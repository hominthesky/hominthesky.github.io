
// @app-block-start b001
import { learningMetrics } from "../learning_metrics.mjs";
// @app-block-end b001

// @app-block-start b002
import { renderIntentIncome, selectIntentIncome, intentRiskMessage } from "../intent_income.mjs";
// @app-block-end b002

// @app-block-start b003
import {
  DEFAULT_MONTHLY_TARGET_CNY,
  LIVE_POLL_INTERVAL_MS,
  MANUAL_REFRESH_TIMEOUT_MS,
  adaptTradingReviewModel,
  applyLiveRiskGate,
  anchoredPortfolioReturnReference,
  assessLiveTradingSignal,
  buildCashflowChartSeries,
  calculateDailyTarget,
  calculateLivingExpenseCoverage,
  combineHealthStatuses,
  currentPortfolioDisplaySummary,
  currentPortfolioReturnReferenceSummary,
  deriveFxStatus,
  derivePortfolioGateInput,
  liveFinancialFingerprint,
  isPeriodCoverageComplete,
  manualRefreshLabel,
  periodDecisionComplete,
  portfolioOverviewPresentation,
  refreshProofMessage,
  resolveLiveCashflowDisplay,
  resolveLiveRealizedTradingDisplay,
  resolvePeriodCashflowDisplay,
  resolvePendingManualRefresh,
  sanitizeCashflowLedgerV2,
  sanitizePrivateTradingLedgerClient,
  updateLastConfirmedPortfolioOverview,
  yearSeriesScope,
  yearCoverageLabel,
} from "../live_trading.mjs?v=20261003-1";
// @app-block-end b003

// @app-block-start b004
import {
  dashboardStatusForView,
  effectiveHoldingsStatus,
  filterHoldingRows,
  holdingStrategyLabel,
  holdingTagLabels,
  holdingStatusPresentation,
  holdingDisplayLabel,
  sanitizePrivateHoldings,
} from "../holdings_ledger.mjs?v=20260903-1";
// @app-block-end b004

// @app-block-start b005
import {
  createUnlockPersistence,
} from "../trusted_unlock.mjs?v=20260904-1";
// @app-block-end b005

// @app-block-start b006
const payloadUrl = "./payload.enc.json";
// @app-block-end b006

// @app-block-start b007
let monitorData = null;
// @app-block-end b007

// @app-block-start b008
let portfolioCurrentSummary = null;
// @app-block-end b008

// @app-block-start b009
let portfolioOverviewSummary = null;
// @app-block-end b009

// @app-block-start b010
let portfolioReturnReferenceSummary = null;
// @app-block-end b010

// @app-block-start b011
let portfolioReturnWeightSummary = null;
// @app-block-end b011

// @app-block-start b012
let portfolioHistoryHealth = null;
// @app-block-end b012

// @app-block-start b013
let unlockKey = null;
// @app-block-end b013

// @app-block-start b014
let unlockPersistenceRecord = null;
// @app-block-end b014

// @app-block-start b015
let unlockPersistenceWarning = "";
// @app-block-end b015

// @app-block-start b016
let livePollTimer = null;
// @app-block-end b016

// @app-block-start b017
let livePollInFlight = null;
// @app-block-end b017

// @app-block-start b018
let holdingsRequestGeneration = 0;
// @app-block-end b018

// @app-block-start b019
let displayCurrency = localStorage.getItem("zzao-monitor-currency") || "USD";
// @app-block-end b019

// @app-block-start b020
let activeView = localStorage.getItem("zzao-monitor-view") || "personal";
// @app-block-end b020

// @app-block-start b021
let tradingChartCadence = localStorage.getItem("zzao-monitor-trading-chart") || "day";
let tradingReviewCadence = localStorage.getItem("zzao-monitor-trading-cadence") || "day";
let tradingDayMode = localStorage.getItem("zzao-monitor-trading-day-mode") || "live";
let tradingLedgerRequestGeneration = 0;
// @app-block-end b021

// @app-block-start b022
let strategyReturnCadence = localStorage.getItem("zzao-monitor-strategy-chart") || "year";
// @app-block-end b022

// @app-block-start b023
const holdingsFilters = {
  query: "",
  broker: "ALL",
  strategy: "ALL",
  instrument: "ALL",
  direction: "ALL",
  group: "STRATEGY",
};
// @app-block-end b023

