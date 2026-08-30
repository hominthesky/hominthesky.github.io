export const LIVE_POLL_INTERVAL_MS = 60_000;
export const LIVE_STALE_AFTER_MS = 10 * 60_000;
export const MANUAL_REFRESH_TIMEOUT_MS = 30_000;
export const DEFAULT_MONTHLY_TARGET_CNY = 40_000;
export const PORTFOLIO_GATE_STALE_AFTER_MS = 10 * 60_000;
export const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60_000;
export const LIVING_EXPENSE_COVERAGE_CONTRACT_ID = "living_expense_coverage_v2";
export const LIVING_EXPENSE_COVERAGE_FORMULA =
  "max(living_expense_net_cashflow_usd * usd_cny_rate, 0) / living_expense_target_cny";
export const CASHFLOW_GENERATION_CONTRACT_ID = "cashflow_generation_v4";
export const CASHFLOW_GENERATION_FORMULA =
  "same_day_equity_net_pnl + active_residual_overnight_equity_net_pnl + option_net_pnl + dividend_cashflow";
export const LIVING_EXPENSE_CASHFLOW_CONTRACT_ID = "living_expense_net_cashflow_v2";
export const LIVING_EXPENSE_CASHFLOW_FORMULA =
  "generated_cashflow + account_interest_cashflow";
export const DYNAMIC_DAILY_TARGET_CONTRACT_ID = "dynamic_daily_target_v5";
export const DYNAMIC_DAILY_TARGET_FORMULA =
  "max(monthly_target_cny - settled_mtd_active_net_pnl_usd * usd_cny_rate, 0) / remaining_sessions_in_month";
export const DYNAMIC_DAILY_TARGET_CONFIRMED_REFERENCE_FORMULA =
  "max(monthly_target_cny - confirmed_settled_mtd_active_net_pnl_usd * usd_cny_rate, 0) / remaining_sessions_in_month";
export const BROKER_NATIVE_RETURN_FORMULA =
  "native_interval_return; ibkr_annualized_reference=(1+native_twr)^(365/elapsed_calendar_days)-1";

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
const PORTFOLIO_OVERVIEW_FIELDS = [
  "source_status",
  "derived_nav_usd",
  "gross_market_value_usd",
  "gross_leverage",
  "gross_leverage_red",
  "source_retrieved_at",
  "holdings_as_of",
  "source_label",
  "expected_brokers",
  "broker_breakdown",
];
const SOURCE_FAILURE_STATES = new Set([
  "EXPECTED_LAG",
  "PARTIAL",
  "STALE",
  "MISSING",
  "FAILED",
]);
const BROKER_CALCULATED_RETURN_FORMULA = "chain_link((broker_NAV_end - broker_NAV_begin - broker_capital_flow) / (broker_NAV_begin + 0.5 * broker_capital_flow)); annualized=(1+cumulative)^(365/elapsed_calendar_days)-1";
const BROKER_CALCULATED_RETURN_REASONS = new Set([
  "HISTORY_INVALID", "HISTORY_EMPTY", "HISTORY_ACCUMULATING", "VALUATION_GAP",
  "CALENDAR_UNAVAILABLE", "CAPITAL_FLOW_COVERAGE_INCOMPLETE", "CAPITAL_FLOW_INVALID",
  "CAPITAL_FLOW_FX_MISSING", "CAPITAL_FLOW_SIGN_INVALID", "RETURN_DENOMINATOR_NON_POSITIVE",
  "RETURN_OUT_OF_DOMAIN", "ANNUALIZATION_INVALID", "MINIMUM_HISTORY_NOT_MET",
]);
const MANUAL_RETURN_REFERENCE_FORMULA = "broker_app_reported_cash_weighted_return_and_interval_profit";
const MANUAL_RETURN_REFERENCE_V2_FORMULA = "broker_app_reported_ytd_time_weighted_and_money_weighted_returns";
const MANUAL_REFERENCE_START_DATE = "2026-01-01";
const MANUAL_REFERENCE_ANCHOR_DATE = "2026-08-07";
const MANUAL_REFERENCE_FIRST_POST_ANCHOR_SESSION = "2026-08-10";
const MANUAL_REFERENCE_AS_OF = "2026-08-10T00:17:50-04:00";
const ANCHORED_BROKER_RETURN_FORMULA = "(1+owner_confirmed_cash_weighted_return)*chain_link(post_anchor_modified_dietz_returns)-1; annualized_estimate=(1+anchored_cumulative)^(365/elapsed_calendar_days)-1";
const ANCHORED_BROKER_RETURN_V2_FORMULA = "(1+owner_confirmed_time_weighted_return)*chain_link(post_anchor_modified_dietz_returns)-1; annualized_estimate=(1+anchored_cumulative)^(365/elapsed_calendar_days)-1";
const PORTFOLIO_ANNUALIZED_REFERENCE_FORMULA = "sum(current_broker_nav/current_total_nav*broker_annualized_reference)";

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

function cashflowGenerationContractValid(row) {
  return row?.cashflow_contract_id === CASHFLOW_GENERATION_CONTRACT_ID &&
    row?.cashflow_formula === CASHFLOW_GENERATION_FORMULA;
}

function livingExpenseCashflowContractValid(row) {
  return row?.living_expense_contract_id === LIVING_EXPENSE_CASHFLOW_CONTRACT_ID &&
    row?.living_expense_formula === LIVING_EXPENSE_CASHFLOW_FORMULA;
}

