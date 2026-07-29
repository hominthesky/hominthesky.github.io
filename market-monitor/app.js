"use strict";

const payloadUrl = "./payload.enc.json";
let monitorData = null;

const byId = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function append(parent, ...children) {
  for (const child of children) {
    if (child !== null && child !== undefined) parent.appendChild(child);
  }
  return parent;
}

function b64bytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function decryptPayload(password) {
  const response = await fetch(payloadUrl, { cache: "no-store" });
  if (!response.ok) throw new Error("加密数据未能读取，请稍后重试。");
  const envelope = await response.json();
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: b64bytes(envelope.salt),
      iterations: envelope.iterations,
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: b64bytes(envelope.iv),
      tagLength: 128,
    },
    key,
    b64bytes(envelope.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

function pct(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

function number(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function usd(value, compact = false) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    notation: compact ? "compact" : "standard",
  }).format(Number(value));
}

function riskClass(value) {
  const text = String(value || "").toUpperCase();
  if (text.includes("RED") || text.includes("极端") || text.includes("S4")) return "red";
  if (text.includes("高") || text.includes("S3") || text.includes("S2") || text.includes("PARTIAL")) {
    return "amber";
  }
  if (text.includes("GREEN") || text.includes("S6") || text.includes("OK")) return "green";
  return "";
}

function actionTone(label) {
  const text = String(label || "");
  if (
    ["停止新增杠杆", "降杠杆至红线以下", "优先核对账户保证金", "优先减仓复核"].some(
      (item) => text.includes(item),
    )
  ) {
    return "tone-red";
  }
  if (
    ["暂停加仓", "等待确认", "等待压力", "减仓或保护复核", "持有但不加仓", "控制追涨"].some(
      (item) => text.includes(item),
    )
  ) {
    return "tone-amber";
  }
  if (["小仓分批买入候选", "修复候选"].some((item) => text.includes(item))) {
    return "tone-green";
  }
  return "tone-neutral";
}

function metricCard(label, value, note) {
  const card = el("article", "metric-card");
  append(
    card,
    el("div", "metric-label", label),
    el("div", "metric-value", value),
    el("p", "metric-note", note),
  );
  return card;
}

function section(title, copy) {
  const card = el("section", "section-card");
  const head = el("div", "section-head");
  const wrap = el("div");
  append(wrap, el("h2", "", title), el("p", "section-copy", copy));
  head.appendChild(wrap);
  card.appendChild(head);
  return card;
}

