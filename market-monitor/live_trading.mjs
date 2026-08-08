export const LIVE_POLL_INTERVAL_MS = 60_000;
export const LIVE_STALE_AFTER_MS = 10 * 60_000;
export const MANUAL_REFRESH_TIMEOUT_MS = 30_000;
export const DEFAULT_MONTHLY_TARGET_CNY = 40_000;
export const PORTFOLIO_GATE_STALE_AFTER_MS = 10 * 60_000;
export const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60_000;
export const LIVING_EXPENSE_COVERAGE_CONTRACT_ID = "living_expense_coverage_v1";
export const LIVING_EXPENSE_COVERAGE_FORMULA =
  "max(living_expense_net_cashflow_usd * usd_cny_rate, 0) / living_expense_target_cny";

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

export function resolveTradingCashflow(period) {
  const realizedComplete = period?.realized_coverage_status === "COMPLETE";
  const dividendComplete =
    (period?.dividend_coverage_status ?? period?.passive_cashflow_coverage_status) === "COMPLETE";
  const interestComplete =
    (period?.interest_coverage_status ?? period?.passive_cashflow_coverage_status) === "COMPLETE";

  let generated = null;
  if (realizedComplete && dividendComplete) {
    generated = finiteNumber(period?.generated_cashflow);
    if (generated === null) {
      const activeNet = finiteNumber(period?.active_net_pnl) ?? (
        finiteNumber(period?.intraday_net_pnl) !== null &&
        finiteNumber(period?.option_net_pnl) !== null
          ? finiteNumber(period.intraday_net_pnl) + finiteNumber(period.option_net_pnl)
          : null
      );
      const dividend = finiteNumber(period?.dividend_cashflow);
      if (activeNet !== null && dividend !== null) generated = activeNet + dividend;
    }
  }

  let interest = null;
  if (interestComplete) {
    interest = finiteNumber(period?.account_interest_cashflow) ??
      finiteNumber(period?.interest_cashflow);
  }

  let living = null;
  if (generated !== null && interest !== null) {
    living = finiteNumber(period?.living_expense_net_cashflow) ??
      finiteNumber(period?.investable_cashflow) ??
      generated + interest;
  }
  return { generated, interest, living };
}

/**
 * Return the numeric cash-flow value that the period card may display.
 *
 * A complete governed total takes precedence. When the period is incomplete,
 * only the explicitly numeric confirmed subtotal may be shown. Predicates,
 * booleans and other truthy values must never cross this financial-value
 * boundary because JavaScript would otherwise coerce `true` to USD 1.
 */
export function periodDisplayGeneratedCashflow(period, periodComplete = false) {
  const field = periodComplete === true
    ? period?.generated_cashflow
    : period?.confirmed_generated_cashflow;
  return nativeFiniteNumber(field);
}

const CASHFLOW_CHART_COMPONENTS = [
  "intraday_net_pnl",
  "overnight_equity_net_pnl",
  "option_net_pnl",
  "dividend_cashflow",
  "account_interest_cashflow",
  "fees",
];

function nativeFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cashflowChartGeneratedDeclaredComplete(period, sourcesComplete, cadence, yearComplete) {
  return Boolean(
    sourcesComplete &&
    period?.realized_coverage_status === "COMPLETE" &&
    period?.active_scope_coverage_status === "COMPLETE" &&
    (period?.dividend_coverage_status ?? period?.passive_cashflow_coverage_status) === "COMPLETE" &&
    (cadence !== "year" || yearComplete),
  );
}

function cashflowChartComponentValues(period, interest) {
  return Object.fromEntries(CASHFLOW_CHART_COMPONENTS.map((key) => [
    key,
    key === "account_interest_cashflow"
      ? interest
      : nativeFiniteNumber(period?.[key]),
  ]));
}