export function resolveTradingCashflow(period) {
  const realizedComplete = period?.realized_coverage_status === "COMPLETE";
  const dividendComplete =
    (period?.dividend_coverage_status ?? period?.passive_cashflow_coverage_status) === "COMPLETE";
  const interestComplete =
    (period?.interest_coverage_status ?? period?.passive_cashflow_coverage_status) === "COMPLETE";

  let generated = null;
  if (cashflowGenerationContractValid(period) && realizedComplete && dividendComplete) {
    generated = nativeFiniteNumber(period?.generated_cashflow);
  }

  let interest = null;
  if (interestComplete) {
    interest = nativeFiniteNumber(period?.account_interest_cashflow);
  }

  let living = null;
  if (livingExpenseCashflowContractValid(period) && generated !== null && interest !== null) {
    living = nativeFiniteNumber(period?.living_expense_net_cashflow);
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
  if (!cashflowGenerationContractValid(period)) return null;
  const field = periodComplete === true
    ? period?.generated_cashflow
    : period?.confirmed_generated_cashflow;
  return nativeFiniteNumber(field);
}

const CASHFLOW_CHART_COMPONENTS = [
  "same_day_equity_net_pnl",
  "active_residual_overnight_equity_net_pnl",
  "option_net_pnl",
  "dividend_cashflow",
  "account_interest_cashflow",
  "fees",
];

function nativeFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function resolveLiveRealizedTradingDisplay(live) {
  const triplet = (prefix = "") => {
    const gross = nativeFiniteNumber(live?.[`${prefix}realized_trading_gross_pnl`]);
    const fees = nativeFiniteNumber(live?.[`${prefix}realized_trading_fees`]);
    const net = nativeFiniteNumber(live?.[`${prefix}realized_trading_net_pnl`]);
    if (
      gross === null || fees === null || net === null ||
      Math.abs((gross - fees) - net) > 0.01
    ) return null;
    return { gross, fees, net };
  };
  const governed = triplet();
  if (governed) return { ...governed, complete: true };
  const confirmed = triplet("confirmed_");
  if (confirmed) return { ...confirmed, complete: false };
  return { gross: null, fees: null, net: null, complete: false };
}

export function resolveLiveCashflowDisplay(live) {
  const generatedContractValid = cashflowGenerationContractValid(live);
  const livingContractValid = livingExpenseCashflowContractValid(live);
  const generated = generatedContractValid ? nativeFiniteNumber(live?.cashflow_generated) : null;
  const confirmedGenerated = generatedContractValid
    ? nativeFiniteNumber(live?.confirmed_cashflow_generated)
    : null;
  const interest = String(live?.interest_coverage_status || "").toUpperCase() === "COMPLETE"
    ? nativeFiniteNumber(live?.account_interest_cashflow)
    : null;
  const living = livingContractValid ? nativeFiniteNumber(live?.living_expense_net_cashflow) : null;
  const confirmedLiving = livingContractValid
    ? nativeFiniteNumber(live?.confirmed_living_expense_net_cashflow)
    : null;
  const formalIdentity = generated !== null && interest !== null && living !== null
    && Math.abs((generated + interest) - living) <= 0.01;
  const confirmedIdentity = confirmedGenerated !== null && interest !== null && confirmedLiving !== null
    && Math.abs((confirmedGenerated + interest) - confirmedLiving) <= 0.01;
  if (formalIdentity) return {
    value: living, generated, interest, complete: true, includesInterest: true,
  };
  if (confirmedIdentity) return {
    value: confirmedLiving, generated: confirmedGenerated, interest,
    complete: false, includesInterest: true,
  };
  if (confirmedGenerated !== null) return {
    value: confirmedGenerated, generated: confirmedGenerated, interest: null,
    complete: false, includesInterest: false,
  };
  return { value: null, generated: null, interest: null, complete: false, includesInterest: false };
}

export function anchoredPortfolioReturnReference(summary) {
  const rows = Array.isArray(summary?.broker_breakdown) ? summary.broker_breakdown : [];
  const allowedBrokers = ["Futu", "Tiger", "IBKR"];
  const expectedBrokers = Array.isArray(summary?.expected_brokers) ? summary.expected_brokers : [];
  const brokerNames = rows.map((row) => row?.broker);
  if (!["OK", "PARTIAL"].includes(summary?.source_status)
    || rows.length < 2 || rows.length > allowedBrokers.length
    || new Set(brokerNames).size !== rows.length
    || !brokerNames.every((broker) => allowedBrokers.includes(broker))
    || expectedBrokers.length !== brokerNames.length
    || new Set(expectedBrokers).size !== expectedBrokers.length
    || !expectedBrokers.every((broker) => allowedBrokers.includes(broker) && brokerNames.includes(broker))
    || !["Futu", "Tiger"].every((broker) => brokerNames.includes(broker))) return null;
  const futu = rows.find((row) => row?.broker === "Futu");
  const tiger = rows.find((row) => row?.broker === "Tiger");
  if (!futu || !tiger || futu.source_status !== "OK") return null;
  const manual = safeManualReturnReference(futu.manual_return_reference, "Futu");
  const calculated = safeCalculatedBrokerReturn(futu.calculated_return, "Futu");
  const native = safeNativeBrokerReturn(tiger?.native_return, "Tiger");
  if (!manual || manual.verification_status !== "USER_CONFIRMED" || !calculated) return null;
  const manualIsV2 = manual.contract_id === "manual_broker_return_reference_v2";
  const manualReturn = nativeFiniteNumber(manualIsV2 ? manual.time_weighted_return : manual.cash_weighted_return);
  const anchor = manual.anchor_effective_date;
  const accumulationDatesAbsent = calculated.start_date === null && calculated.end_date === null;
  const accumulationSinglePoint = validManualDate(calculated.start_date)
    && calculated.start_date === calculated.end_date
    && (calculated.start_date === anchor
      || (!manualIsV2 && calculated.start_date === MANUAL_REFERENCE_FIRST_POST_ANCHOR_SESSION));
  const noContinuationYet = calculated.coverage_status === "MISSING"
    && calculated.capital_flow_coverage_status === "UNKNOWN"
    && calculated.reason_codes?.length === 1
    && calculated.reason_codes[0] === "HISTORY_ACCUMULATING"
    && (accumulationDatesAbsent || accumulationSinglePoint);
  const completeContinuation = calculated.coverage_status === "COMPLETE"
    && calculated.capital_flow_coverage_status === "COMPLETE"
    && calculated.start_date === anchor && calculated.end_date >= anchor;
  const completeAfterGap = !manualIsV2 && calculated.coverage_status === "COMPLETE"
    && calculated.capital_flow_coverage_status === "COMPLETE"
    && validManualDate(calculated.start_date) && validManualDate(calculated.end_date)
    && calculated.start_date === MANUAL_REFERENCE_FIRST_POST_ANCHOR_SESSION
    && calculated.end_date >= calculated.start_date
    && nativeFiniteNumber(calculated.cumulative_total_return) !== null;
  if (!noContinuationYet && !completeContinuation && !completeAfterGap) return null;
  const requiresReanchor = completeAfterGap
    || (accumulationSinglePoint && calculated.start_date > anchor);
  const postAnchor = completeContinuation
    ? nativeFiniteNumber(calculated.cumulative_total_return) : 0;
  if (manualReturn === null || postAnchor === null) return null;
  const start = manual.start_date;
  const end = completeContinuation ? calculated.end_date : anchor;
  const elapsed = start && end
    ? Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000)
    : null;
  if (!Number.isInteger(elapsed) || elapsed <= 0) return null;
  const growth = (1 + manualReturn) * (1 + postAnchor);
  if (!Number.isFinite(growth) || growth <= 0) return null;
  const futuAnnualized = growth ** (365 / elapsed) - 1;
  const tigerAnnualized = tiger.source_status === "OK" && native?.coverage_status === "COMPLETE"
    ? nativeFiniteNumber(native.annualized_total_return) : null;
  const annualizedByBroker = new Map([
    ["Futu", Number.isFinite(futuAnnualized) ? futuAnnualized : null],
    ["Tiger", tigerAnnualized],
  ]);
  const ibkr = rows.find((row) => row?.broker === "IBKR");
  if (ibkr) {
    const ibkrNative = safeNativeBrokerReturn(ibkr.native_return, "IBKR");
    const ibkrCalculated = safeCalculatedBrokerReturn(ibkr.calculated_return, "IBKR");
    const ibkrNativeAnnualized = ibkr.source_status === "OK" && ibkrNative?.coverage_status === "COMPLETE"
      ? nativeFiniteNumber(ibkrNative.annualized_total_return) : null;
    const ibkrAnnualized = ibkrNativeAnnualized ?? (ibkr.source_status === "OK"
      && ibkrCalculated?.coverage_status === "COMPLETE"
      && ibkrCalculated.capital_flow_coverage_status === "COMPLETE"
      ? nativeFiniteNumber(ibkrCalculated.annualized_total_return) : null);
    annualizedByBroker.set("IBKR", ibkrAnnualized);
  }
  const navRows = rows.map((row) => ({
    broker: row.broker,
    nav: nativeFiniteNumber(row.derived_nav_usd),
    annualized: annualizedByBroker.get(row.broker) ?? null,
  }));
  const totalNav = navRows.every((row) => row.nav !== null && row.nav > 0)
    ? navRows.reduce((sum, row) => sum + row.nav, 0) : null;
  const declaredTotalNav = nativeFiniteNumber(summary?.derived_nav_usd);
  const navIdentityValid = totalNav !== null && declaredTotalNav !== null
    && Math.abs(totalNav - declaredTotalNav) < 0.005;
  const exactThreeBrokerScope = allowedBrokers.every((broker) => expectedBrokers.includes(broker));
  const missingReferenceBrokers = allowedBrokers.filter((broker) => {
    const row = navRows.find((candidate) => candidate.broker === broker);
    return !row || row.annualized === null;
  });
  const allSourcesCurrent = summary.source_status === "OK"
    && rows.every((row) => row?.source_status === "OK");
  const combined = allSourcesCurrent && exactThreeBrokerScope && totalNav > 0
    && missingReferenceBrokers.length === 0 && navIdentityValid
    ? navRows.reduce((sum, row) => sum + row.nav * row.annualized, 0) / totalNav : null;
  return {
    anchored_contract_id: manualIsV2 ? "anchored_broker_return_v2" : "anchored_broker_return_v1",
    anchored_formula: manualIsV2 ? ANCHORED_BROKER_RETURN_V2_FORMULA : ANCHORED_BROKER_RETURN_FORMULA,
    anchored_method: manualIsV2
      ? "OWNER_CONFIRMED_TWR_ANCHOR_PLUS_MODIFIED_DIETZ"
      : "OWNER_CONFIRMED_MWR_ANCHOR_PLUS_MODIFIED_DIETZ",
    futu_cumulative: growth - 1,
    futu_annualized_estimate: Number.isFinite(futuAnnualized) ? futuAnnualized : null,
    portfolio_reference_contract_id: "portfolio_annualized_reference_v1",
    portfolio_reference_formula: PORTFOLIO_ANNUALIZED_REFERENCE_FORMULA,
    portfolio_reference_method: "CURRENT_NAV_WEIGHTED_ESTIMATE",
    portfolio_annualized_reference: Number.isFinite(combined) ? combined : null,
    portfolio_reference_brokers: navRows.map((row) => row.broker),
    missing_reference_brokers: missingReferenceBrokers,
    continuation_status: completeContinuation
      ? "CONTINUING"
      : requiresReanchor
        ? "ANCHOR_ONLY_REANCHOR_REQUIRED"
        : "ANCHOR_ONLY",
    system_baseline_date: requiresReanchor ? calculated.start_date : anchor,
    system_observed_through: requiresReanchor ? calculated.end_date : end,
    start_date: start,
    anchor_effective_date: anchor,
    end_date: end,
  };
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

export function resolvePeriodCashflowDisplay(
  period,
  {
    cadence = period?.cadence || "day",
    sourcesComplete = false,
    yearComplete = false,
    labels = {},
  } = {},
) {
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
    components.same_day_equity_net_pnl,
    components.active_residual_overnight_equity_net_pnl,
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
  const governedLiving = livingExpenseCashflowContractValid(period)
    ? nativeFiniteNumber(period?.living_expense_net_cashflow)
    : null;
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

export function periodDecisionComplete(display) {
  return Boolean(
    display?.generatedComplete === true &&
    display?.interestComplete === true &&
    display?.livingComplete === true &&
    nativeFiniteNumber(display?.livingValue) !== null,
  );
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
    return ordered.slice(-30).map((row) => resolvePeriodCashflowDisplay(row, {
      cadence,
      sourcesComplete,
      yearComplete,
      labels: { label: row.date.slice(5), fullLabel: row.date },
    }));
  }

  const groups = new Map();
  ordered.forEach((row) => {
    const key = cashflowChartGroupKey(row.date, cadence);
    const group = groups.get(key) || emptyCashflowChartGroup();
    const point = resolvePeriodCashflowDisplay(row, {
      cadence,
      sourcesComplete,
      yearComplete,
    });
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

export function safeCalculatedBrokerReturn(value, broker) {
  if (value === null || value === undefined) return {
    contract_id: "broker_portfolio_return_v1",
    formula: BROKER_CALCULATED_RETURN_FORMULA,
    broker,
    method: "SYSTEM_CALCULATED",
    coverage_status: "MISSING",
    start_date: null,
    end_date: null,
    elapsed_calendar_days: null,
    cumulative_total_return: null,
    annualized_total_return: null,
    valuation_granularity: "DAILY_2000_ET",
    capital_flow_coverage_status: "UNKNOWN",
    reason_codes: ["HISTORY_EMPTY"],
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const coverage = String(value.coverage_status || "MISSING");
  const capitalStatus = String(value.capital_flow_coverage_status || "UNKNOWN");
  const reasons = Array.isArray(value.reason_codes) ? value.reason_codes : [];
  const elapsed = typeof value.elapsed_calendar_days === "number"
    && Number.isInteger(value.elapsed_calendar_days) && value.elapsed_calendar_days >= 0
    ? value.elapsed_calendar_days : null;
  const cumulative = nativeFiniteNumber(value.cumulative_total_return);
  const annualized = nativeFiniteNumber(value.annualized_total_return);
  const start = value.start_date ?? null;
  const end = value.end_date ?? null;
  const datesValid = (start === null || validManualDate(start))
    && (end === null || validManualDate(end))
    && (start === null || end === null || start <= end);
  if (value.contract_id !== "broker_portfolio_return_v1"
    || value.formula !== BROKER_CALCULATED_RETURN_FORMULA
    || value.broker !== broker || value.method !== "SYSTEM_CALCULATED"
    || value.valuation_granularity !== "DAILY_2000_ET" || !datesValid
    || !["COMPLETE", "PARTIAL", "MISSING", "FAILED"].includes(coverage)
    || !["COMPLETE", "PARTIAL", "UNKNOWN"].includes(capitalStatus)
    || reasons.some((reason) => typeof reason !== "string" || !BROKER_CALCULATED_RETURN_REASONS.has(reason))) return null;
  if (coverage === "COMPLETE" && (start === null || end === null || elapsed === null
    || cumulative === null || capitalStatus !== "COMPLETE"
    || (elapsed >= 30 && annualized === null)
    || (elapsed < 30 && (annualized !== null || !reasons.includes("MINIMUM_HISTORY_NOT_MET"))))) return null;
  if (coverage !== "COMPLETE" && (elapsed !== null || cumulative !== null || annualized !== null)) return null;
  return {
    contract_id: "broker_portfolio_return_v1",
    formula: BROKER_CALCULATED_RETURN_FORMULA,
    broker,
    method: "SYSTEM_CALCULATED",
    coverage_status: coverage,
    start_date: start,
    end_date: end,
    elapsed_calendar_days: elapsed,
    cumulative_total_return: cumulative,
    annualized_total_return: annualized,
    valuation_granularity: "DAILY_2000_ET",
    capital_flow_coverage_status: capitalStatus,
    reason_codes: reasons,
  };
}

function validManualDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function validManualTimestamp(value) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:-04:00|-05:00)$/.test(value)) return false;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return false;
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "longOffset" })
    .formatToParts(parsed).find((part) => part.type === "timeZoneName")?.value;
  return zone?.replace("GMT", "") === value.slice(-6);
}

