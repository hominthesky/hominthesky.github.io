"use strict";

import {
  DEFAULT_MONTHLY_TARGET_CNY,
  LIVE_POLL_INTERVAL_MS,
  MANUAL_REFRESH_TIMEOUT_MS,
  applyLiveRiskGate,
  anchoredPortfolioReturnReference,
  assessLiveTradingSignal,
  buildCashflowChartSeries,
  calculateDailyTarget,
  calculateLivingExpenseCoverage,
  combineHealthStatuses,
  deriveFxStatus,
  derivePortfolioGateInput,
  liveFinancialFingerprint,
  isPeriodCoverageComplete,
  manualRefreshLabel,
  periodDecisionComplete,
  refreshProofMessage,
  resolveLiveCashflowDisplay,
  resolveLiveRealizedTradingDisplay,
  resolvePeriodCashflowDisplay,
  resolvePendingManualRefresh,
  updateLastConfirmedPortfolioOverview,
  yearSeriesScope,
  yearCoverageLabel,
} from "./live_trading.mjs?v=20260829-1";
import {
  effectiveHoldingsStatus,
  filterHoldingRows,
  holdingStrategyLabel,
  sanitizePrivateHoldings,
} from "./holdings_ledger.mjs?v=20260823-1";

const payloadUrl = "./payload.enc.json";
let monitorData = null;
let portfolioOverviewSummary = null;
let unlockKey = null;
let livePollTimer = null;
let livePollInFlight = null;
let holdingsRequestGeneration = 0;
let displayCurrency = localStorage.getItem("zzao-monitor-currency") || "USD";
let activeView = localStorage.getItem("zzao-monitor-view") || "personal";
let tradingChartCadence = localStorage.getItem("zzao-monitor-trading-chart") || "day";
let strategyReturnCadence = localStorage.getItem("zzao-monitor-strategy-chart") || "year";
const holdingsFilters = {
  query: "",
  broker: "ALL",
  strategy: "ALL",
  instrument: "ALL",
  direction: "ALL",
  group: "STRATEGY",
};

const metaContent = (name) =>
  document.querySelector(`meta[name="${name}"]`)?.content?.trim() || "";
const LIVE_CLIENT = Object.freeze({
  payloadUrl: metaContent("zzao-live-payload-url"),
  challengeUrl: metaContent("zzao-live-challenge-url"),
  refreshUrl: metaContent("zzao-live-refresh-url"),
  holdingsUrl: metaContent("zzao-private-holdings-url"),
});
const STRATEGY_ANALYSIS_FORMULA = "bucket_actual_pct=classified_bucket/total_classified_long; rebalance_amount=total_classified_long*target_pct-classified_bucket; portfolio_twr=portfolio_total_return_v1.cumulative_total_return; portfolio_mwr=portfolio_money_weighted_return_v1.money_weighted_return";
const STRATEGY_ANALYSIS_CONTRACT = "strategy_analysis_v2";
const liveRuntime = {
  transportStatus: LIVE_CLIENT.payloadUrl ? "EXPECTED_LAG" : "MISSING",
  pollState: LIVE_CLIENT.payloadUrl ? "idle" : "disabled",
  refreshState: LIVE_CLIENT.refreshUrl ? "idle" : "disabled",
  error: "",
  nextCheckAt: null,
  cooldownUntil: 0,
  pendingRefresh: null,
};
const holdingsRuntime = {
  state: LIVE_CLIENT.holdingsUrl ? "idle" : "disabled",
  data: null,
  error: "",
};

