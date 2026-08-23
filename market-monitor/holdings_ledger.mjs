"use strict";

export const HOLDING_STRATEGY_LABELS = Object.freeze({
  高进攻: "高进攻",
  现金流支柱: "现金流支柱",
  防御避险: "防御避险",
  UNCLASSIFIED: "未分类",
  OUTSIDE_LONG_STRATEGIC_SLEEVE: "非长期多头策略范围",
});

export function holdingStrategyLabel(value) {
  return HOLDING_STRATEGY_LABELS[value] || value || "未分类";
}

const BROKERS = new Set(["Futu", "Tiger", "IBKR"]);
const BASE_BROKERS = new Set(["Futu", "Tiger"]);
export const HOLDINGS_STALE_AFTER_MS = 30 * 60 * 1000;

const HOLDINGS_REASONS = new Set([
  "POSITIONS_SHAPE_INVALID",
  "INVALID_POSITION_ROWS",
  "ZERO_QUANTITY_ROWS_EXCLUDED",
  "POSITION_COVERAGE_INCOMPLETE",
  "PORTFOLIO_SOURCE_PARTIAL",
  "PORTFOLIO_SOURCE_STALE",
  "PORTFOLIO_SOURCE_FAILED",
  "PORTFOLIO_SOURCE_MISSING",
  "ROLLBACK_SOURCE_HAS_NO_HOLDINGS_LEDGER",
  "ROLLBACK_SOURCE_READ_FAILED",
  "ROLLBACK_SOURCE_INVALID",
]);

const nativeNumber = (value) => (
  typeof value === "number" && Number.isFinite(value) ? value : null
);

const nativeInteger = (value) => (
  Number.isInteger(value) && value >= 0 ? value : null
);

function requiredTimestamp(value) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value))) {
    throw new Error("持仓批次时间无效。");
  }
  requiredDate(value.slice(0, 10));
  return value;
}

function requiredDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("持仓日期无效。");
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day) throw new Error("持仓日期无效。");
  return value;
}

function optionalMetric(value, minimum = null) {
  if (value === null) return null;
  const safe = nativeNumber(value);
  if (safe === null || (minimum !== null && safe < minimum)) {
    throw new Error("持仓金融数值无效。");
  }
  return safe;
}

function sanitizeBroker(row, batchTimestamp) {
  const brokers = new Set(["Futu", "Tiger", "IBKR"]);
  const statuses = new Set(["OK", "PARTIAL", "STALE", "MISSING", "FAILED"]);
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("券商摘要无效。");
  const retrievedAt = requiredTimestamp(row.source_retrieved_at);
  if (!brokers.has(row.broker) || !statuses.has(row.source_status) || retrievedAt !== batchTimestamp) {
    throw new Error("券商摘要与持仓批次不一致。");
  }
  return {
    broker: row.broker,
    source_status: row.source_status,
    derived_nav_usd: optionalMetric(row.derived_nav_usd, 0),
    gross_market_value_usd: optionalMetric(row.gross_market_value_usd, 0),
    gross_leverage: optionalMetric(row.gross_leverage, 0),
    source_retrieved_at: retrievedAt,
  };
}

function sanitizeHolding(row, batchTimestamp) {
  const brokers = new Set(["Futu", "Tiger", "IBKR"]);
  const instruments = new Set(["STOCK", "ETF", "FUND", "BOND", "REIT", "ADR", "OPTION", "CASH", "OTHER"]);
  const statuses = new Set(["OK", "PARTIAL", "STALE", "MISSING", "FAILED"]);
  const strategyBuckets = new Set(["高进攻", "现金流支柱", "防御避险", "UNCLASSIFIED", "OUTSIDE_LONG_STRATEGIC_SLEEVE"]);
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("持仓行无效。");
  const quantity = nativeNumber(row.quantity);
  const value = nativeNumber(row.market_value_usd);
  const retrievedAt = requiredTimestamp(row.source_retrieved_at);
  if (!brokers.has(row.broker)
    || typeof row.ticker !== "string" || !/^[A-Z0-9][A-Z0-9._-]{0,19}$/.test(row.ticker)
    || !instruments.has(row.instrument_type)
    || !["LONG", "SHORT"].includes(row.direction)
    || quantity === null || quantity === 0
    || (row.direction === "LONG" && quantity <= 0)
    || (row.direction === "SHORT" && quantity >= 0)
    || value === null || value <= 0
    || !statuses.has(row.source_status)
    || retrievedAt !== batchTimestamp
    || !strategyBuckets.has(row.strategy_bucket)
    || !["COMPLETE", "PARTIAL", "MISSING"].includes(row.strategy_status)) {
    throw new Error("持仓行身份、方向或批次无效。");
  }
  const expectedExclusionReason = {
    UNCLASSIFIED: "UNCLASSIFIED_TICKER",
    OUTSIDE_LONG_STRATEGIC_SLEEVE: "OUTSIDE_LONG_STRATEGIC_SLEEVE",
  }[row.strategy_bucket] || null;
  if ((expectedExclusionReason !== null && row.strategy_reason !== expectedExclusionReason)
    || (expectedExclusionReason === null && row.strategy_reason !== null)) {
    throw new Error("持仓策略归类无效。");
  }
  const pctClassifiedLong = optionalMetric(row.pct_classified_long, 0);
  if (pctClassifiedLong !== null && pctClassifiedLong > 1) throw new Error("持仓策略比例无效。");
  return {
    broker: row.broker,
    ticker: row.ticker,
    instrument_type: row.instrument_type,
    direction: row.direction,
    quantity,
    market_value_usd: value,
    pct_nav: optionalMetric(row.pct_nav, 0),
    pct_gross: optionalMetric(row.pct_gross, 0),
    strategy_bucket: row.strategy_bucket,
    strategy_reason: row.strategy_reason ?? null,
    pct_classified_long: pctClassifiedLong,
    strategy_status: row.strategy_status,
    source_status: row.source_status,
    source_retrieved_at: retrievedAt,
  };
}

