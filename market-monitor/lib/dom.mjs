import {
  __set_activeTermAnchor,
  activeTermAnchor,
  byId
} from "./context.mjs";

// @app-block-start b034
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
// @app-block-end b034

// @app-block-start b035
export function append(parent, ...children) {
  for (const child of children) {
    if (child !== null && child !== undefined) parent.appendChild(child);
  }
  return parent;
}
// @app-block-end b035

// @app-block-start b037
export function hideTermTooltip() {
  const tooltip = byId("term-tooltip-live");
  if (tooltip) tooltip.hidden = true;
  if (activeTermAnchor) activeTermAnchor.removeAttribute("aria-describedby");
  __set_activeTermAnchor(null);
}
// @app-block-end b037

// @app-block-start b038
export function termTooltipNode() {
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
// @app-block-end b038

// @app-block-start b039
export function showTermTooltip(anchor) {
  const definition = anchor.dataset.tooltip;
  if (!definition) return;
  const tooltip = termTooltipNode();
  __set_activeTermAnchor(anchor);
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
// @app-block-end b039

// @app-block-start b040
export function term(label, definition, className = "") {
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
// @app-block-end b040

// @app-block-start b108
export function metricGuidance(label, text, tone = "") {
  const row = el("div", `metric-guidance-row ${tone}`.trim());
  append(
    row,
    el("span", "metric-guidance-label", label),
    el("p", "", text),
  );
  return row;
}
// @app-block-end b108

// @app-block-start b109
export function metricCard(label, value, note, options = {}) {
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
// @app-block-end b109

// @app-block-start b110
export function section(title, copy) {
  const card = el("section", "section-card");
  const head = el("div", "section-head");
  const wrap = el("div");
  append(wrap, el("h2", "", title), el("p", "section-copy", copy));
  head.appendChild(wrap);
  card.appendChild(head);
  return card;
}
// @app-block-end b110

// @app-block-start b111
export function table(columns, rows) {
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
// @app-block-end b111
