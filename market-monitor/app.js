"use strict";

const payloadUrl = "./payload.enc.json";
let monitorData = null;

const byId = (id) => document.getElementById(id);

const TERM_DEFINITIONS = {
  grossLeverage:
    "组合所有多空名义敞口绝对值之和 ÷ 组合净资产（NAV）。上升会放大回撤、融资成本和保证金风险；下降会改善安全垫。",
  deleverAmount:
    "按当前净资产静态估算，把组合毛杠杆降到治理红线所需减少的毛敞口。它不是建议订单金额，执行前必须用券商实时数据重算。",
  attackExposure:
    "高进攻策略的名义毛敞口 ÷ 组合净资产。因为包含融资和名义敞口，该比例可以超过100%。",
  highestAccountLeverage:
    "各券商账户的毛敞口 ÷ 该账户净资产中的最高值。数值越高，该账户通常越容易先受到保证金约束。",
  finraMarginYoy:
    "FINRA 全市场客户融资余额相对上年同期的变化。上升表示融资存量扩张，下降可能是健康降温，也可能是被动去杠杆；该数据按月发布且不能定位具体板块。",
  pricePressure:
    "0–100的历史分位代理，综合短期跌幅、波动、回撤、市场宽度和相关性。上升表示价格型去杠杆压力增强，下降只表示急性压力缓和；它不是实际杠杆率或爆仓概率。",
  fullSessionCoverage:
    "当前价格源对美东时间 [T-1 20:00, T 20:00) 完整监控日的覆盖比例。上升表示夜盘、盘前、正常盘和盘后数据更完整，不代表市场风险上升。",
  return5d:
    "当前价格相对5个交易日前的涨跌幅。下跌越大，短期价格冲击越强；单独上涨不能证明风险已经清除。",
  drawdown20d:
    "当前价格相对过去20个交易日最高价的跌幅。数值越负，近期价格损伤越深。",
  breadth50:
    "板块成分股中价格高于各自50日均线的比例。上升表示上涨或修复扩散，下降表示更多股票跌破中期趋势。",
  volatility20:
    "最近20个交易日日收益率的年化实现波动率。上升表示价格振幅和风险预算消耗加快。",
  correlation20:
    "板块成分股最近20日收益率的平均相关性。快速上升表示个股更容易一起涨跌，常见于系统性卖压，但不能单独证明强平。",
  priceCoverage:
    "该板块配置成分中成功取得可用价格历史的比例。覆盖越低，板块分数和状态的置信度越低。",
  crowdingProxy:
    "价格型拥挤代理：60日动量分位40%＋价格在252日区间的位置35%＋异常成交量分位25%。上升表示趋势交易更集中，但不是实际机构持仓。",
  priceDamage:
    "价格损伤分数：5日跌幅分位40%＋20日波动率分位30%＋20日回撤分位30%。上升表示卖压、波动和回撤综合恶化。",
  tickerRisk:
    "个股风险优先分对应的等级：拥挤代理45%＋价格损伤55%。用于排查优先级，不是自动买卖信号。",
  sourceCoverage:
    "本次运行中该公开数据源成功取得有效观察值的比例。下降表示证据缺口变大，不代表市场风险改善。",
};

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

let activeTermAnchor = null;

function hideTermTooltip() {
  const tooltip = byId("term-tooltip-live");
  if (tooltip) tooltip.hidden = true;
  if (activeTermAnchor) activeTermAnchor.removeAttribute("aria-describedby");
  activeTermAnchor = null;
}

function termTooltipNode() {
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

function showTermTooltip(anchor) {
  const definition = anchor.dataset.tooltip;
  if (!definition) return;
  const tooltip = termTooltipNode();
  activeTermAnchor = anchor;
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

function term(label, definition, className = "") {
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
  const safeDigits =
    Number.isInteger(digits) && digits >= 0 && digits <= 20 ? digits : 1;
  return `${(Number(value) * 100).toFixed(safeDigits)}%`;
}

function number(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  const safeDigits =
    Number.isInteger(digits) && digits >= 0 && digits <= 20 ? digits : 1;
  return Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: safeDigits,
    maximumFractionDigits: safeDigits,
  });
}

function usd(value, compact = false) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    notation: compact === true ? "compact" : "standard",
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