function cashflowChartDay(period, cadence, sourcesComplete, yearComplete, labels) {
  const generatedDeclaredComplete = cashflowChartGeneratedDeclaredComplete(
    period,
    sourcesComplete,
    cadence,
    yearComplete,
  );
  const officialGenerated = periodDisplayGeneratedCashflow(period, true);
  const confirmedGenerated = periodDisplayGeneratedCashflow(period, false);
  const interestDeclaredComplete =
    (period?.interest_coverage_status ?? period?.passive_cashflow_coverage_status) === "COMPLETE";
  const interest = interestDeclaredComplete
    ? nativeFiniteNumber(period?.account_interest_cashflow)
    : null;
  const interestComplete = Boolean(interestDeclaredComplete && interest !== null);
  const components = cashflowChartComponentValues(period, interest);
  const generatedComponents = [
    components.intraday_net_pnl,
    components.overnight_equity_net_pnl,
    components.option_net_pnl,
    components.dividend_cashflow,
  ];
  const generatedIdentityValid = generatedComponents.every((value) => value !== null) &&
    officialGenerated !== null &&
    Math.abs(officialGenerated - generatedComponents.reduce((sum, value) => sum + value, 0)) < 0.005;
  const generatedComplete = Boolean(
    generatedDeclaredComplete &&
    generatedIdentityValid &&
    nativeFiniteNumber(period?.fees) !== null,
  );
  const generated = generatedComplete ? officialGenerated : confirmedGenerated;
  const governedLiving = nativeFiniteNumber(period?.living_expense_net_cashflow);
  const derivedLiving = generated !== null && interest !== null ? generated + interest : null;
  const governedLivingValid = governedLiving !== null && officialGenerated !== null && interest !== null &&
    Math.abs(governedLiving - (officialGenerated + interest)) < 0.005;
  const livingComplete = Boolean(generatedComplete && interestComplete && governedLivingValid);
  const living = livingComplete
    ? governedLiving
    : generatedComplete && interestComplete
      ? null
      : derivedLiving;
  return {
    ...labels,
    value: generated,
    interestValue: interest,
    livingValue: living,
    ...components,
    generatedComplete,
    interestComplete,
    livingComplete,
    coverageComplete: livingComplete,
  };
}

function cashflowChartGroupKey(day, cadence) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ""))) return "";
  if (cadence !== "week") return day.slice(0, 7);
  const date = new Date(`${day}T00:00:00Z`);
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

