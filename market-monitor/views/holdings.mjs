import {
  LEDGER_COLUMNS,
  LIVE_CLIENT,
  byId,
  effectiveHoldingsStatus,
  filterHoldingRows,
  holdingDisplayLabel,
  holdingStrategyLabel,
  holdingStatusPresentation,
  holdingTagLabels,
  holdingsFilters,
  holdingsRuntime,
  ledgerColumnLabel
} from "../lib/context.mjs";
import {
  append,
  el,
  section
} from "../lib/dom.mjs";
import {
  isFiniteMetric,
  liveTime,
  number,
  pct,
  usd
} from "../lib/format.mjs";
import {
  loadPrivateHoldings
} from "../lib/live_channel.mjs";

// @app-block-start b145
export function holdingFilterField(labelText, value, options, onChange) {
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
// @app-block-end b145

// @app-block-start b146
export function holdingStatusNode(status) {
  const normalized = String(status || "MISSING").toUpperCase();
  const presentation = holdingStatusPresentation(normalized);
  const node = el("span", `holdings-status ${normalized.toLowerCase()}`, presentation.label);
  node.title = presentation.tooltip;
  node.setAttribute("aria-label", `来源${presentation.label}`);
  return node;
}
// @app-block-end b146

// @app-block-start b147
export function holdingDeviationNode(value) {
  if (!isFiniteMetric(value)) return el("span", "strategy-deviation-neutral", "—");
  const tone = value > 0
    ? "strategy-deviation-positive"
    : value < 0 ? "strategy-deviation-negative" : "strategy-deviation-neutral";
  return el("span", tone, `${value > 0 ? "+" : ""}${pct(value)}`);
}
// @app-block-end b147

// @app-block-start b148
export function appendHoldingCell(row, value, { numeric = false, rowSpan = 1, className = "" } = {}) {
  const cell = el("td", `${numeric ? "num" : ""} ${className}`.trim());
  if (rowSpan > 1) cell.rowSpan = rowSpan;
  if (value instanceof Node) cell.appendChild(value);
  else cell.textContent = value ?? "—";
  row.appendChild(cell);
}
// @app-block-end b148

// @app-block-start b151
export function syncLedgerGroupRowSpans(tbody) {
  tbody.querySelectorAll("tr[data-ledger-group]").forEach((groupHead) => {
    const base = Number(groupHead.dataset.ledgerRowSpan || "0");
    if (base < 2) return;
    const openCount = tbody.querySelectorAll(
      `tr[data-ledger-detail-group="${groupHead.dataset.ledgerGroup}"]:not([hidden])`,
    ).length;
    groupHead.querySelectorAll("td.holdings-group-cell").forEach((cell) => {
      cell.rowSpan = base + openCount;
    });
  });
}
// @app-block-end b151

// @app-block-start b152
export function renderHoldingsTable(host, rows, allocation, countNode) {
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
  const [
    strategyCol, targetCol, actualCol, driftCol, brokerCol, tickerCol,
    typeCol, directionCol, qtyCol, valueCol, navCol, bucketCol, sourceCol,
  ] = LEDGER_COLUMNS;
  const wrap = el("div", "table-wrap holdings-table-wrap");
  const tableNode = el("table", "holdings-ledger-table");
  const thead = el("thead");
  const headerRow = el("tr");
  LEDGER_COLUMNS.forEach((column) => headerRow.appendChild(
    el("th", column.className, ledgerColumnLabel(column)),
  ));
  thead.appendChild(headerRow);
  const tbody = el("tbody");
  const emittedGroups = new Set();
  visibleRows.forEach((row, rowIndex) => {
    const allocationRow = allocationByBucket.get(row.strategy_bucket);
    const groupRowSpan = mergeStrategy ? groupSizes.get(row.strategy_bucket) : 1;
    const tr = el("tr");
    const firstInGroup = !mergeStrategy || !emittedGroups.has(row.strategy_bucket);
    if (firstInGroup) {
      emittedGroups.add(row.strategy_bucket);
      const rowSpan = groupRowSpan;
      if (mergeStrategy) {
        tr.dataset.ledgerGroup = row.strategy_bucket;
        tr.dataset.ledgerRowSpan = String(rowSpan);
      }
      appendHoldingCell(tr, holdingStrategyLabel(row.strategy_bucket), {
        rowSpan, className: `holdings-group-cell ${strategyCol.className}`,
      });
      appendHoldingCell(tr, allocationRow?.target_pct === null
        || allocationRow?.target_pct === undefined ? "—" : pct(allocationRow.target_pct), {
        numeric: true, rowSpan, className: `holdings-group-cell ${targetCol.className}`,
      });
      appendHoldingCell(tr, allocationRow?.actual_pct === null
        || allocationRow?.actual_pct === undefined ? "—" : pct(allocationRow.actual_pct), {
        numeric: true, rowSpan, className: `holdings-group-cell ${actualCol.className}`,
      });
      appendHoldingCell(tr, holdingDeviationNode(allocationRow?.gap_pct), {
        numeric: true, rowSpan, className: `holdings-group-cell ${driftCol.className}`,
      });
    }
    appendHoldingCell(tr, row.broker, { className: "col-broker" });
    const detailRow = el("tr", "holdings-detail-row");
    detailRow.id = `holdings-detail-${rowIndex}`;
    if (mergeStrategy) detailRow.dataset.ledgerDetailGroup = row.strategy_bucket;
    detailRow.hidden = true;
    const tickerCell = el("td", "col-ticker");
    const toggle = el("button", "holdings-row-toggle", "▸");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", detailRow.id);
    toggle.setAttribute("aria-label", `展开 ${row.ticker} 明细`);
    toggle.addEventListener("click", () => {
      const open = detailRow.hidden;
      detailRow.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "▾" : "▸";
      toggle.setAttribute("aria-label", `${open ? "收起" : "展开"} ${row.ticker} 明细`);
      syncLedgerGroupRowSpans(tbody);
    });
    append(tickerCell, toggle, el("span", "", holdingDisplayLabel(row)));
    tr.appendChild(tickerCell);
    appendHoldingCell(tr, row.instrument_type === "OPTION" ? "期权" : row.instrument_type, { className: "col-type" });
    appendHoldingCell(tr, row.direction === "LONG" ? "多头" : "空头", { className: "col-direction" });
    appendHoldingCell(tr, holdingQuantityLabel(row), { numeric: true, className: "col-qty" });
    appendHoldingCell(tr, usd(row.market_value_usd), { numeric: true, className: "col-value" });
    appendHoldingCell(tr, pct(row.pct_nav), { numeric: true, className: "col-nav" });
    appendHoldingCell(tr, row.pct_classified_long === null ? "—" : pct(row.pct_classified_long), { numeric: true, className: "col-bucket" });
    appendHoldingCell(tr, holdingStatusNode(row.source_status), { className: "col-source" });
    tbody.appendChild(tr);

    const detailCell = el("td", "holdings-detail");
    // Merged multi-row groups span their four group cells across every layout
    // row of the group, including this detail row, so the detail cell covers
    // the remaining nine logical columns; single-row groups and non-merged
    // layouts leave all thirteen free. Render-time constant: display:none
    // detail rows take no layout rows. colSpan is always counted on the
    // 13-column logical grid — display:none cells produce no boxes, and
    // browser clamping is NOT relied on as a safety net.
    detailCell.colSpan = mergeStrategy && groupRowSpan >= 2 ? 9 : 13;
    const detailGrid = el("dl", "holdings-detail-grid");
    // Explicit [column, value] pairs — never a bare-index zip — so a value
    // can only sit next to its own column descriptor.
    const detailItems = [
      [strategyCol, holdingStrategyLabel(row.strategy_bucket)],
      [targetCol, allocationRow?.target_pct === null
        || allocationRow?.target_pct === undefined ? "—" : pct(allocationRow.target_pct)],
      [actualCol, allocationRow?.actual_pct === null
        || allocationRow?.actual_pct === undefined ? "—" : pct(allocationRow.actual_pct)],
      [driftCol, holdingDeviationNode(allocationRow?.gap_pct)],
      [brokerCol, row.broker],
      [tickerCol, holdingDisplayLabel(row)],
      [typeCol, row.instrument_type === "OPTION" ? "期权" : row.instrument_type],
      [directionCol, row.direction === "LONG" ? "多头" : "空头"],
      [qtyCol, holdingQuantityLabel(row)],
      [valueCol, usd(row.market_value_usd)],
      [navCol, pct(row.pct_nav)],
      [bucketCol, row.pct_classified_long === null ? "—" : pct(row.pct_classified_long)],
      [sourceCol, holdingStatusNode(row.source_status)],
    ];
    if (row.tags) detailItems.push(...holdingTagLabels(row.tags).map(tag => {
      const label=el("span", tag.inferred ? "section-note" : "", `${tag.label}${tag.inferred ? " · 推断" : ""}`);
      label.title={manual:"手工确认",inferred:"规则推断",default:"资料待确认"}[tag.source];
      return [{label:"分类标签"},label];
    }));
    detailItems.forEach(([column, value]) => {
      const item = el("div", "holdings-detail-item");
      const dd = el("dd");
      if (value instanceof Node) dd.appendChild(value);
      else dd.textContent = value;
      append(item, el("dt", "", ledgerColumnLabel(column)), dd);
      detailGrid.appendChild(item);
    });
    detailCell.appendChild(detailGrid);
    detailRow.appendChild(detailCell);
    tbody.appendChild(detailRow);
  });
  append(tableNode, thead, tbody);
  wrap.appendChild(tableNode);
  host.replaceChildren(wrap);
}
// @app-block-end b152

// @app-block-start b153
export function renderHoldingsAllocation(data) {
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
// @app-block-end b153

// @app-block-start b154
export function holdingQuantityLabel(row) {
  return `${number(row.quantity, Math.abs(row.quantity % 1) > 0 ? 4 : 0)}${row.instrument_type === "OPTION" ? " 张" : " 股"}`;
}
// @app-block-end b154

// @app-block-start b155
export function renderHoldings() {
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
  const sourceStatus = effectiveHoldingsStatus(data);
  const rows = sourceStatus === "STALE" ? dataset.rows.map(row => ({...row, source_status: "STALE"})) : dataset.rows;

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
    el("span", `status-pill ${sourceStatus === "OK" ? "green" : "amber"}`, `${liveTime(summary.holdings_as_of || summary.source_retrieved_at)} · ${holdingStatusPresentation(sourceStatus).label}`),
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
      holdingStatusNode(sourceStatus === "STALE" ? "STALE" : row.source_status),
    );
    brokerGrid.appendChild(card);
  });
  if (!brokerGrid.childElementCount) brokerGrid.appendChild(el("p", "empty-state", "分券商快照暂不可用。"));
  brokers.appendChild(brokerGrid);

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
  root.appendChild(brokers);

  const quality = section("数据健康与边界", "展开查看当前账本为什么可能不完整。");
  const details = el("details", "holdings-quality");
  const qualitySummary = el("summary", "", `${holdingStatusPresentation(sourceStatus).label} · ${rows.length} 项持仓`);
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
// @app-block-end b155
