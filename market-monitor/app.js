"use strict";

import {
  DEFAULT_MONTHLY_TARGET_CNY,
  LIVE_POLL_INTERVAL_MS,
  MANUAL_REFRESH_TIMEOUT_MS,
  applyLiveRiskGate,
  assessLiveTradingSignal,
  calculateDailyTarget,
  calculateLivingExpenseCoverage,
  combineHealthStatuses,
  deriveFxStatus,
  derivePortfolioGateInput,
  liveFinancialFingerprint,
  liveFinancialComplete,
  isPeriodCoverageComplete,
  manualRefreshLabel,
  periodDisplayGeneratedCashflow,
  refreshProofMessage,
  resolveTradingCashflow,
  resolvePendingManualRefresh,
  rowsWithinYearCoverage,
  yearSeriesScope,
  yearCoverageLabel,
} from "./live_trading.mjs?v=20260808-1";

const payloadUrl = "./payload.enc.json";
let monitorData = null;
let unlockKey = null;
let livePollTimer = null;
let livePollInFlight = null;
let displayCurrency = localStorage.getItem("zzao-monitor-currency") || "USD";
let activeView = localStorage.getItem("zzao-monitor-view") || "personal";
let tradingChartCadence = localStorage.getItem("zzao-monitor-trading-chart") || "day";

const metaContent = (name) =>
  document.querySelector(`meta[name="${name}"]`)?.content?.trim() || "";
const LIVE_CLIENT = Object.freeze({
  payloadUrl: metaContent("zzao-live-payload-url"),
  challengeUrl: metaContent("zzao-live-challenge-url"),
  refreshUrl: metaContent("zzao-live-refresh-url"),
});
const liveRuntime = {
  transportStatus: LIVE_CLIENT.payloadUrl ? "EXPECTED_LAG" : "MISSING",
  pollState: LIVE_CLIENT.payloadUrl ? "idle" : "disabled",
  refreshState: LIVE_CLIENT.refreshUrl ? "idle" : "disabled",
  error: "",
  nextCheckAt: null,
  cooldownUntil: 0,
  pendingRefresh: null,
};

const VIEW_META = {
  personal: {
    eyebrow: "PORTFOLIO RISK",
    title: "持仓风险",
    subtitle: "组合杠杆、风险预算与逐标的行动",
  },
  macro: {
    eyebrow: "MARKET LEVERAGE",
    title: "宏观与板块",
    subtitle: "半导体、存储、核心芯片与纳斯达克压力监测",
  },
  trading: {
    eyebrow: "TRADING REVIEW",
    title: "交易复盘",
    subtitle: "现金创造、长期持仓融资与生活开支覆盖",
  },
};

const byId = (id) => document.getElementById(id);

const TERM_DEFINITIONS = {
  grossLeverage:
    "组合所有多空名义敞口绝对值之和 ÷ 组合净资产（NAV）。上升会放大回撤、融资成本和保证金风险；下降会改善安全垫。",
  deleverAmount:
    "按当前净资产静态估算，把组合毛杠杆降到治理红线所需减少的毛敞口。它不是建议订单金额，执行前必须用券商实时数据重算。",
  attackExposure:
    "高进攻策略的名义毛敞口 ÷ 组合净资产。因为包含融资和名义敞口，该比例可以超过100%。",
  highestAccountLeverage:
    "各券商账户的毛敞口 ÷ 该账户净资产中的最高值。数值越高，该账户通常越容易先受到保证金约束。",
  finraMarginYoy:
    "FINRA 全市场客户融资余额相对上年同期的变化。上升表示融资存量扩张，下降可能是健康降温，也可能是被动去杠杆；该数据按月发布且不能定位具体板块。",
  pricePressure:
    "0–100的历史分位代理，综合短期跌幅、波动、回撤、市场宽度和相关性。上升表示价格型去杠杆压力增强，下降只表示急性压力缓和；它不是实际杠杆率或爆仓概率。",
  fullSessionCoverage:
    "当前价格源对美东时间 [T-1 20:00, T 20:00) 完整监控日的覆盖比例。上升表示夜盘、盘前、正常盘和盘后数据更完整，不代表市场风险上升。",
  return5d:
    "当前价格相对5个交易日前的涨跌幅。下跌越大，短期价格冲击越强；单独上涨不能证明风险已经清除。",
  drawdown20d:
    "当前价格相对过去20个交易日最高价的跌幅。数值越负，近期价格损伤越深。",
  breadth50:
    "板块成分股中价格高于各自50日均线的比例。上升表示上涨或修复扩散，下降表示更多股票跌破中期趋势。",
  volatility20:
    "最近20个交易日日收益率的年化实现波动率。上升表示价格振幅和风险预算消耗加快。",
  correlation20:
    "板块成分股最近20日收益率的平均相关性。快速上升表示个股更容易一起涨跌，常见于系统性卖压，但不能单独证明强平。",
  priceCoverage:
    "该板块配置成分中成功取得可用价格历史的比例。覆盖越低，板块分数和状态的置信度越低。",
  crowdingProxy:
    "价格型拥挤代理：60日动量分位40%＋价格在252日区间的位置35%＋异常成交量分位25%。上升表示趋势交易更集中，但不是实际机构持仓。",
  priceDamage:
    "价格损伤分数：5日跌幅分位40%＋20日波动率分位30%＋20日回撤分位30%。上升表示卖压、波动和回撤综合恶化。",
  tickerRisk:
    "个股风险优先分对应的等级：拥挤代理45%＋价格损伤55%。用于排查优先级，不是自动买卖信号。",
  sourceCoverage:
    "本次运行中该公开数据源成功取得有效观察值的比例。下降表示证据缺口变大，不代表市场风险改善。",
  netTradingPnl:
    "连续 FIFO 账本中，方向相反的成交实际减少已有成本批次时形成的毛收益，减去券商可取得费用。期初成本不明的 carried lot 平仓会被排除；未平仓浮盈亏不计入。",
  grossTradingPnl:
    "已完成交易周期在扣除券商可取得手续费之前的收益。它用于解释成本侵蚀，不代表最终可支配现金。",
  netAfterCosts:
    "现金流创造加上账户实际入账的融资、借券、现金余额及其他利息净额。融资主要服务长期持仓，不归因给日内或期权策略，但会减少可用于生活开支评估的现金。",
  tradeWinRate:
    "盈利的已完成交易周期 ÷ 有明确盈亏的已完成周期。按周期而不是订单或成交笔数统计；样本少时容易失真。",
  profitFactor:
    "盈利周期净利润之和 ÷ 亏损周期净亏损绝对值。大于1表示样本期盈利覆盖亏损，小于1表示策略期望值需要复核。无亏损样本时不显示。",
  cashflowContribution:
    "该来源净现金 ÷（股票日内净收益＋期权净收益＋税后已入账股息）。只在现金流创造总额大于零且来源完整时显示；融资利息不参与策略来源贡献分摊。",
  dividendIncome:
    "已取得的 USD 现金股息减去股息预扣税，为税后股息分红现金流；不含股票送股、资本利得和未入账应收股息。",
  generatedCashflow:
    "已归类为主动交易的股票完整周期（含日内与隔夜）与期权完整周期扣除可取得交易费用后的净收益，加上税后已入账现金股息。用于衡量策略与股息的现金创造能力；不含融资利息、长期资产出售、本金周转和未实现盈亏。",
  livingExpenseCashflow:
    "现金流创造加上账户实际入账的利息净额。用于评估生活开支覆盖，但不等于券商安全可提现金额；实际提现还受结算现金、保证金安全垫和税务准备金约束。",
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function append(parent, ...children) {
  for (const child of children) {
    if (child !== null && child !== undefined) parent.appendChild(child);
  }
  return parent;
}

let activeTermAnchor = null;

function hideTermTooltip() {
  const tooltip = byId("term-tooltip-live");
  if (tooltip) tooltip.hidden = true;
  if (activeTermAnchor) activeTermAnchor.removeAttribute("aria-describedby");
  activeTermAnchor = null;
}

function termTooltipNode() {
  let tooltip = byId("term-tooltip-live");
  if (tooltip) return tooltip;
  tooltip = el("div", "term-tooltip-panel");
  tooltip.id = "term-tooltip-live";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.appendChild(tooltip);
  window.addEventListener("resize", hideTermTooltip);
  window.addEventListener("scroll", hideTermTooltip, true);
  return tooltip;
}

function showTermTooltip(anchor) {
  const definition = anchor.dataset.tooltip;
  if (!definition) return;
  const tooltip = termTooltipNode();
  activeTermAnchor = anchor;
  tooltip.textContent = definition;
  tooltip.hidden = false;
  tooltip.style.left = "0px";
  tooltip.style.top = "0px";
  const anchorRect = anchor.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const margin = 12;
  const gap = 9;
  const left = Math.min(
    window.innerWidth - tooltipRect.width - margin,
    Math.max(margin, anchorRect.left),
  );
  const below = anchorRect.bottom + gap;
  const top =
    below + tooltipRect.height <= window.innerHeight - margin
      ? below
      : Math.max(margin, anchorRect.top - tooltipRect.height - gap);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  anchor.setAttribute("aria-describedby", tooltip.id);
}

function term(label, definition, className = "") {
  const node = el("span", `term-tooltip ${className}`.trim(), label);
  node.dataset.tooltip = definition;
  node.tabIndex = 0;
  node.setAttribute("aria-label", `${label}：${definition}`);
  node.addEventListener("mouseenter", () => showTermTooltip(node));
  node.addEventListener("mouseleave", hideTermTooltip);
  node.addEventListener("focus", () => showTermTooltip(node));
  node.addEventListener("blur", hideTermTooltip);
  node.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideTermTooltip();
      node.blur();
    }
  });
  return node;
}

function b64bytes(value) {
  const normalized = String(value || "").replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesB64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function importUnlockKey(password) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
}

async function decryptEnvelope(envelope, passwordKey) {
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: b64bytes(envelope.salt),
      iterations: envelope.iterations,
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: b64bytes(envelope.iv),
      tagLength: 128,
    },
    key,
    b64bytes(envelope.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

async function fetchEncryptedPayload(url, passwordKey) {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "omit",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("加密数据未能读取，请稍后重试。");
  return decryptEnvelope(await response.json(), passwordKey);
}

async function decryptPayload(password) {
  const key = await importUnlockKey(password);
  return { data: await fetchEncryptedPayload(payloadUrl, key), key };
}

function pct(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  const safeDigits =
    Number.isInteger(digits) && digits >= 0 && digits <= 20 ? digits : 1;
  return `${(Number(value) * 100).toFixed(safeDigits)}%`;
}

function number(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  const safeDigits =
    Number.isInteger(digits) && digits >= 0 && digits <= 20 ? digits : 1;
  return Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: safeDigits,
    maximumFractionDigits: safeDigits,
  });
}