function portfolioMetricGuidance(summary) {
  const leverage = Number(summary.gross_leverage);
  const leverageRed = Number(summary.gross_leverage_red);
  const attackExposure = Number(summary.attack_exposure_pct_nav);
  const attackTarget = Number(summary.attack_target_pct_nav);
  return {
    leverage: {
      definition: TERM_DEFINITIONS.grossLeverage,
      meaning: "↑ 回撤与保证金敏感度增加；↓ 强平安全垫改善。",
      action:
        Number.isFinite(leverage) &&
        Number.isFinite(leverageRed) &&
        leverage > leverageRed
          ? `高于 ${number(leverageRed, 2)}x 红线：停止新增杠杆，先降到红线以下。`
          : "未越过红线：仍需按券商实时保证金维持安全垫。",
      tone:
        Number.isFinite(leverage) &&
        Number.isFinite(leverageRed) &&
        leverage > leverageRed
          ? "tone-red"
          : "tone-neutral",
    },
    reduction: {
      definition: TERM_DEFINITIONS.deleverAmount,
      meaning: "↑ 离治理红线更远；↓ 更接近风险预算范围。",
      action: "先用券商实时 NAV、融资负债和 house requirement 重算，再决定账户与手数。",
      tone: "tone-red",
    },
    attack: {
      definition: TERM_DEFINITIONS.attackExposure,
      meaning: "↑ 高波动与集中度风险增加；↓ 风险预算逐步恢复。",
      action:
        Number.isFinite(attackExposure) &&
        Number.isFinite(attackTarget) &&
        attackExposure > attackTarget
          ? `高于 ${pct(attackTarget)} 目标：优先复核大额高进攻敞口。`
          : "处于目标内：按 thesis 与风险预算维护，不因短期价格单独加仓。",
      tone:
        Number.isFinite(attackExposure) &&
        Number.isFinite(attackTarget) &&
        attackExposure > attackTarget
          ? "tone-red"
          : "tone-neutral",
    },
    account: {
      definition: TERM_DEFINITIONS.highestAccountLeverage,
      meaning: "↑ 账户更容易先触发保证金约束；↓ 账户安全垫改善。",
      action: `${summary.highest_leverage_account || "最高杠杆账户"}：优先核对实时 house requirement 与压力价格。`,
      tone: "tone-red",
    },
  };
}

function marginMetricGuidance(value) {
  const yoy = Number(value);
  return {
    definition: TERM_DEFINITIONS.finraMarginYoy,
    meaning: "↑ 全市场融资存量扩张、潜在脆弱性累积；↓ 可能是降温，也可能是被动去杠杆。",
    action:
      Number.isFinite(yoy) && yoy > 0
        ? "融资同比仍为正：高价格压力下不新增杠杆，并监控宽度与信用确认。"
        : Number.isFinite(yoy)
          ? "融资同比收缩：先判断健康降温还是被动出清，不直接把下降当买点。"
          : "数据缺失或滞后：不据此改变仓位，等待下一次正式更新。",
    tone: Number.isFinite(yoy) && yoy > 0 ? "tone-amber" : "tone-neutral",
  };
}

function pressureMetricGuidance(universe) {
  const state = universe.state_code || "S0";
  const actions = {
    S4: "优先降低风险并核对保证金；不要在强制去杠杆证据期接飞刀。",
    S3: "避免杠杆抄底；压力连续3日低于70且宽度改善后再重估。",
    S2: "不追涨、不加杠杆；等待压力清除或新的基本面证据。",
    S1: "控制追涨，在既定风险预算内持有并监控宽度背离。",
    S5: "只建立观察清单；等待趋势、宽度和第二证据族确认。",
    S6: "个人风险闸门通过后，才考虑无杠杆、小仓、分批执行。",
    S0: "信号正常或不足；不因单一分位改变仓位。",
  };
  const tones = {
    S4: "tone-red",
    S3: "tone-amber",
    S2: "tone-amber",
    S1: "tone-amber",
    S5: "tone-neutral",
    S6: "tone-green",
    S0: "tone-neutral",
  };
  return {
    definition: TERM_DEFINITIONS.pricePressure,
    meaning: "↑ 卖压、波动、回撤或同步下跌增强；↓ 只表示急性压力缓和。",
    action: actions[state] || actions.S0,
    tone: tones[state] || tones.S0,
  };
}

function coverageMetricGuidance(value) {
  const coverage = Number(value);
  return {
    definition: TERM_DEFINITIONS.fullSessionCoverage,
    meaning: "↑ 数据更完整、判断置信度提高；↓ 盲区扩大，不代表市场风险下降。",
    action:
      Number.isFinite(coverage) && coverage < 0.7
        ? "完整时段覆盖不足：仅作正常盘代理，不单独确认强制去杠杆。"
        : "时段覆盖较充分：仍需结合资金流、融资与信用证据确认状态。",
    tone:
      Number.isFinite(coverage) && coverage < 0.7
        ? "tone-amber"
        : "tone-neutral",
  };
}

function metricGuidance(label, text, tone = "") {
  const row = el("div", `metric-guidance-row ${tone}`.trim());
  append(
    row,
    el("span", "metric-guidance-label", label),
    el("p", "", text),
  );
  return row;
}

function metricCard(label, value, note, options = {}) {
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
  const guidance = portfolioMetricGuidance(summary);
  append(
    metrics,
    metricCard(
      "组合毛杠杆",
      `${number(summary.gross_leverage, 2)}x`,
      `治理红线 ${number(summary.gross_leverage_red, 2)}x`,
      guidance.leverage,
    ),
    metricCard(
      "回到红线需降毛敞口",
      usd(summary.required_gross_reduction_usd_to_red, true),
      "静态一阶估算，执行前须用券商实时数据重算",
      guidance.reduction,
    ),
    metricCard(
      "高进攻敞口 / NAV",
      pct(summary.attack_exposure_pct_nav),
      `目标 ${pct(summary.attack_target_pct_nav)}`,
      guidance.attack,
    ),
    metricCard(
      "最高账户杠杆",
      `${number(summary.highest_account_gross_leverage, 2)}x`,
      `${summary.highest_leverage_account || "—"} · 先核对 house requirement`,
      guidance.account,
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

function renderPressureChart(rows) {
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
        `${universe.state_code || "S0"} ${universe.state_label || "观察"}`,
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
    requestAnimationFrame(() => {
      byId("dashboard").scrollIntoView({ block: "start" });
    });
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