export function safeManualReturnReference(value, broker) {
  if (broker !== "Futu") return value === null || value === undefined ? null : undefined;
  const missing = {
    contract_id: "manual_broker_return_reference_v2", formula: MANUAL_RETURN_REFERENCE_V2_FORMULA,
    broker: "Futu", scope: "US_EQUITIES", method: "BROKER_APP_USER_CONFIRMED",
    verification_status: "MISSING", start_date: null, anchor_effective_date: null, as_of: null,
    time_weighted_return: null, money_weighted_return: null,
    observed_start_date: null, observed_end_date: null, observation_count: 0,
    currency: "USD", auto_refresh: false, reason_codes: ["HISTORY_EMPTY"],
  };
  if (value === null || value === undefined) return missing;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v2Valid = value.contract_id === "manual_broker_return_reference_v2"
    && value.formula === MANUAL_RETURN_REFERENCE_V2_FORMULA && value.broker === "Futu"
    && value.scope === "US_EQUITIES" && value.method === "BROKER_APP_USER_CONFIRMED"
    && value.currency === "USD" && value.auto_refresh === false;
  if (v2Valid && value.verification_status === "MISSING") {
    return value.start_date === null && value.anchor_effective_date === null && value.as_of === null
      && value.time_weighted_return === null && value.money_weighted_return === null
      && value.observed_start_date === null && value.observed_end_date === null
      && value.observation_count === 0 && Array.isArray(value.reason_codes)
      && value.reason_codes.length === 1 && ["HISTORY_EMPTY", "INPUT_INVALID"].includes(value.reason_codes[0])
      ? { ...missing, reason_codes: [value.reason_codes[0]] } : undefined;
  }
  if (v2Valid) {
    const start = value.start_date;
    const anchor = value.anchor_effective_date;
    const observationStart = value.observed_start_date;
    const observationEnd = value.observed_end_date;
    const twr = nativeFiniteNumber(value.time_weighted_return);
    const mwr = nativeFiniteNumber(value.money_weighted_return);
    const observationSpanDays = validManualDate(observationStart) && validManualDate(observationEnd)
      ? Math.floor((Date.parse(`${observationEnd}T00:00:00Z`) - Date.parse(`${observationStart}T00:00:00Z`)) / 86_400_000) + 1
      : null;
    if (value.verification_status !== "USER_CONFIRMED" || !validManualDate(start)
      || !validManualDate(anchor) || !validManualDate(observationStart) || observationEnd !== anchor
      || !validManualDate(observationEnd) || start !== `${value.as_of?.slice(0, 4)}-01-01`
      || observationStart >= observationEnd || observationSpanDays === null
      || !Number.isInteger(value.observation_count) || value.observation_count < 2
      || value.observation_count > observationSpanDays
      || !validManualTimestamp(value.as_of) || twr === null || twr <= -1 || mwr === null || mwr <= -1
      || !Array.isArray(value.reason_codes) || value.reason_codes.length !== 0) return undefined;
    return {
      contract_id: value.contract_id, formula: value.formula, broker: "Futu", scope: "US_EQUITIES",
      method: value.method, verification_status: "USER_CONFIRMED", start_date: start,
      anchor_effective_date: anchor, as_of: value.as_of, time_weighted_return: twr,
      money_weighted_return: mwr, observed_start_date: observationStart,
      observed_end_date: observationEnd, observation_count: value.observation_count,
      currency: "USD", auto_refresh: false, reason_codes: [],
    };
  }
  const commonValid = value.contract_id === "manual_broker_return_reference_v1"
    && value.formula === MANUAL_RETURN_REFERENCE_FORMULA && value.broker === "Futu"
    && value.scope === "US_EQUITIES" && value.method === "BROKER_APP_CASH_WEIGHTED"
    && value.currency === "USD" && value.auto_refresh === false;
  if (!commonValid) return undefined;
  if (value.verification_status === "MISSING") {
    return value.start_date === null && value.anchor_effective_date === null && value.as_of === null
      && value.cash_weighted_return === null && value.interval_profit_usd === null
      && Array.isArray(value.reason_codes) && value.reason_codes.length === 1
      && ["HISTORY_EMPTY", "INPUT_INVALID"].includes(value.reason_codes[0])
      ? { ...missing, reason_codes: [value.reason_codes[0]] } : undefined;
  }
  const asOf = value.as_of;
  const start = value.start_date;
  const anchorEffectiveDate = value.anchor_effective_date;
  const cashReturn = nativeFiniteNumber(value.cash_weighted_return);
  const intervalProfit = nativeFiniteNumber(value.interval_profit_usd);
  if (value.verification_status !== "USER_CONFIRMED"
    || !validManualDate(start) || !validManualDate(anchorEffectiveDate) || !validManualTimestamp(asOf)
    || start !== MANUAL_REFERENCE_START_DATE
    || anchorEffectiveDate !== MANUAL_REFERENCE_ANCHOR_DATE || asOf !== MANUAL_REFERENCE_AS_OF
    || cashReturn === null || cashReturn <= -1 || intervalProfit === null
    || !Array.isArray(value.reason_codes) || value.reason_codes.length !== 0) return undefined;
  return {
    contract_id: "manual_broker_return_reference_v1", formula: MANUAL_RETURN_REFERENCE_FORMULA,
    broker: "Futu", scope: "US_EQUITIES", method: "BROKER_APP_CASH_WEIGHTED",
    verification_status: "USER_CONFIRMED", start_date: start,
    anchor_effective_date: anchorEffectiveDate, as_of: asOf,
    cash_weighted_return: cashReturn, interval_profit_usd: intervalProfit,
    currency: "USD", auto_refresh: false, reason_codes: [],
  };
}

