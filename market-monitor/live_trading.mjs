export const LIVE_POLL_INTERVAL_MS = 60_000;
export const LIVE_STALE_AFTER_MS = 10 * 60_000;
export const MANUAL_REFRESH_TIMEOUT_MS = 30_000;
export const DEFAULT_MONTHLY_TARGET_CNY = 40_000;
export const PORTFOLIO_GATE_STALE_AFTER_MS = 10 * 60_000;
export const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60_000;

const HEALTHY = "OK";
const DEFAULT_EXPECTED_LIVE_BROKERS = ["Futu", "Tiger"];
const ALLOWED_LIVE_BROKERS = new Set(["Futu", "Tiger", "IBKR"]);
const PORTFOLIO_GATE_VALUES = new Set(["RED", "CLEAR"]);
const RISK_SNAPSHOT_FIELDS = [
  "portfolio_gate",
  "implementation_readiness",
  "derived_nav_usd",
  "gross_market_value_usd",
  "gross_leverage",
  "gross_leverage_red",
  "required_gross_reduction_usd_to_red",
  "highest_leverage_account",
  "highest_account_gross_leverage",
  "maintenance_margin_available",
  "source_retrieved_at",
  "source_status",
  "holdings_as_of",
  "quality_flags",
  "source_label",
  "broker_coverage",
];
const SOURCE_FAILURE_STATES = new Set([
  "EXPECTED_LAG",
  "PARTIAL",
  "STALE",
  "MISSING",
  "FAILED",
]);

export function yearCoverageLabel(coverageStatus) {
  const status = String(coverageStatus || "UNKNOWN").toUpperCase();
  if (status === "COMPLETE") return "年内累计";
  if (status === "PARTIAL") return "可确认覆盖期累计";
  return "累计统计不可确认";
}

export function rowsWithinYearCoverage(rows, period) {
  if (String(period?.coverage_status || "UNKNOWN").toUpperCase() === "UNKNOWN") return [];
  return [...(rows || [])].filter((row) =>
    row?.date &&
    (!period?.start_date || row.date >= period.start_date) &&
    (!period?.end_date || row.date <= period.end_date)
  );
}

export function isPeriodCoverageComplete(period) {
  return String(period?.coverage_status || "UNKNOWN").toUpperCase() === "COMPLETE";
}

export function yearSeriesScope(period, overallComplete) {
  const status = String(period?.coverage_status || "UNKNOWN").toUpperCase();
  if (status === "UNKNOWN") return null;
  if (status === "PARTIAL") return "可确认覆盖期累计";
  return overallComplete ? "年内累计" : "年内可确认金额";
}

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

export function derivePortfolioGateInput(summary, retrievedAt, nowMs = Date.now()) {
  const value = String(summary?.portfolio_gate || "").toUpperCase();
  const sourceStatus = status(summary?.source_status);
  const asOfMs = timestamp(retrievedAt);
  if (!PORTFOLIO_GATE_VALUES.has(value) || asOfMs === null) {
    return { value, status: "MISSING", as_of: retrievedAt || null };
  }
  if (asOfMs > Number(nowMs) + MAX_FUTURE_CLOCK_SKEW_MS) {
    return { value, status: "MISSING", as_of: retrievedAt };
  }
  if (Number(nowMs) - asOfMs > PORTFOLIO_GATE_STALE_AFTER_MS) {
    return { value, status: "STALE", as_of: retrievedAt };
  }
  const knownFreshRed = value === "RED" && ["OK", "PARTIAL"].includes(sourceStatus);
  const completeClear =
    value === "CLEAR" &&
    sourceStatus === "OK" &&
    summary?.implementation_readiness === "CONDITIONAL";
  return {
    value,
    status: knownFreshRed || completeClear ? "OK" : sourceStatus,
    as_of: retrievedAt,
  };
}

export function replaceRiskGateSummary(incoming) {
  return incoming && typeof incoming === "object" && !Array.isArray(incoming)
    ? { ...incoming }
    : {};
}