function isFiniteMetric(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function usd(value, compact = false) {
  if (!isFiniteMetric(value)) return "—";
  const fx = Number(monitorData?.meta?.usd_cny_rate);
  const useCny = displayCurrency === "CNY" && Number.isFinite(fx) && fx > 0;
  const amount = Number(value) * (useCny ? fx : 1);
  return new Intl.NumberFormat(useCny ? "zh-CN" : "en-US", {
    style: "currency",
    currency: useCny ? "CNY" : "USD",
    minimumFractionDigits: compact === true ? 0 : 2,
    maximumFractionDigits: compact === true ? 1 : 2,
    notation: compact === true ? "compact" : "standard",
  }).format(amount);
}

function cny(value) {
  if (!isFiniteMetric(value)) return "—";
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function usdExact(value) {
  if (!isFiniteMetric(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function readPositiveLocalNumber(key) {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function liveTarget(trading) {
  const live = trading.live || null;
  const localMonthlyTarget = readPositiveLocalNumber("zzao-monitor-monthly-target-cny");
  const monthlyTargetCny =
    localMonthlyTarget ??
    live?.target?.monthly_target_cny ??
    trading.plan?.monthly_target_cny ??
    DEFAULT_MONTHLY_TARGET_CNY;
  return calculateDailyTarget({
    monthlyTargetCny,
    scheduledSessionsInMonth:
      live?.calendar?.scheduled_sessions_in_month ?? live?.scheduled_sessions_in_month,
    remainingSessionsInMonth: live?.target?.remaining_sessions_in_month,
    settledMtdActiveNetPnlUsd: live?.target?.settled_mtd_active_net_pnl_usd,
    settledThrough: live?.target?.settled_through,
    targetStatus: live?.target?.status ?? (Number(monthlyTargetCny) > 0 ? "OK" : "MISSING"),
    calendarStatus: live?.calendar?.status ?? live?.calendar_status,
    usdCnyRate: monitorData?.meta?.usd_cny_rate,
    fxStatus: deriveFxStatus({
      explicitStatus: monitorData?.meta?.usd_cny_status,
      rate: monitorData?.meta?.usd_cny_rate,
      asOfDate: monitorData?.meta?.usd_cny_as_of,
      referenceDate: live?.monitoring_day || easternCalendarDate(),
    }),
  });
}

function easternCalendarDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function liveSignal(trading) {
  return assessLiveTradingSignal({
    live: trading.live,
    target: liveTarget(trading),
    portfolioGate: portfolioGateInput(),
    maximumLossCny: readPositiveLocalNumber("zzao-monitor-maximum-loss-cny"),
    transportStatus: liveRuntime.transportStatus,
  });
}

function portfolioGateInput() {
  const summary = monitorData?.personal?.summary || {};
  const retrievedAt = monitorData?.meta?.portfolio_retrieved_at;
  return derivePortfolioGateInput(summary, retrievedAt);
}

function liveTime(value) {
  const parsed = typeof value === "number" ? value : Date.parse(value || "");
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "America/New_York",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(new Date(parsed));
}

function liveAge(ageMs) {
  if (ageMs === null || ageMs === undefined || !Number.isFinite(Number(ageMs))) return "未知";
  const seconds = Math.max(0, Math.floor(Number(ageMs) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function renderLiveOnly() {
  if (!monitorData || byId("dashboard").hidden) return;
  const region = byId("trading-live-region");
  if (!region) return;
  region.replaceChildren(renderLiveTrading(monitorData.trading || {}));
  if (activeView === "personal") renderPersonal();
}

function mergeLivePayload(payload) {
  const incomingTrading = payload?.trading;
  const incomingLive = incomingTrading?.live;
  if (!incomingLive || typeof incomingLive !== "object") {
    throw new Error("实时数据格式不完整，已保留上次成功数据。");
  }
  const normalizedLive = {
    ...incomingLive,
    checked_at: incomingLive.checked_at || incomingTrading.meta?.checked_at,
    sources: Array.isArray(incomingLive.sources)
      ? incomingLive.sources
      : Array.isArray(incomingTrading.sources)
        ? incomingTrading.sources
        : [],
  };
  const incomingCheckedAt = Date.parse(normalizedLive.checked_at || "");
  if (!Number.isFinite(incomingCheckedAt)) {
    throw new Error("实时数据缺少有效检查时间，已保留上次成功数据。");
  }
  const previousCheckedAt = Date.parse(monitorData.trading?.live?.checked_at || "");
  if (Number.isFinite(previousCheckedAt) && incomingCheckedAt < previousCheckedAt) {
    throw new Error("实时数据版本早于当前页面，已保留较新的数据。");
  }

  const previousLive = monitorData.trading?.live;
  const heartbeatAdvanced =
    incomingCheckedAt > (Number.isFinite(previousCheckedAt) ? previousCheckedAt : 0);
  const financialChanged =
    liveFinancialFingerprint(normalizedLive) !== liveFinancialFingerprint(previousLive);
  monitorData.trading = {
    ...monitorData.trading,
    live: normalizedLive,
    plan:
      incomingTrading.plan && typeof incomingTrading.plan === "object"
        ? incomingTrading.plan
        : monitorData.trading?.plan,
  };
  const incomingRiskGate = payload?.personal?.risk_gate;
  if (incomingRiskGate && typeof incomingRiskGate === "object") {
    monitorData.personal = applyLiveRiskGate(monitorData.personal, incomingRiskGate);
    monitorData.meta = {
      ...monitorData.meta,
      portfolio_retrieved_at: incomingRiskGate.source_retrieved_at || null,
    };
  }
  return { heartbeatAdvanced, financialChanged };
}

async function checkLivePayload() {
  if (!LIVE_CLIENT.payloadUrl || !unlockKey || !monitorData) return false;
  if (livePollInFlight) return livePollInFlight;
  const sessionKey = unlockKey;
  liveRuntime.pollState = "checking";
  liveRuntime.error = "";
  renderLiveOnly();
  livePollInFlight = (async () => {
    try {
      const payload = await fetchEncryptedPayload(LIVE_CLIENT.payloadUrl, sessionKey);
      if (unlockKey !== sessionKey || !monitorData) {
        return { heartbeatAdvanced: false, financialChanged: false, cancelled: true };
      }
      const outcome = mergeLivePayload(payload);
      liveRuntime.transportStatus = "OK";
      liveRuntime.pollState = "idle";
      const completion = resolvePendingManualRefresh(
        liveRuntime.pendingRefresh,
        monitorData.trading?.live,
      );
      if (completion) {
        liveRuntime.refreshState = completion.state;
        liveRuntime.pendingRefresh = null;
      }
      return outcome;
    } catch (error) {
      liveRuntime.transportStatus = "FAILED";
      liveRuntime.pollState = "failed";
      liveRuntime.error = error instanceof Error ? error.message : "实时通道检查失败。";
      return { heartbeatAdvanced: false, financialChanged: false, failed: true };
    } finally {
      livePollInFlight = null;
      renderLiveOnly();
    }
  })();
  return livePollInFlight;
}

function stopLivePolling() {
  if (livePollTimer) window.clearTimeout(livePollTimer);
  livePollTimer = null;
  liveRuntime.nextCheckAt = null;
}

function scheduleLivePolling(delayMs = LIVE_POLL_INTERVAL_MS) {
  stopLivePolling();
  if (!LIVE_CLIENT.payloadUrl || !unlockKey || document.hidden) return;
  liveRuntime.nextCheckAt = Date.now() + delayMs;
  renderLiveOnly();
  livePollTimer = window.setTimeout(async () => {
    livePollTimer = null;
    await checkLivePayload();
    scheduleLivePolling();
  }, delayMs);
}

async function deriveRefreshProof(challenge, requestPath) {
  if (!unlockKey) throw new Error("页面已锁定，请重新解锁。");
  const salt = b64bytes(challenge.salt);
  const iterations = Number(challenge.iterations);
  if (!salt.length || !Number.isInteger(iterations) || iterations < 100_000) {
    throw new Error("刷新 challenge 参数无效。");
  }
  const proofKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    unlockKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
  const message = refreshProofMessage(challenge, requestPath);
  const signature = await crypto.subtle.sign(
    "HMAC",
    proofKey,
    new TextEncoder().encode(message),
  );
  return bytesB64Url(signature);
}

async function requestManualRefresh() {
  if (!LIVE_CLIENT.challengeUrl || !LIVE_CLIENT.refreshUrl || !unlockKey) return;
  if (Date.now() < liveRuntime.cooldownUntil) {
    renderLiveOnly();
    return;
  }
  stopLivePolling();
  liveRuntime.refreshState = "requesting";
  liveRuntime.error = "";
  renderLiveOnly();
  const previousCheckedAt = monitorData.trading?.live?.checked_at || null;
  try {
    const challengeResponse = await fetch(LIVE_CLIENT.challengeUrl, {
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    if (!challengeResponse.ok) throw new Error("无法取得单次刷新凭证。");
    const challenge = await challengeResponse.json();
    const refreshPath = new URL(LIVE_CLIENT.refreshUrl, window.location.href).pathname;
    const proof = await deriveRefreshProof(challenge, refreshPath);
    const refreshResponse = await fetch(LIVE_CLIENT.refreshUrl, {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        nonce: challenge.nonce,
        expires_at: challenge.expires_at,
        proof,
      }),
    });
    const result = await refreshResponse.json().catch(() => ({}));
    if (refreshResponse.status === 429) {
      const cooldownSeconds = Math.max(1, Number(result.retry_after_seconds) || 60);
      liveRuntime.cooldownUntil = Date.now() + cooldownSeconds * 1000;
      liveRuntime.refreshState = "cooldown";
      liveRuntime.pendingRefresh = null;
      return;
    }
    if (refreshResponse.status !== 202) throw new Error(result.message || "刷新请求未被接受。");
    liveRuntime.pendingRefresh = {
      checkedAt: previousCheckedAt,
      financialFingerprint: liveFinancialFingerprint(monitorData.trading?.live),
    };
    liveRuntime.refreshState = result.status === "merged" ? "checking" : "accepted";
    renderLiveOnly();

    const deadline = Date.now() + MANUAL_REFRESH_TIMEOUT_MS;
    let completed = false;
    let financialChanged = false;
    while (Date.now() < deadline && unlockKey) {
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      if (!unlockKey || !monitorData) return;
      liveRuntime.refreshState = "checking";
      const outcome = await checkLivePayload();
      const nextCheckedAt = monitorData.trading?.live?.checked_at || null;
      if (outcome?.heartbeatAdvanced && nextCheckedAt !== previousCheckedAt) {
        completed = true;
        financialChanged = outcome.financialChanged;
        break;
      }
    }
    liveRuntime.refreshState = completed
      ? financialChanged
        ? "updated"
        : "current"
      : "timeout";
    if (completed) liveRuntime.pendingRefresh = null;
    liveRuntime.cooldownUntil = Math.max(liveRuntime.cooldownUntil, Date.now() + 60_000);
  } catch (error) {
    liveRuntime.refreshState = "failed";
    liveRuntime.pendingRefresh = null;
    liveRuntime.error = error instanceof Error ? error.message : "主动刷新失败。";
  } finally {
    renderLiveOnly();
    scheduleLivePolling();
  }
}

function riskClass(value) {
  const text = String(value || "").toUpperCase();
  if (text.includes("RED") || text.includes("极端") || text.includes("S4")) return "red";
  if (text.includes("高") || text.includes("S3") || text.includes("S2") || text.includes("PARTIAL")) {
    return "amber";
  }
  if (text.includes("GREEN") || text.includes("S6") || text.includes("OK")) return "green";
  return "";
}

function actionTone(label) {
  const text = String(label || "");
  if (
    ["停止新增杠杆", "降杠杆至红线以下", "优先核对账户保证金", "优先减仓复核"].some(
      (item) => text.includes(item),
    )
  ) {
    return "tone-red";
  }
  if (
    ["暂停加仓", "等待确认", "等待压力", "减仓或保护复核", "持有但不加仓", "控制追涨"].some(
      (item) => text.includes(item),
    )
  ) {
    return "tone-amber";
  }
  if (["小仓分批买入候选", "修复候选"].some((item) => text.includes(item))) {
    return "tone-green";
  }
  return "tone-neutral";
}

function portfolioMetricGuidance(summary) {
  const leverage = isFiniteMetric(summary.gross_leverage)
    ? Number(summary.gross_leverage)
    : null;
  const leverageRed = isFiniteMetric(summary.gross_leverage_red)
    ? Number(summary.gross_leverage_red)
    : null;
  const attackExposure = isFiniteMetric(summary.attack_exposure_pct_nav)
    ? Number(summary.attack_exposure_pct_nav)
    : null;
  const attackTarget = isFiniteMetric(summary.attack_target_pct_nav)
    ? Number(summary.attack_target_pct_nav)
    : null;
  return {
    leverage: {
      definition: TERM_DEFINITIONS.grossLeverage,
      meaning: "↑ 回撤与保证金敏感度增加；↓ 强平安全垫改善。",
      action:
        leverage !== null &&
        leverageRed !== null &&
        leverage > leverageRed
          ? `高于 ${number(leverageRed, 2)}x 红线：停止新增杠杆，先降到红线以下。`
          : leverage === null
            ? "账户覆盖或关键字段不完整：当前不能计算组合毛杠杆，先以券商原生红灯阻断新增风险。"
            : "未越过红线：仍需按券商实时保证金维持安全垫。",
      tone:
        leverage !== null &&
        leverageRed !== null &&
        leverage > leverageRed
          ? "tone-red"
          : "tone-neutral",
    },
    reduction: {
      definition: TERM_DEFINITIONS.deleverAmount,
      meaning: "↑ 离治理红线更远；↓ 更接近风险预算范围。",
      action: "先用券商实时 NAV、融资负债和 house requirement 重算，再决定账户与手数。",
      tone: "tone-red",
    },
    attack: {
      definition: TERM_DEFINITIONS.attackExposure,
      meaning: "↑ 高波动与集中度风险增加；↓ 风险预算逐步恢复。",
      action:
        attackExposure !== null &&
        attackTarget !== null &&
        attackExposure > attackTarget
          ? `高于 ${pct(attackTarget)} 目标：优先复核大额高进攻敞口。`
          : attackExposure === null || attackTarget === null
            ? "策略分类或目标不可用：不据此判断敞口是否处于预算内。"
            : "处于目标内：按 thesis 与风险预算维护，不因短期价格单独加仓。",
      tone:
        attackExposure !== null &&
        attackTarget !== null &&
        attackExposure > attackTarget
          ? "tone-red"
          : "tone-neutral",
    },
    account: {
      definition: TERM_DEFINITIONS.highestAccountLeverage,
      meaning: "↑ 账户更容易先触发保证金约束；↓ 账户安全垫改善。",
      action: `${summary.highest_leverage_account || "最高杠杆账户"}：优先核对实时 house requirement 与压力价格。`,
      tone: "tone-red",
    },
  };
}

function marginMetricGuidance(value) {
  const yoy = Number(value);
  return {
    definition: TERM_DEFINITIONS.finraMarginYoy,
    meaning: "↑ 全市场融资存量扩张、潜在脆弱性累积；↓ 可能是降温，也可能是被动去杠杆。",
    action:
      Number.isFinite(yoy) && yoy > 0
        ? "融资同比仍为正：高价格压力下不新增杠杆，并监控宽度与信用确认。"
        : Number.isFinite(yoy)
          ? "融资同比收缩：先判断健康降温还是被动出清，不直接把下降当买点。"
          : "数据缺失或滞后：不据此改变仓位，等待下一次正式更新。",
    tone: Number.isFinite(yoy) && yoy > 0 ? "tone-amber" : "tone-neutral",
  };
}

function pressureMetricGuidance(universe) {
  const state = universe.state_code || "S0";
  const actions = {
    S4: "优先降低风险并核对保证金；不要在强制去杠杆证据期接飞刀。",
    S3: "避免杠杆抄底；压力连续3日低于70且宽度改善后再重估。",
    S2: "不追涨、不加杠杆；等待压力清除或新的基本面证据。",
    S1: "控制追涨，在既定风险预算内持有并监控宽度背离。",
    S5: "只建立观察清单；等待趋势、宽度和第二证据族确认。",
    S6: "个人风险闸门通过后，才考虑无杠杆、小仓、分批执行。",
    S0: "信号正常或不足；不因单一分位改变仓位。",
  };
  const tones = {
    S4: "tone-red",
    S3: "tone-amber",
    S2: "tone-amber",
    S1: "tone-amber",
    S5: "tone-neutral",
    S6: "tone-green",
    S0: "tone-neutral",
  };
  return {
    definition: TERM_DEFINITIONS.pricePressure,
    meaning: "↑ 卖压、波动、回撤或同步下跌增强；↓ 只表示急性压力缓和。",
    action: actions[state] || actions.S0,
    tone: tones[state] || tones.S0,
  };
}

function coverageMetricGuidance(value) {
  const coverage = Number(value);
  return {
    definition: TERM_DEFINITIONS.fullSessionCoverage,
    meaning: "↑ 数据更完整、判断置信度提高；↓ 盲区扩大，不代表市场风险下降。",
    action:
      Number.isFinite(coverage) && coverage < 0.7
        ? "完整时段覆盖不足：仅作正常盘代理，不单独确认强制去杠杆。"
        : "时段覆盖较充分：仍需结合资金流、融资与信用证据确认状态。",
    tone:
      Number.isFinite(coverage) && coverage < 0.7
        ? "tone-amber"
        : "tone-neutral",
  };
}

function metricGuidance(label, text, tone = "") {
  const row = el("div", `metric-guidance-row ${tone}`.trim());
  append(
    row,
    el("span", "metric-guidance-label", label),
    el("p", "", text),
  );
  return row;
}

function metricCard(label, value, note, options = {}) {
  const card = el("article", `metric-card ${options.tone || ""}`.trim());
  const labelNode = options.definition
    ? term(label, options.definition, "metric-label")
    : el("div", "metric-label", label);
  append(
    card,
    labelNode,
    el("div", "metric-value", value),
    el("p", "metric-note", note),
  );
  if (options.meaning || options.action) {
    const guidance = el("div", "metric-guidance");
    if (options.meaning) {
      guidance.appendChild(metricGuidance("怎么读", options.meaning));
    }
    if (options.action) {
      guidance.appendChild(
        metricGuidance("当前行动", options.action, options.tone || ""),
      );
    }
    card.appendChild(guidance);
  }
  return card;
}

function section(title, copy) {
  const card = el("section", "section-card");
  const head = el("div", "section-head");
  const wrap = el("div");
  append(wrap, el("h2", "", title), el("p", "section-copy", copy));
  head.appendChild(wrap);
  card.appendChild(head);
  return card;
}

function table(columns, rows) {
  const wrap = el("div", "table-wrap");
  const tableNode = el("table");
  const thead = el("thead");
  const headerRow = el("tr");
  columns.forEach((column) => {
    const header = el("th");
    header.appendChild(
      column.definition
        ? term(column.label, column.definition)
        : document.createTextNode(column.label),
    );
    headerRow.appendChild(header);
  });
  thead.appendChild(headerRow);
  const tbody = el("tbody");
  rows.forEach((row) => {
    const tr = el("tr");
    columns.forEach((column) => {
      const td = el("td", column.numeric ? "num" : "");
      const value = column.render ? column.render(row[column.key]) : row[column.key];
      if (value instanceof Node) td.appendChild(value);
      else td.textContent = value ?? "—";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  append(tableNode, thead, tbody);
  wrap.appendChild(tableNode);
  return wrap;
}

function renderActionList(actions) {
  const list = el("div", "action-list");
  actions.forEach((action) => {
    const tone = actionTone(action.action_label);
    const card = el("article", `action-card ${tone}`);
    const content = el("div");
    const top = el("div", "action-topline");
    append(
      top,
      el("span", `action-label ${tone}`, action.action_label),
      el("span", "action-entity", action.entity_label || action.entity),
    );
    const details = el("div", "fact-stack");
    const fact = el("span");
    append(fact, el("b", "", "事实 · "), document.createTextNode(action.fact || "—"));
    const inference = el("span");
    append(inference, el("b", "", "推断 · "), document.createTextNode(action.inference || "—"));
    const condition = el("span");
    append(
      condition,
      el("b", "", "执行条件 · "),
      document.createTextNode(action.execution_condition || "—"),
    );
    append(details, fact, inference, condition);
    append(content, top, el("p", "", action.action), details);
    append(card, el("div", "action-rank", action.priority_rank), content);
    list.appendChild(card);
  });
  return list;
}

function renderPositionRows(positions) {
  const list = el("div", "position-list");
  positions.forEach((position) => {
    const tone = actionTone(position.action_label);
    const card = el("article", `position-row ${tone}`);
    const identity = el("div", "position-identity");
    append(
      identity,
      el("strong", "", position.ticker),
      el("span", "", position.strategy || "未分类"),
    );
    const exposure = el("div", "position-exposure");
    append(
      exposure,
      el("strong", "", pct(position.pct_nav)),
      el("span", "", `${usd(position.market_value_usd, true)} 名义敞口`),
    );
    const message = el("div", "position-message");
    append(
      message,
      el(
        "span",
        `action-label ${tone}`,
        position.action_label,
      ),
      el("p", "", position.suggested_action),
      el(
        "span",
        "position-state",
        `${position.market_state || "UNMAPPED"} · ${position.data_readiness || "—"}`,
      ),
    );
    append(card, identity, exposure, message);
    list.appendChild(card);
  });
  return list;
}

function renderPersonal() {
  const root = byId("personal-content");
  root.replaceChildren();
  const data = monitorData.personal;
  const summary = data.summary;
  const personalAlert = (data.alerts || [])[0];
  const sourceStatus = String(summary.source_status || "MISSING").toUpperCase();
  const isRed = summary.portfolio_gate === "RED";
  const sourceLabel = summary.source_label || "持仓风险快照";
  const brokerNativeSource = String(sourceLabel).startsWith("Futu/Tiger");
  const sourceIncomplete = sourceStatus !== "OK" && brokerNativeSource;
  const sourceUncertain = sourceStatus !== "OK" && !isRed;
  const liveGateOnly = data.live_risk_gate_only === true;
  const coverage = Number(summary.broker_coverage);
  const coverageText = Number.isFinite(coverage)
    ? `，券商覆盖 ${(coverage * 100).toFixed(0)}%`
    : "";

  const banner = el("section", `risk-banner ${summary.portfolio_gate === "RED" ? "" : "amber"}`);
  const bannerText = el("div");
  append(
    bannerText,
    el(
      "h2",
      "",
      isRed
        ? "组合红色闸门"
        : sourceUncertain
        ? "券商账户数据不确定"
        : personalAlert?.headline || "个人风险预算",
    ),
    el(
      "p",
      "",
      isRed
        ? `${sourceLabel}触发风险阻断（${summary.quality_flags || "红色风险证据"}）；来源状态 ${sourceStatus}${coverageText}。停止新增风险，券商原生来源不完整时不推导具体减仓标的或金额。`
        : sourceUncertain
        ? `${sourceLabel}来源状态为 ${sourceStatus}；先刷新来源数据再判断。`
        : personalAlert?.evidence ||
          `当前组合毛杠杆 ${number(summary.gross_leverage, 2)}x，风险闸门 ${summary.portfolio_gate}。`,
    ),
  );
  append(banner, el("div", "risk-bar"), bannerText);
  root.appendChild(banner);

  const metrics = el("section", "metric-grid");
  const guidance = portfolioMetricGuidance(summary);
  const metricCards = [
    metricCard(
      "组合毛杠杆",
      isFiniteMetric(summary.gross_leverage)
        ? `${number(summary.gross_leverage, 2)}x`
        : "—",
      `治理红线 ${number(summary.gross_leverage_red, 2)}x`,
      guidance.leverage,
    ),
  ];
  if (isFiniteMetric(summary.derived_nav_usd)) {
    metricCards.unshift(
      metricCard(
        "券商账户净资产",
        usd(summary.derived_nav_usd, true),
        "Futu/Tiger net liquidation 合计",
        {
          definition: "两家券商本次快照返回的账户净清算值合计，不含未接入的银行、基金或其它券商资产。",
          meaning: "它是组合毛杠杆的分母；下降会使同样的毛敞口对应更高杠杆。",
          action: "与券商 App 的账户权益核对；来源不完整时不据此调整仓位。",
          tone: "tone-neutral",
        },
      ),
    );
  }
  if (isFiniteMetric(summary.gross_market_value_usd)) {
    metricCards.push(
      metricCard(
        "绝对毛持仓价值",
        usd(summary.gross_market_value_usd, true),
        "多空绝对值合计，不做方向抵消",
        {
          definition: "券商账户股票与期权多空持仓价值的绝对值合计，用于观察总风险占用而非净方向。",
          meaning: "↑ 总风险占用扩大；↓ 组合去杠杆，但不代表一定盈利或亏损。",
          action: "结合净资产、保证金和逐标的集中度判断，不单独用该金额做买卖决定。",
          tone: "tone-neutral",
        },
      ),
    );
  }
  if (
    isFiniteMetric(summary.required_gross_reduction_usd_to_red) &&
    Number(summary.required_gross_reduction_usd_to_red) > 0
  ) {
    metricCards.push(metricCard(
      "回到红线需降毛敞口",
      usd(summary.required_gross_reduction_usd_to_red, true),
      "静态一阶估算，执行前须用券商实时数据重算",
      guidance.reduction,
    ));
  }
  if (isFiniteMetric(summary.attack_exposure_pct_nav)) {
    metricCards.push(metricCard(
      "高进攻敞口 / NAV",
      pct(summary.attack_exposure_pct_nav),
      `目标 ${pct(summary.attack_target_pct_nav)}`,
      guidance.attack,
    ));
  }
  if (isFiniteMetric(summary.highest_account_gross_leverage)) {
    metricCards.push(metricCard(
      "最高账户杠杆",
      `${number(summary.highest_account_gross_leverage, 2)}x`,
      `${summary.highest_leverage_account || "—"} · 先核对 house requirement`,
      guidance.account,
    ));
  }
  append(metrics, ...metricCards);
  root.appendChild(metrics);

  const actions = section("今天先做什么", "按个人风险预算排序；不是自动交易指令。");
  const visibleActions = isRed
    ? [
        {
          priority_rank: 1,
          action_label: "停止新增杠杆",
          entity_label: "组合整体",
          fact: `${sourceLabel}触发 ${summary.quality_flags || "RED"}；来源状态 ${sourceStatus}${coverageText}。`,
          inference: "盈利目标与旧机会信号不能覆盖当前组合风险。",
          execution_condition: "先在券商 App 核对账户、保证金和开放仓位；只有完整新快照恢复 CLEAR 后再重新评估。",
          action: "停止新增日内和期权风险；本实时聚合不提供具体减仓标的或手数。",
        },
      ]
    : sourceUncertain
      ? [
        {
          priority_rank: 1,
          action_label: "先刷新券商数据",
          entity_label: "Futu / Tiger",
          fact: `账户风险来源状态为 ${sourceStatus}，无法确认当前组合闸门。`,
          inference: "旧的持仓动作可能已过期，不应继续展示为当前建议。",
          execution_condition: "两家券商来源均恢复为 OK，且账户快照不超过 10 分钟。",
          action: "刷新券商账户净值、毛持仓与保证金信息；恢复前停止依据本页增加风险。",
        },
        ]
      : liveGateOnly
        ? [
            {
              priority_rank: 1,
              action_label: "等待确认",
              entity_label: "组合整体",
              fact: "实时账户闸门为 CLEAR，但逐标的派生分析已因新快照而失效。",
              inference: "旧快照生成的机会与持仓动作不再作为当前建议展示。",
              execution_condition: "等待下一次完整页面计算，或只在券商 App 中按既定计划人工复核。",
              action: "不依据旧逐标的动作新增风险；完整页面刷新后再评估。",
            },
          ]
        : data.actions || [];
  actions.appendChild(renderActionList(visibleActions));
  root.appendChild(actions);

  const positions = section("持仓风险与行动", "仅显示个人持仓事实和对应风险动作，不混入宏观板块列表。");
  if (sourceIncomplete || liveGateOnly) {
    positions.appendChild(
      el(
        "p",
        "section-note",
        isRed
          ? "红色闸门的账户覆盖不完整或实时快照已变化；请在券商 App 核对开放仓位，本页不猜测具体减仓标的。"
          : "账户快照已变化或不完整；暂不展示可能已经过期的逐标的动作。",
      ),
    );
  } else {
    positions.appendChild(renderPositionRows(data.positions || []));
  }
  root.appendChild(positions);

  const strategyRows = sourceIncomplete || liveGateOnly
    ? []
    : (data.strategy || []).filter(
        (row) => Number.isFinite(Number(row.target_pct_nav)),
      );
  if (strategyRows.length) {
    const strategy = section("策略敞口与目标", "实际敞口按组合 NAV 重算。");
    strategy.appendChild(table(
      [
        { key: "strategy", label: "策略" },
        { key: "actual_pct_nav", label: "实际 / NAV", numeric: true, render: pct },
        { key: "target_pct_nav", label: "目标 / NAV", numeric: true, render: pct },
        { key: "gap_pct_nav", label: "偏离", numeric: true, render: pct },
        { key: "actual_market_value_usd", label: "毛敞口", numeric: true, render: usd },
      ],
      strategyRows,
    ));
    root.appendChild(strategy);
  }
}

function cadenceLabel(value, period = null) {
  if (value === "year") {
    return yearCoverageLabel(period?.coverage_status);
  }
  return { day: "本日", week: "本周", month: "本月" }[value] || value;
}

function tradingSourcesComplete(trading) {
  const expected = Array.isArray(trading.expected_brokers)
    ? trading.expected_brokers
    : ["Futu", "Tiger"];
  const sources = Array.isArray(trading.sources) ? trading.sources : [];
  const counts = new Map();
  sources.forEach((source) => {
    const broker = String(source?.broker || "");
    counts.set(broker, (counts.get(broker) || 0) + 1);
  });
  const sourcesComplete =
    expected.length > 0 &&
    new Set(expected).size === expected.length &&
    sources.length === expected.length &&
    expected.every((broker) => {
      const source = sources.find((row) => row?.broker === broker);
      return counts.get(broker) === 1 &&
        source?.status === "OK" &&
        Number(source?.fee_coverage_ratio) >= 1;
    });
  return sourcesComplete;
}

function periodCashflowHealth(trading, period) {
  const expected = Array.isArray(trading?.expected_brokers)
    ? trading.expected_brokers
    : ["Futu", "Tiger"];
  const sources = Array.isArray(trading?.sources) ? trading.sources : [];
  const sourceStatuses = expected.map((broker) => {
    const matches = sources.filter((source) => source?.broker === broker);
    if (matches.length !== 1) return "MISSING";
    if (!Number.isFinite(Number(matches[0]?.fee_coverage_ratio))) return "MISSING";
    if (Number(matches[0].fee_coverage_ratio) < 1) return "PARTIAL";
    return matches[0]?.status;
  });
  if (new Set(expected).size !== expected.length || sources.length !== expected.length) {
    sourceStatuses.push("MISSING");
  }
  return combineHealthStatuses([
    ...sourceStatuses,
    period?.coverage_status,
    period?.realized_coverage_status,
    period?.active_scope_coverage_status,
    period?.dividend_coverage_status ?? period?.passive_cashflow_coverage_status,
    period?.interest_coverage_status ?? period?.passive_cashflow_coverage_status,
  ]);
}

function settledPeriodComplete(trading, period) {
  return periodCashflowHealth(trading, period) === "OK";
}

function periodGeneratedCashflow(period) {
  return resolveTradingCashflow(period).generated;
}

function periodAccountInterest(period) {
  return resolveTradingCashflow(period).interest;
}

function periodLivingExpenseCashflow(period) {
  return resolveTradingCashflow(period).living;
}

function livingExpenseCoverage(period, trading) {
  const cashflowHealth = periodCashflowHealth(trading, period);
  const generatedAtMs = Date.parse(monitorData?.meta?.generated_at || "");
  const referenceDate = easternCalendarDate(
    Number.isFinite(generatedAtMs) ? new Date(generatedAtMs) : new Date(),
  );
  const fxStatus = deriveFxStatus({
    explicitStatus: monitorData?.meta?.usd_cny_status,
    rate: monitorData?.meta?.usd_cny_rate,
    asOfDate: monitorData?.meta?.usd_cny_as_of,
    referenceDate,
  });
  return calculateLivingExpenseCoverage({
    monthlyTargetCny:
      readPositiveLocalNumber("zzao-monitor-monthly-target-cny") ??
      trading?.plan?.monthly_target_cny ??
      DEFAULT_MONTHLY_TARGET_CNY,
    livingExpenseNetCashflowUsd: periodLivingExpenseCashflow(period),
    usdCnyRate: monitorData?.meta?.usd_cny_rate,
    coverageStatus: cashflowHealth,
    fxStatus,
  });
}

function tradingAction(period, portfolioSummary, coverageComplete = true) {
  if (!coverageComplete) {
    return "数据覆盖不完整：仅用于核对，不据此判断可分配现金、扩大仓位或结束当日交易。";
  }
  const trades = Number(period.intraday_closed_trades || 0) + Number(period.option_closed_trades || 0);
  const pnl = Number(period.active_net_pnl || 0);
  const weak = [period.intraday_profit_factor, period.option_profit_factor]
    .filter((value) => value !== null && value !== undefined)
    .some((value) => Number(value) < 1);
  if (!trades) return "尚无已完成周期；不要把未平仓浮盈当作可分配现金。";
  if (trades < 20) return "已完成周期少于20个：胜率与利润因子仅作早期观察，不据此放大仓位。";
  if (pnl < 0 || weak) return "净收益为负或利润因子低于1：缩小单笔风险，先复盘亏损集中来源。";
  if (Number(periodLivingExpenseCashflow(period)) < 0) {
    return "账户生活开支评估净现金流为负：融资成本已超过本期现金创造；缺口不构成追单理由。";
  }
  if (portfolioSummary.portfolio_gate === "RED") {
    return "组合仍处红色风险闸门：已实现现金优先降低融资与补足安全垫，不扩大杠杆。";
  }
  return "先保留税费与风险准备金；仅将稳定、可重复的已实现净现金按风险预算再分配。";
}

function cashflowMetric(label, amount, definition, emphasis = false) {
  const item = el("div", `cashflow-metric ${emphasis ? "primary" : ""}`.trim());
  const numericAmount = Number(amount);
  const valueClass = Number.isFinite(numericAmount)
    ? numericAmount < 0
      ? "negative"
      : numericAmount > 0
        ? "positive"
        : ""
    : "";
  append(
    item,
    term(label, definition, "cashflow-metric-label"),
    el("strong", `cashflow-metric-value ${valueClass}`.trim(), usd(amount)),
  );
  return item;
}

function negativeMetric(value) {
  return isFiniteMetric(value) ? -Number(value) : null;
}

function cashflowGroup(title, subtitle, tone, metrics, footer) {
  const group = el("section", `cashflow-group ${tone}`);
  const head = el("div", "cashflow-group-head");
  append(head, el("strong", "", title), el("span", "", subtitle));
  const list = el("div", "cashflow-metric-list");
  metrics.forEach((metric) => {
    list.appendChild(
      cashflowMetric(metric.label, metric.value, metric.definition, metric.primary),
    );
  });
  append(group, head, list, el("p", "cashflow-group-footer", footer));
  return group;
}

function renderTradingPerformance(trading, portfolioSummary) {
  const sources = trading.sources || [];
  const connected = sources.filter((row) => row.status === "OK");
  const card = section(
    "现金流创造与生活开支覆盖",
    "美东 [T-1 20:00, T 20:00) 为一日；现金创造只统计已完成交易周期和税后已入账股息，长期持仓融资单列。",
  );
  const sourceLine = el("div", "broker-source-line");
  if (!sources.length) {
    sourceLine.appendChild(el("span", "broker-source missing", "Futu / Tiger API 未连接"));
  } else {
    sources.forEach((source) => {
      const statusClass = source.status === "OK" ? "ok" : source.status === "FAILED" ? "failed" : "missing";
      const chip = el("span", `broker-source ${statusClass}`);
      const backfillStart = source.backfill_start || trading.meta?.backfill_start;
      const latestDate = String(source.latest_observation_at || "").slice(0, 10);
      const scope = backfillStart ? `${backfillStart} 起累计` : "累计";
      const freshness = latestDate ? ` · 最新成交 ${latestDate}` : "";
      chip.title = [
        `${scope}成交记录；不是当日成交笔数。`,
        latestDate ? `最近一笔成交时间：${source.latest_observation_at}` : "",
        source.notes || "",
      ].filter(Boolean).join("\n");
      chip.textContent = `${source.broker} · ${source.status === "OK" ? `${scope} ${Number(source.records || 0).toLocaleString()} 笔${freshness}` : source.status}`;
      sourceLine.appendChild(chip);
    });
  }
  card.appendChild(sourceLine);

  if (!connected.length) {
    const empty = el("div", "trading-empty");
    append(
      empty,
      el("strong", "", "等待只读 API 授权"),
      el("p", "", "连接后将自动回填 2026-01-01 起的美股与期权成交，并按日 / 周 / 月 / 年计算净收益、胜率与现金流贡献。"),
    );
    card.appendChild(empty);
    return card;
  }

  const periodList = el("div", "trading-period-list");
  (trading.periods || []).forEach((period) => {
    const realizedComplete = period?.realized_coverage_status === "COMPLETE";
    const historyComplete = isPeriodCoverageComplete(period);
    const coverageComplete = settledPeriodComplete(trading, period);
    const displayedGeneratedCashflow = periodDisplayGeneratedCashflow(period, coverageComplete);
    const accountInterest = periodAccountInterest(period);
    const livingCashflow = periodLivingExpenseCashflow(period);
    const expenseCoverage = livingExpenseCoverage(period, trading);
    const periodTone = isFiniteMetric(displayedGeneratedCashflow)
      ? Number(displayedGeneratedCashflow) < 0 ? "tone-red" : "tone-green"
      : "";
    const row = el("article", `trading-period ${periodTone}`.trim());
    const head = el("div", "trading-period-head");
    append(
      head,
      el("strong", "", cadenceLabel(period.cadence, period)),
      el("span", "", `${period.start_date || "起点未知"} — ${period.end_date}`),
    );
    const primary = el(
      "div",
      `trading-primary ${
        isFiniteMetric(displayedGeneratedCashflow)
          ? Number(displayedGeneratedCashflow) < 0 ? "loss" : "win"
          : ""
      }`.trim(),
    );
    const primaryCopy = el("div");
    append(
      primaryCopy,
      term(
        coverageComplete ? "现金流创造" : "已确认现金流创造",
        TERM_DEFINITIONS.generatedCashflow,
        "trading-primary-label",
      ),
      el(
        "span",
        "trading-primary-formula",
        coverageComplete
          ? "主动股票净收益（含已归类隔夜）+ 期权净收益 + 税后股息"
          : period.active_scope_coverage_status !== "COMPLETE"
            ? `另有 ${period.unclassified_overnight_realization_count || 0} 笔隔夜股票待归类；完整总额未知`
          : !realizedComplete
            ? `已排除期初成本不明的 ${(period.excluded_instruments || []).join("、") || "未知标的"}`
            : !historyComplete
              ? `仅统计 ${period.start_date || "未知起点"} — ${period.end_date} 的可确认历史`
            : (period.dividend_coverage_status ?? period.passive_cashflow_coverage_status) !== "COMPLETE"
              ? "股息流水未覆盖全部券商；缺失不可按零处理"
              : "券商来源或费用覆盖不完整，仅供核对",
      ),
    );
    append(
      primary,
      primaryCopy,
      el("strong", "trading-primary-value", usd(displayedGeneratedCashflow)),
    );
    const bridge = el("div", "cashflow-bridge");
    const interestRow = el("div", "cashflow-bridge-row");
    append(
      interestRow,
      el("span", "", "长期持仓融资及账户利息"),
      el("strong", Number(accountInterest) < 0 ? "negative" : "", usd(accountInterest)),
    );
    const livingRow = el("div", "cashflow-bridge-row result");
    append(
      livingRow,
      term("生活开支评估净现金流", TERM_DEFINITIONS.livingExpenseCashflow),
      el("strong", Number(livingCashflow) < 0 ? "negative" : "positive", usd(livingCashflow)),
    );
    append(bridge, interestRow, livingRow);
    if (period.cadence === "month") {
      const coverageRow = el("div", "cashflow-bridge-row target");
      const coverageLabel = expenseCoverage.status === "OK"
        ? `月生活现金流目标覆盖 ${pct(expenseCoverage.coverageRatio)}`
        : "月生活现金流目标覆盖待确认";
      const variance = expenseCoverage.status === "OK"
        ? expenseCoverage.surplusCny >= 0
          ? `盈余 ${cny(expenseCoverage.surplusCny)}`
          : `缺口 ${cny(Math.abs(expenseCoverage.surplusCny))}`
        : "—";
      append(coverageRow, el("span", "", coverageLabel), el("strong", "", variance));
      bridge.appendChild(coverageRow);
      bridge.appendChild(el("p", "cashflow-bridge-note", expenseCoverage.reason));
    }
    const inputsHead = el("div", "cashflow-input-head");
    append(
      inputsHead,
      el("strong", "", "现金流输入拆解"),
      el("span", "", "按类别从未扣成本金额核对到实际净入账"),
    );
    const inputs = el("div", "cashflow-groups");
    append(
      inputs,
      cashflowGroup(
        "股票主动交易",
        `${number(period.intraday_closed_trades, 0)} 个日内 + ${number(period.overnight_equity_closed_trades, 0)} 个已归类隔夜周期`,
        "stock",
        [
          { label: "毛收益（未扣手续费）", value: period.active_equity_gross_pnl, definition: TERM_DEFINITIONS.grossTradingPnl },
          { label: "手续费成本", value: negativeMetric(period.active_equity_fees), definition: "已分摊到主动股票完整周期的佣金及费用，以负数显示。" },
          { label: "扣费后主动净收益", value: period.active_equity_net_pnl, definition: TERM_DEFINITIONS.netTradingPnl, primary: true },
        ],
        `其中日内 ${usd(period.intraday_net_pnl)} · 已归类隔夜 ${usd(period.overnight_equity_net_pnl)} · 现金流贡献 ${pct(period.active_equity_cashflow_contribution)}`,
      ),
      cashflowGroup(
        "期权",
        `${number(period.option_closed_trades, 0)} 个完成周期`,
        "option",
        [
          { label: "毛收益（未扣手续费）", value: period.option_gross_pnl, definition: TERM_DEFINITIONS.grossTradingPnl },
          { label: "手续费成本", value: negativeMetric(period.option_fees), definition: "已分摊到期权完整持仓周期的佣金及费用，以负数显示。" },
          { label: "扣费后净入账", value: period.option_net_pnl, definition: TERM_DEFINITIONS.netTradingPnl, primary: true },
        ],
        `胜率 ${pct(period.option_win_rate)} · 利润因子 ${number(period.option_profit_factor, 2)} · 现金流贡献 ${pct(period.option_cashflow_contribution)}`,
      ),
      cashflowGroup(
        "股息分红",
        "已入账 USD 现金股息",
        "dividend",
        [
          { label: "税前现金股息", value: period.dividend_gross_cashflow, definition: "券商已入账的 USD 现金股息毛额，尚未扣除股息预扣税。" },
          { label: "股息预扣税", value: period.dividend_tax_cashflow, definition: "券商已入账的 USD 股息预扣税，通常为负值。" },
          { label: "税后实际入账", value: period.dividend_cashflow, definition: TERM_DEFINITIONS.dividendIncome, primary: true },
        ],
        `现金流贡献 ${pct(period.dividend_cashflow_contribution)} · 不含未入账应收股息`,
      ),
      cashflowGroup(
        "长期持仓融资",
        "账户级现金调整",
        "cost",
        [
          { label: "现金流创造", value: displayedGeneratedCashflow, definition: TERM_DEFINITIONS.generatedCashflow },
          { label: "融资 / 借券 / 其他利息", value: accountInterest, definition: "服务长期持仓的融资成本及账户其他已入账利息净额；负值减少生活开支可用现金，但不归因给日内或期权策略。" },
          { label: "生活开支评估净现金流", value: livingCashflow, definition: TERM_DEFINITIONS.livingExpenseCashflow, primary: true },
        ],
        "不等于安全可提现金额；仍需结算现金、保证金安全垫与税务准备金。",
      ),
    );
    const scopeNote = period.cashflow_scope === "ACTIVE_PLUS_PASSIVE"
      ? `贡献度只分解主动股票、期权和税后股息；长期持仓融资利息仅调整生活开支评估净现金流${period.long_term_realization_count ? `；已排除 ${period.long_term_realization_count} 笔长期资产处置` : ""}${period.excluded_non_usd_cashflow_records ? `；另有 ${period.excluded_non_usd_cashflow_records} 条非 USD 流水未换汇、已排除` : ""}。`
      : `${period.passive_cashflow_coverage_reason || "股息 / 利息流水覆盖不完整。"} 当前金额仅含可确认来源，不可作为可分配现金、追加交易或结束当日交易的依据。`;
    const coverageNote = !realizedComplete
      ? `Realized 配对仅部分覆盖：排除 ${period.excluded_instrument_count || 0} 个标的、${period.excluded_realization_count || 0} 笔无法可靠配对的平仓；不得把本卡金额视为账户全部已实现收益。`
      : period.active_scope_coverage_status !== "COMPLETE"
        ? `有 ${period.unclassified_overnight_realization_count || 0} 笔隔夜股票尚未标记为主动或长期；已确认小计不代表完整总额。`
      : period.coverage_status === "PARTIAL"
        ? "Realized 配对覆盖完整，但历史范围不完整；本卡金额只代表上述实际覆盖期。"
        : period.coverage_status === "UNKNOWN"
          ? "共同历史起点无法确认，未生成确定性累计金额。"
            : (period.dividend_coverage_status ?? period.passive_cashflow_coverage_status) !== "COMPLETE" ||
                (period.interest_coverage_status ?? period.passive_cashflow_coverage_status) !== "COMPLETE"
              ? "股息或利息现金流水覆盖不完整；本卡仅显示可确认来源金额。"
              : coverageComplete
            ? "Realized 与历史覆盖完整。"
            : "券商来源或费用覆盖不完整，本卡仅用于核对。";
    const advice = el(
      "p",
      "trading-advice",
      `${period.coverage_reason || ""} ${coverageNote} ${tradingAction(period, portfolioSummary, coverageComplete)} ${scopeNote}`,
    );
    append(row, head, primary, bridge, inputsHead, inputs, advice);
    periodList.appendChild(row);
  });
  card.appendChild(periodList);
  if ((trading.strategies || []).length) {
    const breakdownTitle = el("h3", "trading-breakdown-title", "回填期收益来源");
    const breakdown = el("div", "trading-breakdown");
    trading.strategies.slice(0, 12).forEach((item) => {
      const row = el("div", `trading-breakdown-row ${Number(item.net_pnl) < 0 ? "loss" : "win"}`);
      const identity = el("div");
      append(
        identity,
        el("strong", "", item.symbol),
        el("span", "", `${item.broker} · ${item.category}`),
      );
      const result = el("div", "trading-breakdown-result");
      append(
        result,
        el("strong", "", usd(item.net_pnl)),
        el("span", "", `${item.closed_trades} 个周期 · 胜率 ${pct(item.win_rate)}`),
      );
      append(row, identity, result);
      breakdown.appendChild(row);
    });
    append(card, breakdownTitle, breakdown);
  }
  if (trading.meta?.methodology) {
    card.appendChild(el("p", "trading-method", trading.meta.methodology));
  }
  return card;
}

function chartCashflowValues(row) {
  const generated = periodGeneratedCashflow(row);
  const interest = periodAccountInterest(row);
  const living = periodLivingExpenseCashflow(row);
  return { generated, interest, living };
}

function tradingChartSeries(rows, cadence, yearPeriod = null, yearComplete = false, sourcesComplete = false) {
  if (cadence === "year" && yearPeriod?.coverage_status === "UNKNOWN") return [];
  const components = [
    "intraday_net_pnl",
    "option_net_pnl",
    "dividend_cashflow",
    "account_interest_cashflow",
    "fees",
  ];
  const normalized = (row, labels = {}) => {
    const values = chartCashflowValues(row);
    return {
      ...labels,
      value: values.generated,
      livingValue: values.living,
      ...Object.fromEntries(components.map((key) => [
        key,
        key === "account_interest_cashflow"
          ? values.interest
          : isFiniteMetric(row[key]) ? Number(row[key]) : null,
      ])),
      coverageComplete: Boolean(
      sourcesComplete &&
      row.realized_coverage_status === "COMPLETE" &&
      row.active_scope_coverage_status === "COMPLETE" &&
      (row.dividend_coverage_status ?? row.passive_cashflow_coverage_status) === "COMPLETE" &&
      (row.interest_coverage_status ?? row.passive_cashflow_coverage_status) === "COMPLETE" &&
      (cadence === "year" ? yearComplete : true),
      ),
    };
  };
  const scopedRows = cadence === "year" ? rowsWithinYearCoverage(rows, yearPeriod) : [...(rows || [])];
  const ordered = scopedRows
    .filter((row) => row.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (cadence === "day") {
    return ordered
      .filter((row) => isFiniteMetric(chartCashflowValues(row).generated))
      .slice(-30)
      .map((row) => normalized(row, { label: row.date.slice(5), fullLabel: row.date }));
  }
  const groups = new Map();
  ordered.forEach((row) => {
    const date = new Date(`${row.date}T00:00:00Z`);
    let key;
    if (cadence === "week") {
      const monday = new Date(date);
      monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
      key = monday.toISOString().slice(0, 10);
    } else {
      key = row.date.slice(0, 7);
    }
    const group = groups.get(key) || {
      generated_cashflow: 0,
      living_expense_net_cashflow: 0,
      ...Object.fromEntries(components.map((component) => [component, 0])),
      coverageComplete: true,
      generatedKnown: true,
      componentsKnown: true,
      livingKnown: true,
    };
    const cashflow = chartCashflowValues(row);
    if (isFiniteMetric(cashflow.generated)) group.generated_cashflow += Number(cashflow.generated);
    else group.generatedKnown = false;
    if (isFiniteMetric(cashflow.living)) group.living_expense_net_cashflow += Number(cashflow.living);
    else group.livingKnown = false;
    components.forEach((component) => {
      const value = component === "account_interest_cashflow"
        ? cashflow.interest
        : row[component];
      if (isFiniteMetric(value)) group[component] += Number(value);
      else group.componentsKnown = false;
    });
    group.coverageComplete = group.coverageComplete &&
      row.realized_coverage_status === "COMPLETE" &&
      row.active_scope_coverage_status === "COMPLETE" &&
      (row.dividend_coverage_status ?? row.passive_cashflow_coverage_status) === "COMPLETE" &&
      (row.interest_coverage_status ?? row.passive_cashflow_coverage_status) === "COMPLETE";
    groups.set(key, group);
  });
  let series = [...groups.entries()].map(([key, row]) => {
    const normalizedRow = normalized({
      ...row,
      realized_coverage_status: row.generatedKnown ? "COMPLETE" : "UNKNOWN",
      dividend_coverage_status: row.generatedKnown ? "COMPLETE" : "UNKNOWN",
      interest_coverage_status: row.livingKnown ? "COMPLETE" : "UNKNOWN",
      living_expense_net_cashflow: row.livingKnown
        ? row.living_expense_net_cashflow
        : null,
      investable_cashflow: null,
    }, {
      label: cadence === "week" ? key.slice(5) : key,
      fullLabel: cadence === "week" ? `周起始 ${key}` : key,
    });
    return {
      ...normalizedRow,
      coverageComplete: Boolean(
        sourcesComplete && row.coverageComplete && row.componentsKnown &&
        (cadence === "year" ? yearComplete : true),
      ),
    };
  });
  if (cadence === "week") return series.filter((row) => isFiniteMetric(row.value)).slice(-16);
  if (cadence === "month") return series.filter((row) => isFiniteMetric(row.value)).slice(-12);
  const latestYear = series.at(-1)?.label.slice(0, 4);
  series = series.filter((row) => row.label.startsWith(latestYear));
  const cumulative = {
    value: 0,
    livingValue: 0,
    ...Object.fromEntries(components.map((component) => [component, 0])),
  };
  return series.map((row) => {
    Object.keys(cumulative).forEach((key) => {
      if (isFiniteMetric(cumulative[key]) && isFiniteMetric(row[key])) {
        cumulative[key] += Number(row[key]);
      } else {
        cumulative[key] = null;
      }
    });
    const scope = yearSeriesScope(yearPeriod, yearComplete);
    return { ...row, ...cumulative, fullLabel: `${row.fullLabel} ${scope}` };
  }).filter((row) => isFiniteMetric(row.value));
}

function renderTradingCashflowChart(trading) {
  const yearPeriod = (trading.periods || []).find((period) => period.cadence === "year");
  const yearComplete = Boolean(yearPeriod && settledPeriodComplete(trading, yearPeriod));
  const yearScope = yearSeriesScope(yearPeriod, yearComplete);
  const descriptions = {
    day: "最近30个有记录的美东监控日；实线为现金流创造，辅线为扣除账户利息后的生活开支评估净现金流。",
    week: "最近16周；按周汇总现金流创造，并单列长期持仓融资对生活现金的影响。",
    month: "最近12个月；按月比较现金流创造与生活开支评估净现金流。",
    year: yearPeriod?.coverage_status === "PARTIAL"
      ? yearPeriod.coverage_reason
      : yearPeriod?.coverage_status === "UNKNOWN"
        ? "共同历史覆盖起点未知，不生成确定性年内累计。"
        : yearComplete
          ? "本年度按月累计现金流创造与生活开支评估净现金流"
          : "自然年历史存在，但 realized、券商来源、股息或利息覆盖不完整；以下仅为年内可确认金额。",
  };
  const card = section("现金流创造与生活开支趋势", descriptions[tradingChartCadence]);
  const controls = el("div", "chart-cadence-control");
  [["day", "日"], ["week", "周"], ["month", "月"], ["year", "年"]].forEach(
    ([value, label]) => {
      const button = el("button", "chart-cadence-button", label);
      button.type = "button";
      button.setAttribute("aria-pressed", String(value === tradingChartCadence));
      button.addEventListener("click", () => {
        tradingChartCadence = value;
        localStorage.setItem("zzao-monitor-trading-chart", value);
        renderTrading();
      });
      controls.appendChild(button);
    },
  );
  card.querySelector(".section-head").appendChild(controls);

  const series = tradingChartSeries(
    trading.daily,
    tradingChartCadence,
    yearPeriod,
    yearComplete,
    tradingSourcesComplete(trading),
  );
  if (!series.length) {
    card.appendChild(el(
      "p",
      "trading-chart-empty",
      tradingChartCadence === "year" && yearPeriod?.coverage_status === "UNKNOWN"
        ? "共同历史覆盖起点无法确认，未绘制年内累计。"
        : "当前时间范围没有可绘制的已入账数据。",
    ));
    return card;
  }

  const latest = series.at(-1);
  const summary = el("div", "trading-chart-summary");
  append(
    summary,
    el("span", "", latest.fullLabel),
    el("strong", Number(latest.value) < 0 ? "negative" : "positive", `创造 ${usd(latest.value)}`),
    el("strong", Number(latest.livingValue) < 0 ? "negative" : "", `生活净额 ${usd(latest.livingValue)}`),
  );
  card.appendChild(summary);

  const width = 820;
  const height = 250;
  const left = 72;
  const right = 20;
  const top = 18;
  const bottom = 215;
  const values = series.flatMap((row) =>
    [row.value, row.livingValue].filter(isFiniteMetric).map(Number),
  );
  let minimum = Math.min(0, ...values);
  let maximum = Math.max(0, ...values);
  if (minimum === maximum) {
    minimum -= 1;
    maximum += 1;
  }
  const padding = (maximum - minimum) * 0.08;
  minimum -= padding;
  maximum += padding;
  const y = (value) =>
    top + ((maximum - Number(value)) / (maximum - minimum)) * (bottom - top);
  const x = (index) =>
    series.length === 1
      ? (left + width - right) / 2
      : left + (index / (series.length - 1)) * (width - left - right);

  const wrap = el("div", "trading-chart-wrap");
  const previousTooltip = byId("trading-chart-tooltip");
  if (previousTooltip) previousTooltip.remove();
  const tooltip = el("div", "trading-chart-tooltip");
  tooltip.id = "trading-chart-tooltip";
  tooltip.setAttribute("role", "status");
  tooltip.setAttribute("aria-live", "polite");
  tooltip.hidden = true;
  let pinnedPoint = null;
  let activePoint = null;
  let guideLine = null;
  const clearActivePoint = () => {
    activePoint?.classList.remove("active");
    activePoint = null;
    if (guideLine) guideLine.setAttribute("visibility", "hidden");
  };
  const closeTooltip = () => {
    pinnedPoint = null;
    tooltip.hidden = true;
    clearActivePoint();
  };
  const showPointTooltip = (anchor, row, pin = false) => {
    if (pin) pinnedPoint = pinnedPoint === anchor ? null : anchor;
    if (pin && !pinnedPoint) {
      tooltip.hidden = true;
      return;
    }
    const head = el("div", "trading-chart-tooltip-head");
    const close = el("button", "trading-chart-tooltip-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "关闭数据提示");
    close.addEventListener("click", closeTooltip);
    append(head, el("strong", "", row.fullLabel), close);
    const total = el("div", "trading-chart-tooltip-total");
    append(
      total,
      el("span", "", row.coverageComplete ? "现金流创造" : "可确认现金流创造"),
      el("strong", Number(row.value) < 0 ? "negative" : "positive", usd(row.value)),
    );
    const livingTotal = el("div", "trading-chart-tooltip-total secondary");
    append(
      livingTotal,
      el("span", "", "生活开支评估净现金流"),
      el("strong", Number(row.livingValue) < 0 ? "negative" : "positive", usd(row.livingValue)),
    );
    const details = el("div", "trading-chart-tooltip-details");
    [
      ["股票日内净入账", row.intraday_net_pnl],
      ["期权净入账", row.option_net_pnl],
      ["税后股息", row.dividend_cashflow],
      ["长期持仓融资 / 其他利息", row.account_interest_cashflow],
      ["手续费（已含在交易净额）", isFiniteMetric(row.fees) ? -Math.abs(Number(row.fees)) : null],
    ].forEach(([label, value]) => {
      const detail = el("div");
      append(detail, el("span", "", label), el("strong", "", usd(value)));
      details.appendChild(detail);
    });
    tooltip.replaceChildren(head, total, livingTotal, details);
    tooltip.hidden = false;
    tooltip.style.left = "0px";
    tooltip.style.top = "0px";
    const anchorRect = anchor.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const margin = 12;
    const center = anchorRect.left + anchorRect.width / 2;
    const leftPosition = Math.min(
      window.innerWidth - tooltipRect.width - margin,
      Math.max(margin, center - tooltipRect.width / 2),
    );
    const above = anchorRect.top - tooltipRect.height - 10;
    const topPosition = above >= margin ? above : anchorRect.bottom + 10;
    tooltip.style.left = `${leftPosition}px`;
    tooltip.style.top = `${topPosition}px`;
  };
  document.body.appendChild(tooltip);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "trading-cashflow-chart");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", `${yearScope || "现金流"}${descriptions[tradingChartCadence]}双折线图`);

  [maximum, 0, minimum].forEach((value) => {
    const line = document.createElementNS(svg.namespaceURI, "line");
    line.setAttribute("x1", String(left));
    line.setAttribute("x2", String(width - right));
    line.setAttribute("y1", String(y(value)));
    line.setAttribute("y2", String(y(value)));
    line.setAttribute("class", value === 0 ? "trading-chart-zero" : "trading-chart-grid");
    svg.appendChild(line);
    const label = document.createElementNS(svg.namespaceURI, "text");
    label.setAttribute("x", String(left - 9));
    label.setAttribute("y", String(y(value) + 4));
    label.setAttribute("text-anchor", "end");
    label.setAttribute("class", "trading-chart-axis-label");
    label.textContent = usd(value, true);
    svg.appendChild(label);
  });

  const polyline = document.createElementNS(svg.namespaceURI, "polyline");
  polyline.setAttribute(
    "points",
    series.map((row, index) => `${x(index)},${y(row.value)}`).join(" "),
  );
  polyline.setAttribute("class", "trading-chart-line");
  svg.appendChild(polyline);

  if (series.every((row) => isFiniteMetric(row.livingValue))) {
    const livingPolyline = document.createElementNS(svg.namespaceURI, "polyline");
    livingPolyline.setAttribute(
      "points",
      series.map((row, index) => `${x(index)},${y(row.livingValue)}`).join(" "),
    );
    livingPolyline.setAttribute("class", "trading-chart-line living");
    svg.appendChild(livingPolyline);
  }

  guideLine = document.createElementNS(svg.namespaceURI, "line");
  guideLine.setAttribute("y1", String(top));
  guideLine.setAttribute("y2", String(bottom));
  guideLine.setAttribute("class", "trading-chart-guide");
  guideLine.setAttribute("visibility", "hidden");
  svg.appendChild(guideLine);

  const points = series.map((row, index) => {
    const point = document.createElementNS(svg.namespaceURI, "circle");
    point.setAttribute("cx", String(x(index)));
    point.setAttribute("cy", String(y(row.value)));
    point.setAttribute("r", "3.5");
    point.setAttribute("tabindex", "0");
    point.setAttribute("role", "button");
    point.setAttribute(
      "aria-label",
      `${row.fullLabel}，${row.coverageComplete ? "现金流创造" : "可确认现金流创造"} ${usd(row.value)}，` +
      `生活开支评估净现金流 ${usd(row.livingValue)}，` +
      `股票 ${usd(row.intraday_net_pnl)}，期权 ${usd(row.option_net_pnl)}，` +
      `税后股息 ${usd(row.dividend_cashflow)}，利息 ${usd(row.account_interest_cashflow)}，` +
      `手续费 ${usd(negativeMetric(row.fees))}`,
    );
    point.setAttribute("aria-describedby", tooltip.id);
    point.setAttribute("class", Number(row.value) < 0 ? "trading-chart-point loss" : "trading-chart-point win");
    const title = document.createElementNS(svg.namespaceURI, "title");
    title.textContent = `${row.fullLabel}：创造 ${usd(row.value)}；生活净额 ${usd(row.livingValue)}`;
    point.appendChild(title);
    svg.appendChild(point);
    return point;
  });

  const activatePoint = (index, pin = false) => {
    const point = points[index];
    const row = series[index];
    if (!point || !row) return;
    activePoint?.classList.remove("active");
    activePoint = point;
    activePoint.classList.add("active");
    guideLine.setAttribute("x1", String(x(index)));
    guideLine.setAttribute("x2", String(x(index)));
    guideLine.removeAttribute("visibility");
    showPointTooltip(point, row, pin);
    if (pin && !pinnedPoint) clearActivePoint();
  };

  points.forEach((point, index) => {
    point.addEventListener("focus", () => activatePoint(index));
    point.addEventListener("blur", () => {
      if (!pinnedPoint) {
        tooltip.hidden = true;
        clearActivePoint();
      }
    });
    point.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activatePoint(index, true);
      }
      if (event.key === "Escape") closeTooltip();
    });
  });
  [0, series.length - 1].forEach((index) => {
    if (index < 0 || !series[index]) return;
    const label = document.createElementNS(svg.namespaceURI, "text");
    label.setAttribute("x", String(x(index)));
    label.setAttribute("y", String(height - 10));
    label.setAttribute("text-anchor", index === 0 ? "start" : "end");
    label.setAttribute("class", "trading-chart-axis-label");
    label.textContent = series[index].label;
    svg.appendChild(label);
  });

  const hitArea = document.createElementNS(svg.namespaceURI, "rect");
  hitArea.setAttribute("x", String(left));
  hitArea.setAttribute("y", String(top));
  hitArea.setAttribute("width", String(width - left - right));
  hitArea.setAttribute("height", String(bottom - top));
  hitArea.setAttribute("class", "trading-chart-hit-area");
  const nearestPointIndex = (event) => {
    const matrix = svg.getScreenCTM();
    let localX;
    if (matrix) {
      const pointer = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      localX = pointer.x;
    } else {
      const bounds = svg.getBoundingClientRect();
      localX = ((event.clientX - bounds.left) / bounds.width) * width;
    }
    if (series.length === 1) return 0;
    const ratio = (localX - left) / (width - left - right);
    return Math.max(0, Math.min(series.length - 1, Math.round(ratio * (series.length - 1))));
  };
  hitArea.addEventListener("pointermove", (event) => {
    if (!pinnedPoint) activatePoint(nearestPointIndex(event));
  });
  hitArea.addEventListener("pointerleave", () => {
    if (!pinnedPoint) {
      tooltip.hidden = true;
      clearActivePoint();
    }
  });
  hitArea.addEventListener("click", (event) => {
    activatePoint(nearestPointIndex(event), true);
  });
  svg.appendChild(hitArea);
  wrap.appendChild(svg);
  card.appendChild(wrap);
  return card;
}

function liveSourceRows(live) {
  const list = el("div", "live-source-list");
  const sources = Array.isArray(live?.sources) ? live.sources : [];
  if (!sources.length) {
    list.appendChild(el("div", "live-source-row missing", "券商来源状态缺失"));
    return list;
  }
  sources.forEach((source) => {
    const sourceStatus = String(source.status || "MISSING").toUpperCase();
    const row = el("div", `live-source-row ${sourceStatus === "OK" ? "ok" : "warning"}`);
    append(
      row,
      el("strong", "", source.broker || source.source || "未知来源"),
      el("span", "", sourceStatus),
      el("small", "", source.notes || "只读成交与可取得费用"),
    );
    list.appendChild(row);
  });
  return list;
}

function liveBrokerIndicator(source) {
  const broker = source?.broker || source?.source || "未知来源";
  const sourceStatus = String(source?.status || "MISSING").toUpperCase();
  const tone = sourceStatus === "OK"
    ? "ok"
    : sourceStatus === "FAILED"
      ? "failed"
      : sourceStatus === "PARTIAL" || sourceStatus === "STALE"
        ? "warning"
        : "missing";
  const indicator = el("span", `live-broker-indicator ${tone}`);
  indicator.setAttribute("aria-label", `${broker} ${sourceStatus}`);
  indicator.title = `${broker} · ${sourceStatus}`;
  append(
    indicator,
    el("span", "live-broker-dot", ""),
    el("strong", "", broker),
  );
  return indicator;
}

function livePreferenceField({ id, label, value, placeholder, storageKey, suffix }) {
  const field = el("label", "live-preference-field");
  const labelNode = el("span", "", label);
  const control = el("div", "live-preference-control");
  const input = el("input", "");
  input.id = id;
  input.type = "number";
  input.min = "0";
  input.step = "100";
  input.inputMode = "decimal";
  input.value = value ?? "";
  input.placeholder = placeholder;
  input.addEventListener("change", () => {
    const numeric = Number(input.value);
    if (Number.isFinite(numeric) && numeric > 0) localStorage.setItem(storageKey, String(numeric));
    else localStorage.removeItem(storageKey);
    renderTrading();
  });
  append(control, input, el("span", "", suffix));
  append(field, labelNode, control);
  return field;
}

function renderLiveTrading(trading) {
  const live = trading.live || null;
  const target = liveTarget(trading);
  const signal = liveSignal(trading);
  const financial = liveFinancialComplete({
    live,
    transportStatus: liveRuntime.transportStatus,
    staleAfterMs: 10 * 60_000,
  });
  const cashflowValue = live?.cashflow_generated ?? live?.confirmed_cashflow_generated;
  const cashflowComplete = live?.cashflow_generated !== null && live?.cashflow_generated !== undefined;
  const cashflowScopeComplete = live?.active_scope_coverage_status === "COMPLETE";
  const card = el("section", `live-trading-card tone-${signal.tone}`);
  const head = el("div", "live-trading-head");
  const heading = el("div");
  append(
    heading,
    el("p", "eyebrow", "LIVE · PROVISIONAL"),
    el("h2", "", `${live?.monitoring_day || "本日"} ${cashflowComplete ? "现金流创造" : "已确认现金流创造"}`),
    el("p", "live-trading-window", live?.window_label || "美东 [T-1 20:00, T 20:00)"),
  );
  const refresh = el(
    "button",
    "live-refresh-button",
    manualRefreshLabel(
      Date.now() < liveRuntime.cooldownUntil ? "cooldown" : liveRuntime.refreshState,
      (liveRuntime.cooldownUntil - Date.now()) / 1000,
    ),
  );
  refresh.type = "button";
  refresh.disabled =
    !LIVE_CLIENT.challengeUrl ||
    !LIVE_CLIENT.refreshUrl ||
    live?.data_status === "NO_ACTIVE_SESSION" ||
    ["requesting", "accepted", "checking"].includes(liveRuntime.refreshState) ||
    Date.now() < liveRuntime.cooldownUntil;
  refresh.addEventListener("click", requestManualRefresh);
  append(head, heading, refresh);

  const primary = el("div", "live-primary");
  const primaryValue = el(
    "strong",
    Number(cashflowValue) < 0 ? "negative" : Number(cashflowValue) > 0 ? "positive" : "",
    usd(cashflowValue),
  );
  const primaryCopy = el("div");
  append(
    primaryCopy,
    term(
      cashflowComplete ? "当日现金流创造" : "当日已确认现金流创造",
      TERM_DEFINITIONS.generatedCashflow,
      "live-primary-label",
    ),
    el(
      "span",
      "",
      cashflowComplete
        ? "已归类的主动股票、期权与税后已入账股息；不含长期资产处置"
        : !cashflowScopeComplete
          ? `已排除 ${live?.unclassified_overnight_realization_count || 0} 笔未归类隔夜平仓；显示已确认小计`
          : financial.complete
            ? "连续 FIFO 账本、券商来源与可取得手续费均完整"
            : financial.reason,
    ),
  );
  append(primary, primaryCopy, primaryValue);

  const details = el("div", "live-detail-grid");
  [
    ["股票日内净入账", live?.intraday?.net_pnl, `${live?.intraday?.closed_trades ?? "—"} 个完成周期`],
    ["已归类隔夜净入账", live?.cashflow_overnight_equity_net_pnl, "仅计入标为主动交易的完整周期"],
    ["期权净入账", live?.options?.net_pnl, `${live?.options?.closed_trades ?? "—"} 个完成周期`],
    ["税后已入账股息", live?.cashflow_dividend, "不含应收或未入账股息"],
    ["可取得手续费", live?.cashflow_active_fees === null || live?.cashflow_active_fees === undefined ? null : -Math.abs(Number(live.cashflow_active_fees)), "已包含在当日现金流创造"],
  ].forEach(([label, value, note]) => {
    const item = el("div", "live-detail-item");
    append(
      item,
      el("span", "", label),
      el("strong", Number(value) < 0 ? "negative" : Number(value) > 0 ? "positive" : "", usd(value)),
      el("small", "", note),
    );
    details.appendChild(item);
  });

  const signalBlock = el("div", `live-signal tone-${signal.tone}`);
  append(
    signalBlock,
    el("strong", "", signal.headline),
    el("p", "", signal.message),
  );

  const facts = el("div", "live-fact-grid");
  const factRows = [
    ["券商检查时间", liveTime(live?.checked_at)],
    ["数据年龄", liveAge(signal.ageMs)],
    ["下次页面检查", liveRuntime.nextCheckAt ? liveTime(liveRuntime.nextCheckAt) : "页面可见时每 60 秒"],
    ["开放风险", live?.open_exposure_status === "KNOWN" ? "已取得" : "未知 · 不含未实现盈亏和挂单"],
    [
      "Realized 覆盖",
      live?.realized_coverage_status === "COMPLETE"
        ? "完整"
        : `部分 · 排除 ${(live?.excluded_instruments || []).join("、") || "未知标的"}`,
    ],
    [
      "隔夜归类",
      cashflowScopeComplete
        ? "完整"
        : `待归类 ${live?.unclassified_overnight_realization_count || 0} 笔；长期资产处置不计入`,
    ],
  ];
  factRows.forEach(([label, value]) => {
    const row = el("div", "live-fact-row");
    append(row, el("span", "", label), el("strong", "", value));
    facts.appendChild(row);
  });

  const statusDetails = el("div", "live-status-disclosure");
  const statusSummary = el("button", "live-status-summary");
  statusSummary.type = "button";
  statusSummary.setAttribute("aria-expanded", "false");
  statusSummary.setAttribute("aria-controls", "live-status-detail-body");
  const toggleStatusDetails = () => {
    const isOpen = statusDetails.classList.toggle("is-open");
    statusSummary.setAttribute("aria-expanded", String(isOpen));
    statusBody.hidden = !isOpen;
  };
  statusSummary.addEventListener("click", (event) => {
    event.preventDefault();
    toggleStatusDetails();
  });
  statusSummary.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleStatusDetails();
  });
  const statusIndicators = el("span", "live-status-indicators");
  if (Array.isArray(live?.sources) && live.sources.length) {
    live.sources.forEach((source) => statusIndicators.appendChild(liveBrokerIndicator(source)));
  } else {
    statusIndicators.appendChild(liveBrokerIndicator(null));
  }
  const sourceIssues = Array.isArray(live?.sources) && live.sources.length
    ? live.sources.filter((source) => String(source?.status || "MISSING").toUpperCase() !== "OK").length
    : 1;
  const diagnosticIssues = sourceIssues
    + (live?.realized_coverage_status === "COMPLETE" ? 0 : 1)
    + (live?.open_exposure_status === "KNOWN" ? 0 : 1)
    + (Number.isFinite(signal.ageMs) ? 0 : 1);
  const statusMeta = diagnosticIssues
    ? `${diagnosticIssues} 项待核对 · ${liveAge(signal.ageMs)}`
    : `覆盖完整 · ${liveAge(signal.ageMs)}`;
  append(
    statusSummary,
    statusIndicators,
    el("span", `live-status-meta ${diagnosticIssues ? "warning" : ""}`.trim(), statusMeta),
    el("span", "live-status-action", "详情"),
  );

  const targetPanel = el("div", "live-target-panel");
  const targetHead = el("div", "live-target-head");
  append(
    targetHead,
    el("strong", "", "当日交易节奏参考"),
    el("span", "", target.status === "OK" ? "可比较" : "数据不足，暂停达标判断"),
  );
  const formula = el("p", "live-target-formula");
  formula.textContent = target.remainingSessionsInMonth
    ? `（${cny(target.monthlyTargetCny)} − 本月已结算 ${cny(target.settledMtdActiveNetPnlCny)}）÷ ${target.remainingSessionsInMonth} 个剩余 NYSE 交易日（含今日）= ${cny(target.dailyTargetCny)} / 日${target.dailyTargetUsd !== null ? `（${usdExact(target.dailyTargetUsd)}）` : ""}`
    : `${cny(target.monthlyTargetCny)} − 本月已结算收益；剩余 NYSE 交易日数待确认`;
  const targetNote = el("p", "live-target-note", target.reason);
  const preferences = el("div", "live-preferences");
  append(
    preferences,
    livePreferenceField({
      id: "monthly-target-cny",
      label: "月生活现金流目标",
      value: readPositiveLocalNumber("zzao-monitor-monthly-target-cny") ?? target.monthlyTargetCny,
      placeholder: "40000",
      storageKey: "zzao-monitor-monthly-target-cny",
      suffix: "CNY",
    }),
    livePreferenceField({
      id: "maximum-loss-cny",
      label: "当日最大亏损（可选）",
      value: readPositiveLocalNumber("zzao-monitor-maximum-loss-cny"),
      placeholder: "未设置",
      storageKey: "zzao-monitor-maximum-loss-cny",
      suffix: "CNY",
    }),
  );
  append(targetPanel, targetHead, formula, targetNote, preferences);

  const statusLine = el("p", "live-transport-status");
  const pollCopy = liveRuntime.pollState === "checking"
    ? "正在检查服务器上的最新加密快照。"
    : liveRuntime.error || "自动检查只更新进行中数据；历史结算结果保持不变。";
  statusLine.textContent = pollCopy;
  const statusBody = el("div", "live-status-body");
  statusBody.id = "live-status-detail-body";
  statusBody.hidden = true;
  append(statusBody, facts, liveSourceRows(live), statusLine);
  append(statusDetails, statusSummary, statusBody);
  append(card, head, primary, details, signalBlock, statusDetails, targetPanel);
  return card;
}

function renderTrading() {
  const root = byId("trading-content");
  root.replaceChildren();
  const trading = monitorData.trading || {};
  const summary = monitorData.personal.summary;
  const periods = trading.periods || [];
  const settlement = el("div", "trading-settlement-status");
  append(
    settlement,
    el(
      "span",
      "settlement-complete",
      `已结算至 ${trading.meta?.settled_through || periods[0]?.end_date || "—"} ET`,
    ),
  );
  if (trading.meta?.pending_monitoring_day) {
    settlement.appendChild(
      el(
        "span",
        "settlement-pending",
        `${trading.meta.pending_monitoring_day} 进行中 · 20:00 ET 后纳入完整统计`,
      ),
    );
  }
  root.appendChild(settlement);
  const liveRegion = el("div", "trading-live-region");
  liveRegion.id = "trading-live-region";
  liveRegion.appendChild(renderLiveTrading(trading));
  root.appendChild(liveRegion);
  const focus = periods.find((period) => period.cadence === "month") || periods[0];
  if (focus) {
    const generated = periodGeneratedCashflow(focus);
    const living = periodLivingExpenseCashflow(focus);
    const coverage = livingExpenseCoverage(focus, trading);
    const tone = isFiniteMetric(living)
      ? Number(living) < 0 ? "" : "amber"
      : "";
    const banner = el("section", `risk-banner ${tone}`.trim());
    const copy = el("div");
    append(
      copy,
      el(
        "h2",
        "",
        `${cadenceLabel(focus.cadence, focus)} · 现金流创造 ${usd(generated)} · 生活净额 ${usd(living)}`,
      ),
      el(
        "p",
        "",
        `${focus.start_date || "起点未知"} — ${focus.end_date} · ${coverage.status === "OK" ? `月目标覆盖 ${pct(coverage.coverageRatio)}` : coverage.reason} ${tradingAction(focus, summary, settledPeriodComplete(trading, focus))}`,
      ),
    );
    append(banner, el("div", "risk-bar"), copy);
    root.appendChild(banner);
  }
  root.appendChild(renderTradingCashflowChart(trading));
  root.appendChild(renderTradingPerformance(trading, summary));
}

function universeCard(universe, action) {
  const card = el("article", `universe-card ${actionTone(action.action_label)}`);
  const heading = el("div", "universe-title");
  const nameWrap = el("div");
  append(
    nameWrap,
    el("h2", "", universe.universe_label),
    el("p", "", `${universe.benchmark} · 截至 ${universe.as_of_date}`),
  );
  append(
    heading,
    nameWrap,
    el("span", `badge ${riskClass(action.state_label)}`, action.state_label),
  );
  const pressure = Number(universe.price_deleveraging_pressure || 0);
  const track = el("div", "pressure-track");
  const fill = el("div", `pressure-fill ${pressure >= 85 ? "red" : ""}`);
  fill.style.width = `${Math.max(0, Math.min(100, pressure))}%`;
  track.appendChild(fill);
  const stats = el("div", "stat-grid");
  [
    ["5日涨跌", pct(universe.benchmark_return_5d), TERM_DEFINITIONS.return5d],
    ["20日回撤", pct(universe.benchmark_drawdown_20d), TERM_DEFINITIONS.drawdown20d],
    ["50日线上方", pct(universe.breadth_above_50d), TERM_DEFINITIONS.breadth50],
    ["20日波动", pct(universe.benchmark_realized_vol_20d), TERM_DEFINITIONS.volatility20],
    [
      "20日相关性",
      number(universe.average_correlation_20d, 2),
      TERM_DEFINITIONS.correlation20,
    ],
    ["价格覆盖", pct(universe.price_coverage), TERM_DEFINITIONS.priceCoverage],
  ].forEach(([label, value, definition]) => {
    const item = el("div");
    append(item, term(label, definition, "k"), el("span", "v", value));
    stats.appendChild(item);
  });
  const macroAction = el("div", "macro-action");
  append(
    macroAction,
    el("strong", "", action.action_label),
    el("p", "", action.action),
  );
  append(
    card,
    heading,
    el("div", "pressure-value", number(pressure, 1)),
    term(
      "价格去杠杆压力分位",
      TERM_DEFINITIONS.pricePressure,
      "metric-note",
    ),
    track,
    stats,
    macroAction,
  );
  return card;
}

function renderPressureChart(rows) {
  const wrap = el("div", "chart-wrap");
  const legend = el("div", "chart-legend");
  const universeLabels = Object.fromEntries(
    monitorData.macro.universes.map((row) => [
      row.universe_id,
      row.universe_label,
    ]),
  );
  const series = monitorData.macro.universes.map((row) => row.universe_id);
  series.forEach((id) => {
    const className = id.replace(/[^a-z0-9_-]/gi, "-");
    const item = el("span");
    append(
      item,
      el("i", `legend-dot ${className}`),
      document.createTextNode(universeLabels[id] || id),
    );
    legend.appendChild(item);
  });

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "pressure-chart");
  svg.setAttribute("viewBox", "0 0 900 230");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "近60个交易日价格去杠杆压力");
  const left = 38;
  const right = 886;
  const top = 12;
  const bottom = 202;
  [0, 25, 50, 75, 100].forEach((tick) => {
    const y = bottom - (tick / 100) * (bottom - top);
    const line = document.createElementNS(svg.namespaceURI, "line");
    line.setAttribute("class", "chart-grid");
    line.setAttribute("x1", left);
    line.setAttribute("x2", right);
    line.setAttribute("y1", y);
    line.setAttribute("y2", y);
    svg.appendChild(line);
    const label = document.createElementNS(svg.namespaceURI, "text");
    label.setAttribute("class", "chart-label");
    label.setAttribute("x", 2);
    label.setAttribute("y", y + 3);
    label.textContent = String(tick);
    svg.appendChild(label);
  });
  series.forEach((id) => {
    const values = rows.filter((row) => row.universe_id === id);
    if (!values.length) return;
    const points = values
      .map((row, index) => {
        const x = left + (index / Math.max(values.length - 1, 1)) * (right - left);
        const y =
          bottom -
          (Math.max(0, Math.min(100, Number(row.price_pressure_score))) / 100) *
            (bottom - top);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    const polyline = document.createElementNS(svg.namespaceURI, "polyline");
    const className = id.replace(/[^a-z0-9_-]/gi, "-");
    polyline.setAttribute("class", `chart-line chart-line-${className}`);
    polyline.setAttribute("points", points);
    svg.appendChild(polyline);
  });
  append(wrap, legend, svg);
  return wrap;
}

function renderMacro() {
  const root = byId("macro-content");
  root.replaceChildren();
  const data = monitorData.macro;
  const highest = [...data.alerts].sort((a, b) => b.severity_rank - a.severity_rank)[0];
  const banner = el("section", `risk-banner ${highest?.severity === "极端" ? "" : "amber"}`);
  const bannerText = el("div");
  append(
    bannerText,
    el("h2", "", highest?.headline || "市场状态"),
    el("p", "", highest?.evidence || "当前没有高优先级市场告警。"),
  );
  append(banner, el("div", "risk-bar"), bannerText);
  root.appendChild(banner);

  const metrics = el("section", "metric-grid");
  const hero = data.hero;
  const marginGuidance = marginMetricGuidance(hero.margin_debt_yoy);
  metrics.appendChild(
    metricCard(
      "FINRA 融资余额同比",
      pct(hero.margin_debt_yoy),
      `参考月 ${hero.margin_reference_month || "—"} · 全市场慢频存量`,
      marginGuidance,
    ),
  );
  data.universes.forEach((universe) => {
    const guidance = pressureMetricGuidance(universe);
    metrics.appendChild(
      metricCard(
        `${universe.universe_label}压力`,
        number(universe.price_deleveraging_pressure, 1),
        `${universe.state_code || "S0"} ${universe.state_label || "观察"}`,
        guidance,
      ),
    );
  });
  const coverageGuidance = coverageMetricGuidance(
    hero.full_session_market_data_coverage,
  );
  metrics.appendChild(
    metricCard(
      "完整时段行情覆盖",
      pct(hero.full_session_market_data_coverage),
      `${hero.market_data_session_scope} · 当前主要为正常盘价量`,
      coverageGuidance,
    ),
  );
  root.appendChild(metrics);

  const universeGrid = el("section", "universe-grid");
  data.universes.forEach((universe) => {
    const action = data.actions.find((item) => item.universe_id === universe.universe_id);
    universeGrid.appendChild(universeCard(universe, action));
  });
  root.appendChild(universeGrid);

  const chart = section("近60个交易日压力轨迹", "仅使用公开价量代理；不把单一极端分位直接视为强平。");
  chart.appendChild(renderPressureChart(data.daily_pressure));
  root.appendChild(chart);

  const alerts = section("宏观与板块预警", "只列市场事实、证据缺口和清除条件。");
  alerts.appendChild(
    table(
      [
        {
          key: "severity",
          label: "级别",
          render: (value) => el("span", `badge ${riskClass(value)}`, value),
        },
        { key: "entity_label", label: "对象" },
        { key: "headline", label: "触发" },
        { key: "evidence", label: "事实证据" },
        { key: "counterevidence", label: "反证 / 缺口" },
        { key: "clear_condition", label: "清除条件" },
      ],
      data.alerts,
    ),
  );
  root.appendChild(alerts);

  const tickers = section("个股价格风险排序", "板块与纳斯达克核心成分，仅用于风险排查。");
  tickers.appendChild(
    table(
      [
        { key: "ticker", label: "标的" },
        { key: "company_name", label: "公司" },
        { key: "universe", label: "板块" },
        {
          key: "return_5d",
          label: "5日",
          numeric: true,
          render: pct,
          definition: TERM_DEFINITIONS.return5d,
        },
        {
          key: "drawdown_20d",
          label: "20日回撤",
          numeric: true,
          render: pct,
          definition: TERM_DEFINITIONS.drawdown20d,
        },
        {
          key: "price_crowding_proxy",
          label: "拥挤代理",
          numeric: true,
          render: number,
          definition: TERM_DEFINITIONS.crowdingProxy,
        },
        {
          key: "price_damage_score",
          label: "价格损伤",
          numeric: true,
          render: number,
          definition: TERM_DEFINITIONS.priceDamage,
        },
        {
          key: "risk_level",
          label: "风险",
          definition: TERM_DEFINITIONS.tickerRisk,
        },
      ],
      data.tickers,
    ),
  );
  root.appendChild(tickers);

  const sources = section("公开数据源状态", "来源故障或滞后不会被解释成投资信号。");
  sources.appendChild(
    table(
      [
        { key: "publisher", label: "来源" },
        {
          key: "freshness_status",
          label: "状态",
          render: (value) => el("span", `badge ${riskClass(value)}`, value),
        },
        { key: "latest_observation_at", label: "最新观察" },
        {
          key: "coverage_ratio",
          label: "覆盖",
          numeric: true,
          render: pct,
          definition: TERM_DEFINITIONS.sourceCoverage,
        },
        { key: "notes", label: "说明" },
      ],
      data.sources,
    ),
  );
  root.appendChild(sources);
}

function setDrawerOpen(open) {
  const dashboard = byId("dashboard");
  dashboard.classList.toggle("drawer-open", open);
  byId("drawer-backdrop").hidden = !open;
  byId("mobile-menu-button").setAttribute("aria-expanded", String(open));
}

function switchView(view) {
  if (!VIEW_META[view]) view = "personal";
  activeView = view;
  localStorage.setItem("zzao-monitor-view", view);
  Object.keys(VIEW_META).forEach((key) => {
    byId(`panel-${key}`).hidden = key !== view;
    byId(`nav-${key}`).setAttribute("aria-current", key === view ? "page" : "false");
  });
  const meta = VIEW_META[view];
  byId("page-eyebrow").textContent = meta.eyebrow;
  byId("page-title").textContent = meta.title;
  byId("page-subtitle").textContent = meta.subtitle;
  const chartTooltip = byId("trading-chart-tooltip");
  if (chartTooltip) chartTooltip.hidden = true;
  setDrawerOpen(false);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderCurrencyControl() {
  const rate = Number(monitorData?.meta?.usd_cny_rate);
  const cnyAvailable = Number.isFinite(rate) && rate > 0;
  if (!cnyAvailable && displayCurrency === "CNY") displayCurrency = "USD";
  document.querySelectorAll(".currency-option").forEach((button) => {
    const selected = button.dataset.currency === displayCurrency;
    button.setAttribute("aria-pressed", String(selected));
    if (button.dataset.currency === "CNY") {
      button.disabled = !cnyAvailable;
      button.title = cnyAvailable
        ? `按 FRED DEXCHUS ${monitorData.meta.usd_cny_as_of || "最新"} 汇率换算`
        : "汇率数据暂不可用";
    }
  });
}

function setCurrency(currency) {
  if (!['USD', 'CNY'].includes(currency)) return;
  if (currency === "CNY" && !Number(monitorData?.meta?.usd_cny_rate)) return;
  displayCurrency = currency;
  localStorage.setItem("zzao-monitor-currency", currency);
  renderCurrencyControl();
  renderPersonal();
  renderMacro();
  renderTrading();
}

function applyThemePreference(preference) {
  const allowed = ["system", "light", "dark"];
  const selected = allowed.includes(preference) ? preference : "system";
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const actual = selected === "system" ? (systemDark ? "dark" : "light") : selected;
  document.documentElement.dataset.theme = actual;
  document.documentElement.dataset.themePreference = selected;
  localStorage.setItem("zzao-monitor-theme", selected);
  const labels = { system: "跟随系统", light: "浅色模式", dark: "深色模式" };
  const icons = { system: "◐", light: "☼", dark: "☾" };
  byId("theme-label").textContent = labels[selected];
  byId("theme-icon").textContent = icons[selected];
  byId("theme-button").title = `当前：${labels[selected]}；点击切换`;
}

function cycleTheme() {
  const current = document.documentElement.dataset.themePreference || "system";
  const order = ["system", "light", "dark"];
  applyThemePreference(order[(order.indexOf(current) + 1) % order.length]);
}

function renderDashboard() {
  const { meta } = monitorData;
  byId("asof-line").replaceChildren(
    el("span", "", `市场截至 ${meta.market_as_of || "—"} ET`),
    el("span", "", `持仓读取 ${meta.portfolio_retrieved_at || "—"}`),
    el("span", "", meta.session_boundary),
    el(
      "span",
      "fx-line",
      meta.usd_cny_rate
        ? `展示汇率 1 USD = ${number(meta.usd_cny_rate, 4)} CNY · FRED ${meta.usd_cny_as_of || "—"}`
        : "CNY 展示汇率暂不可用",
    ),
  );
  const status = byId("snapshot-status");
  status.textContent = meta.status === "ready" ? "数据已就绪" : "数据部分可用";
  status.className = `status-pill ${meta.status === "ready" ? "green" : "amber"}`;
  byId("personal-tab-alert").textContent = monitorData.personal.alerts.length
    ? `· ${monitorData.personal.alerts.length}`
    : "";
  byId("macro-tab-alert").textContent = monitorData.macro.alerts.length
    ? `· ${monitorData.macro.alerts.length}`
    : "";
  const failedBrokerSources = (monitorData.trading?.sources || []).filter(
    (source) => source.status !== "OK",
  ).length;
  byId("trading-source-alert").textContent = failedBrokerSources
    ? `· ${failedBrokerSources}`
    : "";
  renderCurrencyControl();
  renderPersonal();
  renderMacro();
  renderTrading();
  switchView(activeView);
}

byId("unlock-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = byId("unlock-button");
  const error = byId("unlock-error");
  const passwordInput = byId("password");
  button.disabled = true;
  button.textContent = "正在解密…";
  error.textContent = "";
  try {
    const unlocked = await decryptPayload(passwordInput.value);
    monitorData = unlocked.data;
    unlockKey = unlocked.key;
    passwordInput.value = "";
    renderDashboard();
    byId("unlock-view").hidden = true;
    byId("dashboard").hidden = false;
    scheduleLivePolling(0);
    requestAnimationFrame(() => {
      byId("dashboard").scrollIntoView({ block: "start" });
    });
  } catch (decryptError) {
    error.textContent =
      decryptError instanceof DOMException
        ? "密码不正确，或数据包已损坏。"
        : decryptError.message;
  } finally {
    button.disabled = false;
    button.textContent = "解锁监控";
  }
});

document.querySelectorAll(".drawer-item").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document.querySelectorAll(".currency-option").forEach((button) => {
  button.addEventListener("click", () => setCurrency(button.dataset.currency));
});

byId("theme-button").addEventListener("click", cycleTheme);
applyThemePreference(document.documentElement.dataset.themePreference || "system");
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (document.documentElement.dataset.themePreference === "system") {
    applyThemePreference("system");
  }
});

byId("mobile-menu-button").addEventListener("click", () => setDrawerOpen(true));
byId("drawer-backdrop").addEventListener("click", () => setDrawerOpen(false));
byId("drawer-toggle").addEventListener("click", () => {
  if (window.matchMedia("(max-width: 900px)").matches) {
    setDrawerOpen(false);
    return;
  }
  const collapsed = byId("dashboard").classList.toggle("drawer-collapsed");
  localStorage.setItem("zzao-monitor-drawer", collapsed ? "collapsed" : "open");
  byId("drawer-toggle").setAttribute("aria-expanded", String(!collapsed));
  byId("drawer-toggle").setAttribute("aria-label", collapsed ? "展开导航" : "收起导航");
});

if (localStorage.getItem("zzao-monitor-drawer") === "collapsed") {
  byId("dashboard").classList.add("drawer-collapsed");
  byId("drawer-toggle").setAttribute("aria-expanded", "false");
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setDrawerOpen(false);
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopLivePolling();
    return;
  }
  if (unlockKey && monitorData) {
    scheduleLivePolling(0);
    renderLiveOnly();
  }
});

byId("lock-button").addEventListener("click", () => {
  stopLivePolling();
  unlockKey = null;
  monitorData = null;
  liveRuntime.transportStatus = LIVE_CLIENT.payloadUrl ? "EXPECTED_LAG" : "MISSING";
  liveRuntime.pollState = LIVE_CLIENT.payloadUrl ? "idle" : "disabled";
  liveRuntime.refreshState = LIVE_CLIENT.refreshUrl ? "idle" : "disabled";
  liveRuntime.error = "";
  liveRuntime.cooldownUntil = 0;
  liveRuntime.pendingRefresh = null;
  byId("personal-content").replaceChildren();
  byId("macro-content").replaceChildren();
  byId("trading-content").replaceChildren();
  byId("dashboard").hidden = true;
  byId("unlock-view").hidden = false;
  byId("password").focus();
});
