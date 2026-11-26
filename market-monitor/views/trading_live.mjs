import { renderMonthlyProgress } from "../pace_display.mjs";
import {
  LIVE_CLIENT,
  TERM_DEFINITIONS,
  __set_tradingDayMode,
  __set_tradingReviewCadence,
  activeView,
  adaptTradingReviewModel,
  byId,
  displayCurrency,
  intentRiskMessage,
  learningMetrics,
  liveRuntime,
  manualRefreshLabel,
  monitorData,
  renderIntentIncome,
  resolveLiveCashflowDisplay,
  resolveLiveRealizedTradingDisplay,
  tradingDayMode,
  tradingLedgerRuntime,
  tradingReviewCadence,
  unlockKey,
} from "../lib/context.mjs";
import {
  append,
  el,
  section,
  term
} from "../lib/dom.mjs";
import {
  cny,
  isFiniteMetric,
  liveAge,
  liveSignal,
  liveTarget,
  liveTime,
  number,
  pct,
  portfolioGateInput,
  readPositiveLocalNumber,
  usd,
  usdExact
} from "../lib/format.mjs";
import {
  renderPersonal,
  renderPortfolioOverview
} from "./personal.mjs";
import {
  loadPrivateTradingLedger,
  requestManualRefresh,
  submitTradingOverride,
} from "../lib/live_channel.mjs";
import {
  cadenceLabel,
  livingExpenseCoverage,
  periodCashflowDisplay,
  renderTradingPerformance,
  renderTradingV2PrivateLedgerSection,
  tradingAction
} from "./trading.mjs";
import {
  renderTradingCashflowChart,
  renderTradingV2AttributionSection
} from "./trading_chart.mjs";
import {
  renderStrategy
} from "./strategy.mjs";

// @app-block-start b062
export function renderLiveOnly() {
  if (!monitorData || byId("dashboard").hidden) return;
  renderPortfolioOverview();
  if (activeView === "trading") {
    const dialog = byId("tr5-override-dialog");
    if (!dialog || !dialog.open) renderTrading();
    return;
  }
  const region = byId("trading-live-region");
  if (!region) return;
  region.replaceChildren(renderLiveTrading(monitorData.trading || {}));
  if (activeView === "personal") renderPersonal();
  if (activeView === "strategy") renderStrategy();
}
// @app-block-end b062

// @app-block-start b128
export function liveSourceRows(live) {
  const list = el("div", "live-source-list");
  const sources = Array.isArray(live?.sources) ? live.sources : [];
  if (!sources.length) {
    list.appendChild(el("div", "live-source-row missing", "券商来源状态缺失"));
    return list;
  }
  sources.forEach((source) => {
    const sourceStatus = String(source.status || "MISSING").toUpperCase();
    const row = el("div", `live-source-row ${sourceStatus === "OK" ? "ok" : "warning"}`);
    append(
      row,
      el("strong", "", source.broker || source.source || "未知来源"),
      el("span", "", liveSourceStatusLabel(sourceStatus)),
      el("small", "", source.notes || "只读成交与可取得费用"),
    );
    list.appendChild(row);
  });
  return list;
}
// @app-block-end b128

// @app-block-start b129
export function liveSourceStatusLabel(sourceStatus) {
  return sourceStatus === "EXPECTED_LAG" ? "日结待更新" : sourceStatus;
}
// @app-block-end b129

// @app-block-start b130
export function liveBrokerIndicator(source) {
  const broker = source?.broker || source?.source || "未知来源";
  const sourceStatus = String(source?.status || "MISSING").toUpperCase();
  const tone = sourceStatus === "OK"
    ? "ok"
    : sourceStatus === "FAILED"
      ? "failed"
      : sourceStatus === "PARTIAL" || sourceStatus === "STALE" || sourceStatus === "EXPECTED_LAG"
        ? "warning"
        : "missing";
  const statusLabel = liveSourceStatusLabel(sourceStatus);
  const indicator = el("span", `live-broker-indicator ${tone}`);
  indicator.setAttribute("aria-label", `${broker} ${statusLabel}`);
  indicator.title = `${broker} · ${statusLabel}`;
  append(
    indicator,
    el("span", "live-broker-dot", ""),
    el("strong", "", broker),
  );
  return indicator;
}
// @app-block-end b130