export function sanitizePrivateHoldings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.contract_id !== "private_portfolio_holdings_v1") {
    throw new Error("私有持仓数据契约不匹配。");
  }
  const batchTimestamp = requiredTimestamp(value.source_retrieved_at);
  requiredTimestamp(value.generated_at);
  const summary = value.summary;
  const holdings = value.holdings;
  if (!summary || typeof summary !== "object" || !holdings || typeof holdings !== "object"
    || holdings.contract_id !== "portfolio_holdings_ledger_v1"
    || requiredTimestamp(summary.source_retrieved_at) !== batchTimestamp
    || requiredTimestamp(holdings.source_retrieved_at) !== batchTimestamp) {
    throw new Error("持仓摘要与明细不是同一批次。");
  }
  const statuses = new Set(["OK", "PARTIAL", "STALE", "MISSING", "FAILED"]);
  if (!statuses.has(summary.source_status) || !statuses.has(holdings.status)
    || !Array.isArray(holdings.rows) || !Array.isArray(holdings.reason_codes)
    || holdings.reason_codes.some((reason) => !HOLDINGS_REASONS.has(reason))) {
    throw new Error("持仓覆盖状态无效。");
  }
  const expectedBrokers = Array.isArray(holdings.expected_brokers)
    ? [...holdings.expected_brokers] : null;
  if (!expectedBrokers
    || new Set(expectedBrokers).size !== expectedBrokers.length
    || expectedBrokers.some((broker) => !BROKERS.has(broker))
    || JSON.stringify(expectedBrokers) !== JSON.stringify([...expectedBrokers].sort())
    || [...BASE_BROKERS].some((broker) => !expectedBrokers.includes(broker))) {
    throw new Error("预期券商集合无效。");
  }
  let counts = {
    input_count: null, accepted_count: null, excluded_zero_count: null, rejected_count: null,
  };
  if (["OK", "PARTIAL", "STALE"].includes(holdings.status)) {
    counts = Object.fromEntries(Object.keys(counts).map((key) => [key, nativeInteger(holdings[key])]));
    if (Object.values(counts).includes(null)
      || counts.input_count !== counts.accepted_count + counts.excluded_zero_count + counts.rejected_count
      || counts.accepted_count !== holdings.rows.length) {
      throw new Error("持仓行数守恒校验失败。");
    }
  } else if (holdings.rows.length) {
    throw new Error("缺失状态不能携带持仓行。");
  }
  const allocation = value.allocation && typeof value.allocation === "object"
    ? value.allocation : { status: "MISSING", buckets: [] };
  const allocationBuckets = new Set(["高进攻", "现金流支柱", "防御避险"]);
  if (!["COMPLETE", "PARTIAL", "MISSING"].includes(allocation.status)
    || !Array.isArray(allocation.buckets)
    || allocation.buckets.some((row) => !row || typeof row !== "object"
      || !allocationBuckets.has(row.bucket))) throw new Error("策略配置摘要无效。");
  const brokerRows = Array.isArray(summary.broker_breakdown)
    ? summary.broker_breakdown.map((row) => sanitizeBroker(row, batchTimestamp)) : [];
  if (new Set(brokerRows.map((row) => row.broker)).size !== brokerRows.length) {
    throw new Error("券商摘要存在重复来源。");
  }
  const brokerStatuses = new Map(brokerRows.map((row) => [row.broker, row.source_status]));
  const activeStatus = ["OK", "PARTIAL", "STALE"].includes(holdings.status);
  if (activeStatus
    && (brokerStatuses.size !== expectedBrokers.length
      || expectedBrokers.some((broker) => !brokerStatuses.has(broker)))) {
    throw new Error("券商摘要未覆盖全部预期券商。");
  }
  if ([...brokerStatuses.keys()].some((broker) => !expectedBrokers.includes(broker))) {
    throw new Error("券商摘要包含未启用的来源。");
  }
  if (holdings.status === "OK"
    && (summary.source_status !== "OK"
      || expectedBrokers.some((broker) => brokerStatuses.get(broker) !== "OK"))) {
    throw new Error("完整持仓要求每个预期券商均为 OK。");
  }
  const holdingsAsOf = summary.holdings_as_of === null || summary.holdings_as_of === undefined
    ? null : requiredTimestamp(summary.holdings_as_of);
  const brokerCoverage = optionalMetric(summary.broker_coverage, 0);
  if (brokerCoverage !== null && brokerCoverage > 1) throw new Error("券商覆盖率无效。");
  if (holdings.status === "OK" && brokerCoverage !== 1) throw new Error("完整持仓要求券商覆盖率为 100%。");
  const safeAllocationBuckets = allocation.buckets.map((row) => {
    const actual = optionalMetric(row.actual_pct, 0);
    const target = optionalMetric(row.target_pct, 0);
    const gap = optionalMetric(row.gap_pct);
    if ((actual !== null && actual > 1) || (target !== null && target > 1)
      || (gap !== null && Math.abs(gap) > 1)) throw new Error("策略配置比例无效。");
    return { bucket: row.bucket, actual_pct: actual, target_pct: target, gap_pct: gap };
  });
  return {
    contract_id: value.contract_id,
    generated_at: value.generated_at,
    source_retrieved_at: batchTimestamp,
    summary: {
      source_status: summary.source_status,
      source_retrieved_at: batchTimestamp,
      holdings_as_of: holdingsAsOf,
      derived_nav_usd: optionalMetric(summary.derived_nav_usd, 0),
      gross_market_value_usd: optionalMetric(summary.gross_market_value_usd, 0),
      gross_leverage: optionalMetric(summary.gross_leverage, 0),
      gross_leverage_red: optionalMetric(summary.gross_leverage_red, 0),
      broker_coverage: brokerCoverage,
      broker_breakdown: brokerRows,
    },
    holdings: {
      contract_id: holdings.contract_id,
      status: holdings.status,
      source_retrieved_at: batchTimestamp,
      expected_brokers: expectedBrokers,
      ...counts,
      reason_codes: [...holdings.reason_codes],
      rows: holdings.rows.map((row) => {
        const safeRow = sanitizeHolding(row, batchTimestamp);
        const brokerStatus = brokerStatuses.get(safeRow.broker);
        if (brokerStatus === undefined) {
          throw new Error("持仓行没有对应的券商摘要。");
        }
        if (holdings.status === "OK" && safeRow.source_status !== "OK") {
          throw new Error("完整持仓不能包含降级行。");
        }
        if (holdings.status === "STALE" && safeRow.source_status === "STALE"
          && ["STALE", "MISSING"].includes(brokerStatus)) {
          return safeRow;
        }
        if (!((brokerStatus === "OK" && ["OK", "PARTIAL"].includes(safeRow.source_status))
          || (brokerStatus !== "OK" && safeRow.source_status === brokerStatus))) {
          throw new Error("持仓行状态超过券商摘要覆盖状态。");
        }
        return safeRow;
      }),
    },
    allocation: {
      status: allocation.status,
      buckets: safeAllocationBuckets,
    },
  };
}

