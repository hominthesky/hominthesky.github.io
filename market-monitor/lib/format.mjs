import {
  DEFAULT_MONTHLY_TARGET_CNY,
  assessLiveTradingSignal,
  calculateDailyTarget,
  deriveFxStatus,
  derivePortfolioGateInput,
  displayCurrency,
  liveRuntime,
  monitorData
} from "./context.mjs";

// @app-block-start b049
export function pct(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  const safeDigits =
    Number.isInteger(digits) && digits >= 0 && digits <= 20 ? digits : 1;
  return `${(Number(value) * 100).toFixed(safeDigits)}%`;
}
// @app-block-end b049

// @app-block-start b050
export function number(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  const safeDigits =
    Number.isInteger(digits) && digits >= 0 && digits <= 20 ? digits : 1;
  return Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: safeDigits,
    maximumFractionDigits: safeDigits,
  });
}
// @app-block-end b050

// @app-block-start b051
export function isFiniteMetric(value) {
  return typeof value === "number" && Number.isFinite(value);
}
// @app-block-end b051

// @app-block-start b052
export function usd(value, compact = false) {
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
// @app-block-end b052

// @app-block-start b053
export function cny(value) {
  if (!isFiniteMetric(value)) return "—";
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}
// @app-block-end b053

// @app-block-start b054
export function usdExact(value) {
  if (!isFiniteMetric(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}
// @app-block-end b054

// @app-block-start b055
export function readPositiveLocalNumber(key) {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : null;
}
// @app-block-end b055

// @app-block-start b056
export function liveTarget(trading) {
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
// @app-block-end b056

// @app-block-start b057
export function easternCalendarDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
// @app-block-end b057

// @app-block-start b058
export function liveSignal(trading) {
  return assessLiveTradingSignal({
    live: trading.live,
    target: liveTarget(trading),
    portfolioGate: portfolioGateInput(),
    maximumLossCny: readPositiveLocalNumber("zzao-monitor-maximum-loss-cny"),
    transportStatus: liveRuntime.transportStatus,
  });
}
// @app-block-end b058

// @app-block-start b059
export function portfolioGateInput() {
  const summary = monitorData?.personal?.summary || {};
  const retrievedAt = monitorData?.meta?.portfolio_retrieved_at;
  return derivePortfolioGateInput(summary, retrievedAt);
}
// @app-block-end b059

// @app-block-start b060
export function liveTime(value) {
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
// @app-block-end b060

// @app-block-start b061
export function liveAge(ageMs) {
  if (ageMs === null || ageMs === undefined || !Number.isFinite(Number(ageMs))) return "未知";
  const seconds = Math.max(0, Math.floor(Number(ageMs) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
// @app-block-end b061