function cashflowChartGroupKeys(firstKey, lastKey, cadence) {
  if (!firstKey || !lastKey) return [];
  const keys = [];
  const cursor = new Date(`${firstKey}${cadence === "week" ? "" : "-01"}T00:00:00Z`);
  const end = new Date(`${lastKey}${cadence === "week" ? "" : "-01"}T00:00:00Z`);
  while (cursor <= end) {
    keys.push(cadence === "week"
      ? cursor.toISOString().slice(0, 10)
      : cursor.toISOString().slice(0, 7));
    if (cadence === "week") cursor.setUTCDate(cursor.getUTCDate() + 7);
    else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}

function emptyCashflowChartGroup() {
  return {
    hasRows: false,
    value: 0,
    interestValue: 0,
    livingValue: 0,
    valueKnown: true,
    interestKnown: true,
    livingKnown: true,
    generatedComplete: true,
    interestComplete: true,
    livingComplete: true,
    components: Object.fromEntries(CASHFLOW_CHART_COMPONENTS.map((key) => [key, {
      value: 0,
      known: true,
    }])),
  };
}

/**
 * Build chart rows without allowing one unknown financial series to delete a
 * date or calendar bucket. Complete periods use governed totals; incomplete
 * periods use only explicit confirmed subtotals. Booked interest remains
 * independently visible when realized or strategy-scope coverage is partial.
 */
export function buildCashflowChartSeries(
  rows,
  cadence,
  {
    yearPeriod = null,
    yearComplete = false,
    sourcesComplete = false,
    scopeStart = null,
    scopeEnd = null,
  } = {},
) {
  if (!new Set(["day", "week", "month", "year"]).has(cadence)) return [];
  if (cadence === "year" && yearPeriod?.coverage_status === "UNKNOWN") return [];
  const scopedRows = cadence === "year"
    ? rowsWithinYearCoverage(rows, yearPeriod)
    : [...(rows || [])];
  const ordered = scopedRows
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.date || "")))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (cadence === "day") {
    return ordered.slice(-30).map((row) => cashflowChartDay(
      row,
      cadence,
      sourcesComplete,
      yearComplete,
      { label: row.date.slice(5), fullLabel: row.date },
    ));
  }

  const groups = new Map();
  ordered.forEach((row) => {
    const key = cashflowChartGroupKey(row.date, cadence);
    const group = groups.get(key) || emptyCashflowChartGroup();
    const point = cashflowChartDay(row, cadence, sourcesComplete, yearComplete, {});
    group.hasRows = true;
    for (const [valueKey, knownKey] of [
      ["value", "valueKnown"],
      ["interestValue", "interestKnown"],
      ["livingValue", "livingKnown"],
    ]) {
      if (point[valueKey] === null) group[knownKey] = false;
      else group[valueKey] += point[valueKey];
    }
    CASHFLOW_CHART_COMPONENTS.forEach((component) => {
      if (point[component] === null) group.components[component].known = false;
      else group.components[component].value += point[component];
    });
    group.generatedComplete = group.generatedComplete && point.generatedComplete;
    group.interestComplete = group.interestComplete && point.interestComplete;
    group.livingComplete = group.livingComplete && point.livingComplete;
    groups.set(key, group);
  });

  const existingKeys = [...groups.keys()].sort();
  const scopedFirstKey = cashflowChartGroupKey(
    cadence === "year" ? yearPeriod?.start_date : scopeStart,
    cadence,
  );
  const scopedLastKey = cashflowChartGroupKey(
    cadence === "year" ? yearPeriod?.end_date : scopeEnd,
    cadence,
  );
  const keys = cashflowChartGroupKeys(
    scopedFirstKey || existingKeys[0],
    scopedLastKey || existingKeys.at(-1),
    cadence,
  );
  let series = keys.map((key) => {
    const group = groups.get(key);
    const hasRows = Boolean(group?.hasRows);
    return {
      label: cadence === "week" ? key.slice(5) : key,
      fullLabel: cadence === "week" ? `周起始 ${key}` : key,
      value: hasRows && group.valueKnown ? group.value : null,
      interestValue: hasRows && group.interestKnown ? group.interestValue : null,
      livingValue: hasRows && group.livingKnown ? group.livingValue : null,
      ...Object.fromEntries(CASHFLOW_CHART_COMPONENTS.map((component) => [
        component,
        hasRows && group.components[component].known
          ? group.components[component].value
          : null,
      ])),
      generatedComplete: Boolean(hasRows && group.generatedComplete),
      interestComplete: Boolean(hasRows && group.interestComplete),
      livingComplete: Boolean(hasRows && group.livingComplete),
      coverageComplete: Boolean(hasRows && group.livingComplete),
    };
  });
  if (cadence === "week") return series.slice(-16);
  if (cadence === "month") return series.slice(-12);

  const cumulative = {
    value: 0,
    interestValue: 0,
    livingValue: 0,
    ...Object.fromEntries(CASHFLOW_CHART_COMPONENTS.map((component) => [component, 0])),
  };
  const cumulativeComplete = {
    generatedComplete: true,
    interestComplete: true,
    livingComplete: true,
  };
  return series.map((row) => {
    Object.keys(cumulative).forEach((key) => {
      if (cumulative[key] !== null && row[key] !== null) cumulative[key] += row[key];
      else cumulative[key] = null;
    });
    Object.keys(cumulativeComplete).forEach((key) => {
      cumulativeComplete[key] = cumulativeComplete[key] && row[key];
    });
    return {
      ...row,
      ...cumulative,
      ...cumulativeComplete,
      coverageComplete: cumulativeComplete.livingComplete,
      fullLabel: `${row.fullLabel} ${yearSeriesScope(yearPeriod, yearComplete) || ""}`.trim(),
    };
  });
}

