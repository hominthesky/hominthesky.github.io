// Mirror position_risk_transport.py: aggregate facts and fixed metadata only.
const FORMULA = 'cushion=excess_liquidity/nav; gross_notional=sum(abs(quantity*multiplier*underlying_price)); delta_notional=sum(quantity*multiplier*underlying_price*delta)';
const BROKERS = ['Futu', 'Tiger', 'IBKR'];
const STATUSES = ['OK', 'PARTIAL', 'STALE', 'MISSING', 'FAILED'];
const REASONS = new Set([
  'SOURCE_STALE_OR_MISSING', 'CUSHION_UNAVAILABLE', 'NOTIONAL_INPUT_MISSING',
  'NOTIONAL_OUT_OF_DOMAIN', 'DELTA_UNAVAILABLE', 'DELTA_OUT_OF_DOMAIN',
  'BETA_UNAVAILABLE', 'BETA_OUT_OF_DOMAIN', 'NAV_UNAVAILABLE',
  'POSITIONS_MISSING', 'SOURCE_INCOMPLETE', 'RISK_CALENDAR_UNAVAILABLE',
  'QQQ_HISTORY_INCOMPLETE_OR_STALE', 'CUSHION_THRESHOLDS_INVALID', 'RISK_INPUT_UNAVAILABLE',
]);
const METADATA = {
  market_input_method: 'COMPLETED_XNYS_CLOSE_60_RETURNS_QQQ_BETA',
  greeks_method: 'NATIVE_OR_ESTIMATED_BS_Q0_HISTORICAL_VOL_ACT365',
  model_assumptions: 'q=0; r=log1p(DGS3MO/100); sigma=stdev(60 log returns)*sqrt(252); expiry16NY',
};
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const rows = (value, limit) => Array.isArray(value) ? value.slice(0, limit).filter(record) : [];
function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}
function timestamp(value) {
  if (typeof value !== 'string' || value.length < 20 || value.length > 40
    || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    || day(value.slice(0, 10)) === null || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

export function sanitizePositionRisk(value) {
  if (!record(value) || value.contract_id !== 'position_risk_v1' || !STATUSES.includes(value.status)) return null;
  const result = {
    contract_id: 'position_risk_v1', formula: value.formula === FORMULA ? FORMULA : null,
    status: value.status,
    reason_codes: Array.isArray(value.reason_codes) ? value.reason_codes.slice(0, 20).filter(code => REASONS.has(code)) : [],
    source_retrieved_at: timestamp(value.source_retrieved_at),
    alert_status: ['NOT_CONFIGURED', 'UNKNOWN', 'CLEAR', 'YELLOW', 'RED'].includes(value.alert_status) ? value.alert_status : 'UNKNOWN',
    minimum_cushion_broker: BROKERS.includes(value.minimum_cushion_broker) ? value.minimum_cushion_broker : null,
  };
  for (const key of ['minimum_cushion_ratio', 'gross_notional_usd', 'gross_notional_leverage', 'net_delta_usd', 'gross_delta_leverage', 'beta_weighted_delta_usd']) result[key] = number(value[key]);
  result.brokers = rows(value.brokers, 3).filter(row => BROKERS.includes(row.broker)).map(row => ({
    broker: row.broker, cushion_ratio: number(row.cushion_ratio),
    cushion_method: ['EXCESS_LIQUIDITY', 'MAINTENANCE_APPROX'].includes(row.cushion_method) ? row.cushion_method : 'UNAVAILABLE',
  }));
  result.expiry_weeks = rows(value.expiry_weeks, 104).filter(row => day(row.week)).map(row => ({
    week: row.week,
    ...Object.fromEntries(['contracts', 'nearest_dte', 'short_put_assignment_usd', 'short_call_delivery_shares'].map(key => [key, number(row[key])])),
    status: ['OK', 'PARTIAL'].includes(row.status) ? row.status : 'PARTIAL',
  }));
  result.stress = rows(value.stress, 3).map(row => ({
    ...Object.fromEntries(['qqq_return', 'iv_change', 'estimated_nav_usd', 'linear_price_only_nav_usd', 'estimated_cushion_ratio'].map(key => [key, number(row[key])])),
    method: ['LINEAR_DELTA_BETA', 'DELTA_GAMMA_VEGA_BETA_MODEL_ESTIMATE'].includes(row.method) ? row.method : 'UNAVAILABLE',
    iv_effect_status: row.iv_effect_status === 'ESTIMATED_HISTORICAL_VOL_PROXY' ? row.iv_effect_status : 'UNAVAILABLE',
    margin_call_status: 'UNKNOWN',
  }));
  if (Object.hasOwn(value, 'market_input_as_of')) result.market_input_as_of = day(value.market_input_as_of);
  for (const [key, approved] of Object.entries(METADATA)) if (value[key] === approved) result[key] = approved;
  if (record(value.model_estimates)) {
    result.model_estimates = {};
    for (const key of ['native_delta', 'estimated_delta', 'unavailable_delta']) {
      const count = number(value.model_estimates[key]);
      result.model_estimates[key] = Number.isInteger(count) && count >= 0 ? count : null;
    }
  }
  return result;
}