function safeNativeBrokerReturn(value, broker) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const expected = {
    Futu: ["UNAVAILABLE", null, null, null],
    Tiger: ["TIGER_ANALYTICS", "BROKER_DEFINED", "SEC", "BROKER_PROVIDED"],
    IBKR: ["IBKR_FLEX_CHANGE_IN_NAV", "TWR", "UNIVERSAL_ACCOUNT", "ACT_365_FROM_NATIVE_TWR"],
  }[broker];
  if (!expected || value.contract_id !== "broker_native_return_v2" || value.broker !== broker) return null;
  const coverage = String(value.coverage_status || "MISSING");
  const method = String(value.method || "UNAVAILABLE");
  const source = String(value.source || "UNAVAILABLE");
  const measure = value.return_measure ?? null;
  const scope = value.scope ?? null;
  const annualization = value.annualization_method ?? null;
  const reasons = Array.isArray(value.reason_codes) ? value.reason_codes : [];
  const allowedReasons = new Set([
    "BROKER_NATIVE_HISTORY_API_UNAVAILABLE", "BROKER_NATIVE_ANALYTICS_INCOMPLETE",
    "BROKER_NATIVE_RETURN_DISABLED", "BROKER_NATIVE_RETURN_RUNTIMEERROR",
    "MINIMUM_HISTORY_NOT_MET",
  ]);
  if (!["COMPLETE", "MISSING"].includes(coverage)
    || !["BROKER_NATIVE", "UNAVAILABLE"].includes(method)
    || [source, measure, scope, annualization].some((item, index) => item !== expected[index])
    || reasons.some((code) => typeof code !== "string" || !allowedReasons.has(code))) return null;
  const start = validManualDate(value.start_date) ? value.start_date : null;
  const end = validManualDate(value.end_date) ? value.end_date : null;
  const elapsed = Number.isInteger(value.elapsed_calendar_days) && value.elapsed_calendar_days >= 0
    ? value.elapsed_calendar_days : null;
  const count = Number.isInteger(value.observation_count) && value.observation_count >= 0
    ? value.observation_count : null;
  const cumulative = nativeFiniteNumber(value.cumulative_total_return);
  const annualized = nativeFiniteNumber(value.annualized_total_return);
  const expectedElapsed = start && end
    ? Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000)
    : null;
  const expectedAnnualized = broker === "IBKR" && elapsed >= 30 && cumulative > -1
    ? (1 + cumulative) ** (365 / elapsed) - 1 : null;
  if (coverage === "COMPLETE") {
    if (method !== "BROKER_NATIVE" || !start || !end || start > end || elapsed === null
      || elapsed <= 0 || elapsed !== expectedElapsed || count === null || count <= 0
      || cumulative === null || cumulative <= -1
      || (broker === "IBKR" && count !== 1)
      || (elapsed >= 30 && (annualized === null || reasons.length))
      || (broker === "IBKR" && expectedAnnualized !== null && Math.abs(annualized - expectedAnnualized) > 1e-8)
      || (broker === "Tiger" && (annualized === null || reasons.length))
      || (broker === "IBKR" && elapsed < 30 && (annualized !== null || reasons.length !== 1 || reasons[0] !== "MINIMUM_HISTORY_NOT_MET"))) return null;
  } else if (method !== "UNAVAILABLE" || start !== null || end !== null || elapsed !== null
    || count !== 0 || cumulative !== null || annualized !== null || reasons.length === 0) return null;
  return {
    contract_id: "broker_native_return_v2", broker, coverage_status: coverage, method,
    source, return_measure: measure, scope, annualization_method: annualization,
    start_date: start, end_date: end, elapsed_calendar_days: elapsed,
    observation_count: count, cumulative_total_return: cumulative,
    annualized_total_return: annualized, reason_codes: [...reasons],
  };
}