export function yearSeriesScope(period, overallComplete) {
  const status = String(period?.coverage_status || "UNKNOWN").toUpperCase();
  if (status === "UNKNOWN") return null;
  if (status === "PARTIAL") return "可确认覆盖期累计";
  return overallComplete ? "年内累计" : "年内可确认金额";
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return null;
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

export function combineHealthStatuses(values) {
  const priority = {
    OK: 0,
    EXPECTED_LAG: 1,
    PARTIAL: 2,
    STALE: 3,
    MISSING: 4,
    FAILED: 5,
  };
  const normalized = [...(values || [])].map((value) => {
    const raw = String(value || "MISSING").toUpperCase();
    if (raw === "COMPLETE") return "OK";
    if (raw === "UNKNOWN") return "MISSING";
    return status(raw);
  });
  return normalized.length
    ? normalized.reduce((worst, value) => priority[value] > priority[worst] ? value : worst, "OK")
    : "MISSING";
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
    summary: {
      ...nextSummary,
      portfolio_return: current.summary?.portfolio_return,
    },
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

/** Compare settled account-level cash generation with a monthly living-expense target. */
export function calculateLivingExpenseCoverage({
  monthlyTargetCny,
  livingExpenseNetCashflowUsd,
  usdCnyRate,
  coverageStatus = "OK",
  fxStatus = "OK",
}) {
  const target = finiteNumber(monthlyTargetCny);
  const netUsd = finiteNumber(livingExpenseNetCashflowUsd);
  const rate = finiteNumber(usdCnyRate);
  const financialHealth = status(coverageStatus);
  const fxHealth = status(fxStatus);
  const base = {
    contractId: LIVING_EXPENSE_COVERAGE_CONTRACT_ID,
    formula: LIVING_EXPENSE_COVERAGE_FORMULA,
    monthlyTargetCny: target,
    livingExpenseNetCashflowUsd: netUsd,
    livingExpenseNetCashflowCny: null,
    coverageRatio: null,
    surplusCny: null,
    usdCnyRate: rate,
  };
  if (financialHealth !== HEALTHY) {
    return {
      ...base,
      status: financialHealth,
      reason: "历史、交易、股息或利息覆盖不完整，不能判断生活开支覆盖。",
    };
  }
  if (fxHealth !== HEALTHY || rate === null || rate <= 0) {
    return {
      ...base,
      status: fxHealth === HEALTHY ? "MISSING" : fxHealth,
      reason: "USD/CNY 汇率不可用，不能判断人民币生活开支覆盖。",
    };
  }
  if (target === null || target <= 0 || netUsd === null) {
    return {
      ...base,
      status: "MISSING",
      reason: "生活开支目标或账户净现金流不可用。",
    };
  }
  const netCny = netUsd * rate;
  return {
    ...base,
    status: HEALTHY,
    livingExpenseNetCashflowCny: netCny,
    coverageRatio: Math.max(netCny, 0) / target,
    surplusCny: netCny - target,
    reason: netCny >= target
      ? "本期已入账净现金流覆盖目标；这不等于券商安全可提现金额。"
      : "本期已入账净现金流尚未覆盖目标；缺口不构成追单或扩大风险的理由。",
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
    cashflow_generated: live.cashflow_generated ?? null,
    confirmed_cashflow_generated: live.confirmed_cashflow_generated ?? null,
    cashflow_active_equity_net_pnl: live.cashflow_active_equity_net_pnl ?? null,
    cashflow_dividend: live.cashflow_dividend ?? null,
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
