import {
  STRATEGY_ANALYSIS_CONTRACT,
  STRATEGY_ANALYSIS_FORMULA,
  SYSTEM_BROKER_RETURN_BROKERS,
  SYSTEM_BROKER_RETURN_COVERAGE,
  SYSTEM_BROKER_RETURN_METHOD,
  SYSTEM_BROKER_RETURN_PERIODS_CONTRACT,
  SYSTEM_BROKER_RETURN_PERIODS_FORMULA,
  __set_strategyFreshnessBadgesHost,
  __set_strategyFreshnessRenderedKey,
  __set_strategyReturnCadence,
  __set_strategyTrendCopyHost,
  byId,
  monitorData,
  portfolioCurrentSummary,
  portfolioOverviewPresentation,
  strategyFreshnessBadgesHost,
  strategyFreshnessRenderedKey,
  strategyReturnCadence,
  strategyTrendCopyHost
} from "../lib/context.mjs";
import {
  append,
  el,
  section,
  table
} from "../lib/dom.mjs";
import {
  cny,
  isFiniteMetric,
  liveTime,
  number,
  pct,
  usd,
  usdExact
} from "../lib/format.mjs";
import {
  brokerCurrentStatusLabel,
  lastKnownGoodAgeLabel
} from "../lib/freshness.mjs";
import {
  strategyFreshnessDisplayStatus,
  strategyFreshnessPillNode,
  strategyFreshnessRenderKey,
  strategyNyToday,
  strategyTrendCopyText
} from "../lib/strategy_freshness.mjs";

// @app-block-start b138
export function strategyTrendData(data) {
  if (strategyReturnCadence === "month") {
    const rows = Array.isArray(data.monthly_returns) ? data.monthly_returns : [];
    const labels = [...new Set(rows.map((row) => row.period))].sort().slice(-24);
    // CR-20261030-01: Tiger months may carry two sources (SYSTEM_DAILY
    // daily-RoR chain vs BROKER_DISPLAY broker-app interval readings). They
    // are separate series so a source switch never draws a connecting line
    // across the boundary; each series stays sparse (months without a row of
    // that exact source render no point and break the line).
    return {
      labels,
      series: [
        ["Futu", null, "Futu", "#2563eb"],
        ["Tiger", "SYSTEM_DAILY", "Tiger 日级走势", "#d97706"],
        ["Tiger", "BROKER_DISPLAY", "Tiger App 展示", "#fbbf24"],
      ].map(([broker, sourceKind, label, color]) => ({
        id: sourceKind ? `${broker}-${sourceKind}` : broker,
        label,
        color,
        values: labels.map(
          (period) => rows.find(
            (row) => row.broker === broker && row.period === period
              && (sourceKind === null || row.source_kind === sourceKind),
          )?.return ?? null,
        ),
      })),
      note: "Futu 为券商月度展示收益，不可链式复原年度 TWR/MWR；Tiger 月度逐行标注来源，日级 RoR 链式走势与 App 展示区间收益分列两条线，不跨来源混算或连接；IBKR Flex 当前只提供 YTD 原生 TWR，没有月度序列，不补造折线。",
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
    ["IBKR TWR", "IBKR", "twr", "#0f766e"],
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
  return { labels, series, note: `年度券商值为原生核验；IBKR 仅有 Flex YTD TWR，MWR 与月度序列保持未知。${combinedNote} SPY/QQQ 为价格回报，不含分红再投资。` };
}
// @app-block-end b138

// @app-block-start b139
export function selectedStrategySeries(trend) {
  const available = trend.series.filter((series) => series.values.some(isFiniteMetric)).map((series) => series.id);
  let stored = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(`zzao-monitor-strategy-series-${strategyReturnCadence}`) || "[]");
    // CR-20261030-01: the merged monthly "Tiger" series id split into
    // Tiger-SYSTEM_DAILY / Tiger-BROKER_DISPLAY. A selection saved before the
    // split keeps showing the Tiger line(s) via this alias expansion instead
    // of silently dropping them (unknown/aliased ids still filter to
    // available series; other cadences are unaffected).
    const legacyAliases = { Tiger: ["Tiger-SYSTEM_DAILY", "Tiger-BROKER_DISPLAY"] };
    stored = Array.isArray(parsed)
      ? [...new Set(parsed.flatMap((id) => [id, ...(legacyAliases[id] || [])]))]
        .filter((id) => available.includes(id))
      : [];
  } catch (_error) {
    stored = [];
  }
  return stored.length ? stored : available;
}
// @app-block-end b139