function confirmedPortfolioOverviewCandidate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (String(value.source_status || "").toUpperCase() !== HEALTHY) return null;
  const nav = value.derived_nav_usd;
  const gross = value.gross_market_value_usd;
  const leverage = value.gross_leverage;
  const retrievedAt = timestamp(value.source_retrieved_at);
  if (
    typeof nav !== "number" || !Number.isFinite(nav) || nav <= 0
    || typeof gross !== "number" || !Number.isFinite(gross) || gross < 0
    || typeof leverage !== "number" || !Number.isFinite(leverage) || leverage < 0
    || retrievedAt === null
  ) {
    return null;
  }
  const breakdown = Array.isArray(value.broker_breakdown) ? value.broker_breakdown : [];
  const expectedBrokers = Array.isArray(value.expected_brokers) ? value.expected_brokers : [];
  if (expectedBrokers.length !== breakdown.length
    || new Set(expectedBrokers).size !== expectedBrokers.length
    || !expectedBrokers.every((broker) => ["Futu", "Tiger", "IBKR"].includes(broker))) return null;
  const seen = new Set();
  const safeBreakdown = breakdown.map((row) => {
    const broker = String(row?.broker || "");
    if (!["Futu", "Tiger", "IBKR"].includes(broker) || seen.has(broker)) return null;
    seen.add(broker);
    const rowNav = nativeFiniteNumber(row?.derived_nav_usd);
    const rowGross = nativeFiniteNumber(row?.gross_market_value_usd);
    const rowLeverage = nativeFiniteNumber(row?.gross_leverage);
    if (row?.source_status !== "OK" || rowNav === null || rowNav <= 0
      || rowGross === null || rowGross < 0 || rowLeverage === null || rowLeverage < 0) return null;
    const native = safeNativeBrokerReturn(row?.native_return, broker);
    const calculatedReturn = safeCalculatedBrokerReturn(row?.calculated_return, broker);
    const manualReference = safeManualReturnReference(row?.manual_return_reference, broker);
    if (calculatedReturn === null || manualReference === undefined) return null;
    return {
      broker,
      source_status: "OK",
      derived_nav_usd: rowNav,
      gross_market_value_usd: rowGross,
      gross_leverage: rowLeverage,
      source_retrieved_at: row.source_retrieved_at ?? null,
      manual_return_reference: manualReference,
      native_return: native,
      calculated_return: calculatedReturn,
    };
  });
  if (safeBreakdown.some((row) => row === null)) return null;
  if (safeBreakdown.some((row) => !expectedBrokers.includes(row.broker))) return null;
  if (!["Futu", "Tiger"].every((broker) => seen.has(broker))) return null;
  if (safeBreakdown.length) {
    const breakdownNav = safeBreakdown.reduce((sum, row) => sum + row.derived_nav_usd, 0);
    const breakdownGross = safeBreakdown.reduce((sum, row) => sum + row.gross_market_value_usd, 0);
    const identitiesValid = Math.abs(breakdownNav - nav) < 0.005
      && Math.abs(breakdownGross - gross) < 0.005
      && safeBreakdown.every((row) =>
        Math.abs(row.gross_leverage - row.gross_market_value_usd / row.derived_nav_usd) < 0.0001,
      );
    if (!identitiesValid) return null;
  }
  const result = Object.fromEntries(PORTFOLIO_OVERVIEW_FIELDS.map((field) => [
    field,
    field === "gross_leverage_red"
      ? (typeof value[field] === "number" && Number.isFinite(value[field]) ? value[field] : null)
      : (value[field] ?? null),
  ]));
  result.broker_breakdown = safeBreakdown;
  return result;
}

