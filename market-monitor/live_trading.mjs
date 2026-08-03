export const LIVE_POLL_INTERVAL_MS = 60_000;
export const LIVE_STALE_AFTER_MS = 10 * 60_000;
export const MANUAL_REFRESH_TIMEOUT_MS = 30_000;
export const DEFAULT_MONTHLY_TARGET_CNY = 40_000;
export const PORTFOLIO_GATE_STALE_AFTER_MS = 30 * 60 * 60_000;
export const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60_000;

const HEALTHY = "OK";
const EXPECTED_LIVE_BROKERS = new Set(["Futu", "Tiger"]);
const PORTFOLIO_GATE_VALUES = new Set(["RED", "CLEAR"]);
const SOURCE_FAILURE_STATES = new Set([
  "EXPECTED_LAG",
  "PARTIAL",
  "STALE",
  "MISSING",
  "FAILED",
]);

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function status(value, fallback = "MISSING") {
  const normalized = String(value || fallback).toUpperCase();
  return normalized === HEALTHY || SOURCE_FAILURE_STATES.has(normalized)
    ? normalized
    : fallback;
}

function isoDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

export function deriveFxStatus({ explicitStatus, rate, asOfDate, referenceDate }) {
  const explicit = status(explicitStatus, "");
  if (explicit && explicit !== HEALTHY) return explicit;
  const numericRate = finiteNumber(rate);
  if (numericRate === null || numericRate <= 0) return "MISSING";
  const asOf = isoDay(asOfDate);
  const reference = isoDay(referenceDate);
  if (asOf === null || reference === null || asOf > reference) return "MISSING";
  const calendarAgeDays = Math.floor((reference - asOf) / 86_400_000);
  return calendarAgeDays > 7 ? "STALE" : HEALTHY;
}

/**
 * The exchange calendar remains an upstream fact. This function only divides a
 * configured monthly target by the authoritative number of NYSE sessions.
 */
export function calculateDailyTarget({
  monthlyTargetCny,
  scheduledSessionsInMonth,
  targetStatus = "OK",
  calendarStatus,
  usdCnyRate,
  fxStatus,
}) {
  const monthly = finiteNumber(monthlyTargetCny);
  const sessions = finiteNumber(scheduledSessionsInMonth);
  const rate = finiteNumber(usdCnyRate);
  const calendarHealth = status(calendarStatus);
  const targetHealth = status(targetStatus);
  const fxHealth = status(fxStatus);

  if (targetHealth !== HEALTHY) {
    return {
      status: targetHealth,
      comparisonReady: false,
      reason: "当日目标配置不可用，暂停判断是否达标。",
      monthlyTargetCny: monthly,
      scheduledSessionsInMonth: sessions,
      dailyTargetCny: null,
      dailyTargetUsd: null,
      usdCnyRate: rate,
      fxStatus: fxHealth,
    };
  }
  if (monthly === null || monthly <= 0) {
    return {
      status: "MISSING",
      comparisonReady: false,
      reason: "未设置有效的月度盈利目标。",
      monthlyTargetCny: monthly,
      scheduledSessionsInMonth: sessions,
      dailyTargetCny: null,
      dailyTargetUsd: null,
      usdCnyRate: rate,
      fxStatus: fxHealth,
    };
  }
  if (calendarHealth !== HEALTHY || sessions === null || sessions <= 0 || !Number.isInteger(sessions)) {
    return {
      status: calendarHealth === HEALTHY ? "MISSING" : calendarHealth,
      comparisonReady: false,
      reason: "NYSE 计划交易日历不可用，暂停判断是否达标。",
      monthlyTargetCny: monthly,
      scheduledSessionsInMonth: sessions,
      dailyTargetCny: null,
      dailyTargetUsd: null,
      usdCnyRate: rate,
      fxStatus: fxHealth,
    };
  }

  const dailyTargetCny = monthly / sessions;
  if (fxHealth !== HEALTHY || rate === null || rate <= 0) {
    return {
      status: fxHealth === HEALTHY ? "MISSING" : fxHealth,
      comparisonReady: false,
      reason: "USD/CNY 汇率缺失或过期，暂停判断是否达标。",
      monthlyTargetCny: monthly,
      scheduledSessionsInMonth: sessions,
      dailyTargetCny,
      dailyTargetUsd: null,
      usdCnyRate: rate,
      fxStatus: fxHealth,
    };
  }

  return {
    status: HEALTHY,
    comparisonReady: true,
    reason: "目标按整月计划交易日平均分摊，不追补此前差额。",
    monthlyTargetCny: monthly,
    scheduledSessionsInMonth: sessions,
    dailyTargetCny,
    dailyTargetUsd: dailyTargetCny / rate,
    usdCnyRate: rate,
    fxStatus: fxHealth,
  };
}