const VIEW_META = {
  personal: {
    eyebrow: "PORTFOLIO RISK",
    title: "持仓风险",
    subtitle: "组合杠杆、风险预算与逐标的行动",
  },
  holdings: {
    eyebrow: "PORTFOLIO LEDGER",
    title: "持仓账本",
    subtitle: "跨券商最近确认持仓、策略归属与组合结构",
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
  strategy: {
    eyebrow: "PORTFOLIO STRATEGY",
    title: "组合策略与投资成长",
    subtitle: "跨券商收益、策略配置与长期投资能力复盘",
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
  provisionalRealizedTradingPnl:
    "当前美东监控日截至最近券商检查时，连续 FIFO 中已被反向成交匹配的股票和期权数量所形成的已实现净收益。部分减仓即时计入，不等待整仓归零或交易日结束；不含开放数量的未实现盈亏。",
  grossTradingPnl:
    "已完成交易周期在扣除券商可取得手续费之前的收益。它用于解释成本侵蚀，不代表最终可支配现金。",
  netAfterCosts:
    "策略现金流创造加上账户实际入账的融资、借券、现金余额及其他利息净额。融资主要服务长期持仓，不归因给股票因果同日策略或期权策略，但会减少可用于生活开支评估的现金。",
  tradeWinRate:
    "盈利的已完成交易周期 ÷ 有明确盈亏的已完成周期。按周期而不是订单或成交笔数统计；样本少时容易失真。",
  profitFactor:
    "盈利周期净利润之和 ÷ 亏损周期净亏损绝对值。大于1表示样本期盈利覆盖亏损，小于1表示策略期望值需要复核。无亏损样本时不显示。",
  cashflowContribution:
    "该来源净现金 ÷（股票因果同日策略净收益＋已归类跨日残余净收益＋期权净收益＋税后已入账股息）。只在现金流创造总额大于零且来源完整时显示；融资利息不参与策略来源贡献分摊。",
  dividendIncome:
    "已取得的 USD 现金股息减去股息预扣税，为税后股息分红现金流；不含股票送股、资本利得和未入账应收股息。",
  generatedCashflow:
    "股票按成交顺序形成的因果同日策略 realization、未匹配残余账中已归类主动的跨日实现、期权已实现片段扣除可取得交易费用后的净收益，加上税后已入账现金股息。普通卖出不会与未来买入倒配；用于衡量策略与股息的现金创造能力，不含融资利息、长期资产出售、本金周转和未实现盈亏。",
  livingExpenseCashflow:
    "现金流创造加上账户实际入账的利息净额。用于评估生活开支覆盖，但不等于券商安全可提现金额；实际提现还受结算现金、保证金安全垫和税务准备金约束。",
  portfolioNav:
    "所有已接入券商账户净清算价值的同步合计，包含现金、持仓市值和账户负债。任一预期账户缺失、过期或不同步时不显示确定金额。",
  portfolioTotalReturn:
    "跨券商组合净资产变化剔除外部入金和出金后的链式总回报；股息、融资利息、交易费用以及已实现和未实现盈亏均通过净资产自然体现一次。年化值按 ACT/365 折算，不是未来收益预测。",
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
    confirmedSettledMtdActiveNetPnlUsd:
      live?.target?.confirmed_settled_mtd_active_net_pnl_usd,
    confirmedReferenceCoverageStatus:
      live?.target?.confirmed_reference_coverage_status,
    excludedRealizationCount: live?.target?.excluded_realization_count,
    excludedInstrumentCount: live?.target?.excluded_instrument_count,
    excludedInstruments: live?.target?.excluded_instruments,
    settledThrough: live?.target?.settled_through,
    targetStatus: live?.target?.status ?? (Number(monthlyTargetCny) > 0 ? "OK" : "MISSING"),
    targetContractId: live?.target?.contract_id,
    targetFormula: live?.target?.formula,
    confirmedReferenceFormula: live?.target?.confirmed_reference_formula,
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
  renderPortfolioOverview();
  const region = byId("trading-live-region");
  if (!region) return;
  region.replaceChildren(renderLiveTrading(monitorData.trading || {}));
  if (activeView === "personal") renderPersonal();
}

const PORTFOLIO_RETURN_REASON_LABELS = Object.freeze({
  HISTORY_EMPTY: "尚无完整日终历史",
  HISTORY_INVALID: "历史记录未通过校验",
  HISTORY_ACCUMULATING: "共同历史积累中",
  MINIMUM_HISTORY_NOT_MET: "满 30 个自然日后显示年化",
  CALENDAR_UNAVAILABLE: "交易日历不可用",
  VALUATION_GAP: "日终净资产覆盖有缺口",
  EXTERNAL_FLOW_COVERAGE_INCOMPLETE: "入出金流水覆盖不完整",
  INTERNAL_TRANSFER_UNMATCHED: "跨券商划转尚未配对",
  EXTERNAL_FLOW_FX_MISSING: "资金流水币种无法换算",
  EXTERNAL_FLOW_INVALID: "资金流水未通过校验",
  EXTERNAL_FLOW_SIGN_INVALID: "入出金方向未通过校验",
  CAPITAL_FLOW_COVERAGE_INCOMPLETE: "Futu 资本流覆盖不完整",
  CAPITAL_FLOW_FX_MISSING: "Futu 资本流币种无法换算",
  CAPITAL_FLOW_INVALID: "Futu 资本流未通过校验",
  CAPITAL_FLOW_SIGN_INVALID: "Futu 资本流方向未通过校验",
  RETURN_DENOMINATOR_NON_POSITIVE: "收益率分母无效",
  RETURN_OUT_OF_DOMAIN: "收益率超出可计算范围",
});

const PORTFOLIO_RETURN_CONTRACT = Object.freeze({
  id: "portfolio_total_return_v1",
  formula: "chain_link((NAV_end - NAV_begin - external_flow) / (NAV_begin + 0.5 * external_flow)); annualized=(1+cumulative)^(365/elapsed_calendar_days)-1",
});
const BROKER_RETURN_CONTRACT = Object.freeze({
  id: "broker_portfolio_return_v1",
  formula: "chain_link((broker_NAV_end - broker_NAV_begin - broker_capital_flow) / (broker_NAV_begin + 0.5 * broker_capital_flow)); annualized=(1+cumulative)^(365/elapsed_calendar_days)-1",
});
const MANUAL_RETURN_REFERENCE_CONTRACT = Object.freeze({
  id: "manual_broker_return_reference_v1",
  formula: "broker_app_reported_cash_weighted_return_and_interval_profit",
});

function overviewMetric(label, value, note, options = {}) {
  const item = el("div", "portfolio-overview-metric");
  const labelNode = options.definition
    ? term(label, options.definition, "portfolio-overview-label")
    : el("span", "portfolio-overview-label", label);
  const valueNode = el("strong", `portfolio-overview-value ${options.tone || ""}`.trim(), value);
  append(item, labelNode, valueNode, el("span", "portfolio-overview-note", note));
  if (Array.isArray(options.details) && options.details.length) {
    const details = el("div", "portfolio-overview-details");
    options.details.forEach(({ label: detailLabel, value: detailValue, note: detailNote }) => {
      const row = el("div", "portfolio-overview-detail");
      append(
        row,
        el("span", "portfolio-overview-detail-label", detailLabel),
        el("strong", "portfolio-overview-detail-value", detailValue),
        detailNote ? el("span", "portfolio-overview-detail-note", detailNote) : null,
      );
      details.append(row);
    });
    item.append(details);
  }
  return item;
}

function renderPortfolioOverview() {
  const root = byId("portfolio-overview");
  if (!root || !monitorData) return;
  root.replaceChildren();
  const riskSummary = monitorData.personal?.summary || {};
  const summary = portfolioOverviewSummary || {};
  const brokerRows = Array.isArray(summary.broker_breakdown)
    ? summary.broker_breakdown.filter((row) => ["Futu", "Tiger", "IBKR"].includes(row?.broker))
    : [];
  const brokerByName = new Map(brokerRows.map((row) => [row.broker, row]));
  const orderedBrokers = ["Futu", "Tiger", "IBKR"]
    .map((broker) => brokerByName.get(broker)).filter(Boolean);
  const portfolioReturn = riskSummary.portfolio_return || {};
  const governedReturn = portfolioReturn.contract_id === PORTFOLIO_RETURN_CONTRACT.id
    && portfolioReturn.formula === PORTFOLIO_RETURN_CONTRACT.formula;
  const cumulative = governedReturn && isFiniteMetric(portfolioReturn.cumulative_total_return)
    ? portfolioReturn.cumulative_total_return
    : null;
  const annualized = governedReturn && isFiniteMetric(portfolioReturn.annualized_total_return)
    ? portfolioReturn.annualized_total_return
    : null;
  const anchoredReference = anchoredPortfolioReturnReference(summary);
  const displayedAnnualized = annualized ?? anchoredReference?.portfolio_annualized_reference ?? null;
  const referenceMissingBrokers = Array.isArray(anchoredReference?.missing_reference_brokers)
    ? anchoredReference.missing_reference_brokers : [];
  const reasonCodes = Array.isArray(portfolioReturn.reason_codes)
    ? portfolioReturn.reason_codes
    : [];
  const reason = reasonCodes
    .map((code) => PORTFOLIO_RETURN_REASON_LABELS[code])
    .find(Boolean);
  const returnCoverage = portfolioReturn.start_date
    ? `${portfolioReturn.start_date} 起`
    : "共同历史尚未建立";
  const returnNote = cumulative !== null
    ? `累计 ${pct(cumulative, 1)} · ${returnCoverage}${annualized === null ? ` · ${reason || "历史积累中"}` : ""}`
    : `${reason || "共同历史积累中"} · 覆盖不足不估算${referenceMissingBrokers.length
      ? ` · 参考缺口：${referenceMissingBrokers.join("/")} 年化尚未满足`
      : ""}`;
  const head = el("div", "portfolio-overview-head");
  append(
    head,
    el("strong", "", "资产增长概览"),
    el("span", "", "长期组合总回报 · 与下方生活现金流分开"),
  );
  const grid = el("div", "portfolio-overview-grid");
  append(
    grid,
    overviewMetric(
      "跨券商总净资产",
      usd(summary.derived_nav_usd, true),
      isFiniteMetric(summary.derived_nav_usd)
        ? `最近确认 · ${liveTime(summary.source_retrieved_at)}`
        : "尚无完整券商组合快照",
      {
        definition: TERM_DEFINITIONS.portfolioNav,
        details: orderedBrokers.map((row) => ({ label: row.broker, value: usd(row.derived_nav_usd, true) })),
      },
    ),
    overviewMetric(
      annualized === null && displayedAnnualized !== null
        ? "跨券商综合年化参考"
        : "组合年化总回报",
      displayedAnnualized === null ? "—" : pct(displayedAnnualized, 1),
      annualized === null && displayedAnnualized !== null
        ? `跨券商综合年化参考（当前净资产加权估算） · ${anchoredReference.start_date}—${anchoredReference.end_date}`
        : returnNote,
      {
        definition: TERM_DEFINITIONS.portfolioTotalReturn,
        tone: displayedAnnualized === null ? "" : displayedAnnualized >= 0 ? "positive" : "negative",
        details: orderedBrokers.flatMap((row) => {
          if (row.broker === "Futu") {
            const details = [];
            const manual = row.manual_return_reference || {};
            const governedManual = manual.contract_id === MANUAL_RETURN_REFERENCE_CONTRACT.id
              && manual.formula === MANUAL_RETURN_REFERENCE_CONTRACT.formula
              && manual.broker === "Futu" && manual.scope === "US_EQUITIES"
              && manual.method === "BROKER_APP_CASH_WEIGHTED"
              && manual.verification_status === "USER_CONFIRMED"
              && manual.currency === "USD" && manual.auto_refresh === false
              && isFiniteMetric(manual.cash_weighted_return)
              && isFiniteMetric(manual.interval_profit_usd);
            if (governedManual) details.push({
              label: "Futu · 锚定年化估算",
              value: anchoredReference?.futu_annualized_estimate == null ? "—" : pct(anchoredReference.futu_annualized_estimate, 1),
              note: `券商 App 现金加权锚点 ${pct(manual.cash_weighted_return, 2)}、区间收益 ${usdExact(manual.interval_profit_usd)}（截至 ${manual.anchor_effective_date || "—"}，锚点不会自动更新）· ${anchoredReference?.continuation_status === "CONTINUING" ? "后续系统日终已续算" : anchoredReference?.continuation_status === "ANCHOR_ONLY_REANCHOR_REQUIRED" ? `仅保留锚点参考；首个系统基线为 ${anchoredReference.system_baseline_date || "—"}，缺锚点日分券商 NAV，未跨缺口续算` : "等待锚点后的完整系统日终续算"} · 累计 ${anchoredReference ? pct(anchoredReference.futu_cumulative, 1) : "—"} · ${manual.start_date || "—"}—${anchoredReference?.end_date || liveTime(manual.as_of)} · 混合方法估算`,
            });
            const calculated = row.calculated_return || {};
            const governed = calculated.contract_id === BROKER_RETURN_CONTRACT.id
              && calculated.formula === BROKER_RETURN_CONTRACT.formula
              && calculated.method === "SYSTEM_CALCULATED"
              && calculated.broker === "Futu";
            const calculatedAnnualized = governed && isFiniteMetric(calculated.annualized_total_return)
              ? calculated.annualized_total_return : null;
            const calculatedCumulative = governed && isFiniteMetric(calculated.cumulative_total_return)
              ? calculated.cumulative_total_return : null;
            const calculatedReason = (Array.isArray(calculated.reason_codes) ? calculated.reason_codes : [])
              .map((code) => PORTFOLIO_RETURN_REASON_LABELS[code])
              .find(Boolean);
            if (calculatedAnnualized !== null) details.push({
              label: "Futu · 系统",
              value: pct(calculatedAnnualized, 1),
              note: `系统自算 · 累计 ${pct(calculatedCumulative, 1)} · ${calculated.start_date || "—"}—${calculated.end_date || "—"}`,
            });
            else if (calculatedCumulative !== null) details.push({
              label: "Futu · 系统",
              value: `累计 ${pct(calculatedCumulative, 1)}`,
              note: `系统自算 · ${calculatedReason || "满 30 个自然日后显示年化"} · ${calculated.start_date || "—"}—${calculated.end_date || "—"}`,
            });
            else details.push({
              label: "Futu · 系统",
              value: "—",
              note: `系统自算 · ${calculatedReason === "共同历史积累中" ? "日终历史积累中" : calculatedReason || "日终历史积累中"}`,
            });
            return details;
          }
          const details = [];
          const native = row.native_return || {};
          const nativeAnnualized = isFiniteMetric(native.annualized_total_return)
            ? native.annualized_total_return : null;
          const nativeCumulative = isFiniteMetric(native.cumulative_total_return)
            ? native.cumulative_total_return : null;
          if (native.coverage_status === "COMPLETE") details.push({
            label: row.broker === "IBKR" ? "IBKR · 原生 TWR" : `${row.broker} · 原生`,
            value: nativeAnnualized !== null ? pct(nativeAnnualized, 1) : "—",
            note: nativeAnnualized !== null
              ? `${row.broker === "IBKR" ? "Universal Account Flex 原生区间 TWR，ACT/365 年化参考" : "证券账户（SEC）券商原生年化"} · 累计 ${pct(nativeCumulative, 1)} · ${native.start_date || "—"}—${native.end_date || "—"}`
              : `原生累计 ${pct(nativeCumulative, 1)} · 满 30 个自然日后显示 ACT/365 年化参考`,
          });
          else if (row.broker === "IBKR") details.push({
            label: "IBKR · 原生 TWR",
            value: "—",
            note: (native.reason_codes || []).includes("BROKER_NATIVE_RETURN_DISABLED")
              ? "原生收益通道未启用 · 待配置只读 Flex 报表"
              : "原生收益报表未通过覆盖校验 · 与系统日终历史独立",
          });
          const calculated = row.calculated_return || {};
          const governed = calculated.contract_id === BROKER_RETURN_CONTRACT.id
            && calculated.formula === BROKER_RETURN_CONTRACT.formula
            && calculated.method === "SYSTEM_CALCULATED"
            && calculated.broker === row.broker;
          const calculatedAnnualized = governed && isFiniteMetric(calculated.annualized_total_return)
            ? calculated.annualized_total_return : null;
          const calculatedCumulative = governed && isFiniteMetric(calculated.cumulative_total_return)
            ? calculated.cumulative_total_return : null;
          const calculatedReason = (Array.isArray(calculated.reason_codes) ? calculated.reason_codes : [])
            .map((code) => PORTFOLIO_RETURN_REASON_LABELS[code])
            .find(Boolean);
          details.push({
            label: `${row.broker} · 系统`,
            value: calculatedAnnualized !== null
              ? pct(calculatedAnnualized, 1)
              : calculatedCumulative !== null
                ? `累计 ${pct(calculatedCumulative, 1)}`
                : "—",
            note: calculatedCumulative !== null
              ? `系统自算 · ${calculatedReason || "满 30 个自然日后显示年化"} · ${calculated.start_date || "—"}—${calculated.end_date || "—"}`
              : `系统自算 · ${calculatedReason === "共同历史积累中" ? "日终历史积累中" : calculatedReason || "日终历史积累中"}`,
          });
          return details;
        }),
      },
    ),
    overviewMetric(
      "组合毛杠杆",
      isFiniteMetric(summary.gross_leverage)
        ? `${number(summary.gross_leverage, 2)}x`
        : "—",
      isFiniteMetric(summary.gross_leverage_red)
        ? `治理红线 ${number(summary.gross_leverage_red, 2)}x`
        : "覆盖不足不估算",
      {
        definition: TERM_DEFINITIONS.grossLeverage,
        tone:
          isFiniteMetric(summary.gross_leverage) &&
          isFiniteMetric(summary.gross_leverage_red) &&
          summary.gross_leverage >= summary.gross_leverage_red
            ? "negative"
            : "",
        details: orderedBrokers.map((row) => ({
          label: row.broker,
          value: isFiniteMetric(row.gross_leverage) ? `${number(row.gross_leverage, 2)}x` : "—",
        })),
      },
    ),
  );
  append(root, head, grid);
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
    portfolioOverviewSummary = updateLastConfirmedPortfolioOverview(
      portfolioOverviewSummary,
      incomingRiskGate,
    );
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
      refreshHoldingsFreshnessDisplay();
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

async function loadPrivateHoldings() {
  if (!LIVE_CLIENT.challengeUrl || !LIVE_CLIENT.holdingsUrl || !unlockKey
    || holdingsRuntime.state === "loading") return;
  const requestGeneration = ++holdingsRequestGeneration;
  holdingsRuntime.state = "loading";
  holdingsRuntime.error = "";
  renderHoldings();
  try {
    const holdingsPath = new URL(LIVE_CLIENT.holdingsUrl, window.location.href).pathname;
    const challengeUrl = new URL(LIVE_CLIENT.challengeUrl, window.location.href);
    challengeUrl.searchParams.set("path", holdingsPath);
    const challengeResponse = await fetch(challengeUrl, {
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    if (!challengeResponse.ok) throw new Error("无法取得持仓读取凭证。");
    const challenge = await challengeResponse.json();
    if (!unlockKey || requestGeneration !== holdingsRequestGeneration) return;
    const proof = await deriveRefreshProof(challenge, holdingsPath);
    const response = await fetch(LIVE_CLIENT.holdingsUrl, {
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
    const payload = await response.json().catch(() => ({}));
    if (!unlockKey || requestGeneration !== holdingsRequestGeneration) return;
    if (!response.ok) throw new Error(payload.message || "精确持仓暂不可用。");
    holdingsRuntime.data = sanitizePrivateHoldings(payload);
    holdingsRuntime.state = "ready";
  } catch (error) {
    if (!unlockKey || requestGeneration !== holdingsRequestGeneration) return;
    holdingsRuntime.data = null;
    holdingsRuntime.state = "error";
    holdingsRuntime.error = error instanceof Error ? error.message : "精确持仓暂不可用。";
  }
  renderHoldings();
  renderHoldingsSourceAlert();
}

function renderHoldingsSourceAlert() {
  byId("holdings-source-alert").textContent = holdingsRuntime.state === "ready"
    && effectiveHoldingsStatus(holdingsRuntime.data) === "OK" ? "" : "· !";
}

function refreshHoldingsFreshnessDisplay() {
  if (holdingsRuntime.state !== "ready" || !holdingsRuntime.data) return;
  // Freshness changes with wall-clock time even when the underlying private
  // file does not.  Re-evaluate on the existing live poll heartbeat so a
  // loaded 29-minute snapshot cannot remain visually green after 30 minutes.
  renderHoldings();
  renderHoldingsSourceAlert();
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
        "全部已接入券商 net liquidation 合计",
        {
          definition: "全部预期券商本次快照返回的账户净清算值合计，不含未接入的银行、基金或其它券商资产。",
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
          entity_label: "全部预期券商",
          fact: `账户风险来源状态为 ${sourceStatus}，无法确认当前组合闸门。`,
          inference: "旧的持仓动作可能已过期，不应继续展示为当前建议。",
          execution_condition: "全部预期券商来源均恢复为 OK，且账户快照不超过 10 分钟。",
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
  return { day: "最近完整交易日", week: "本周", month: "本月" }[value] || value;
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

function periodCashflowDisplay(trading, period) {
  return resolvePeriodCashflowDisplay(period, {
    cadence: period?.cadence || "day",
    sourcesComplete: tradingSourcesComplete(trading) && isPeriodCoverageComplete(period),
    yearComplete: period?.cadence !== "year" || period?.coverage_status === "COMPLETE",
  });
}

function livingExpenseCoverage(period, trading, display = periodCashflowDisplay(trading, period)) {
  const cashflowHealth = periodCashflowHealth(trading, period);
  const decisionComplete = periodDecisionComplete(display);
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
    livingExpenseNetCashflowUsd: decisionComplete ? display.livingValue : null,
    usdCnyRate: monitorData?.meta?.usd_cny_rate,
    coverageStatus: decisionComplete
      ? cashflowHealth
      : combineHealthStatuses([cashflowHealth, "PARTIAL"]),
    fxStatus,
  });
}

function tradingAction(period, portfolioSummary, display) {
  if (!periodDecisionComplete(display)) {
    return "数据覆盖不完整：仅用于核对，不据此判断可分配现金、扩大仓位或结束当日交易。";
  }
  const trades = Number(period.same_day_equity_matched_set_count || 0) + Number(period.option_closed_trades || 0);
  const pnl = Number(period.active_net_pnl || 0);
  const weak = [period.same_day_equity_profit_factor, period.option_profit_factor]
    .filter((value) => value !== null && value !== undefined)
    .some((value) => Number(value) < 1);
  if (!trades) return "尚无已完成周期；不要把未平仓浮盈当作可分配现金。";
  if (trades < 20) return "已完成周期少于20个：胜率与利润因子仅作早期观察，不据此放大仓位。";
  if (pnl < 0 || weak) return "净收益为负或利润因子低于1：缩小单笔风险，先复盘亏损集中来源。";
  if (display.livingValue < 0) {
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
    const display = periodCashflowDisplay(trading, period);
    const displayedGeneratedCashflow = display.value;
    const accountInterest = display.interestValue;
    const livingCashflow = display.livingValue;
    const expenseCoverage = livingExpenseCoverage(period, trading, display);
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
        display.generatedComplete ? "现金流创造" : "可确认现金流创造",
        TERM_DEFINITIONS.generatedCashflow,
        "trading-primary-label",
      ),
      el(
        "span",
        "trading-primary-formula",
        display.generatedComplete
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
      term(
        display.livingComplete ? "生活开支评估净现金流" : "可确认生活净额",
        TERM_DEFINITIONS.livingExpenseCashflow,
      ),
      el(
        "strong",
        isFiniteMetric(livingCashflow) ? Number(livingCashflow) < 0 ? "negative" : "positive" : "",
        usd(livingCashflow),
      ),
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
        `${number(period.same_day_equity_matched_set_count, 0)} 个因果同日 realization + ${number(period.active_residual_overnight_equity_closed_trades, 0)} 个已归类跨日残余周期`,
        "stock",
        [
          { label: "毛收益（未扣手续费）", value: period.active_equity_gross_pnl, definition: TERM_DEFINITIONS.grossTradingPnl },
          { label: "手续费成本", value: negativeMetric(period.active_equity_fees), definition: "已分摊到主动股票完整周期的佣金及费用，以负数显示。" },
          { label: "扣费后主动净收益", value: period.active_equity_net_pnl, definition: TERM_DEFINITIONS.netTradingPnl, primary: true },
        ],
        `其中因果同日策略 ${usd(period.same_day_equity_net_pnl)} · 已归类跨日残余 ${usd(period.active_residual_overnight_equity_net_pnl)} · 现金流贡献 ${pct(period.active_equity_cashflow_contribution)}`,
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
          { label: display.generatedComplete ? "现金流创造" : "可确认现金流创造", value: displayedGeneratedCashflow, definition: TERM_DEFINITIONS.generatedCashflow },
          { label: "融资 / 借券 / 其他利息", value: accountInterest, definition: "服务长期持仓的融资成本及账户其他已入账利息净额；负值减少生活开支可用现金，但不归因给日内或期权策略。" },
          { label: display.livingComplete ? "生活开支评估净现金流" : "可确认生活净额", value: livingCashflow, definition: TERM_DEFINITIONS.livingExpenseCashflow, primary: true },
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
              : periodDecisionComplete(display)
            ? "Realized 与历史覆盖完整。"
            : "券商来源或费用覆盖不完整，本卡仅用于核对。";
    const advice = el(
      "p",
      "trading-advice",
      `${period.coverage_reason || ""} ${coverageNote} ${tradingAction(period, portfolioSummary, display)} ${scopeNote}`,
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

function renderTradingCashflowChart(trading) {
  const yearPeriod = (trading.periods || []).find((period) => period.cadence === "year");
  const yearComplete = Boolean(yearPeriod && settledPeriodComplete(trading, yearPeriod));
  const yearScope = yearSeriesScope(yearPeriod, yearComplete);
  const descriptions = {
    day: "最近30个有记录的美东监控日；分别显示现金流创造、已入账融资/利息与生活净额，部分覆盖保留可确认小计。",
    week: "最近16周；按周保留时间桶，分别汇总现金流创造、已入账融资/利息与生活净额。",
    month: "最近12个月；月份不会因局部未知而消失，缺失只形成对应序列断点。",
    year: yearPeriod?.coverage_status === "PARTIAL"
      ? yearPeriod.coverage_reason
      : yearPeriod?.coverage_status === "UNKNOWN"
        ? "共同历史覆盖起点未知，不生成确定性年内累计。"
        : yearComplete
          ? "本年度按月累计现金流创造、已入账融资/利息与生活开支评估净现金流"
          : "自然年历史存在，但 realized、策略归类、券商来源、股息或利息覆盖不完整；以下仅为年内可确认金额。",
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

  const series = buildCashflowChartSeries(
    trading.daily,
    tradingChartCadence,
    {
      yearPeriod,
      yearComplete,
      sourcesComplete: tradingSourcesComplete(trading),
      scopeStart: yearPeriod?.start_date || null,
      scopeEnd: yearPeriod?.end_date || null,
    },
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
  const generatedLabel = latest.generatedComplete ? "现金流创造" : "可确认现金流创造";
  const livingLabel = latest.livingComplete ? "生活净额" : "可确认生活净额";
  const metricTone = (value) => isFiniteMetric(value)
    ? Number(value) < 0 ? "negative" : "positive"
    : "";
  const summaryItem = (label, value) => {
    const item = el("div", "trading-chart-summary-item");
    append(
      item,
      el("span", "", label),
      el("strong", metricTone(value), usd(value)),
    );
    return item;
  };
  const periodSummary = el("div", "trading-chart-summary-period");
  append(
    periodSummary,
    el("span", "", "当前时间桶"),
    el("strong", "", latest.fullLabel),
  );
  append(
    summary,
    periodSummary,
    summaryItem(generatedLabel, latest.value),
    summaryItem("融资 / 利息", latest.interestValue),
    summaryItem(livingLabel, latest.livingValue),
  );
  card.appendChild(summary);
  const legend = el("div", "trading-chart-legend");
  [
    ["generated", "实线", "现金流创造"],
    ["interest", "点线", "融资 / 利息"],
    ["living", "虚线", "生活净额"],
  ].forEach(([className, shape, label]) => {
    const item = el("span", "trading-chart-legend-item");
    append(
      item,
      el("i", `trading-chart-legend-swatch ${className}`, ""),
      el("span", "", `${label}（${shape}）`),
    );
    legend.appendChild(item);
  });
  card.appendChild(legend);

  const width = 820;
  const height = 250;
  const left = 72;
  const right = 20;
  const top = 18;
  const bottom = 215;
  const values = series.flatMap((row) =>
    [row.value, row.interestValue, row.livingValue].filter(isFiniteMetric).map(Number),
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
      el("span", "", row.generatedComplete ? "现金流创造" : "可确认现金流创造"),
      el("strong", metricTone(row.value), usd(row.value)),
    );
    const livingTotal = el("div", "trading-chart-tooltip-total secondary");
    append(
      livingTotal,
      el("span", "", row.livingComplete ? "生活开支评估净现金流" : "可确认生活净额"),
      el("strong", metricTone(row.livingValue), usd(row.livingValue)),
    );
    const details = el("div", "trading-chart-tooltip-details");
    [
      ["股票因果同日策略净收益", row.same_day_equity_net_pnl],
      ["已归类跨日残余净收益", row.active_residual_overnight_equity_net_pnl],
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
  svg.setAttribute("aria-label", `${yearScope || "现金流"}${descriptions[tradingChartCadence]}趋势图`);

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

  const appendSeriesSegments = (valueKey, className) => {
    let segment = [];
    const flush = () => {
      if (!segment.length) return;
      if (segment.length === 1) {
        const marker = document.createElementNS(svg.namespaceURI, "circle");
        marker.setAttribute("cx", String(segment[0][0]));
        marker.setAttribute("cy", String(segment[0][1]));
        marker.setAttribute("r", "2.25");
        marker.setAttribute("class", `trading-chart-series-point ${className}`.trim());
        svg.appendChild(marker);
      } else {
        const line = document.createElementNS(svg.namespaceURI, "polyline");
        line.setAttribute("points", segment.map((point) => point.join(",")).join(" "));
        line.setAttribute("class", `trading-chart-line ${className}`.trim());
        svg.appendChild(line);
      }
      segment = [];
    };
    series.forEach((row, index) => {
      if (!isFiniteMetric(row[valueKey])) {
        flush();
        return;
      }
      segment.push([x(index), y(row[valueKey])]);
    });
    flush();
  };
  appendSeriesSegments("value", "generated");
  appendSeriesSegments("interestValue", "interest");
  appendSeriesSegments("livingValue", "living");

  guideLine = document.createElementNS(svg.namespaceURI, "line");
  guideLine.setAttribute("y1", String(top));
  guideLine.setAttribute("y2", String(bottom));
  guideLine.setAttribute("class", "trading-chart-guide");
  guideLine.setAttribute("visibility", "hidden");
  svg.appendChild(guideLine);

  const points = series.map((row, index) => {
    const anchorValue = [row.value, row.livingValue, row.interestValue].find(isFiniteMetric);
    if (!isFiniteMetric(anchorValue)) return null;
    const point = document.createElementNS(svg.namespaceURI, "circle");
    point.setAttribute("cx", String(x(index)));
    point.setAttribute("cy", String(y(anchorValue)));
    point.setAttribute("r", "3.5");
    point.setAttribute("tabindex", "0");
    point.setAttribute("role", "button");
    point.setAttribute(
      "aria-label",
      `${row.fullLabel}，${row.generatedComplete ? "现金流创造" : "可确认现金流创造"} ${usd(row.value)}，` +
      `${row.livingComplete ? "生活开支评估净现金流" : "可确认生活净额"} ${usd(row.livingValue)}，` +
      `股票因果同日策略 ${usd(row.same_day_equity_net_pnl)}，已归类跨日残余 ${usd(row.active_residual_overnight_equity_net_pnl)}，期权 ${usd(row.option_net_pnl)}，` +
      `税后股息 ${usd(row.dividend_cashflow)}，利息 ${usd(row.account_interest_cashflow)}，` +
      `手续费 ${usd(negativeMetric(row.fees))}`,
    );
    point.setAttribute("aria-describedby", tooltip.id);
    point.setAttribute("class", !isFiniteMetric(row.value)
      ? "trading-chart-point unknown"
      : Number(row.value) < 0 ? "trading-chart-point loss" : "trading-chart-point win");
    const title = document.createElementNS(svg.namespaceURI, "title");
    title.textContent = `${row.fullLabel}：${row.generatedComplete ? "创造" : "可确认创造"} ${usd(row.value)}；融资/利息 ${usd(row.interestValue)}；${row.livingComplete ? "生活净额" : "可确认生活净额"} ${usd(row.livingValue)}`;
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
    if (!point) return;
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
    if (series.length === 1) return points[0] ? 0 : -1;
    const ratio = (localX - left) / (width - left - right);
    const candidate = Math.max(0, Math.min(series.length - 1, Math.round(ratio * (series.length - 1))));
    return points.reduce((nearest, point, index) => {
      if (!point) return nearest;
      return nearest < 0 || Math.abs(index - candidate) < Math.abs(nearest - candidate)
        ? index
        : nearest;
    }, -1);
  };
  hitArea.addEventListener("pointermove", (event) => {
    const index = nearestPointIndex(event);
    if (!pinnedPoint && index >= 0) activatePoint(index);
  });
  hitArea.addEventListener("pointerleave", () => {
    if (!pinnedPoint) {
      tooltip.hidden = true;
      clearActivePoint();
    }
  });
  hitArea.addEventListener("click", (event) => {
    const index = nearestPointIndex(event);
    if (index >= 0) activatePoint(index, true);
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
  const noActiveSession = live?.data_status === "NO_ACTIVE_SESSION";
  if (noActiveSession) {
    const sources = Array.isArray(live?.sources) ? live.sources : [];
    const sourceIssues = sources.length
      ? sources.filter((source) => String(source?.status || "MISSING").toUpperCase() !== "OK").length
      : 1;
    const card = el(
      "section",
      `live-trading-card live-trading-card-closed tone-${sourceIssues ? "amber" : "green"}`,
    );
    const summary = el("div", "live-closed-summary");
    const copy = el("div", "live-closed-copy");
    append(
      copy,
      el("p", "eyebrow", "MARKET · CLOSED"),
      el("h2", "", "当前为非交易日"),
      el("p", "live-trading-window", "无当日交易窗口；盘中现金流、风控节奏与目标设置将在下一交易日自动恢复。"),
    );
    const health = el("div", "live-closed-health");
    const indicators = el("span", "live-status-indicators");
    if (sources.length) sources.forEach((source) => indicators.appendChild(liveBrokerIndicator(source)));
    else indicators.appendChild(liveBrokerIndicator(null));
    append(
      health,
      indicators,
      el(
        "span",
        `live-closed-meta ${sourceIssues ? "warning" : ""}`.trim(),
        sourceIssues
          ? `${sourceIssues} 个来源待核对 · 最近检查 ${liveTime(live?.checked_at)}`
          : `券商连接正常 · 最近检查 ${liveTime(live?.checked_at)}`,
      ),
    );
    append(summary, copy, health);
    card.appendChild(summary);
    return card;
  }
  const target = liveTarget(trading);
  const signal = liveSignal(trading);
  const cashflowDisplay = resolveLiveCashflowDisplay(live);
  const cashflowValue = cashflowDisplay.value;
  const cashflowComplete = cashflowDisplay.complete;
  const cashflowScopeComplete = live?.active_scope_coverage_status === "COMPLETE";
  const realizedTrading = resolveLiveRealizedTradingDisplay(live);
  const realizedTradingValue = realizedTrading.net;
  const realizedTradingComplete = realizedTrading.complete;
  const executionFees = isFiniteMetric(live?.executed_order_fees)
    ? live.executed_order_fees
    : isFiniteMetric(live?.confirmed_executed_order_fees)
      ? live.confirmed_executed_order_fees
      : null;
  const executionFeesComplete = isFiniteMetric(live?.executed_order_fees);
  const card = el("section", `live-trading-card tone-${signal.tone}`);
  const head = el("div", "live-trading-head");
  const heading = el("div");
  append(
    heading,
    el("p", "eyebrow", "LIVE · PROVISIONAL"),
    el("h2", "", `${live?.monitoring_day || "本日"} 截至当前生活现金流与交易实绩`),
    el(
      "p",
      "live-trading-window",
      `${live?.window_label || "美东 [T-1 20:00, T 20:00)"} · 截至 ${liveTime(live?.checked_at)}`,
    ),
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
      cashflowDisplay.includesInterest
        ? cashflowComplete ? "截至当前生活开支评估净现金流" : "截至当前可确认生活净现金流"
        : "截至当前可确认现金流创造（利息待确认）",
      TERM_DEFINITIONS.generatedCashflow,
      "live-primary-label",
    ),
    el(
      "span",
      "",
      cashflowDisplay.includesInterest
        ? `${cashflowComplete ? "完整" : "可确认"}主动股票、期权、税后股息与已入账账户利息；手续费和税费已包含在交易净收益中`
        : "仅显示已实现且已归类的主动交易、期权与税后股息；融资/账户利息覆盖未确认",
    ),
  );
  append(primary, primaryCopy, primaryValue);

  const cashflowLayer = el("div", "live-cashflow-layer");
  const cashflowCopy = el("div");
  append(
    cashflowCopy,
    term(
      realizedTradingComplete ? "全部已实现交易净收益（审计）" : "可确认已实现交易净收益（审计）",
      TERM_DEFINITIONS.provisionalRealizedTradingPnl,
      "live-cashflow-label",
    ),
    el(
      "small",
      "",
      `${live?.realized_trading_cycle_count ?? 0} 个成本与费用可证明的 realized fragment；包含待归类及长期资产处置，仅供交易审计，不自动进入生活现金流${!cashflowScopeComplete ? `；其中 ${live?.unclassified_overnight_realization_count || 0} 个隔夜片段待归类` : ""}`,
    ),
    el(
      "small",
      "live-ledger-note",
      "账户 FIFO 审计与策略归因是同一窗口的不同账本视角，成本基础不同，不应直接相减或强制勾稽。",
    ),
  );
  append(
    cashflowLayer,
    cashflowCopy,
    el(
      "strong",
      Number(realizedTradingValue) < 0 ? "negative" : Number(realizedTradingValue) > 0 ? "positive" : "",
      usd(realizedTradingValue),
    ),
  );

  const details = el("div", "live-detail-grid");
  [
    ["股票因果同日策略净收益", live?.same_day_equity?.net_pnl, `${live?.same_day_equity?.closed_trades ?? "—"} 个 realization；普通买入仅由后续卖出实现，可跨券商按标准化标的归因`],
    ["已归类跨日残余净收益", live?.cashflow_active_residual_overnight_equity_net_pnl, "仅计入同日净额残余账中已归类为主动交易的完成片段"],
    ["期权净入账", live?.options?.net_pnl, `${live?.options?.closed_trades ?? "—"} 个已实现片段`],
    ["待归类隔夜已实现", live?.unclassified_overnight_net_pnl, `${live?.unclassified_overnight_realization_count ?? "—"} 个片段；不进入生活现金流`],
    ["长期资产处置已实现", live?.long_term_realization_net_pnl, `${live?.long_term_realization_count ?? "—"} 个片段；不进入生活现金流`],
    ["税后已入账股息", live?.cashflow_dividend, "不含应收或未入账股息"],
    [
      live?.interest_coverage_status === "COMPLETE" ? "已入账融资 / 账户利息" : "融资 / 账户利息待确认",
      live?.interest_coverage_status === "COMPLETE" ? live?.account_interest_cashflow : null,
      "仅统计当前监控窗口已入账流水；未入账、应计或覆盖不完整不按零处理",
    ],
    [
      executionFeesComplete ? "已成交订单手续费 / 税费" : "可确认已成交订单手续费 / 税费",
      executionFees === null ? null : -Math.abs(executionFees),
      `${live?.executed_order_fill_count ?? "—"} 笔成交；包含尚未形成已实现收益的开仓费用，不会重复扣入上方净收益`,
    ],
    [
      realizedTradingComplete ? "已实现片段分摊费用" : "可确认已实现片段分摊费用",
      realizedTrading.fees === null ? null : -Math.abs(realizedTrading.fees),
      "按已实现数量分摊开仓与平仓的可取得佣金、平台费及交易相关税费；已包含在上方交易净收益",
    ],
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
    el("span", "", target.status === "OK"
      ? "可比较"
      : target.referenceAvailable
        ? "可确认参考 · 不参与达标判断"
        : "数据不足，暂停达标判断"),
  );
  const formula = el("p", "live-target-formula");
  formula.textContent = target.status === "OK" && target.remainingSessionsInMonth
    ? `（${cny(target.monthlyTargetCny)} − 本月已结算 ${cny(target.settledMtdActiveNetPnlCny)}）÷ ${target.remainingSessionsInMonth} 个剩余 NYSE 交易日（含今日）= ${cny(target.dailyTargetCny)} / 日${target.dailyTargetUsd !== null ? `（${usdExact(target.dailyTargetUsd)}）` : ""}`
    : target.referenceAvailable
      ? `（${cny(target.monthlyTargetCny)} − 本月可确认已结算 ${cny(target.confirmedSettledMtdActiveNetPnlCny)}）÷ ${target.remainingSessionsInMonth} 个剩余 NYSE 交易日（含今日）= 参考 ${cny(target.referenceDailyTargetCny)} / 日${target.referenceDailyTargetUsd !== null ? `（${usdExact(target.referenceDailyTargetUsd)}）` : ""}`
      : target.remainingSessionsInMonth
        ? `（${cny(target.monthlyTargetCny)} − 本月已结算 —）÷ ${target.remainingSessionsInMonth} 个剩余 NYSE 交易日（含今日）= — / 日`
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
  append(card, head, primary, cashflowLayer, details, signalBlock, statusDetails, targetPanel);
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
    const display = periodCashflowDisplay(trading, focus);
    const generated = display.value;
    const living = display.livingValue;
    const generatedLabel = display.generatedComplete ? "现金流创造" : "可确认现金流创造";
    const livingLabel = display.livingComplete ? "生活净额" : "可确认生活净额";
    const coverage = livingExpenseCoverage(focus, trading, display);
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
        `${cadenceLabel(focus.cadence, focus)} · ${generatedLabel} ${usd(generated)} · ${livingLabel} ${usd(living)}`,
      ),
      el(
        "p",
        "",
        `${focus.start_date || "起点未知"} — ${focus.end_date} · ${coverage.status === "OK" ? `月目标覆盖 ${pct(coverage.coverageRatio)}` : coverage.reason} ${tradingAction(focus, summary, display)}`,
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

function strategyTrendData(data) {
  if (strategyReturnCadence === "month") {
    const rows = Array.isArray(data.monthly_returns) ? data.monthly_returns : [];
    const labels = [...new Set(rows.map((row) => row.period))].sort().slice(-24);
    return {
      labels,
      series: [
        ["Futu", "#2563eb"],
        ["Tiger", "#d97706"],
      ].map(([broker, color]) => ({
        id: broker,
        label: broker,
        color,
        values: labels.map((label) => rows.find((row) => row.broker === broker && row.period === label)?.return ?? null),
      })),
      note: "Futu 为券商月度展示收益，不可链式复原年度 TWR/MWR；Tiger 为日级 RoR 链式月度走势。",
    };
  }
  const rows = Array.isArray(data.annual_returns) ? data.annual_returns : [];
  const portfolioRows = Array.isArray(data.portfolio_returns) ? data.portfolio_returns : [];
  const benchmarks = Array.isArray(data.benchmarks) ? data.benchmarks : [];
  const labels = [...new Set([...rows, ...portfolioRows].map((row) => String(row.year)))].sort();
  const definitions = [
    ["Futu TWR", "Futu", "twr", "#2563eb"],
    ["Futu MWR", "Futu", "mwr", "#60a5fa"],
    ["Tiger TWR", "Tiger", "twr", "#d97706"],
    ["Tiger MWR", "Tiger", "mwr", "#fbbf24"],
  ];
  const series = definitions.map(([label, broker, field, color]) => ({
    id: label,
    label,
    color,
    values: labels.map((year) => rows.find((row) => row.broker === broker && row.year === Number(year))?.[field] ?? null),
  }));
  for (const [label, field, color] of [
    ["跨券商 TWR", "twr", "#047857"],
    ["跨券商 MWR", "mwr", "#db2777"],
  ]) {
    series.push({
      id: label,
      label,
      color,
      values: labels.map((year) => portfolioRows.find((row) => row.year === Number(year))?.[field] ?? null),
    });
  }
  for (const ticker of ["SPY", "QQQ"]) {
    series.push({
      id: ticker,
      label: `${ticker} 价格回报`,
      color: ticker === "SPY" ? "#64748b" : "#9333ea",
      values: labels.map((year) => benchmarks.find((row) => row.ticker === ticker && row.year === Number(year))?.return ?? null),
    });
  }
  const combined = portfolioRows.at(-1);
  const combinedNote = combined
    ? `跨券商系统值仅覆盖 ${combined.start_date}—${combined.end_date}${combined.coverage_status === "PARTIAL" ? "（部分年度）" : ""}；不平均券商百分比。`
    : "跨券商共同日终历史或资金流覆盖不足，系统 TWR/MWR 保持未知。";
  return { labels, series, note: `年度券商值为原生核验；${combinedNote} SPY/QQQ 为价格回报，不含分红再投资。` };
}

function selectedStrategySeries(trend) {
  const available = trend.series.filter((series) => series.values.some(isFiniteMetric)).map((series) => series.id);
  let stored = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(`zzao-monitor-strategy-series-${strategyReturnCadence}`) || "[]");
    stored = Array.isArray(parsed) ? parsed.filter((id) => available.includes(id)) : [];
  } catch (_error) {
    stored = [];
  }
  return stored.length ? stored : available;
}

function persistStrategySeries(ids) {
  localStorage.setItem(`zzao-monitor-strategy-series-${strategyReturnCadence}`, JSON.stringify(ids));
}

function renderStrategyTrend(data) {
  const trend = strategyTrendData(data);
  const wrapper = el("div", "strategy-trend");
  const controls = el("div", "strategy-trend-controls");
  for (const cadence of ["year", "month", "week"]) {
    const button = el("button", "strategy-cadence", { year: "年", month: "月", week: "周" }[cadence]);
    button.type = "button";
    button.disabled = cadence === "week";
    button.title = cadence === "week" ? "跨券商完整周收益历史仍在积累，保持未知" : "";
    button.setAttribute("aria-pressed", String(strategyReturnCadence === cadence));
    button.addEventListener("click", () => {
      strategyReturnCadence = cadence;
      localStorage.setItem("zzao-monitor-strategy-chart", cadence);
      renderStrategy();
    });
    controls.appendChild(button);
  }
  wrapper.appendChild(controls);
  if (!trend.labels.length) {
    wrapper.appendChild(el("p", "empty-state", "收益历史不可用；不会以零补齐。"));
    return wrapper;
  }
  const selectedIds = selectedStrategySeries(trend);
  const availableSeries = trend.series.filter((series) => series.values.some(isFiniteMetric));
  const filter = el("div", "strategy-series-filter");
  const allButton = el("button", "strategy-series-toggle", "全部");
  allButton.type = "button";
  allButton.setAttribute("aria-pressed", String(selectedIds.length === availableSeries.length));
  allButton.addEventListener("click", () => { persistStrategySeries(availableSeries.map((series) => series.id)); renderStrategy(); });
  filter.appendChild(allButton);
  availableSeries.forEach((series) => {
    const active = selectedIds.includes(series.id);
    const button = el("button", "strategy-series-toggle");
    button.type = "button";
    button.setAttribute("aria-pressed", String(active));
    const swatch = el("i", "strategy-legend-swatch"); swatch.style.background = series.color;
    append(button, swatch, el("span", "", series.label));
    button.addEventListener("click", () => {
      const next = active ? selectedIds.filter((id) => id !== series.id) : [...selectedIds, series.id];
      if (!next.length) return;
      persistStrategySeries(next); renderStrategy();
    });
    filter.appendChild(button);
  });
  wrapper.appendChild(filter);
  const visibleSeries = trend.series.filter((series) => selectedIds.includes(series.id));
  const values = visibleSeries.flatMap((series) => series.values.filter(isFiniteMetric));
  if (!values.length) {
    wrapper.appendChild(el("p", "empty-state", "当前颗粒度没有可确认收益。"));
    return wrapper;
  }
  const width = 1120;
  const height = 360;
  const margin = { top: 24, right: 24, bottom: 48, left: 70 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const pad = Math.max((high - low) * 0.12, 0.02);
  const yMin = low - pad;
  const yMax = high + pad;
  const x = (index) => margin.left + (trend.labels.length === 1 ? innerWidth / 2 : innerWidth * index / (trend.labels.length - 1));
  const y = (value) => margin.top + innerHeight * (yMax - value) / (yMax - yMin);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("strategy-trend-svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${strategyReturnCadence === "year" ? "年度" : "月度"}跨券商收益趋势`);
  for (const tick of [yMin, 0, yMax]) {
    const line = document.createElementNS(svg.namespaceURI, "line");
    line.setAttribute("x1", margin.left); line.setAttribute("x2", width - margin.right);
    line.setAttribute("y1", y(tick)); line.setAttribute("y2", y(tick)); line.setAttribute("class", "strategy-grid-line");
    svg.appendChild(line);
    const label = document.createElementNS(svg.namespaceURI, "text");
    label.setAttribute("x", margin.left - 12); label.setAttribute("y", y(tick) + 5); label.setAttribute("text-anchor", "end");
    label.setAttribute("class", "strategy-axis-label"); label.textContent = pct(tick, 0); svg.appendChild(label);
  }
  trend.labels.forEach((labelText, index) => {
    if (trend.labels.length > 12 && index % Math.ceil(trend.labels.length / 8) !== 0 && index !== trend.labels.length - 1) return;
    const label = document.createElementNS(svg.namespaceURI, "text");
    label.setAttribute("x", x(index)); label.setAttribute("y", height - 14); label.setAttribute("text-anchor", "middle");
    label.setAttribute("class", "strategy-axis-label"); label.textContent = labelText; svg.appendChild(label);
  });
  for (const series of visibleSeries) {
    let segment = [];
    const flush = () => {
      if (!segment.length) return;
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.setAttribute("d", segment.map((point, index) => `${index ? "L" : "M"}${point[0]} ${point[1]}`).join(" "));
      path.setAttribute("fill", "none"); path.setAttribute("stroke", series.color); path.setAttribute("class", "strategy-series-line");
      svg.appendChild(path); segment = [];
    };
    series.values.forEach((value, index) => {
      if (!isFiniteMetric(value)) { flush(); return; }
      segment.push([x(index), y(value)]);
      const dot = document.createElementNS(svg.namespaceURI, "circle");
      dot.setAttribute("cx", x(index)); dot.setAttribute("cy", y(value)); dot.setAttribute("r", 3.5);
      dot.setAttribute("fill", series.color); svg.appendChild(dot);
    });
    flush();
  }
  wrapper.appendChild(svg);
  const legend = el("div", "strategy-legend");
  visibleSeries.filter((series) => series.values.some(isFiniteMetric)).forEach((series) => {
    const item = el("span", "strategy-legend-item");
    const swatch = el("i", "strategy-legend-swatch"); swatch.style.background = series.color;
    append(item, swatch, el("span", "", series.label)); legend.appendChild(item);
  });
  wrapper.appendChild(legend);
  wrapper.appendChild(el("p", "section-note", trend.note));
  return wrapper;
}

function renderStrategyAllocation(data) {
  const allocation = data.allocation || {};
  const wrapper = el("div", "strategy-allocation");
  if (allocation.status === "MISSING" || !(allocation.buckets || []).length) {
    wrapper.appendChild(el("p", "empty-state", "最新跨券商持仓尚未完整取得；策略比例保持未知。"));
    return wrapper;
  }
  const bar = el("div", "strategy-allocation-bar");
  const bucketColors = { 高进攻: "#dc2626", 现金流支柱: "#15803d", 防御避险: "#2563eb" };
  for (const bucket of allocation.buckets) {
    const segment = el("div", "strategy-allocation-segment");
    segment.style.width = `${Math.max(Number(bucket.actual_pct || 0) * 100, 0)}%`;
    segment.style.background = bucketColors[bucket.bucket];
    segment.title = `${bucket.bucket} ${pct(bucket.actual_pct)} · 目标 ${pct(bucket.target_pct)}`;
    if (Number(bucket.actual_pct) >= 0.08) segment.textContent = `${bucket.bucket} ${pct(bucket.actual_pct, 0)}`;
    bar.appendChild(segment);
  }
  wrapper.appendChild(bar);
  const hierarchy = el("div", "strategy-bucket-grid");
  for (const bucket of allocation.buckets) {
    const card = el("article", `strategy-bucket-card ${bucket.status.toLowerCase()}`);
    const amount = isFiniteMetric(bucket.rebalance_amount_usd)
      ? `${bucket.rebalance_amount_usd >= 0 ? "补足" : "降低"} ${usd(Math.abs(bucket.rebalance_amount_usd), true)}`
      : portfolioOverviewSummary?.portfolio_gate === "RED"
        ? "红色风险闸门：暂停金额建议"
        : allocation.status !== "COMPLETE"
          ? "数据覆盖不足：金额暂缓"
          : "金额建议暂不可用";
    const targetLine = el("p", "strategy-bucket-target");
    targetLine.append(`目标 ${pct(bucket.target_pct)} · 偏离 `);
    const gap = Number(bucket.gap_pct);
    const gapText = isFiniteMetric(gap) ? `${gap > 0 ? "+" : ""}${pct(gap)}` : "—";
    targetLine.appendChild(el("span", gap > 0 ? "strategy-deviation-positive" : gap < 0 ? "strategy-deviation-negative" : "strategy-deviation-neutral", gapText));
    append(card,
      el("p", "metric-label", bucket.bucket),
      el("strong", "strategy-bucket-value", pct(bucket.actual_pct)),
      targetLine,
      el("p", "strategy-bucket-action", amount),
    );
    const holdings = el("div", "strategy-holding-chips");
    (allocation.holdings || []).filter((row) => row.bucket === bucket.bucket).forEach((row) => {
      holdings.appendChild(el("span", "strategy-holding-chip", `${row.ticker} ${pct(row.actual_pct)}`));
    });
    card.appendChild(holdings);
    hierarchy.appendChild(card);
  }
  wrapper.appendChild(hierarchy);
  if ((allocation.unclassified || []).length) {
    const details = el("details", "strategy-unclassified");
    details.appendChild(el("summary", "", `另有 ${allocation.unclassified.length} 个未分类或非长期多头标的；展开查看为何不进入三桶分母。`));
    const list = el("ul", "strategy-unclassified-list");
    (allocation.unclassified || []).forEach((row) => {
      const reason = row.reason_code === "UNCLASSIFIED_TICKER"
        ? "正向长期持仓尚未映射策略桶"
        : Number(row.shares) < 0
          ? "空头腿，不属于长期多头策略分母"
          : "期权或其它非长期多头腿，不属于三桶分母";
      list.appendChild(el("li", "", `${row.ticker} · ${reason}`));
    });
    details.appendChild(list); wrapper.appendChild(details);
  }
  return wrapper;
}

function renderStrategyInstrumentTypes(allocation) {
  const rows = Array.isArray(allocation?.instrument_types) ? allocation.instrument_types : [];
  const wrapper = el("div", "strategy-instrument-types");
  if (!rows.length) {
    wrapper.appendChild(el("p", "empty-state", "当前证券类型结构不可确认；不会以策略分类代替券商证券类型。"));
    return wrapper;
  }
  const colors = { STOCK: "#2563eb", ETF: "#0f766e", FUND: "#7c3aed", BOND: "#b45309", REIT: "#be123c", ADR: "#4f46e5", OTHER: "#64748b" };
  const labels = { STOCK: "股票", ETF: "ETF", FUND: "基金", BOND: "债券", REIT: "REIT", ADR: "ADR", OTHER: "其他" };
  const bar = el("div", "strategy-type-bar");
  rows.forEach((row) => {
    const segment = el("div", "strategy-type-segment");
    segment.style.width = `${Math.max(row.actual_pct * 100, 0)}%`;
    segment.style.background = colors[row.instrument_type];
    segment.title = `${labels[row.instrument_type]} ${pct(row.actual_pct)}`;
    bar.appendChild(segment);
  });
  wrapper.appendChild(bar);
  const legend = el("div", "strategy-type-grid");
  rows.forEach((row) => {
    const item = el("article", "strategy-type-item");
    const marker = el("i", "strategy-type-marker");
    marker.style.background = colors[row.instrument_type];
    append(item, marker, el("span", "", labels[row.instrument_type]), el("strong", "", pct(row.actual_pct)), el("small", "", usd(row.market_value_usd, true)));
    legend.appendChild(item);
  });
  wrapper.appendChild(legend);
  return wrapper;
}

function strategyOriginalPnl(row) {
  if (!isFiniteMetric(row?.pnl)) return "—";
  return row.pnl_currency === "CNH" ? cny(row.pnl) : usdExact(row.pnl);
}

function holdingFilterField(labelText, value, options, onChange) {
  const label = el("label", "holdings-filter-field");
  const select = el("select", "holdings-filter-select");
  options.forEach(([optionValue, optionLabel]) => {
    const option = el("option", "", optionLabel);
    option.value = optionValue;
    option.selected = optionValue === value;
    select.appendChild(option);
  });
  select.addEventListener("change", () => onChange(select.value));
  append(label, el("span", "", labelText), select);
  return label;
}

function holdingStatusNode(status) {
  const normalized = String(status || "MISSING").toUpperCase();
  const node = el("span", `holdings-status ${normalized.toLowerCase()}`, normalized);
  node.setAttribute("aria-label", `来源状态 ${normalized}`);
  return node;
}

function holdingDeviationNode(value) {
  if (!isFiniteMetric(value)) return el("span", "strategy-deviation-neutral", "—");
  const tone = value > 0
    ? "strategy-deviation-positive"
    : value < 0 ? "strategy-deviation-negative" : "strategy-deviation-neutral";
  return el("span", tone, `${value > 0 ? "+" : ""}${pct(value)}`);
}

function appendHoldingCell(row, value, { numeric = false, rowSpan = 1, className = "" } = {}) {
  const cell = el("td", `${numeric ? "num" : ""} ${className}`.trim());
  if (rowSpan > 1) cell.rowSpan = rowSpan;
  if (value instanceof Node) cell.appendChild(value);
  else cell.textContent = value ?? "—";
  row.appendChild(cell);
}

function renderHoldingsTable(host, rows, allocation, countNode) {
  const visibleRows = filterHoldingRows(rows, holdingsFilters);
  countNode.textContent = `显示 ${visibleRows.length} / ${rows.length} 项`;
  if (!visibleRows.length) {
    host.replaceChildren(el("p", "empty-state holdings-empty", "当前筛选条件下没有持仓。"));
    return;
  }
  const allocationByBucket = new Map(
    (allocation?.buckets || []).map((row) => [row.bucket, row]),
  );
  const mergeStrategy = holdingsFilters.group === "STRATEGY";
  const groupSizes = new Map();
  if (mergeStrategy) {
    visibleRows.forEach((row) => groupSizes.set(
      row.strategy_bucket,
      (groupSizes.get(row.strategy_bucket) || 0) + 1,
    ));
  }
  const wrap = el("div", "table-wrap holdings-table-wrap");
  const tableNode = el("table", "holdings-ledger-table");
  const thead = el("thead");
  const headerRow = el("tr");
  [
    "策略归属", "目标配比", "实际配比", "漂移", "券商", "标的", "证券类型", "方向",
    "持仓数", `市值 ${displayCurrency}`, "占组合 NAV", "占三桶分母", "来源",
  ].forEach((label) => headerRow.appendChild(el("th", "", label)));
  thead.appendChild(headerRow);
  const tbody = el("tbody");
  const emittedGroups = new Set();
  visibleRows.forEach((row) => {
    const tr = el("tr");
    const firstInGroup = !mergeStrategy || !emittedGroups.has(row.strategy_bucket);
    if (firstInGroup) {
      emittedGroups.add(row.strategy_bucket);
      const rowSpan = mergeStrategy ? groupSizes.get(row.strategy_bucket) : 1;
      const allocationRow = allocationByBucket.get(row.strategy_bucket);
      appendHoldingCell(tr, holdingStrategyLabel(row.strategy_bucket), {
        rowSpan, className: "holdings-group-cell",
      });
      appendHoldingCell(tr, allocationRow?.target_pct === null
        || allocationRow?.target_pct === undefined ? "—" : pct(allocationRow.target_pct), {
        numeric: true, rowSpan, className: "holdings-group-cell",
      });
      appendHoldingCell(tr, allocationRow?.actual_pct === null
        || allocationRow?.actual_pct === undefined ? "—" : pct(allocationRow.actual_pct), {
        numeric: true, rowSpan, className: "holdings-group-cell",
      });
      appendHoldingCell(tr, holdingDeviationNode(allocationRow?.gap_pct), {
        numeric: true, rowSpan, className: "holdings-group-cell",
      });
    }
    appendHoldingCell(tr, row.broker);
    appendHoldingCell(tr, row.ticker);
    appendHoldingCell(tr, row.instrument_type === "OPTION" ? "期权" : row.instrument_type);
    appendHoldingCell(tr, row.direction === "LONG" ? "多头" : "空头");
    appendHoldingCell(tr, number(row.quantity, Math.abs(row.quantity % 1) > 0 ? 4 : 0), { numeric: true });
    appendHoldingCell(tr, usd(row.market_value_usd), { numeric: true });
    appendHoldingCell(tr, pct(row.pct_nav), { numeric: true });
    appendHoldingCell(tr, row.pct_classified_long === null ? "—" : pct(row.pct_classified_long), { numeric: true });
    appendHoldingCell(tr, holdingStatusNode(row.source_status));
    tbody.appendChild(tr);
  });
  append(tableNode, thead, tbody);
  wrap.appendChild(tableNode);
  host.replaceChildren(wrap);
}

function renderHoldingsAllocation(data) {
  const allocation = data?.allocation || {};
  const rows = Array.isArray(allocation.buckets) ? allocation.buckets : [];
  const grid = el("div", "holdings-allocation-grid");
  for (const row of rows) {
    const card = el("article", "holdings-allocation-card");
    const comparison = el("p", "section-note holdings-allocation-comparison");
    append(
      comparison,
      document.createTextNode(`目标 ${pct(row.target_pct)} · 漂移 `),
      holdingDeviationNode(row.gap_pct),
    );
    append(
      card,
      el("span", "metric-label", row.bucket),
      el("strong", "holdings-allocation-value", pct(row.actual_pct)),
      comparison,
    );
    grid.appendChild(card);
  }
  if (!grid.childElementCount) {
    grid.appendChild(el("p", "empty-state", "策略分类覆盖不足，三桶结构暂不可确认。"));
  }
  return grid;
}

function renderHoldings() {
  const root = byId("holdings-content");
  root.replaceChildren();
  if (holdingsRuntime.state !== "ready" || !holdingsRuntime.data) {
    const message = holdingsRuntime.state === "loading"
      ? "正在通过一次性凭证读取精确持仓…"
      : holdingsRuntime.state === "error"
        ? holdingsRuntime.error
        : "精确持仓需要解锁后从鉴权只读通道获取。";
    const state = el("section", "holdings-hero");
    append(state, el("div", "", message));
    if (["error", "idle"].includes(holdingsRuntime.state) && LIVE_CLIENT.holdingsUrl) {
      const retry = el("button", "live-refresh-button", "重新读取");
      retry.type = "button";
      retry.addEventListener("click", () => { void loadPrivateHoldings(); });
      state.appendChild(retry);
    }
    root.appendChild(state);
    return;
  }
  const data = holdingsRuntime.data;
  const summary = data.summary;
  const dataset = data.holdings;
  const rows = dataset.rows;
  const sourceStatus = effectiveHoldingsStatus(data);

  const hero = el("section", "holdings-hero");
  const heroCopy = el("div");
  append(
    heroCopy,
    el("strong", "", "最近确认的跨券商持仓快照"),
    el("p", "", "解锁后从鉴权只读通道读取最近确认批次；不展示成本、未实现盈亏或账户标识。"),
  );
  append(
    hero,
    heroCopy,
    el("span", `status-pill ${sourceStatus === "OK" ? "green" : "amber"}`, `${liveTime(summary.holdings_as_of || summary.source_retrieved_at)} · ${sourceStatus}`),
  );
  root.appendChild(hero);

  const metrics = el("section", "holdings-summary-grid");
  [
    ["跨券商净资产", usd(summary.derived_nav_usd, true), "全部已接入券商 net liquidation"],
    ["绝对毛敞口", usd(summary.gross_market_value_usd, true), "多空绝对值合计，不做方向抵消"],
    ["组合毛杠杆", isFiniteMetric(summary.gross_leverage) ? `${number(summary.gross_leverage, 2)}x` : "—", `治理红线 ${number(summary.gross_leverage_red, 2)}x`],
    ["当前持仓行", String(rows.length), "零数量行不进入账本"],
  ].forEach(([label, value, note]) => {
    const card = el("article", "holdings-summary-card");
    append(card, el("p", "metric-label", label), el("strong", "holdings-summary-value", value), el("p", "section-note", note));
    metrics.appendChild(card);
  });
  root.appendChild(metrics);

  const brokers = section("分券商概览", "同一批次快照中的账户聚合；不公开账户号或账户别名。");
  const brokerGrid = el("div", "holdings-broker-grid");
  (summary.broker_breakdown || []).forEach((row) => {
    const card = el("article", "holdings-broker-card");
    append(
      card,
      el("div", "holdings-broker-name", row.broker),
      el("strong", "holdings-broker-value", usd(row.derived_nav_usd, true)),
      el("p", "section-note", `毛敞口 ${usd(row.gross_market_value_usd, true)} · 杠杆 ${isFiniteMetric(row.gross_leverage) ? `${number(row.gross_leverage, 2)}x` : "—"}`),
      holdingStatusNode(row.source_status),
    );
    brokerGrid.appendChild(card);
  });
  if (!brokerGrid.childElementCount) brokerGrid.appendChild(el("p", "empty-state", "分券商快照暂不可用。"));
  brokers.appendChild(brokerGrid);
  root.appendChild(brokers);

  const ledger = section("跨券商持仓明细", "默认按策略合并行；目标、实际和漂移始终使用全组合三桶口径。筛选和分组只改变展示，不会重算金额或策略归属。");
  const controls = el("div", "holdings-controls");
  const searchLabel = el("label", "holdings-search-field");
  const search = el("input", "holdings-search-input");
  search.type = "search";
  search.placeholder = "搜索 ticker";
  search.value = holdingsFilters.query;
  append(searchLabel, el("span", "", "标的"), search);
  controls.appendChild(searchLabel);
  const tableHost = el("div", "holdings-table-host");
  const count = el("span", "holdings-result-count");
  const updateTable = () => renderHoldingsTable(tableHost, rows, data.allocation, count);
  search.addEventListener("input", () => { holdingsFilters.query = search.value; updateTable(); });
  const unique = (key) => [...new Set(rows.map((row) => row[key]).filter(Boolean))].sort();
  controls.appendChild(holdingFilterField("券商", holdingsFilters.broker,
    [["ALL", "全部"], ...unique("broker").map((value) => [value, value])],
    (value) => { holdingsFilters.broker = value; updateTable(); }));
  controls.appendChild(holdingFilterField("策略", holdingsFilters.strategy,
    [["ALL", "全部"], ...unique("strategy_bucket").map((value) => [value, holdingStrategyLabel(value)])],
    (value) => { holdingsFilters.strategy = value; updateTable(); }));
  controls.appendChild(holdingFilterField("类型", holdingsFilters.instrument,
    [["ALL", "全部"], ...unique("instrument_type").map((value) => [value, value === "OPTION" ? "期权" : value])],
    (value) => { holdingsFilters.instrument = value; updateTable(); }));
  controls.appendChild(holdingFilterField("方向", holdingsFilters.direction,
    [["ALL", "全部"], ["LONG", "多头"], ["SHORT", "空头"]],
    (value) => { holdingsFilters.direction = value; updateTable(); }));
  controls.appendChild(holdingFilterField("排列", holdingsFilters.group,
    [["VALUE", "按市值"], ["BROKER", "按券商"], ["STRATEGY", "按策略（合并行）"]],
    (value) => { holdingsFilters.group = value; updateTable(); }));
  append(ledger, controls, count, tableHost);
  updateTable();
  root.appendChild(ledger);

  const allocation = section("三桶配置参照", "只复用组合策略页已经确认的已分类长期多头分母；空头、期权和未分类项不进入目标比例。");
  allocation.appendChild(renderHoldingsAllocation({ allocation: data.allocation }));
  root.appendChild(allocation);

  const quality = section("数据健康与边界", "展开查看当前账本为什么可能不完整。");
  const details = el("details", "holdings-quality");
  const qualitySummary = el("summary", "", `${sourceStatus} · ${rows.length} 项持仓`);
  const qualityList = el("ul", "holdings-quality-list");
  [
    `持仓时间：${liveTime(summary.holdings_as_of || summary.source_retrieved_at)}`,
    `券商覆盖：${isFiniteMetric(summary.broker_coverage) ? pct(summary.broker_coverage, 0) : "—"}`,
    `输入守恒：${dataset.input_count ?? "—"} = ${dataset.accepted_count ?? "—"} 接受 + ${dataset.excluded_zero_count ?? "—"} 零仓排除 + ${dataset.rejected_count ?? "—"} 拒绝`,
    `策略分类：${data.allocation.status || "MISSING"}`,
    `原因码：${dataset.reason_codes.length ? dataset.reason_codes.join("、") : "无"}`,
    "不包含账户号、账户别名、合约 ID、成本、未实现盈亏或原始成交。",
  ].forEach((item) => qualityList.appendChild(el("li", "", item)));
  append(details, qualitySummary, qualityList);
  quality.appendChild(details);
  root.appendChild(quality);
}

function renderStrategy() {
  const root = byId("strategy-content");
  root.replaceChildren();
  const data = monitorData.strategy || {};
  if (data.contract_id !== STRATEGY_ANALYSIS_CONTRACT || data.formula !== STRATEGY_ANALYSIS_FORMULA) {
    root.appendChild(el("p", "empty-state", "组合策略数据契约不匹配，已停止展示派生指标。"));
    return;
  }
  const annual = Array.isArray(data.annual_returns) ? data.annual_returns : [];
  const latestYear = annual.length ? Math.max(...annual.map((row) => row.year)) : null;
  const latestFutu = annual.find((row) => row.broker === "Futu" && row.year === latestYear);
  const latestTiger = annual.find((row) => row.broker === "Tiger" && row.year === latestYear);
  const combined = Array.isArray(data.portfolio_returns) ? data.portfolio_returns.at(-1) : null;
  const hero = el("section", "strategy-hero");
  append(hero,
    el("div", "strategy-hero-copy", "把长期资产增长、不同券商策略实验和当前配置放在同一口径下复盘；不与生活现金流相加。"),
    el("span", `status-pill ${data.status === "COMPLETE" ? "green" : "amber"}`, `${data.as_of || "—"} · ${data.status || "MISSING"}`),
  );
  root.appendChild(hero);
  const metrics = el("section", "strategy-summary-grid");
  const summaryRows = [
    ["跨券商共同区间 TWR", combined ? pct(combined.twr) : "—", combined ? `MWR ${pct(combined.mwr)} · ${combined.start_date}—${combined.end_date}` : "共同日终历史或资金流覆盖不足"],
    ["Futu 最新 TWR", latestFutu ? pct(latestFutu.twr) : "—", latestFutu ? `MWR ${pct(latestFutu.mwr)} · ${latestFutu.coverage_status}` : "券商原生历史缺失"],
    ["Tiger 最新 TWR", latestTiger ? pct(latestTiger.twr) : "—", latestTiger ? `MWR ${pct(latestTiger.mwr)} · ${latestTiger.coverage_status}` : "券商原生历史缺失"],
    ["策略配置覆盖", data.allocation?.status || "MISSING", `${data.allocation?.classified_position_count ?? 0} 已分类 · ${data.allocation?.unclassified_position_count ?? 0} 未分类`],
  ];
  summaryRows.forEach(([label, value, note]) => {
    const card = el("article", "strategy-summary-card");
    append(card, el("p", "metric-label", label), el("strong", "strategy-summary-value", value), el("p", "section-note", note));
    metrics.appendChild(card);
  });
  root.appendChild(metrics);
  const trend = section("跨券商收益与成长趋势", "年度看券商原生 TWR/MWR；月度只展示有证据支持的走势口径，缺失不补零。 ");
  trend.appendChild(renderStrategyTrend(data)); root.appendChild(trend);

  const brokerSection = section("逐券商策略复盘", "Futu 与 Tiger 独立解读，适合比较不同券商中试验的策略方向。 ");
  const brokerGrid = el("div", "strategy-broker-grid");
  const currentBrokers = Array.isArray(portfolioOverviewSummary?.broker_breakdown)
    ? portfolioOverviewSummary.broker_breakdown : [];
  for (const broker of ["Futu", "Tiger"]) {
    const rows = annual.filter((row) => row.broker === broker).sort((a, b) => b.year - a.year)
      .map((row) => ({ ...row, pnl_display: strategyOriginalPnl(row) }));
    const current = currentBrokers.find((row) => row?.broker === broker);
    const card = el("article", "strategy-broker-card");
    const brokerHead = el("div", "strategy-broker-head");
    append(brokerHead,
      el("h3", "", broker),
      el("span", "", `净资产 ${usd(current?.derived_nav_usd, true)} · 毛杠杆 ${isFiniteMetric(current?.gross_leverage) ? `${number(current.gross_leverage, 2)}x` : "—"}`),
    );
    card.appendChild(brokerHead);
    card.appendChild(table([
      { key: "year", label: "年度" },
      { key: "twr", label: "TWR", numeric: true, render: pct },
      { key: "mwr", label: "MWR", numeric: true, render: pct },
      { key: "pnl_display", label: "券商年度盈亏", numeric: true },
      { key: "coverage_status", label: "覆盖" },
    ], rows));
    (data.insights || []).filter((item) => item.scope === broker).forEach((item) => card.appendChild(el("p", "strategy-rule-note", item.body)));
    brokerGrid.appendChild(card);
  }
  brokerSection.appendChild(brokerGrid); root.appendChild(brokerSection);

  const allocation = section("当前策略结构", "三桶比例以已分类长期多头战略持仓市值为分母；现金、空头、期权和未知分类单列。 ");
  allocation.appendChild(renderStrategyAllocation(data)); root.appendChild(allocation);

  const instrumentTypes = section("当前证券类型结构", "以跨券商正向长期多头、非期权市值为分母；使用券商快照报告的证券类型，不从名称猜测。 ");
  instrumentTypes.appendChild(renderStrategyInstrumentTypes(data.allocation)); root.appendChild(instrumentTypes);

  const recommendations = section("政策偏离与复盘建议", "由 strategy_policy_v1 的固定阈值和文案模板生成，不依赖大模型，也不会自动下单。 ");
  const insightList = el("div", "strategy-insight-list");
  (data.insights || []).filter((item) => !["Futu", "Tiger"].includes(item.scope)).forEach((item) => {
    const card = el("article", `strategy-insight ${item.severity.toLowerCase()}`);
    append(card, el("span", "badge", item.severity), el("h3", "", item.headline), el("p", "", item.body), el("code", "", item.rule_id));
    insightList.appendChild(card);
  });
  if (!insightList.childElementCount) insightList.appendChild(el("p", "empty-state", "当前没有达到偏离阈值的策略桶；仍需结合杠杆和未分类持仓复核。"));
  recommendations.appendChild(insightList); root.appendChild(recommendations);

  const quality = section("口径与数据健康", "不同收益口径不能相互替代。 ");
  quality.appendChild(el("div", "strategy-quality-grid"));
  const list = quality.querySelector(".strategy-quality-grid");
  [
    ["券商原生年度", "逐券商历史比较的主事实；2020 Futu 和当年 YTD 明确为部分年度。"],
    ["Futu 月度展示", "截图月格不可链式复原年度 TWR/MWR，因此只做走势参考。"],
    ["Tiger 日级走势", "从 2024-11-27 的真实非零起点计算；App 年度值仍独立保留。"],
    ["SPY / QQQ", "当前为正常交易时段价格回报，不含分红再投资，不能称为总回报。"],
  ].forEach(([label, body]) => {
    const item = el("article", "strategy-quality-item"); append(item, el("strong", "", label), el("p", "", body)); list.appendChild(item);
  });
  root.appendChild(quality);
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
  if (view === "holdings" && unlockKey && holdingsRuntime.state !== "loading") {
    void loadPrivateHoldings();
  }
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
  renderPortfolioOverview();
  renderPersonal();
  renderHoldings();
  renderMacro();
  renderTrading();
  renderStrategy();
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
  byId("strategy-source-alert").textContent = monitorData.strategy?.status === "COMPLETE"
    ? ""
    : "· !";
  renderHoldingsSourceAlert();
  renderCurrencyControl();
  renderPortfolioOverview();
  renderPersonal();
  renderHoldings();
  renderMacro();
  renderTrading();
  renderStrategy();
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
    portfolioOverviewSummary = updateLastConfirmedPortfolioOverview(
      null,
      monitorData.personal?.summary,
    );
    unlockKey = unlocked.key;
    passwordInput.value = "";
    renderDashboard();
    void loadPrivateHoldings();
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
  holdingsRequestGeneration += 1;
  unlockKey = null;
  holdingsRuntime.state = LIVE_CLIENT.holdingsUrl ? "idle" : "disabled";
  holdingsRuntime.data = null;
  holdingsRuntime.error = "";
  monitorData = null;
  portfolioOverviewSummary = null;
  liveRuntime.transportStatus = LIVE_CLIENT.payloadUrl ? "EXPECTED_LAG" : "MISSING";
  liveRuntime.pollState = LIVE_CLIENT.payloadUrl ? "idle" : "disabled";
  liveRuntime.refreshState = LIVE_CLIENT.refreshUrl ? "idle" : "disabled";
  liveRuntime.error = "";
  liveRuntime.cooldownUntil = 0;
  liveRuntime.pendingRefresh = null;
  byId("personal-content").replaceChildren();
  byId("macro-content").replaceChildren();
  byId("trading-content").replaceChildren();
  byId("strategy-content").replaceChildren();
  byId("holdings-content").replaceChildren();
  byId("dashboard").hidden = true;
  byId("unlock-view").hidden = false;
  byId("password").focus();
});