// @app-block-start b024
const metaContent = (name) =>
  document.querySelector(`meta[name="${name}"]`)?.content?.trim() || "";
// @app-block-end b024

// @app-block-start b025
const holdingsMetaUrl = metaContent("zzao-private-holdings-url");
const derivePrivateSiblingUrl = (suffix) =>
  holdingsMetaUrl ? holdingsMetaUrl.replace(/\/holdings(?:\?.*)?$/, suffix) : "";
const LIVE_CLIENT = Object.freeze({
  payloadUrl: metaContent("zzao-live-payload-url"),
  challengeUrl: metaContent("zzao-live-challenge-url"),
  refreshUrl: metaContent("zzao-live-refresh-url"),
  holdingsUrl: holdingsMetaUrl,
  tradingLedgerUrl: metaContent("zzao-private-trading-ledger-url") || derivePrivateSiblingUrl("/trading/ledger"),
  tradingOverrideUrl: metaContent("zzao-private-trading-override-url") || derivePrivateSiblingUrl("/trading/override"),
});
// @app-block-end b025

// @app-block-start b026
const unlockPersistence = createUnlockPersistence({ origin: window.location.origin });
// @app-block-end b026

// @app-block-start b027
const STRATEGY_ANALYSIS_FORMULA = "bucket_actual_pct=classified_bucket/total_classified_long; rebalance_amount=total_classified_long*target_pct-classified_bucket; portfolio_twr=portfolio_total_return_v1.cumulative_total_return; portfolio_mwr=portfolio_money_weighted_return_v1.money_weighted_return";
// @app-block-end b027

// @app-block-start b028
const STRATEGY_ANALYSIS_CONTRACT = "strategy_analysis_v3";
// @app-block-end b028

// @app-block-start b029
const liveRuntime = {
  transportStatus: LIVE_CLIENT.payloadUrl ? "EXPECTED_LAG" : "MISSING",
  pollState: LIVE_CLIENT.payloadUrl ? "idle" : "disabled",
  refreshState: LIVE_CLIENT.refreshUrl ? "idle" : "disabled",
  error: "",
  nextCheckAt: null,
  cooldownUntil: 0,
  pendingRefresh: null,
};
// @app-block-end b029

// @app-block-start b030
const holdingsRuntime = {
  state: LIVE_CLIENT.holdingsUrl ? "idle" : "disabled",
  data: null,
  error: "",
};
const tradingLedgerRuntime = {
  state: LIVE_CLIENT.tradingLedgerUrl ? "idle" : "disabled",
  period: "month",
  data: null,
  error: "",
  overrideState: "idle",
  overrideMessage: "",
};
// @app-block-end b030

// @app-block-start b031
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
// @app-block-end b031

// @app-block-start b032
const byId = (id) => document.getElementById(id);
// @app-block-end b032

// @app-block-start b033
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
    "所有已接入券商账户净清算价值的合计。当前批次完整且新鲜时显示当前合计；任一券商本轮不可用但存在最近一次成功采集值时，回退显示该券商历史值并逐券商标注截至时间与年龄，合计标记“含陈旧数据 · 混合时间点”，不代表同一估值时点；任一预期券商既无当前值也无历史值时不显示确定金额，不补零。该展示值仅供观察，不进入风险闸门、收益历史或交易建议。",
  portfolioTotalReturn:
    "跨券商组合净资产变化剔除外部入金和出金后的链式总回报；股息、融资利息、交易费用以及已实现和未实现盈亏均通过净资产自然体现一次。年化值按 ACT/365 折算，不是未来收益预测。",
};
// @app-block-end b033

// @app-block-start b036
let activeTermAnchor = null;
// @app-block-end b036

// @app-block-start b063
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
// @app-block-end b063

// @app-block-start b064
const PORTFOLIO_RETURN_CONTRACT = Object.freeze({
  id: "portfolio_total_return_v1",
  formula: "chain_link((NAV_end - NAV_begin - external_flow) / (NAV_begin + 0.5 * external_flow)); annualized=(1+cumulative)^(365/elapsed_calendar_days)-1",
});
// @app-block-end b064