export function currentPortfolioReturnReferenceSummary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const summaryStatus = String(value.source_status || "").toUpperCase();
  if (summaryStatus === HEALTHY) return confirmedPortfolioOverviewCandidate(value);
  if (summaryStatus !== "PARTIAL" || timestamp(value.source_retrieved_at) === null) return null;
  const breakdown = Array.isArray(value.broker_breakdown) ? value.broker_breakdown : [];
  const expectedBrokers = Array.isArray(value.expected_brokers) ? value.expected_brokers : [];
  if (expectedBrokers.length !== breakdown.length
    || new Set(expectedBrokers).size !== expectedBrokers.length
    || !expectedBrokers.every((broker) => ALLOWED_LIVE_BROKERS.has(broker))) return null;
  const seen = new Set();
  const safeBreakdown = breakdown.map((row) => {
    const broker = String(row?.broker || "");
    const rowStatus = String(row?.source_status || "").toUpperCase();
    if (!ALLOWED_LIVE_BROKERS.has(broker) || seen.has(broker)
      || (rowStatus !== HEALTHY && !SOURCE_FAILURE_STATES.has(rowStatus))) return null;
    seen.add(broker);
    if (rowStatus !== HEALTHY) return {
      broker,
      source_status: rowStatus,
      derived_nav_usd: null,
      gross_market_value_usd: null,
      gross_leverage: null,
      source_retrieved_at: row?.source_retrieved_at ?? null,
      manual_return_reference: safeManualReturnReference(null, broker),
      native_return: null,
      calculated_return: safeCalculatedBrokerReturn(null, broker),
    };
    const rowNav = nativeFiniteNumber(row?.derived_nav_usd);
    const rowGross = nativeFiniteNumber(row?.gross_market_value_usd);
    const rowLeverage = nativeFiniteNumber(row?.gross_leverage);
    const native = safeNativeBrokerReturn(row?.native_return, broker);
    const calculatedReturn = safeCalculatedBrokerReturn(row?.calculated_return, broker);
    const manualReference = safeManualReturnReference(row?.manual_return_reference, broker);
    if (rowNav === null || rowNav <= 0 || rowGross === null || rowGross < 0
      || rowLeverage === null || rowLeverage < 0
      || Math.abs(rowLeverage - rowGross / rowNav) >= 0.0001
      || calculatedReturn === null || manualReference === undefined) return null;
    return {
      broker,
      source_status: HEALTHY,
      derived_nav_usd: rowNav,
      gross_market_value_usd: rowGross,
      gross_leverage: rowLeverage,
      source_retrieved_at: row?.source_retrieved_at ?? null,
      manual_return_reference: manualReference,
      native_return: native,
      calculated_return: calculatedReturn,
    };
  });
  if (safeBreakdown.some((row) => row === null)
    || safeBreakdown.some((row) => !expectedBrokers.includes(row.broker))
    || !["Futu", "Tiger"].every((broker) => seen.has(broker))) return null;
  return {
    source_status: "PARTIAL",
    derived_nav_usd: null,
    gross_market_value_usd: null,
    gross_leverage: null,
    gross_leverage_red: nativeFiniteNumber(value.gross_leverage_red),
    source_retrieved_at: value.source_retrieved_at,
    holdings_as_of: value.holdings_as_of ?? null,
    source_label: value.source_label ?? null,
    expected_brokers: [...expectedBrokers],
    broker_breakdown: safeBreakdown,
  };
}