function uncertain(reason, ageMs = null) {
  return {
    code: "DATA_UNCERTAIN",
    tone: "amber",
    headline: "数据不确定，先核对券商",
    message: reason,
    deterministic: false,
    ageMs,
  };
}

/**
 * Rules return trading pace guidance, never execution instructions. Unknown
 * inputs stay unknown and always win over target-progress messages.
 */
export function assessLiveTradingSignal({
  live,
  target,
  portfolioGate,
  maximumLossCny,
  transportStatus = HEALTHY,
  nowMs = Date.now(),
  staleAfterMs = LIVE_STALE_AFTER_MS,
}) {
  const gateValue = String(portfolioGate?.value || "").toUpperCase();
  const gateAsOfMs = timestamp(portfolioGate?.as_of);
  const gateAgeMs = gateAsOfMs === null ? null : Math.max(0, Number(nowMs) - gateAsOfMs);
  let gateStatus = status(portfolioGate?.status);
  if (!PORTFOLIO_GATE_VALUES.has(gateValue)) gateStatus = "MISSING";
  if (gateStatus === HEALTHY && gateAsOfMs === null) gateStatus = "MISSING";
  if (gateStatus === HEALTHY && gateAsOfMs > Number(nowMs) + MAX_FUTURE_CLOCK_SKEW_MS) {
    gateStatus = "MISSING";
  }
  if (gateStatus === HEALTHY && gateAgeMs > PORTFOLIO_GATE_STALE_AFTER_MS) gateStatus = "STALE";
  if (gateValue === "RED" && gateStatus === HEALTHY) {
    return {
      code: "PORTFOLIO_RED_STOP",
      tone: "red",
      headline: "组合红色闸门：停止新增日内风险",
      message: "盈利目标进度不能覆盖组合风险；先处理已有敞口并核对保证金。",
      deterministic: true,
      ageMs: null,
      pnlCny: null,
    };
  }
  if (gateStatus !== HEALTHY) {
    return uncertain(
      `组合风险闸门状态为 ${portfolioGate?.status || "MISSING"}，先刷新持仓和保证金信息。`,
    );
  }
  if (!live || String(live.status || "").toUpperCase() !== "PROVISIONAL") {
    return uncertain("当前监控日尚无可验证的进行中数据。");
  }
  const liveDataStatus = status(live.data_status);
  if (liveDataStatus !== HEALTHY) {
    const reason = liveDataStatus === "MISSING" && live.data_status === "NO_ACTIVE_SESSION"
      ? "当前没有活跃的美东监控日，只展示最近已结算结果。"
      : `进行中数据状态为 ${live.data_status || "MISSING"}，暂停确定性节奏判断。`;
    return uncertain(reason);
  }
  if (status(transportStatus) !== HEALTHY) {
    return uncertain("实时通道本次检查失败；页面保留上次成功数据，不据此判断是否达标。");
  }

  const checkedAtMs = timestamp(live.checked_at);
  if (checkedAtMs === null) return uncertain("缺少券商检查时间，无法确认数据新鲜度。");
  if (checkedAtMs > Number(nowMs) + MAX_FUTURE_CLOCK_SKEW_MS) {
    return uncertain("券商检查时间超出允许的时钟偏差，先核对服务器时间。");
  }
  const ageMs = Math.max(0, Number(nowMs) - checkedAtMs);
  if (!Number.isFinite(ageMs) || ageMs > staleAfterMs) {
    return uncertain("券商数据已超过两个刷新周期，先主动刷新或核对券商。", ageMs);
  }

  const sources = Array.isArray(live.sources) ? live.sources : [];
  if (!sources.length) return uncertain("缺少券商来源状态，无法确认收益是否完整。", ageMs);
  const sourceCounts = new Map();
  sources.forEach((source) => {
    const broker = String(source?.broker || "");
    sourceCounts.set(broker, (sourceCounts.get(broker) || 0) + 1);
  });
  const completeSourceShape =
    sourceCounts.size === EXPECTED_LIVE_BROKERS.size &&
    [...EXPECTED_LIVE_BROKERS].every((broker) => sourceCounts.get(broker) === 1);
  if (!completeSourceShape) {
    return uncertain("Futu 与 Tiger 来源必须各有且仅有一条，当前覆盖不完整。", ageMs);
  }
  const unhealthy = sources.filter((source) => status(source?.status) !== HEALTHY);
  if (unhealthy.length) {
    const names = unhealthy.map((source) => source.broker || source.source || "未知来源");
    return uncertain(`${names.join("、")} 数据并非 OK，暂停确定性节奏判断。`, ageMs);
  }

  const activeNetPnl = finiteNumber(live.active_net_pnl);
  if (activeNetPnl === null) return uncertain("当日已实现净收益缺失，不能按 0 处理。", ageMs);
  const fxReady = target?.fxStatus === HEALTHY && finiteNumber(target?.usdCnyRate) > 0;
  const pnlCny = fxReady ? activeNetPnl * target.usdCnyRate : null;

  const lossLimit = finiteNumber(maximumLossCny);
  if (fxReady && lossLimit !== null && lossLimit > 0 && pnlCny <= -lossLimit) {
    return {
      code: "LOSS_LIMIT_STOP",
      tone: "red",
      headline: "已触及当日最大亏损限额",
      message: "停止新增交易并复核成交、费用与仍在场内的风险。",
      deterministic: true,
      ageMs,
      pnlCny,
    };
  }

  if (!target?.comparisonReady) {
    return uncertain(target?.reason || "目标、汇率或交易日历不可用。", ageMs);
  }

  if (pnlCny >= target.dailyTargetCny) {
    return {
      code: "TARGET_REACHED_STOP",
      tone: "green",
      headline: "当日已实现收益达到目标",
      message: "可以停止新增日内交易并处理已有风险；本判断不包含未实现盈亏、开放仓位或挂单。",
      deterministic: true,
      ageMs,
      pnlCny,
    };
  }

  return {
    code: "WAIT_FOR_PLANNED_SETUP",
    tone: "neutral",
    headline: "尚未达到目标，不追目标交易",
    message: "等待原计划内、风险回报合格的机会；未达目标不是继续交易的理由。",
    deterministic: true,
    ageMs,
    pnlCny,
  };
}