// @app-block-start b065
const BROKER_RETURN_CONTRACT = Object.freeze({
  id: "broker_portfolio_return_v1",
  formula: "chain_link((broker_NAV_end - broker_NAV_begin - broker_capital_flow) / (broker_NAV_begin + 0.5 * broker_capital_flow)); annualized=(1+cumulative)^(365/elapsed_calendar_days)-1",
});
// @app-block-end b065

// @app-block-start b066
const MANUAL_RETURN_REFERENCE_CONTRACT = Object.freeze({
  id: "manual_broker_return_reference_v1",
  formula: "broker_app_reported_cash_weighted_return_and_interval_profit",
});
// @app-block-end b066

// @app-block-start b067
const MANUAL_RETURN_REFERENCE_V2_CONTRACT = Object.freeze({
  id: "manual_broker_return_reference_v2",
  formula: "broker_app_reported_ytd_time_weighted_and_money_weighted_returns",
});
// @app-block-end b067

// @app-block-start b068
const DAILY_RETURN_HISTORY_HEALTH_FIELDS = Object.freeze(new Set([
  "schema_version", "metadata_status", "history_status", "stored_point_count",
  "last_recorded_date", "latest_scope_start_date",
  "continuous_valuation_point_count", "continuous_start_date",
  "calendar_status", "expected_session_count", "missing_session_count",
  "first_missing_session_date", "latest_missing_session_date",
  "latest_gap_receipt_status", "latest_gap_reason", "computed_at",
]));
// @app-block-end b068

// @app-block-start b069
const DAILY_HISTORY_STATUSES = Object.freeze(new Set([
  "NO_HISTORY", "ONE_POINT", "CONTINUOUS_ZERO", "CONTINUOUS_TWO_OR_MORE", "UNAVAILABLE",
]));
// @app-block-end b069

// @app-block-start b070
const DAILY_GAP_RECEIPT_STATUSES = Object.freeze(new Set(["REJECTED", "UNKNOWN", "NO_GAP"]));
// @app-block-end b070

// @app-block-start b071
const DAILY_GAP_REASONS = Object.freeze(new Set([
  "RECORDED", "UNCHANGED", "SOURCE_NOT_NEWER", "HISTORY_INVALID",
  "SNAPSHOT_NOT_COMPLETE_POSTCLOSE", "SOURCE_TIME_INVALID",
  "SOURCE_NOT_COMPLETE_POSTCLOSE", "BROKER_SNAPSHOT_INCOMPLETE",
  "UNKNOWN", "NO_RECEIPT",
]));
// @app-block-end b071

// @app-block-start b072
const DAILY_GAP_REJECTED_REASONS = Object.freeze(new Set([
  "HISTORY_INVALID", "SNAPSHOT_NOT_COMPLETE_POSTCLOSE", "SOURCE_TIME_INVALID",
  "SOURCE_NOT_COMPLETE_POSTCLOSE", "BROKER_SNAPSHOT_INCOMPLETE",
]));
// @app-block-end b072

// @app-block-start b073
const DAILY_GAP_REASON_LABELS = Object.freeze({
  HISTORY_INVALID: "历史未通过校验",
  SNAPSHOT_NOT_COMPLETE_POSTCLOSE: "盘后快照不完整",
  SOURCE_TIME_INVALID: "来源时间无效",
  SOURCE_NOT_COMPLETE_POSTCLOSE: "来源盘后数据不完整",
  BROKER_SNAPSHOT_INCOMPLETE: "券商快照不完整",
});
// @app-block-end b073

// @app-block-start b077
const DAILY_HISTORY_COMPUTED_AT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
// @app-block-end b077

// @app-block-start b083
const BROKER_CURRENT_STATUS_LABELS = Object.freeze({
  OK: "实时",
  EXPECTED_LAG: "日结待更新",
  PARTIAL: "本轮部分取得",
  STALE: "本轮数据过期",
  MISSING: "本轮未取得",
  FAILED: "本轮采集失败",
});
// @app-block-end b083

// @app-block-start b149
const LEDGER_COLUMNS = Object.freeze([
  { label: "策略归属", className: "col-strategy" },
  { label: "目标配比", className: "col-target" },
  { label: "实际配比", className: "col-actual" },
  { label: "漂移", className: "col-drift" },
  { label: "券商", className: "col-broker" },
  { label: "标的", className: "col-ticker" },
  { label: "证券类型", className: "col-type" },
  { label: "方向", className: "col-direction" },
  { label: "持仓数", className: "col-qty" },
  { label: "市值", className: "col-value", currency: true },
  { label: "占组合 NAV", className: "col-nav" },
  { label: "占三桶分母", className: "col-bucket" },
  { label: "来源", className: "col-source" },
]);
// @app-block-end b149