// @app-block-start b131
export function livePreferenceField({ id, label, value, placeholder, storageKey, suffix }) {
  const field = el("label", "live-preference-field");
  const labelNode = el("span", "", label);
  const control = el("div", "live-preference-control");
  const input = el("input", "");
  input.id = id;
  input.type = "number";
  input.min = "0";
  input.step = "100";
  input.inputMode = "decimal";
  input.value = value ?? "";
  input.placeholder = placeholder;
  input.addEventListener("change", () => {
    const numeric = Number(input.value);
    if (Number.isFinite(numeric) && numeric > 0) localStorage.setItem(storageKey, String(numeric));
    else localStorage.removeItem(storageKey);
    renderTrading();
  });
  append(control, input, el("span", "", suffix));
  append(field, labelNode, control);
  return field;
}
// @app-block-end b131

// @app-block-start b132
export function renderLiveTrading(trading) {
  if (!trading.intent_income) return renderLegacyLiveTrading(trading);
  const region = el("div", "intent-income-region");
  const report = renderIntentIncome(trading.intent_income);
  const refresh = el("button", "", "立即刷新");
  refresh.type = "button";
  refresh.addEventListener("click", () => requestManualRefresh());
  report.appendChild(refresh);
  const signal = intentRiskMessage(portfolioGateInput());
  const gate = el("div", `live-signal tone-${signal.tone}`);
  append(gate, el("strong", "", signal.headline), el("p", "", signal.message));
  const audit = el("details", "intent-legacy-audit");
  append(audit, el("summary", "", "旧账审计 · FIFO 与旧主动归因"), renderLegacyLiveTrading(trading));
  append(region, report, gate, audit);
  return region;
}
// @app-block-end b132