export function riskSnapshotFingerprint(summary) {
  const source = summary && typeof summary === "object" ? summary : {};
  return JSON.stringify(
    RISK_SNAPSHOT_FIELDS.map((field) => [field, source[field] ?? null]),
  );
}

export function applyLiveRiskGate(personal, incoming) {
  const current = personal && typeof personal === "object" ? personal : {};
  const nextSummary = replaceRiskGateSummary(incoming);
  if (riskSnapshotFingerprint(current.summary) === riskSnapshotFingerprint(nextSummary)) {
    return current;
  }
  return {
    ...current,
    summary: nextSummary,
    alerts: [],
    actions: [],
    positions: [],
    strategy: [],
    live_risk_gate_only: true,
  };
}

/** Build a start-of-session target from the settled monthly gap. */
export function calculateDailyTarget({
  monthlyTargetCny,
  scheduledSessionsInMonth,
  remainingSessionsInMonth,
  settledMtdActiveNetPnlUsd,
  settledThrough,
  targetStatus = "OK",
  calendarStatus,
  usdCnyRate,
  fxStatus,
}) {
  const monthly = finiteNumber(monthlyTargetCny);
  const scheduledSessions = finiteNumber(scheduledSessionsInMonth);
  const remainingSessions = finiteNumber(
    remainingSessionsInMonth ?? scheduledSessionsInMonth,
  );
  const settledMtdUsd = finiteNumber(settledMtdActiveNetPnlUsd);
  const rate = finiteNumber(usdCnyRate);
  const calendarHealth = status(calendarStatus);
  const targetHealth = status(targetStatus);
  const fxHealth = status(fxStatus);
  const base = {
    monthlyTargetCny: monthly,
    scheduledSessionsInMonth: scheduledSessions,
    remainingSessionsInMonth: remainingSessions,
    settledMtdActiveNetPnlUsd: settledMtdUsd,
    settledMtdActiveNetPnlCny: null,
    remainingGapCny: null,
    settledThrough,
    dailyTargetCny: null,
    dailyTargetUsd: null,
    usdCnyRate: rate,
    fxStatus: fxHealth,
  };

  if (targetHealth !== HEALTHY) {
    return {
      ...base,
      status: targetHealth,
      comparisonReady: false,
      reason: "当日目标配置或月内结算覆盖不可用，暂停判断是否达标。",
    };
  }
  if (monthly === null || monthly <= 0) {
    return {
      ...base,
      status: "MISSING",
      comparisonReady: false,
      reason: "未设置有效的月度盈利目标。",
    };
  }
  if (
    calendarHealth !== HEALTHY
    || remainingSessions === null
    || remainingSessions <= 0
    || !Number.isInteger(remainingSessions)
    || settledMtdUsd === null
  ) {
    return {
      ...base,
      status: calendarHealth === HEALTHY ? "MISSING" : calendarHealth,
      comparisonReady: false,
      reason: "NYSE 计划交易日历或月内结算进度不可用，暂停判断是否达标。",
    };
  }
  if (fxHealth !== HEALTHY || rate === null || rate <= 0) {
    return {
      ...base,
      status: fxHealth === HEALTHY ? "MISSING" : fxHealth,
      comparisonReady: false,
      reason: "USD/CNY 汇率缺失或过期，暂停判断是否达标。",
    };
  }

  const settledMtdCny = settledMtdUsd * rate;
  const remainingGapCny = Math.max(monthly - settledMtdCny, 0);
  const dailyTargetCny = remainingGapCny / remainingSessions;
  return {
    ...base,
    status: HEALTHY,
    comparisonReady: true,
    reason: "今日目标按月度剩余缺口与含今日的剩余交易日计算，盘中保持固定。",
    settledMtdActiveNetPnlCny: settledMtdCny,
    remainingGapCny,
    dailyTargetCny,
    dailyTargetUsd: dailyTargetCny / rate,
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
  const financial = liveFinancialComplete({ live, transportStatus, nowMs, staleAfterMs });
  if (!financial.complete) return uncertain(financial.reason, financial.ageMs);
  if (status(transportStatus) !== HEALTHY) {
    return uncertain("实时通道本次检查失败；页面保留上次成功数据，不据此判断是否达标。");
  }

  const ageMs = financial.ageMs;

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

  if (finiteNumber(target.remainingGapCny) === 0) {
    return {
      code: "TARGET_REACHED_STOP",
      tone: "green",
      headline: "本月已结算收益已达到月度目标",
      message: "今日无需用新增交易追求目标；可以停止新增日内风险并保护已实现成果。",
      deterministic: true,
      ageMs,
      pnlCny,
    };
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

export function liveFinancialComplete({
  live,
  transportStatus = HEALTHY,
  nowMs = Date.now(),
  staleAfterMs = LIVE_POLL_INTERVAL_MS * 2,
} = {}) {
  const fail = (reason, ageMs = null) => ({ complete: false, reason, ageMs });
  if (!live || String(live.status || "").toUpperCase() !== "PROVISIONAL") {
    return fail("当前监控日尚无可验证的进行中数据。");
  }
  const liveDataStatus = status(live.data_status);
  if (liveDataStatus !== HEALTHY) {
    return fail(liveDataStatus === "MISSING" && live.data_status === "NO_ACTIVE_SESSION"
      ? "当前没有活跃的美东监控日，只展示最近已结算结果。"
      : `进行中数据状态为 ${live.data_status || "MISSING"}，暂停确定性节奏判断。`);
  }
  if (String(live.realized_coverage_status || "PARTIAL").toUpperCase() !== "COMPLETE") {
    const excluded = Number(live.excluded_instrument_count || 0);
    return fail(`期初持仓或成本批次覆盖不完整${excluded ? `，已排除 ${excluded} 个标的` : ""}；当前金额仅代表可确认部分。`);
  }
  if (status(transportStatus) !== HEALTHY) return fail("实时通道本次检查失败；页面保留上次成功数据，不据此判断是否达标。");
  const checkedAtMs = timestamp(live.checked_at);
  if (checkedAtMs === null) return fail("缺少券商检查时间，无法确认数据新鲜度。");
  if (checkedAtMs > Number(nowMs) + MAX_FUTURE_CLOCK_SKEW_MS) return fail("券商检查时间超出允许的时钟偏差，先核对服务器时间。");
  const ageMs = Math.max(0, Number(nowMs) - checkedAtMs);
  if (!Number.isFinite(ageMs) || ageMs > staleAfterMs) return fail("券商数据已超过两个刷新周期，先主动刷新或核对券商。", ageMs);
  const sources = Array.isArray(live.sources) ? live.sources : [];
  const sourceCounts = new Map();
  sources.forEach((source) => sourceCounts.set(String(source?.broker || ""), (sourceCounts.get(String(source?.broker || "")) || 0) + 1));
  const declaredExpected = Array.isArray(live.expected_brokers) ? live.expected_brokers.map((broker) => String(broker || "")) : DEFAULT_EXPECTED_LIVE_BROKERS;
  const expectedBrokers = new Set(declaredExpected);
  const validShape = expectedBrokers.size === declaredExpected.length && expectedBrokers.has("Futu") && expectedBrokers.has("Tiger") && [...expectedBrokers].every((broker) => ALLOWED_LIVE_BROKERS.has(broker));
  if (!validShape || sources.length !== expectedBrokers.size || ![...expectedBrokers].every((broker) => sourceCounts.get(broker) === 1)) return fail(`${[...expectedBrokers].join("、")} 来源必须各有且仅有一条，当前覆盖不完整。`, ageMs);
  const unhealthy = sources.filter((source) =>
    status(source?.status) !== HEALTHY ||
    !Number.isFinite(Number(source?.fee_coverage_ratio)) ||
    Number(source.fee_coverage_ratio) < 1,
  );
  if (unhealthy.length) return fail(`${unhealthy.map((source) => source.broker || "未知来源").join("、")} 数据或费用覆盖不完整，暂停确定性节奏判断。`, ageMs);
  if (finiteNumber(live.active_net_pnl) === null) return fail("当日已实现净收益缺失，不能按 0 处理。", ageMs);
  return { complete: true, reason: "", ageMs };
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
