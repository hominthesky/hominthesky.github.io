import {
  TERM_DEFINITIONS,
  byId,
  monitorData
} from "../lib/context.mjs";
import {
  append,
  el,
  metricCard,
  section,
  table,
  term
} from "../lib/dom.mjs";
import {
  isFiniteMetric,
  number,
  pct
} from "../lib/format.mjs";
import {
  formatStateTag
} from "../lib/freshness.mjs";
import {
  actionTone,
  coverageMetricGuidance,
  marginMetricGuidance,
  pressureMetricGuidance,
  riskClass
} from "../lib/presentation.mjs";

// @app-block-start b135
export function universeCard(universe, action) {
  const card = el("article", `universe-card ${actionTone(action.action_label)}`);
  const heading = el("div", "universe-title");
  const nameWrap = el("div");
  append(
    nameWrap,
    el("h2", "", universe.universe_label),
    el("p", "", `${universe.benchmark ? `${universe.benchmark} · ` : ""}截至 ${universe.as_of_date || "—"}`),
  );
  append(
    heading,
    nameWrap,
    el("span", `badge ${riskClass(action.state_label)}`, action.state_label),
  );
  const pressure = isFiniteMetric(universe.price_deleveraging_pressure) ? Number(universe.price_deleveraging_pressure) : null;
  const track = el("div", "pressure-track");
  const fill = el("div", `pressure-fill ${pressure >= 85 ? "red" : ""}`);
  fill.style.width = `${pressure === null ? 0 : Math.max(0, Math.min(100, pressure))}%`;
  track.hidden = pressure === null;
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
// @app-block-end b135

// @app-block-start b136
export function renderPressureChart(rows) {
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
// @app-block-end b136

// @app-block-start b137
export function renderMacro() {
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
        formatStateTag(universe.state_code, universe.state_label),
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

  const forward = data.forward_risk;
  if (forward) {
    const facts = section("市场前瞻事实", "公开来源的期限结构与信用利差；不单独生成交易指令。");
    const grid = el("div", "metric-grid");
    append(grid,
      metricCard("VIX / VIX3M", number(forward.vix_term_ratio, 2), forward.vix_term_status === "OK" ? forward.term_inverted ? "期限结构倒挂" : "期限结构未倒挂" : "来源不可用"),
      metricCard("高收益债利差", isFiniteMetric(forward.hy_oas_percent) ? `${number(forward.hy_oas_percent,2)}%` : "—", forward.hy_oas_as_of || "不可用"),
      metricCard("近一年利差分位", isFiniteMetric(forward.hy_oas_percentile_1y) ? `${number(forward.hy_oas_percentile_1y,1)}%` : "—", forward.hy_oas_status === "OK" ? "有效历史观测" : "历史覆盖不足"));
    facts.appendChild(grid);root.appendChild(facts);
  }

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
// @app-block-end b137