// @app-block-start b133
export function renderLegacyLiveTrading(trading) {
  const live = trading.live || null;
  const noActiveSession = live?.data_status === "NO_ACTIVE_SESSION";
  if (noActiveSession) {
    const gate = intentRiskMessage(portfolioGateInput());
    const stopped = gate.tone === "red";
    const sources = Array.isArray(live?.sources) ? live.sources : [];
    const sourceIssues = sources.length
      ? sources.filter((source) => String(source?.status || "MISSING").toUpperCase() !== "OK").length
      : 1;
    const card = el(
      "section",
      `live-trading-card live-trading-card-closed tone-${stopped ? "red" : sourceIssues ? "amber" : "green"}`,
    );
    const summary = el("div", "live-closed-summary");
    const copy = el("div", "live-closed-copy");
    append(
      copy,
      el("p", "eyebrow", "MARKET · CLOSED"),
      el("h2", "", "当前为非交易日"),
      el("p", "live-trading-window", "无当日交易窗口；盘中现金流、风控节奏与目标设置将在下一交易日自动恢复。"),
    );
    const health = el("div", "live-closed-health");
    const indicators = el("span", "live-status-indicators");
    if (sources.length) sources.forEach((source) => indicators.appendChild(liveBrokerIndicator(source)));
    else indicators.appendChild(liveBrokerIndicator(null));
    append(
      health,
      indicators,
      el(
        "span",
        `live-closed-meta ${sourceIssues ? "warning" : ""}`.trim(),
        sourceIssues
          ? `${sourceIssues} 个来源待核对 · 最近检查 ${liveTime(live?.checked_at)}`
          : `券商连接正常 · 最近检查 ${liveTime(live?.checked_at)}`,
      ),
    );
    if (stopped) append(copy, el("strong", "live-signal tone-red", gate.headline), el("p", "", gate.message));
    append(summary, copy, health);
    card.appendChild(summary);
    return card;
  }
  const target = liveTarget(trading);
  const signal = liveSignal(trading);
  const cashflowDisplay = resolveLiveCashflowDisplay(live);
  const cashflowValue = cashflowDisplay.value;
  const cashflowComplete = cashflowDisplay.complete;
  const cashflowScopeComplete = live?.active_scope_coverage_status === "COMPLETE";
  const realizedTrading = resolveLiveRealizedTradingDisplay(live);
  const realizedTradingValue = realizedTrading.net;
  const realizedTradingComplete = realizedTrading.complete;
  const executionFees = isFiniteMetric(live?.executed_order_fees)
    ? live.executed_order_fees
    : isFiniteMetric(live?.confirmed_executed_order_fees)
      ? live.confirmed_executed_order_fees
      : null;
  const executionFeesComplete = isFiniteMetric(live?.executed_order_fees);
  const card = el("section", `live-trading-card tone-${signal.tone}`);
  const head = el("div", "live-trading-head");
  const heading = el("div");
  append(
    heading,
    el("p", "eyebrow", "LIVE · 暂定（非结算值）"),
    el("h2", "", `${live?.monitoring_day || "本日"} 截至当前生活现金流与交易实绩`),
    el(
      "p",
      "live-trading-window",
      `${live?.window_label || "美东 [T-1 20:00, T 20:00)"} · 截至 ${liveTime(live?.checked_at)} · 20:00 后进入结算`,
    ),
  );
  const refresh = el(
    "button",
    "live-refresh-button",
    manualRefreshLabel(
      Date.now() < liveRuntime.cooldownUntil ? "cooldown" : liveRuntime.refreshState,
      (liveRuntime.cooldownUntil - Date.now()) / 1000,
    ),
  );
  refresh.type = "button";
  refresh.setAttribute("aria-live", "polite");
  refresh.disabled =
    !LIVE_CLIENT.challengeUrl ||
    !LIVE_CLIENT.refreshUrl ||
    live?.data_status === "NO_ACTIVE_SESSION" ||
    ["requesting", "accepted", "checking"].includes(liveRuntime.refreshState) ||
    Date.now() < liveRuntime.cooldownUntil;
  refresh.addEventListener("click", requestManualRefresh);
  append(head, heading, refresh);

  const primary = el("div", "live-primary");
  const primaryValue = el(
    "strong",
    isFiniteMetric(cashflowValue) && cashflowValue < 0 ? "negative" : isFiniteMetric(cashflowValue) && cashflowValue > 0 ? "positive" : "",
    usd(cashflowValue),
  );
  const primaryCopy = el("div");
  append(
    primaryCopy,
    term(
      cashflowDisplay.includesInterest
        ? cashflowComplete ? "截至当前生活开支净现金流" : "截至当前可确认生活开支净现金流"
        : "截至当前可确认现金流创造（利息待确认）",
      cashflowDisplay.includesInterest
        ? TERM_DEFINITIONS.livingExpenseCashflow
        : TERM_DEFINITIONS.generatedCashflow,
      "live-primary-label",
    ),
    el(
      "span",
      "",
      cashflowDisplay.includesInterest
        ? `${cashflowComplete ? "完整" : "可确认"}主动股票、期权、税后股息与已入账账户利息；手续费和税费已包含在交易净收益中`
        : "仅显示已实现且已归类的主动交易、期权与税后股息；融资/账户利息覆盖未确认",
    ),
  );
  append(primary, primaryCopy, primaryValue);

  const cashflowLayer = el("div", "live-cashflow-layer");
  const cashflowCopy = el("div");
  append(
    cashflowCopy,
    term(
      realizedTradingComplete ? "全部已实现交易净收益（审计）" : "可确认已实现交易净收益（审计）",
      TERM_DEFINITIONS.provisionalRealizedTradingPnl,
      "live-cashflow-label",
    ),
    el(
      "small",
      "",
      `${live?.realized_trading_cycle_count ?? "未知"} 个成本与费用可证明的 realized fragment；包含待归类及长期资产处置，仅供交易审计，不自动进入生活现金流${!cashflowScopeComplete ? `；其中 ${live?.unclassified_overnight_realization_count ?? "未知"} 个隔夜片段待归类` : ""}`,
    ),
    el(
      "small",
      "live-ledger-note",
      "账户 FIFO 审计与策略归因是同一窗口的不同账本视角，成本基础不同，不应直接相减或强制勾稽。",
    ),
  );
  append(
    cashflowLayer,
    cashflowCopy,
    el(
      "strong",
      isFiniteMetric(realizedTradingValue) && realizedTradingValue < 0 ? "negative" : isFiniteMetric(realizedTradingValue) && realizedTradingValue > 0 ? "positive" : "",
      usd(realizedTradingValue),
    ),
  );

  const details = el("div", "live-detail-grid");
  [
    ["股票因果同日策略净收益", live?.same_day_equity?.net_pnl, `${live?.same_day_equity?.closed_trades ?? "—"} 个 realization；普通买入仅由后续卖出实现，可跨券商按标准化标的归因`],
    ["已归类跨日残余净收益", live?.cashflow_active_residual_overnight_equity_net_pnl, "仅计入同日净额残余账中已归类为主动交易的完成片段"],
    ["期权净入账", live?.options?.net_pnl, `${live?.options?.closed_trades ?? "—"} 个已实现片段`],
    ["待归类隔夜已实现", live?.unclassified_overnight_net_pnl, `${live?.unclassified_overnight_realization_count ?? "—"} 个片段；不进入生活现金流`],
    ["长期资产处置已实现", live?.long_term_realization_net_pnl, `${live?.long_term_realization_count ?? "—"} 个片段；不进入生活现金流`],
    ["税后已入账股息", live?.cashflow_dividend, "不含应收或未入账股息"],
    [
      live?.interest_coverage_status === "COMPLETE" ? "已入账融资 / 账户利息" : "融资 / 账户利息待确认",
      live?.interest_coverage_status === "COMPLETE" ? live?.account_interest_cashflow : null,
      "仅统计当前监控窗口已入账流水；未入账、应计或覆盖不完整不按零处理",
    ],
    [
      executionFeesComplete ? "已成交订单手续费 / 税费" : "可确认已成交订单手续费 / 税费",
      executionFees === null ? null : -Math.abs(executionFees),
      `${live?.executed_order_fill_count ?? "—"} 笔成交；包含尚未形成已实现收益的开仓费用，不会重复扣入上方净收益`,
      "不可得",
    ],
    [
      realizedTradingComplete ? "已实现片段分摊费用" : "可确认已实现片段分摊费用",
      realizedTrading.fees === null ? null : -Math.abs(realizedTrading.fees),
      "按已实现数量分摊开仓与平仓的可取得佣金、平台费及交易相关税费；已包含在上方交易净收益",
      "不可得",
    ],
  ].forEach(([label, value, note, unknownText]) => {
    const item = el("div", "live-detail-item");
    append(
      item,
      el("span", "", label),
      el(
        "strong",
        isFiniteMetric(value) && value < 0 ? "negative" : isFiniteMetric(value) && value > 0 ? "positive" : "",
        value === null && unknownText ? unknownText : usd(value),
      ),
      el("small", "", note),
    );
    details.appendChild(item);
  });

  const signalBlock = el("div", `live-signal tone-${signal.tone}`);
  append(
    signalBlock,
    el("strong", "", signal.headline),
    el("p", "", signal.message),
  );

  const facts = el("div", "live-fact-grid");
  const factRows = [
    ["券商检查时间", liveTime(live?.checked_at)],
    ["数据年龄", liveAge(signal.ageMs)],
    ["下次页面检查", liveRuntime.nextCheckAt ? liveTime(liveRuntime.nextCheckAt) : "页面可见时每 60 秒"],
    ["开放风险", live?.open_exposure_status === "KNOWN" ? "已取得" : "未知 · 不含未实现盈亏和挂单"],
    [
      "Realized 覆盖",
      live?.realized_coverage_status === "COMPLETE"
        ? "完整"
        : (live?.excluded_instruments || []).length
          ? `部分 · 排除 ${(live.excluded_instruments || []).length} 个成本不可证明标的`
          : "部分 · 排除标的数未知",
    ],
    [
      "隔夜归类",
      cashflowScopeComplete
        ? "完整"
        : `待归类 ${live?.unclassified_overnight_realization_count ?? "未知"} 笔；长期资产处置不计入`,
    ],
  ];
  factRows.forEach(([label, value]) => {
    const row = el("div", "live-fact-row");
    append(row, el("span", "", label), el("strong", "", value));
    facts.appendChild(row);
  });

  const statusDetails = el("div", "live-status-disclosure");
  const statusSummary = el("button", "live-status-summary");
  statusSummary.type = "button";
  statusSummary.setAttribute("aria-expanded", "false");
  statusSummary.setAttribute("aria-controls", "live-status-detail-body");
  const toggleStatusDetails = () => {
    const isOpen = statusDetails.classList.toggle("is-open");
    statusSummary.setAttribute("aria-expanded", String(isOpen));
    statusBody.hidden = !isOpen;
  };
  statusSummary.addEventListener("click", (event) => {
    event.preventDefault();
    toggleStatusDetails();
  });
  statusSummary.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleStatusDetails();
  });
  const statusIndicators = el("span", "live-status-indicators");
  if (Array.isArray(live?.sources) && live.sources.length) {
    live.sources.forEach((source) => statusIndicators.appendChild(liveBrokerIndicator(source)));
  } else {
    statusIndicators.appendChild(liveBrokerIndicator(null));
  }
  const sourceIssues = Array.isArray(live?.sources) && live.sources.length
    ? live.sources.filter((source) => String(source?.status || "MISSING").toUpperCase() !== "OK").length
    : 1;
  const diagnosticIssues = sourceIssues
    + (live?.realized_coverage_status === "COMPLETE" ? 0 : 1)
    + (live?.open_exposure_status === "KNOWN" ? 0 : 1)
    + (Number.isFinite(signal.ageMs) ? 0 : 1);
  const statusMeta = diagnosticIssues
    ? `${diagnosticIssues} 项待核对 · ${liveAge(signal.ageMs)}`
    : `覆盖完整 · ${liveAge(signal.ageMs)}`;
  append(
    statusSummary,
    statusIndicators,
    el("span", `live-status-meta ${diagnosticIssues ? "warning" : ""}`.trim(), statusMeta),
    el("span", "live-status-action", "详情"),
  );

  const targetPanel = el("div", "live-target-panel");
  const [targetHead, formula, targetNote] = renderMonthlyProgress(
    target, live?.calendar?.status, {el, append, cny},
  );
  const scopeNote = el(
    "p",
    "live-target-scope",
    "达标口径：月目标进度只计入本月已结算与当日已实现的主动交易净收益；不含未实现盈亏、开放仓位、待归类与长期资产处置。",
  );
  const preferences = el("div", "live-preferences");
  append(
    preferences,
    livePreferenceField({
      id: "monthly-target-cny",
      label: "月生活现金流目标",
      value: readPositiveLocalNumber("zzao-monitor-monthly-target-cny") ?? target.monthlyTargetCny,
      placeholder: "40000",
      storageKey: "zzao-monitor-monthly-target-cny",
      suffix: "CNY",
    }),
    livePreferenceField({
      id: "maximum-loss-cny",
      label: "当日最大亏损（可选）",
      value: readPositiveLocalNumber("zzao-monitor-maximum-loss-cny"),
      placeholder: "未设置",
      storageKey: "zzao-monitor-maximum-loss-cny",
      suffix: "CNY",
    }),
  );
  append(targetPanel, targetHead, formula, scopeNote, targetNote, preferences);

  const statusLine = el("p", "live-transport-status");
  const pollCopy = liveRuntime.pollState === "checking"
    ? "正在检查服务器上的最新加密快照。"
    : liveRuntime.error || "自动检查只更新进行中数据；历史结算结果保持不变。";
  statusLine.textContent = pollCopy;
  const statusBody = el("div", "live-status-body");
  statusBody.id = "live-status-detail-body";
  statusBody.hidden = true;
  append(statusBody, facts, liveSourceRows(live), statusLine);
  append(statusDetails, statusSummary, statusBody);
  append(card, head, primary, cashflowLayer, details, signalBlock, statusDetails, targetPanel);
  return card;
}
// @app-block-end b133