export function manualRefreshLabel(state, remainingSeconds = null) {
  const labels = {
    idle: "立即刷新",
    requesting: "正在请求…",
    accepted: "券商查询已排队",
    checking: "正在获取最新成交…",
    updated: "发现新成交并更新",
    current: "已是最新",
    timeout: "查询仍在处理中",
    failed: "刷新失败，重试",
    disabled: "实时通道待启用",
  };
  if (state === "cooldown") {
    const seconds = Math.max(1, Math.ceil(Number(remainingSeconds) || 0));
    return `${seconds} 秒后可刷新`;
  }
  return labels[state] || labels.idle;
}

export function liveFinancialFingerprint(live) {
  if (!live) return "";
  const categoryFields = ["closed_trades", "gross_pnl", "fees", "net_pnl"];
  const category = (value) =>
    Object.fromEntries(categoryFields.map((field) => [field, value?.[field] ?? null]));
  return JSON.stringify({
    active_gross_pnl: live.active_gross_pnl ?? null,
    fees: live.fees ?? null,
    active_net_pnl: live.active_net_pnl ?? null,
    cycle_count: live.cycle_count ?? null,
    intraday: category(live.intraday),
    options: category(live.options),
  });
}

export function resolvePendingManualRefresh(pending, live) {
  if (!pending || !live) return null;
  const previousCheckedAt = timestamp(pending.checkedAt);
  const nextCheckedAt = timestamp(live.checked_at);
  if (nextCheckedAt === null || (previousCheckedAt !== null && nextCheckedAt <= previousCheckedAt)) {
    return null;
  }
  return {
    state:
      liveFinancialFingerprint(live) === pending.financialFingerprint
        ? "current"
        : "updated",
    checkedAt: live.checked_at,
  };
}

export function refreshProofMessage(challenge, requestPath) {
  if (
    challenge?.version !== 1 ||
    challenge?.kdf !== "PBKDF2-SHA-256" ||
    challenge?.proof !== "HMAC-SHA-256" ||
    challenge?.request_path !== requestPath ||
    !challenge?.nonce ||
    !challenge?.expires_at
  ) {
    throw new TypeError("Invalid refresh challenge contract");
  }
  return `POST\n${requestPath}\n${challenge.nonce}\n${challenge.expires_at}`;
}