function table(columns, rows) {
  const wrap = el("div", "table-wrap");
  const tableNode = el("table");
  const thead = el("thead");
  const headerRow = el("tr");
  columns.forEach((column) => headerRow.appendChild(el("th", "", column.label)));
  thead.appendChild(headerRow);
  const tbody = el("tbody");
  rows.forEach((row) => {
    const tr = el("tr");
    columns.forEach((column) => {
      const td = el("td", column.numeric ? "num" : "");
      const value = column.render ? column.render(row[column.key], row) : row[column.key];
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

function renderActionList(actions) {
  const list = el("div", "action-list");
  actions.forEach((action) => {
    const tone = actionTone(action.action_label);
    const card = el("article", `action-card ${tone}`);
    const content = el("div");
    const top = el("div", "action-topline");
    append(
      top,
      el("span", `action-label ${tone}`, action.action_label),
      el("span", "action-entity", action.entity_label || action.entity),
    );
    const details = el("div", "fact-stack");
    const fact = el("span");
    append(fact, el("b", "", "事实 · "), document.createTextNode(action.fact || "—"));
    const inference = el("span");
    append(inference, el("b", "", "推断 · "), document.createTextNode(action.inference || "—"));
    const condition = el("span");
    append(
      condition,
      el("b", "", "执行条件 · "),
      document.createTextNode(action.execution_condition || "—"),
    );
    append(details, fact, inference, condition);
    append(content, top, el("p", "", action.action), details);
    append(card, el("div", "action-rank", action.priority_rank), content);
    list.appendChild(card);
  });
  return list;
}

function renderPositionRows(positions) {
  const list = el("div", "position-list");
  positions.forEach((position) => {
    const tone = actionTone(position.action_label);
    const card = el("article", `position-row ${tone}`);
    const identity = el("div", "position-identity");
    append(
      identity,
      el("strong", "", position.ticker),
      el("span", "", position.strategy || "未分类"),
    );
    const exposure = el("div", "position-exposure");
    append(
      exposure,
      el("strong", "", pct(position.pct_nav)),
      el("span", "", `${usd(position.market_value_usd, true)} 名义敞口`),
    );
    const message = el("div", "position-message");
    append(
      message,
      el(
        "span",
        `action-label ${tone}`,
        position.action_label,
      ),
      el("p", "", position.suggested_action),
      el(
        "span",
        "position-state",
        `${position.market_state || "UNMAPPED"} · ${position.data_readiness || "—"}`,
      ),
    );
    append(card, identity, exposure, message);
    list.appendChild(card);
  });
  return list;
}

function renderPersonal() {
  const root = byId("personal-content");
  root.replaceChildren();
  const data = monitorData.personal;
  const summary = data.summary;
  const personalAlert = data.alerts[0];

  const banner = el("section", `risk-banner ${summary.portfolio_gate === "RED" ? "" : "amber"}`);
  const bannerText = el("div");
  append(
    bannerText,
    el("h2", "", personalAlert?.headline || "个人风险预算"),
    el(
      "p",
      "",
      personalAlert?.evidence ||
        `当前组合毛杠杆 ${number(summary.gross_leverage, 2)}x，风险闸门 ${summary.portfolio_gate}。`,
    ),
  );
  append(banner, el("div", "risk-bar"), bannerText);
  root.appendChild(banner);

  const metrics = el("section", "metric-grid");
  append(
    metrics,
    metricCard(
      "组合毛杠杆",
      `${number(summary.gross_leverage, 2)}x`,
      `治理红线 ${number(summary.gross_leverage_red, 2)}x`,
    ),
    metricCard(
      "回到红线需降毛敞口",
      usd(summary.required_gross_reduction_usd_to_red, true),
      "静态一阶估算，执行前须用券商实时数据重算",
    ),
    metricCard(
      "高进攻敞口 / NAV",
      pct(summary.attack_exposure_pct_nav),
      `目标 ${pct(summary.attack_target_pct_nav)}`,
    ),
    metricCard(
      "最高账户杠杆",
      `${number(summary.highest_account_gross_leverage, 2)}x`,
      `${summary.highest_leverage_account || "—"} · 先核对 house requirement`,
    ),
  );
  root.appendChild(metrics);

  const actions = section("今天先做什么", "按个人风险预算排序；不是自动交易指令。");
  actions.appendChild(renderActionList(data.actions));
  root.appendChild(actions);

  const positions = section("持仓风险与行动", "仅显示个人持仓事实和对应风险动作，不混入宏观板块列表。");
  positions.appendChild(renderPositionRows(data.positions));
  root.appendChild(positions);

  const strategy = section("策略敞口与目标", "实际敞口按组合 NAV 重算。");
  strategy.appendChild(
    table(
      [
        { key: "strategy", label: "策略" },
        { key: "actual_pct_nav", label: "实际 / NAV", numeric: true, render: pct },
        { key: "target_pct_nav", label: "目标 / NAV", numeric: true, render: pct },
        { key: "gap_pct_nav", label: "偏离", numeric: true, render: pct },
        { key: "actual_market_value_usd", label: "毛敞口", numeric: true, render: usd },
      ],
      data.strategy,
    ),
  );
  root.appendChild(strategy);
}

function universeCard(universe, action) {
  const card = el("article", `universe-card ${actionTone(action.action_label)}`);
  const heading = el("div", "universe-title");
  const nameWrap = el("div");
  append(
    nameWrap,
    el("h2", "", universe.universe_label),
    el("p", "", `${universe.benchmark} · 截至 ${universe.as_of_date}`),
  );
  append(
    heading,
    nameWrap,
    el("span", `badge ${riskClass(action.state_label)}`, action.state_label),
  );
  const pressure = Number(universe.price_deleveraging_pressure || 0);
  const track = el("div", "pressure-track");
  const fill = el("div", `pressure-fill ${pressure >= 85 ? "red" : ""}`);
  fill.style.width = `${Math.max(0, Math.min(100, pressure))}%`;
  track.appendChild(fill);
  const stats = el("div", "stat-grid");
  [
    ["5日涨跌", pct(universe.benchmark_return_5d)],
    ["20日回撤", pct(universe.benchmark_drawdown_20d)],
    ["50日线上方", pct(universe.breadth_above_50d)],
    ["20日波动", pct(universe.benchmark_realized_vol_20d)],
    ["20日相关性", number(universe.average_correlation_20d, 2)],
    ["价格覆盖", pct(universe.price_coverage)],
  ].forEach(([label, value]) => {
    const item = el("div");
    append(item, el("span", "k", label), el("span", "v", value));
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
    el("p", "metric-note", "价格去杠杆压力分位"),
    track,
    stats,
    macroAction,
  );
  return card;
}

function renderPressureChart(rows) {
  const wrap = el("div", "chart-wrap");
  const legend = el("div", "chart-legend");
  const semiLegend = el("span");
  append(semiLegend, el("i", "legend-dot semi"), document.createTextNode("半导体"));
  const nasdaqLegend = el("span");
  append(nasdaqLegend, el("i", "legend-dot nasdaq"), document.createTextNode("纳斯达克核心"));
  append(legend, semiLegend, nasdaqLegend);

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
  const series = ["semi", "nasdaq_core"];
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
    polyline.setAttribute(
      "class",
      id === "semi" ? "chart-line-semi" : "chart-line-nasdaq",
    );
    polyline.setAttribute("points", points);
    svg.appendChild(polyline);
  });
  append(wrap, legend, svg);
  return wrap;
}

function renderMacro() {
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
  append(
    metrics,
    metricCard(
      "FINRA 融资余额同比",
      pct(hero.margin_debt_yoy),
      `参考月 ${hero.margin_reference_month || "—"} · 全市场慢频存量`,
    ),
    metricCard(
      "半导体压力",
      number(hero.semi_pressure, 1),
      hero.semi_state,
    ),
    metricCard(
      "纳斯达克核心压力",
      number(hero.nasdaq_pressure, 1),
      hero.nasdaq_state,
    ),
    metricCard(
      "完整时段行情覆盖",
      pct(hero.full_session_market_data_coverage),
      `${hero.market_data_session_scope} · 当前主要为正常盘价量`,
    ),
  );
  root.appendChild(metrics);

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
        { key: "return_5d", label: "5日", numeric: true, render: pct },
        { key: "drawdown_20d", label: "20日回撤", numeric: true, render: pct },
        { key: "price_crowding_proxy", label: "拥挤代理", numeric: true, render: number },
        { key: "price_damage_score", label: "价格损伤", numeric: true, render: number },
        { key: "risk_level", label: "风险" },
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
        { key: "coverage_ratio", label: "覆盖", numeric: true, render: pct },
        { key: "notes", label: "说明" },
      ],
      data.sources,
    ),
  );
  root.appendChild(sources);
}

function switchTab(tab) {
  const personal = tab === "personal";
  byId("panel-personal").hidden = !personal;
  byId("panel-macro").hidden = personal;
  byId("tab-personal").setAttribute("aria-selected", String(personal));
  byId("tab-macro").setAttribute("aria-selected", String(!personal));
}

function renderDashboard() {
  const { meta } = monitorData;
  byId("asof-line").replaceChildren(
    el("span", "", `市场截至 ${meta.market_as_of || "—"} ET`),
    el("span", "", `持仓读取 ${meta.portfolio_retrieved_at || "—"}`),
    el("span", "", meta.session_boundary),
  );
  const status = byId("snapshot-status");
  status.textContent = meta.status === "ready" ? "数据已就绪" : "数据部分可用";
  status.className = `status-pill ${meta.status === "ready" ? "green" : "amber"}`;
  byId("personal-tab-alert").textContent = monitorData.personal.alerts.length
    ? `· ${monitorData.personal.alerts.length}`
    : "";
  byId("macro-tab-alert").textContent = monitorData.macro.alerts.length
    ? `· ${monitorData.macro.alerts.length}`
    : "";
  renderPersonal();
  renderMacro();
  switchTab("personal");
}

byId("unlock-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = byId("unlock-button");
  const error = byId("unlock-error");
  const passwordInput = byId("password");
  button.disabled = true;
  button.textContent = "正在解密…";
  error.textContent = "";
  try {
    monitorData = await decryptPayload(passwordInput.value);
    passwordInput.value = "";
    renderDashboard();
    byId("unlock-view").hidden = true;
    byId("dashboard").hidden = false;
  } catch (decryptError) {
    error.textContent =
      decryptError instanceof DOMException
        ? "密码不正确，或数据包已损坏。"
        : decryptError.message;
  } finally {
    button.disabled = false;
    button.textContent = "解锁监控";
  }
});

document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
});

byId("lock-button").addEventListener("click", () => {
  monitorData = null;
  byId("personal-content").replaceChildren();
  byId("macro-content").replaceChildren();
  byId("dashboard").hidden = true;
  byId("unlock-view").hidden = false;
  byId("password").focus();
});