export function updateLastConfirmedPortfolioOverview(current, incoming) {
  const previous = confirmedPortfolioOverviewCandidate(current);
  const next = confirmedPortfolioOverviewCandidate(incoming);
  if (!next) return previous;
  const previousFutu = previous?.broker_breakdown?.find((row) => row.broker === "Futu");
  const nextFutu = next.broker_breakdown?.find((row) => row.broker === "Futu");
  if (previousFutu?.manual_return_reference?.verification_status === "USER_CONFIRMED"
    && nextFutu?.manual_return_reference?.verification_status === "MISSING") {
    nextFutu.manual_return_reference = previousFutu.manual_return_reference;
  }
  return next;
}

/** Build a start-of-session target from the settled monthly gap. */
export function calculateDailyTarget({
  monthlyTargetCny,
  scheduledSessionsInMonth,
  remainingSessionsInMonth,
  settledMtdActiveNetPnlUsd,
  confirmedSettledMtdActiveNetPnlUsd,
  confirmedReferenceCoverageStatus = "MISSING",
  excludedRealizationCount = 0,
  excludedInstrumentCount = 0,
  excludedInstruments = [],
  settledThrough,
  targetStatus = "OK",
  targetContractId = DYNAMIC_DAILY_TARGET_CONTRACT_ID,
  targetFormula = DYNAMIC_DAILY_TARGET_FORMULA,
  confirmedReferenceFormula = DYNAMIC_DAILY_TARGET_CONFIRMED_REFERENCE_FORMULA,
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
  const confirmedSettledMtdUsd = finiteNumber(confirmedSettledMtdActiveNetPnlUsd);
  const rate = finiteNumber(usdCnyRate);
  const calendarHealth = status(calendarStatus);
  const targetHealth = status(targetStatus);
  const fxHealth = status(fxStatus);
  const referenceCoverage = String(confirmedReferenceCoverageStatus || "MISSING").toUpperCase();
  const contractValid = targetContractId === DYNAMIC_DAILY_TARGET_CONTRACT_ID &&
    targetFormula === DYNAMIC_DAILY_TARGET_FORMULA &&
    confirmedReferenceFormula === DYNAMIC_DAILY_TARGET_CONFIRMED_REFERENCE_FORMULA;
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
    referenceAvailable: false,
    referenceCoverageStatus: referenceCoverage,
    confirmedSettledMtdActiveNetPnlUsd: confirmedSettledMtdUsd,
    confirmedSettledMtdActiveNetPnlCny: null,
    referenceRemainingGapCny: null,
    referenceDailyTargetCny: null,
    referenceDailyTargetUsd: null,
    excludedRealizationCount: Number.isInteger(excludedRealizationCount) && excludedRealizationCount >= 0
      ? excludedRealizationCount : 0,
    excludedInstrumentCount: Number.isInteger(excludedInstrumentCount) && excludedInstrumentCount >= 0
      ? excludedInstrumentCount : 0,
    excludedInstruments: Array.isArray(excludedInstruments)
      ? excludedInstruments.filter((value) => typeof value === "string") : [],
    usdCnyRate: rate,
    fxStatus: fxHealth,
  };

  if (!contractValid) {
    return {
      ...base,
      status: "MISSING",
      comparisonReady: false,
      reason: "当日目标金融契约不匹配，暂停计算与达标判断。",
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

  if (targetHealth !== HEALTHY) {
    if (referenceCoverage === "PARTIAL" && confirmedSettledMtdUsd !== null) {
      const confirmedSettledMtdCny = confirmedSettledMtdUsd * rate;
      const referenceGapCny = Math.max(monthly - confirmedSettledMtdCny, 0);
      const referenceDailyTargetCny = referenceGapCny / remainingSessions;
      const excluded = base.excludedRealizationCount;
      const instruments = base.excludedInstruments.length
        ? `（${base.excludedInstruments.join("、")}）`
        : "";
      return {
        ...base,
        status: targetHealth,
        comparisonReady: false,
        referenceAvailable: true,
        confirmedSettledMtdActiveNetPnlCny: confirmedSettledMtdCny,
        referenceRemainingGapCny: referenceGapCny,
        referenceDailyTargetCny,
        referenceDailyTargetUsd: referenceDailyTargetCny / rate,
        reason: `月内另有 ${excluded} 个已实现片段${instruments}未完成策略覆盖；参考值只基于可确认收益，不参与达标或行动判断。`,
      };
    }
    return {
      ...base,
      status: targetHealth,
      comparisonReady: false,
      reason: "当日目标配置或月内结算覆盖不可用，暂停判断是否达标。",
    };
  }
  if (settledMtdUsd === null) {
    return {
      ...base,
      status: "MISSING",
      comparisonReady: false,
      reason: "月内完整结算进度不可用，暂停判断是否达标。",
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
    realized_trading_gross_pnl: live.realized_trading_gross_pnl ?? null,
    realized_trading_fees: live.realized_trading_fees ?? null,
    realized_trading_net_pnl: live.realized_trading_net_pnl ?? null,
    confirmed_realized_trading_gross_pnl: live.confirmed_realized_trading_gross_pnl ?? null,
    confirmed_realized_trading_fees: live.confirmed_realized_trading_fees ?? null,
    confirmed_realized_trading_net_pnl: live.confirmed_realized_trading_net_pnl ?? null,
    realized_trading_cycle_count: live.realized_trading_cycle_count ?? null,
    executed_order_fees: live.executed_order_fees ?? null,
    confirmed_executed_order_fees: live.confirmed_executed_order_fees ?? null,
    executed_order_fill_count: live.executed_order_fill_count ?? null,
    unclassified_overnight_net_pnl: live.unclassified_overnight_net_pnl ?? null,
    long_term_realization_net_pnl: live.long_term_realization_net_pnl ?? null,
    cashflow_generated: live.cashflow_generated ?? null,
    confirmed_cashflow_generated: live.confirmed_cashflow_generated ?? null,
    account_interest_cashflow: live.account_interest_cashflow ?? null,
    living_expense_net_cashflow: live.living_expense_net_cashflow ?? null,
    confirmed_living_expense_net_cashflow: live.confirmed_living_expense_net_cashflow ?? null,
    interest_coverage_status: live.interest_coverage_status ?? null,
    cashflow_same_day_equity_net_pnl: live.cashflow_same_day_equity_net_pnl ?? null,
    cashflow_active_residual_overnight_equity_net_pnl:
      live.cashflow_active_residual_overnight_equity_net_pnl ?? null,
    cashflow_dividend: live.cashflow_dividend ?? null,
    same_day_equity: category(live.same_day_equity),
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