// @app-block-start b134
export function renderTrading() {
  const root = byId("trading-content");
  if (!root) return;
  root.replaceChildren();
  const trading = monitorData?.trading || {};
  const meta = monitorData?.meta || {};
  const targetOverride = readPositiveLocalNumber("zzao-monitor-monthly-target-cny");
  const model = adaptTradingReviewModel({
    trading,
    meta,
    cadence: tradingReviewCadence,
    dayMode: tradingDayMode,
    usdCnyRate: meta.usd_cny_rate ?? trading.cashflow_ledger_v2?.fx?.usd_cny_rate ?? null,
    targetOverrideCny: targetOverride,
  });

  const toneFor = (value) => (isFiniteMetric(value) ? (Number(value) > 0 ? "positive" : Number(value) < 0 ? "negative" : "") : "");
  const cnySubtle = (usdValue) => {
    if (!isFiniteMetric(usdValue) || !isFiniteMetric(model.fxRate) || model.fxRate <= 0) return "";
    return displayCurrency === "CNY" ? `原币 ${usdExact(usdValue)}` : `约合 ${cny(usdValue * model.fxRate)}`;
  };
  const covLabel = (status) =>
    status === "COMPLETE" ? "数据完整" : status === "PARTIAL" ? "部分待补齐" : "统计缺失";
  const covClass = (status) =>
    status === "COMPLETE" ? "ok" : status === "PARTIAL" ? "warning" : "missing";

  // Layer 1: Control header, 4-cadence selector, intraday/settled toggle, honest health bar
  const shell = el("div", "tr5-shell");
  const header = el("section", "tr5-controls-header");
  const tabList = el("div", "tr5-cadence-tabs");
  tabList.setAttribute("role", "tablist");
  tabList.setAttribute("aria-label", "交易复盘时间维度");
  [
    ["day", "当日"],
    ["week", "本周"],
    ["month", "本月"],
    ["year", "本年"],
  ].forEach(([cadenceKey, label]) => {
    const tab = el("button", "tr5-tab", label);
    tab.type = "button";
    tab.setAttribute("role", "tab");
    tab.dataset.cadence = cadenceKey;
    const selected = model.cadence === cadenceKey;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    tab.addEventListener("click", () => {
      if (tradingReviewCadence === cadenceKey) return;
      __set_tradingReviewCadence(cadenceKey);
      localStorage.setItem("zzao-monitor-trading-cadence", cadenceKey);
      if (unlockKey && LIVE_CLIENT.tradingLedgerUrl) {
        void loadPrivateTradingLedger({ period: cadenceKey, force: true });
      }
      renderTrading();
    });
    tabList.appendChild(tab);
  });

  const cadenceOrder = ["day", "week", "month", "year"];
  tabList.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const idx = cadenceOrder.indexOf(model.cadence);
    if (idx < 0) return;
    event.preventDefault();
    const nextCadence = cadenceOrder[(idx + (event.key === "ArrowRight" ? 1 : -1) + cadenceOrder.length) % cadenceOrder.length];
    __set_tradingReviewCadence(nextCadence);
    localStorage.setItem("zzao-monitor-trading-cadence", nextCadence);
    if (unlockKey && LIVE_CLIENT.tradingLedgerUrl) void loadPrivateTradingLedger({ period: nextCadence, force: true });
    renderTrading();
    byId("trading-content")?.querySelector?.(`.tr5-tab[data-cadence="${nextCadence}"]`)?.focus?.();
  });

  const leftControls = el("div", "tr5-controls-left");
  leftControls.appendChild(tabList);

  if (model.cadence === "day") {
    const daySwitch = el("div", "tr5-day-mode-toggle");
    daySwitch.setAttribute("role", "group");
    daySwitch.setAttribute("aria-label", "当日统计模式");
    [
      ["live", "盘中实时（未结算）"],
      ["settled", "已结算日结"],
    ].forEach(([modeKey, modeLabel]) => {
      const btn = el("button", "tr5-mode-btn", modeLabel);
      btn.type = "button";
      btn.dataset.dayMode = modeKey;
      btn.setAttribute("aria-pressed", String(model.dayMode === modeKey));
      if (modeKey === "live" && !model.hasIntradayLive) {
        btn.title = "当前非盘中或暂无实时快照，将显示最近完整统计";
      }
      btn.addEventListener("click", () => {
        if (tradingDayMode === modeKey) return;
        __set_tradingDayMode(modeKey);
        localStorage.setItem("zzao-monitor-trading-day-mode", modeKey);
        renderTrading();
      });
      daySwitch.appendChild(btn);
    });
    leftControls.appendChild(daySwitch);
  }

  const rightControls = el("div", "tr5-controls-right");
  const indicators = el("span", "live-status-indicators");
  if (model.sources.length) {
    model.sources.forEach((src) => indicators.appendChild(liveBrokerIndicator(src)));
  } else {
    indicators.appendChild(liveBrokerIndicator(null));
  }
  const covBadge = el("span", `tr5-health-badge ${covClass(model.coverageStatus)}`, covLabel(model.coverageStatus));
  const fxBadgeText = model.fxRate
    ? `汇率 ${number(model.fxRate, 4)}${model.fxStale ? " · 滞后" : ""}`
    : "汇率缺失";
  const fxBadge = el("span", `tr5-health-badge ${model.fxStale ? "warning" : "ok"}`, fxBadgeText);
  const refreshBtn = el(
    "button",
    "live-refresh-button tr5-refresh-btn",
    manualRefreshLabel(
      Date.now() < liveRuntime.cooldownUntil ? "cooldown" : liveRuntime.refreshState,
      (liveRuntime.cooldownUntil - Date.now()) / 1000,
    ),
  );
  refreshBtn.type = "button";
  refreshBtn.disabled =
    !LIVE_CLIENT.challengeUrl ||
    !LIVE_CLIENT.refreshUrl ||
    ["requesting", "accepted", "checking"].includes(liveRuntime.refreshState) ||
    Date.now() < liveRuntime.cooldownUntil;
  refreshBtn.addEventListener("click", requestManualRefresh);
  append(rightControls, indicators, covBadge, fxBadge, refreshBtn);

  const windowCaption = el(
    "p",
    "tr5-window-meta",
    `${model.isIntradayLive ? "盘中统计日" : "统计区间"}：${model.startDate && model.endDate ? `${model.startDate} — ${model.endDate}` : model.monitoringDay || model.settledThrough || "等待同步"} · 已结算至 ${model.settledThrough || "—"} ET`,
  );
  const controlsTop = el("div", "tr5-controls-top");
  append(controlsTop, leftControls, rightControls);
  append(header, controlsTop, windowCaption);
  shell.appendChild(header);

  if (model.healthReasons.length > 0) {
    const banner = el("div", "tr5-health-banner");
    append(
      banner,
      el("strong", "", "口径与覆盖提示"),
      el("span", "", model.healthReasons.join(" · ")),
    );
    shell.appendChild(banner);
  }

  // Layer 2: 3 Hero Conclusion Cards
  const heroGrid = el("section", "tr5-hero-grid");
  const { hero } = model;

  const incomeCard = el("article", "tr5-hero-card");
  append(
    incomeCard,
    el("p", "tr5-card-eyebrow", model.isIntradayLive ? "实时现金收益（未结算）" : "净已实现现金收益"),
    el("strong", `tr5-hero-value ${toneFor(hero.netRealizedCashIncomeUsd)}`.trim(), usd(hero.netRealizedCashIncomeUsd)),
    el("span", "tr5-hero-subvalue", cnySubtle(hero.netRealizedCashIncomeUsd) || covLabel(model.coverageStatus)),
    el("p", "tr5-card-note", "汇总短线波段、期权、长线减持净盈亏及股息利息；不含长线底仓本金回笼，个人预扣税已计券商实扣。"),
  );

  const freeCard = el("article", "tr5-hero-card");
  const ws = hero.withdrawalSafety;
  const safetyBox = el("div", `tr5-safety-box ${ws.marginDeficitAlert ? "alert" : ""}`.trim());
  if (ws.marginDeficitAlert) {
    safetyBox.appendChild(el("strong", "tr5-safety-alert", "融资缺口警示：请保留足额保证金，暂缓全额提现"));
  }
  append(
    safetyBox,
    el("span", "", `可用美元现金 ${ws.available ? usd(ws.totalUsdCash) : "待同步"}`),
    el("span", "", `T+1 未交收 ${ws.available ? usd(ws.tPlus1UnsettledUsd) : "待同步"}`),
    el("strong", "", `可安全提现 ${ws.available ? usd(ws.settledWithdrawableUsd) : "待同步"}`),
  );
  append(
    freeCard,
    el("p", "tr5-card-eyebrow", "自由现金流入与提现安全"),
    el("strong", `tr5-hero-value ${toneFor(hero.freeCashInflowUsd)}`.trim(), usd(hero.freeCashInflowUsd)),
    el(
      "span",
      "tr5-hero-subvalue",
      hero.releasedPrincipalUsd !== null
        ? `含释放底仓本金 ${usd(hero.releasedPrincipalUsd)}`
        : cnySubtle(hero.freeCashInflowUsd) || "本金回笼拆分待补齐",
    ),
    safetyBox,
  );

  const targetCard = el("article", "tr5-hero-card");
  const mt = hero.monthlyTarget;
  const clampedPct = isFiniteMetric(mt.coverageRatio) ? Math.min(Math.max(mt.coverageRatio * 100, 0), 100) : 0;
  const progressBar = el("div", "tr5-progress-track");
  const progressFill = el("div", "tr5-progress-fill");
  progressFill.style.width = `${clampedPct.toFixed(1)}%`;
  progressBar.appendChild(progressFill);
  const targetInputWrap = el("label", "tr5-target-inline");
  const targetInput = document.createElement("input");
  targetInput.id = "tr5-monthly-target-cny";
  targetInput.type = "number";
  targetInput.min = "100";
  targetInput.step = "500";
  targetInput.inputMode = "decimal";
  targetInput.value = String(mt.targetCny);
  targetInput.addEventListener("change", () => {
    const val = Number(targetInput.value);
    if (Number.isFinite(val) && val > 0) localStorage.setItem("zzao-monitor-monthly-target-cny", String(val));
    else localStorage.removeItem("zzao-monitor-monthly-target-cny");
    renderTrading();
  });
  append(targetInputWrap, el("span", "", "月度生活开支目标 ¥"), targetInput);
  append(
    targetCard,
    el("p", "tr5-card-eyebrow", mt.referenceLabel),
    el("strong", `tr5-hero-value ${mt.coverageRatio >= 1 ? "positive" : ""}`.trim(), mt.coverageRatio !== null ? pct(mt.coverageRatio) : "进度待同步"),
    el("span", "tr5-hero-subvalue", `目标 ${cny(mt.targetCny)} · 已覆盖 ${cny(mt.coveredCny)} · 还差 ${cny(mt.gapCny)}`),
    progressBar,
    targetInputWrap,
  );

  append(heroGrid, incomeCard, freeCard, targetCard);
  shell.appendChild(heroGrid);

  // Layer 3 & Layer 4: Modular attribution + unlocked private ledger
  shell.appendChild(renderTradingV2AttributionSection({ model, toneFor }));
  shell.appendChild(renderTradingV2PrivateLedgerSection({ model, toneFor, onSubmitted: renderTrading }));
  root.appendChild(shell);
}

// Retained legacy contract helper so backward-compatible display-contract invariants remain testable.
function renderLegacyTradingBannerContract(trading, focus, summary, historyRoot) {
  const display = periodCashflowDisplay(trading, focus);
  const generated = display.value;
  const living = display.livingValue;
  const generatedLabel = display.generatedComplete ? "现金流创造" : "可确认现金流创造";
  const livingLabel = display.livingComplete ? "生活开支净现金流" : "可确认生活开支净现金流";
  const coverage = livingExpenseCoverage(focus, trading, display);
  const learning = section("当日日内股票复盘", "仅使用实时快照中的当日日内股票已平仓样本；样本不足时保持未知，不因目标落后抬高当天交易目标。");
  const values = learningMetrics(trading.live?.same_day_equity || {});
  learning.appendChild(el("p", "section-note", `盈亏比 ${number(values.payoff_ratio,2)} · 每笔期望 ${usd(values.expectancy_usd)} · 手续费/毛利 ${pct(values.fee_to_gross_profit)}`));
  historyRoot.appendChild(learning);
  return {
    generated,
    living,
    generatedLabel,
    livingLabel,
    coverage,
    action: tradingAction(focus, summary, display),
  };
}
// @app-block-end b134