// @app-block-start b150
const ledgerColumnLabel = (column) => (column.currency ? `${column.label} ${displayCurrency}` : column.label);
// @app-block-end b150

// @app-block-start b156
const STRATEGY_FRESHNESS_GRACE_DAYS = 10;
// @app-block-end b156

// @app-block-start b159
const STRATEGY_FRESHNESS_STATUS_SEVERITY = Object.freeze({
  OK: 0,
  EXPECTED_LAG: 1,
  STALE: 2,
  MISSING: 3,
});
// @app-block-end b159

// @app-block-start b164
const STRATEGY_FRESHNESS_RECHECK_MS = 60_000;
// @app-block-end b164

// @app-block-start b165
let strategyFreshnessTimer = null;
// @app-block-end b165

// @app-block-start b166
let strategyFreshnessRenderedKey = "";
// @app-block-end b166

// @app-block-start b167
let strategyFreshnessBadgesHost = null;
// @app-block-end b167

// @app-block-start b168
let strategyTrendCopyHost = null;
// @app-block-end b168

// @app-block-start b173
const SYSTEM_BROKER_RETURN_PERIODS_CONTRACT = "system_broker_return_periods_v1";
// @app-block-end b173

// @app-block-start b174
const SYSTEM_BROKER_RETURN_PERIODS_FORMULA = "broker_twr=broker_portfolio_return_v1.cumulative_total_return; broker_mwr=broker_money_weighted_return_v1.money_weighted_return";
// @app-block-end b174

// @app-block-start b175
const SYSTEM_BROKER_RETURN_METHOD = "TWR=DAILY_CHAIN_LINKED_MODIFIED_DIETZ;MWR=INTERVAL_MODIFIED_DIETZ";
// @app-block-end b175

// @app-block-start b176
const SYSTEM_BROKER_RETURN_COVERAGE = Object.freeze(["COMPLETE", "PARTIAL", "MISSING", "FAILED"]);
// @app-block-end b176

// @app-block-start b177
const SYSTEM_BROKER_RETURN_BROKERS = Object.freeze(["Futu", "Tiger", "IBKR"]);
// @app-block-end b177

export function __set_monitorData(value) { return monitorData = value; }

export function __set_portfolioCurrentSummary(value) { return portfolioCurrentSummary = value; }

export function __set_portfolioOverviewSummary(value) { return portfolioOverviewSummary = value; }

export function __set_portfolioReturnReferenceSummary(value) { return portfolioReturnReferenceSummary = value; }

export function __set_portfolioReturnWeightSummary(value) { return portfolioReturnWeightSummary = value; }

export function __set_portfolioHistoryHealth(value) { return portfolioHistoryHealth = value; }

export function __set_unlockKey(value) { return unlockKey = value; }

export function __set_unlockPersistenceRecord(value) { return unlockPersistenceRecord = value; }

export function __set_unlockPersistenceWarning(value) { return unlockPersistenceWarning = value; }

export function __set_livePollTimer(value) { return livePollTimer = value; }

export function __set_livePollInFlight(value) { return livePollInFlight = value; }

export function __set_holdingsRequestGeneration(value) { return holdingsRequestGeneration = value; }

export function __set_displayCurrency(value) { return displayCurrency = value; }

export function __set_activeView(value) { return activeView = value; }

export function __set_tradingChartCadence(value) { return tradingChartCadence = value; }

export function __set_tradingReviewCadence(value) { return tradingReviewCadence = value; }

export function __set_tradingDayMode(value) { return tradingDayMode = value; }

export function __set_tradingLedgerRequestGeneration(value) { return tradingLedgerRequestGeneration = value; }

export function __set_strategyReturnCadence(value) { return strategyReturnCadence = value; }

export function __set_activeTermAnchor(value) { return activeTermAnchor = value; }

export function __set_strategyFreshnessTimer(value) { return strategyFreshnessTimer = value; }

export function __set_strategyFreshnessRenderedKey(value) { return strategyFreshnessRenderedKey = value; }