export function effectiveHoldingsStatus(value, nowMs = Date.now(), staleAfterMs = HOLDINGS_STALE_AFTER_MS) {
  const status = value?.holdings?.status;
  if (!["OK", "PARTIAL", "STALE", "MISSING", "FAILED"].includes(status)) return "MISSING";
  if (status !== "OK") return status;
  const observedAt = Date.parse(value?.source_retrieved_at || "");
  if (!Number.isFinite(observedAt) || !Number.isFinite(nowMs) || !Number.isFinite(staleAfterMs)
    || staleAfterMs <= 0 || nowMs < observedAt || nowMs - observedAt > staleAfterMs) return "STALE";
  return "OK";
}

export function filterHoldingRows(rows, filters = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const query = String(filters.query || "").trim().toUpperCase();
  const broker = filters.broker || "ALL";
  const strategy = filters.strategy || "ALL";
  const instrument = filters.instrument || "ALL";
  const direction = filters.direction || "ALL";
  const group = filters.group || "VALUE";
  const filtered = safeRows.filter((row) => (
    (!query || String(row?.ticker || "").toUpperCase().includes(query))
    && (broker === "ALL" || row?.broker === broker)
    && (strategy === "ALL" || row?.strategy_bucket === strategy)
    && (instrument === "ALL" || row?.instrument_type === instrument)
    && (direction === "ALL" || row?.direction === direction)
  ));
  const secondary = (a, b) => b.market_value_usd - a.market_value_usd
    || a.ticker.localeCompare(b.ticker);
  if (group === "BROKER") {
    return filtered.sort((a, b) => a.broker.localeCompare(b.broker) || secondary(a, b));
  }
  if (group === "STRATEGY") {
    return filtered.sort((a, b) => holdingStrategyLabel(a.strategy_bucket)
      .localeCompare(holdingStrategyLabel(b.strategy_bucket), "zh-CN") || secondary(a, b));
  }
  return filtered.sort(secondary);
}