// @app-block-start b140
export function persistStrategySeries(ids) {
  localStorage.setItem(`zzao-monitor-strategy-series-${strategyReturnCadence}`, JSON.stringify(ids));
}
// @app-block-end b140

// @app-block-start b141
export function renderStrategyTrend(data) {
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
      __set_strategyReturnCadence(cadence);
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
// @app-block-end b141

// @app-block-start b142
export function renderStrategyAllocation(data) {
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
      : monitorData.personal?.summary?.portfolio_gate === "RED"
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
// @app-block-end b142

// @app-block-start b143
export function renderStrategyInstrumentTypes(allocation) {
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
// @app-block-end b143

// @app-block-start b144
export function strategyOriginalPnl(row) {
  if (!isFiniteMetric(row?.pnl)) return "—";
  return row.pnl_currency === "CNH" ? cny(row.pnl) : usdExact(row.pnl);
}
// @app-block-end b144

// @app-block-start b178
export function normalizeSystemBrokerReturnPeriods(source) {
  if (!source || typeof source !== "object") {
    return { state: "EMPTY", asOf: null, rows: [] };
  }
  if (source.contract_id !== SYSTEM_BROKER_RETURN_PERIODS_CONTRACT
    || source.formula !== SYSTEM_BROKER_RETURN_PERIODS_FORMULA) {
    return { state: "CONTRACT_MISMATCH", asOf: null, rows: [] };
  }
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const periodPattern = /^\d{4}-\d{2}$/;
  const finiteOrNull = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const rows = (Array.isArray(source.rows) ? source.rows : [])
    .filter((row) => row && typeof row === "object"
      && periodPattern.test(row.period ?? "")
      && SYSTEM_BROKER_RETURN_BROKERS.includes(row.broker)
      && row.source_kind === "SYSTEM_CALCULATED"
      && row.method === SYSTEM_BROKER_RETURN_METHOD
      && SYSTEM_BROKER_RETURN_COVERAGE.includes(row.coverage_status))
    .map((row) => ({
      period: row.period,
      broker: row.broker,
      startDate: datePattern.test(row.start_date ?? "") ? row.start_date : null,
      endDate: datePattern.test(row.end_date ?? "") ? row.end_date : null,
      twr: finiteOrNull(row.twr),
      mwr: finiteOrNull(row.mwr),
      coverageStatus: row.coverage_status,
      reasonCodes: Array.isArray(row.reason_codes)
        ? row.reason_codes.filter((code) => typeof code === "string" && code) : [],
    }))
    .sort((left, right) => right.period.localeCompare(left.period)
      || left.broker.localeCompare(right.broker));
  return {
    state: "READY",
    asOf: datePattern.test(source.as_of ?? "") ? source.as_of : null,
    rows,
  };
}
// @app-block-end b178

// @app-block-start b179
export function systemBrokerReturnPeriodsSection(source) {
  const normalized = normalizeSystemBrokerReturnPeriods(source);
  const card = section("系统计算月度收益（Modified Dietz 估算）",
    "系统计算/Modified Dietz估算，非券商App原生TWR/MWR，不与旧月格/日级手工走势拼接。 "
    + "逐券商按自然月独立计算：TWR 为日链 Modified Dietz，MWR 为区间 Modified Dietz；"
    + "估值基线是上一段交易日历月的最后一个交易日日终，完整月止于当月最后交易日，当前月最多给部分窗口（MTD）。"
    + "缺失不补零；缺失行的日期只是所需计算窗口，不代表已有证据。 ");
  if (normalized.state === "CONTRACT_MISMATCH") {
    card.appendChild(el("p", "empty-state", "系统月度收益契约不匹配，本区域已停止展示派生数字。"));
    return card;
  }
  card.appendChild(el("p", "system-periods-asof",
    normalized.asOf
      ? `日终证据截至 ${normalized.asOf} · 为最新一条已记录的日终估值，不代表所有券商同日都有证据。`
      : "尚无已记录日终证据。"));
  if (normalized.state === "EMPTY" || !normalized.rows.length) {
    card.appendChild(el("p", "empty-state", "日终证据积累中，暂无可计算的完整月度窗口；缺失不显示为 0。"));
    return card;
  }
  const currentPeriod = strategyNyToday().slice(0, 7);
  const coverageLabels = { COMPLETE: "完整月", MISSING: "缺失", FAILED: "失败" };
  const displayRows = normalized.rows.map((row) => {
    const base = row.coverageStatus === "PARTIAL"
      ? (row.period === currentPeriod ? "部分窗口 · 本月 MTD" : "部分窗口")
      : coverageLabels[row.coverageStatus];
    const span = row.startDate && row.endDate ? `${row.startDate}—${row.endDate}` : null;
    return {
      ...row,
      window: span
        ? (row.coverageStatus === "COMPLETE" || row.coverageStatus === "PARTIAL"
          ? span
          : `需 ${span} · 待证据`)
        : "—",
      coverage: row.reasonCodes.length ? `${base} · ${row.reasonCodes.join("、")}` : base,
    };
  });
  const wrap = table([
    { key: "period", label: "月份" },
    { key: "broker", label: "券商" },
    { key: "window", label: "窗口（基线—止日）" },
    { key: "twr", label: "TWR 估算", numeric: true, render: pct },
    { key: "mwr", label: "MWR 估算", numeric: true, render: pct },
    { key: "coverage", label: "覆盖与原因" },
  ], displayRows);
  wrap.className += " system-periods-table-wrap";
  card.appendChild(wrap);
  return card;
}
// @app-block-end b179

// @app-block-start b180
export function renderStrategy() {
  const root = byId("strategy-content");
  root.replaceChildren();
  const data = monitorData.strategy || {};
  if (data.contract_id !== STRATEGY_ANALYSIS_CONTRACT || data.formula !== STRATEGY_ANALYSIS_FORMULA) {
    root.appendChild(el("p", "empty-state", "组合策略数据契约不匹配，已停止展示派生指标。"));
    // The system monthly evidence source is independent of the manual
    // strategy contract; it stays visible when the strategy guard trips.
    root.appendChild(systemBrokerReturnPeriodsSection(monitorData.broker_return_periods));
    __set_strategyFreshnessBadgesHost(null);
    __set_strategyTrendCopyHost(null);
    __set_strategyFreshnessRenderedKey("");
    return;
  }
  const annual = Array.isArray(data.annual_returns) ? data.annual_returns : [];
  const latestBrokerReturn = (broker) => annual
    .filter((row) => row.broker === broker)
    .sort((left, right) => right.year - left.year)[0];
  const latestFutu = latestBrokerReturn("Futu");
  const latestTiger = latestBrokerReturn("Tiger");
  const latestIbkr = latestBrokerReturn("IBKR");
  const combined = Array.isArray(data.portfolio_returns) ? data.portfolio_returns.at(-1) : null;
  const freshness = data.return_freshness;
  const freshnessEdge = typeof freshness?.evidence_edge === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(freshness.evidence_edge) ? freshness.evidence_edge : null;
  // The shown status is the worse of the transported server status and the
  // browser recomputation from the evidence edge against the current NY day:
  // the browser may only age the verdict, never improve it, so a device
  // clock running behind cannot wash a server STALE back to green.
  // Missing/malformed blocks (old payloads) render no pill.
  const displayStatus = strategyFreshnessDisplayStatus(freshness);
  const hero = el("section", "strategy-hero");
  const heroBadges = append(el("div", "strategy-hero-badges"),
    el("span", `status-pill ${data.status === "COMPLETE" ? "green" : "amber"}`, `策略输入截至 ${data.as_of || "—"}`),
    el("span", `status-pill ${data.status === "COMPLETE" ? "green" : "amber"}`, `配置 ${data.status || "MISSING"}`));
  const freshnessPill = strategyFreshnessPillNode(displayStatus, freshnessEdge);
  if (freshnessPill) heroBadges.appendChild(freshnessPill);
  // Hosts let the bounded freshness recheck patch only the pill and the
  // trend copy; charts, filters and focus are never rebuilt by that path.
  __set_strategyFreshnessBadgesHost(heroBadges);
  append(hero,
    el("div", "strategy-hero-copy", "把长期资产增长、不同券商策略实验和当前配置放在同一口径下复盘；不与生活现金流相加。"),
    heroBadges,
  );
  root.appendChild(hero);
  const metrics = el("section", "strategy-summary-grid");
  const summaryRows = [
    ["跨券商共同区间 TWR", combined ? pct(combined.twr) : "—", combined ? `MWR ${pct(combined.mwr)} · ${combined.start_date}—${combined.end_date}` : "共同日终历史或资金流覆盖不足"],
    ["Futu 最新 TWR", latestFutu ? pct(latestFutu.twr) : "—", latestFutu ? `MWR ${pct(latestFutu.mwr)} · ${latestFutu.coverage_status} · ${latestFutu.start_date}—${latestFutu.end_date}` : "券商原生历史缺失"],
    ["Tiger 最新 TWR", latestTiger ? pct(latestTiger.twr) : "—", latestTiger ? `MWR ${pct(latestTiger.mwr)} · ${latestTiger.coverage_status} · ${latestTiger.start_date}—${latestTiger.end_date}` : "券商原生历史缺失"],
    ["IBKR 最新 TWR", latestIbkr ? pct(latestIbkr.twr) : "—", latestIbkr ? `Flex 原生 · MWR 不可用 · ${latestIbkr.end_date}` : "Flex 原生收益缺失"],
  ];
  summaryRows.forEach(([label, value, note]) => {
    const card = el("article", "strategy-summary-card");
    append(card, el("p", "metric-label", label), el("strong", "strategy-summary-value", value), el("p", "section-note", note));
    metrics.appendChild(card);
  });
  root.appendChild(metrics);
  const trendCopy = strategyTrendCopyText(displayStatus, freshnessEdge);
  const trend = section("跨券商收益与成长趋势", trendCopy);
  __set_strategyTrendCopyHost(trend.querySelector(".section-copy"));
  trend.appendChild(renderStrategyTrend(data)); root.appendChild(trend);

  const brokerSection = section("逐券商策略复盘", "Futu、Tiger 与 IBKR 独立列示；IBKR 当前只有原生 TWR，不把缺失的 MWR 或盈亏补成零。 ");
  const brokerGrid = el("div", "strategy-broker-grid");
  const brokerNotes = [];
  // One presentation call: portfolioOverviewPresentation sanitizes the
  // stored summary internally, so no separate currentPortfolioDisplaySummary
  // pass is needed here. Rows carry both the current status and the display
  // resolution.
  const strategyPresentation = portfolioOverviewPresentation(portfolioCurrentSummary, null);
  const strategyDisplayByBroker = new Map(
    (Array.isArray(strategyPresentation.broker_breakdown)
      ? strategyPresentation.broker_breakdown
      : []).map((row) => [row.broker, row]),
  );
  const currentBrokers = Array.isArray(strategyPresentation.broker_breakdown)
    ? strategyPresentation.broker_breakdown : [];
  for (const broker of ["Futu", "Tiger", "IBKR"]) {
    const rows = annual.filter((row) => row.broker === broker).sort((a, b) => b.year - a.year)
      .map((row) => ({
        ...row,
        window: row.start_date && row.end_date ? `${row.start_date}—${row.end_date}` : null,
        pnl_display: strategyOriginalPnl(row),
      }));
    const current = currentBrokers.find((row) => row?.broker === broker);
    const brokerDisplay = strategyDisplayByBroker.get(broker)?.display || null;
    const brokerHeadNote = `净资产 ${usd(brokerDisplay?.derived_nav_usd, true)}`
      + ` · 毛杠杆 ${isFiniteMetric(brokerDisplay?.gross_leverage) ? `${number(brokerDisplay.gross_leverage, 2)}x` : "—"}`
      + (brokerDisplay?.origin === "LKG"
        ? ` · 显示历史数据（${lastKnownGoodAgeLabel(brokerDisplay) || "数据年龄未知"}）`
        : "")
      + ` · ${brokerCurrentStatusLabel(brokerDisplay?.current_source_status || current?.source_status)}`
      + (brokerDisplay?.source_retrieved_at
        ? ` · 值截至 ${liveTime(brokerDisplay.source_retrieved_at)}`
        : strategyPresentation.source_retrieved_at
          ? ` · 批次 ${liveTime(strategyPresentation.source_retrieved_at)}`
          : "");
    const card = el("article", "strategy-broker-card");
    const brokerHead = el("div", "strategy-broker-head");
    append(brokerHead,
      el("h3", "", broker),
      el("span", "", brokerHeadNote),
    );
    card.appendChild(brokerHead);
    card.appendChild(table([
      { key: "year", label: "年度" },
      { key: "window", label: "窗口" },
      { key: "twr", label: "TWR", numeric: true, render: pct },
      { key: "mwr", label: "MWR", numeric: true, render: pct },
      { key: "pnl_display", label: "券商年度盈亏", numeric: true },
      { key: "coverage_status", label: "覆盖" },
    ], rows));
    (data.insights || []).filter((item) => item.scope === broker).forEach((item) => {
      if (item.body) brokerNotes.push({ broker, body: item.body });
    });
    brokerGrid.appendChild(card);
  }
  brokerSection.appendChild(brokerGrid);
  const uniqueBrokerNotes = [...new Map(brokerNotes.map((item) => [item.body, item])).values()];
  if (uniqueBrokerNotes.length) {
    const note = el("div", "strategy-broker-note");
    uniqueBrokerNotes.forEach((item) => {
      const body = uniqueBrokerNotes.length > 1 ? `${item.broker}：${item.body}` : item.body;
      note.appendChild(el("p", "", body));
    });
    brokerSection.appendChild(note);
  }
  root.appendChild(brokerSection);

  // Independent system-calculated monthly evidence: mounted after the native
  // per-broker cards so the estimate lane reads as its own source and never
  // replaces or splices the native TWR/MWR lanes above.
  root.appendChild(systemBrokerReturnPeriodsSection(monitorData.broker_return_periods));

  const allocation = section("当前策略结构", "三桶比例以已分类长期多头战略持仓市值为分母；现金、空头、期权和未知分类单列。 ");
  allocation.appendChild(renderStrategyAllocation(data)); root.appendChild(allocation);

  const instrumentTypes = section("当前证券类型结构", "以跨券商正向长期多头、非期权市值为分母；使用券商快照报告的证券类型，不从名称猜测。 ");
  instrumentTypes.appendChild(renderStrategyInstrumentTypes(data.allocation)); root.appendChild(instrumentTypes);

  const recommendations = section("政策偏离与复盘建议", "由 strategy_policy_v1 的固定阈值和文案模板生成，不依赖大模型，也不会自动下单。 ");
  const insightList = el("div", "strategy-insight-list");
  (data.insights || []).filter((item) => !["Futu", "Tiger", "IBKR"].includes(item.scope)).forEach((item) => {
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
    ["Tiger 月度走势", "两种来源逐行标注：日级 RoR 链式（从 2024-11-27 的真实非零起点计算）与 App 展示区间收益分列两条线，不跨来源混算或连接；App 年度值仍独立保留。"],
    ["IBKR 原生 TWR", "Flex Change in NAV 只提供 YTD 原生 TWR；当前没有受治理 MWR、年度盈亏或月度序列。"],
    ["系统月度估算", "由留存的日终估值按自然月自动计算 Modified Dietz 估算；独立于券商 App 原生值与旧月格，缺失月显示为缺失，不补零、不拼接。"],
    ["SPY / QQQ", "当前为正常交易时段价格回报，不含分红再投资，不能称为总回报。"],
  ].forEach(([label, body]) => {
    const item = el("article", "strategy-quality-item"); append(item, el("strong", "", label), el("p", "", body)); list.appendChild(item);
  });
  root.appendChild(quality);
  // Snapshot what the freshness display depends on, so lifecycle rechecks
  // only touch the DOM when the verdict or the NY day actually changed.
  __set_strategyFreshnessRenderedKey(strategyFreshnessRenderKey(
    displayStatus, freshnessEdge, strategyNyToday(),
  ));
}
// @app-block-end b180