export function __set_strategyFreshnessBadgesHost(value) { return strategyFreshnessBadgesHost = value; }

export function __set_strategyTrendCopyHost(value) { return strategyTrendCopyHost = value; }

export {
  learningMetrics,
  renderIntentIncome,
  selectIntentIncome,
  intentRiskMessage,
  DEFAULT_MONTHLY_TARGET_CNY,
  LIVE_POLL_INTERVAL_MS,
  MANUAL_REFRESH_TIMEOUT_MS,
  adaptTradingReviewModel,
  applyLiveRiskGate,
  anchoredPortfolioReturnReference,
  assessLiveTradingSignal,
  buildCashflowChartSeries,
  calculateDailyTarget,
  calculateLivingExpenseCoverage,
  combineHealthStatuses,
  currentPortfolioDisplaySummary,
  currentPortfolioReturnReferenceSummary,
  deriveFxStatus,
  derivePortfolioGateInput,
  liveFinancialFingerprint,
  isPeriodCoverageComplete,
  manualRefreshLabel,
  periodDecisionComplete,
  portfolioOverviewPresentation,
  refreshProofMessage,
  resolveLiveCashflowDisplay,
  resolveLiveRealizedTradingDisplay,
  resolvePeriodCashflowDisplay,
  resolvePendingManualRefresh,
  sanitizeCashflowLedgerV2,
  sanitizePrivateTradingLedgerClient,
  updateLastConfirmedPortfolioOverview,
  yearSeriesScope,
  yearCoverageLabel,
  dashboardStatusForView,
  effectiveHoldingsStatus,
  filterHoldingRows,
  holdingStrategyLabel,
  holdingTagLabels,
  holdingStatusPresentation,
  holdingDisplayLabel,
  sanitizePrivateHoldings,
  createUnlockPersistence,
  payloadUrl,
  monitorData,
  portfolioCurrentSummary,
  portfolioOverviewSummary,
  portfolioReturnReferenceSummary,
  portfolioReturnWeightSummary,
  portfolioHistoryHealth,
  unlockKey,
  unlockPersistenceRecord,
  unlockPersistenceWarning,
  livePollTimer,
  livePollInFlight,
  holdingsRequestGeneration,
  displayCurrency,
  activeView,
  tradingChartCadence,
  tradingReviewCadence,
  tradingDayMode,
  tradingLedgerRequestGeneration,
  strategyReturnCadence,
  holdingsFilters,
  metaContent,
  LIVE_CLIENT,
  unlockPersistence,
  STRATEGY_ANALYSIS_FORMULA,
  STRATEGY_ANALYSIS_CONTRACT,
  liveRuntime,
  holdingsRuntime,
  tradingLedgerRuntime,
  VIEW_META,
  byId,
  TERM_DEFINITIONS,
  activeTermAnchor,
  PORTFOLIO_RETURN_REASON_LABELS,
  PORTFOLIO_RETURN_CONTRACT,
  BROKER_RETURN_CONTRACT,
  MANUAL_RETURN_REFERENCE_CONTRACT,
  MANUAL_RETURN_REFERENCE_V2_CONTRACT,
  DAILY_RETURN_HISTORY_HEALTH_FIELDS,
  DAILY_HISTORY_STATUSES,
  DAILY_GAP_RECEIPT_STATUSES,
  DAILY_GAP_REASONS,
  DAILY_GAP_REJECTED_REASONS,
  DAILY_GAP_REASON_LABELS,
  DAILY_HISTORY_COMPUTED_AT_PATTERN,
  BROKER_CURRENT_STATUS_LABELS,
  LEDGER_COLUMNS,
  ledgerColumnLabel,
  STRATEGY_FRESHNESS_GRACE_DAYS,
  STRATEGY_FRESHNESS_STATUS_SEVERITY,
  STRATEGY_FRESHNESS_RECHECK_MS,
  strategyFreshnessTimer,
  strategyFreshnessRenderedKey,
  strategyFreshnessBadgesHost,
  strategyTrendCopyHost,
  SYSTEM_BROKER_RETURN_PERIODS_CONTRACT,
  SYSTEM_BROKER_RETURN_PERIODS_FORMULA,
  SYSTEM_BROKER_RETURN_METHOD,
  SYSTEM_BROKER_RETURN_COVERAGE,
  SYSTEM_BROKER_RETURN_BROKERS
};
