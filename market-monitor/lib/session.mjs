import {
  LIVE_CLIENT,
  VIEW_META,
  __set_activeView,
  __set_displayCurrency,
  __set_holdingsRequestGeneration,
  __set_monitorData,
  __set_portfolioCurrentSummary,
  __set_portfolioHistoryHealth,
  __set_portfolioOverviewSummary,
  __set_portfolioReturnReferenceSummary,
  __set_portfolioReturnWeightSummary,
  __set_strategyFreshnessBadgesHost,
  __set_strategyFreshnessRenderedKey,
  __set_strategyTrendCopyHost,
  __set_tradingLedgerRequestGeneration,
  __set_unlockKey,
  __set_unlockPersistenceRecord,
  __set_unlockPersistenceWarning,
  activeView,
  byId,
  currentPortfolioDisplaySummary,
  currentPortfolioReturnReferenceSummary,
  dashboardStatusForView,
  displayCurrency,
  holdingsRequestGeneration,
  holdingsRuntime,
  liveRuntime,
  monitorData,
  payloadUrl,
  portfolioCurrentSummary,
  portfolioHistoryHealth,
  portfolioOverviewSummary,
  portfolioReturnReferenceSummary,
  portfolioReturnWeightSummary,
  strategyFreshnessBadgesHost,
  strategyFreshnessRenderedKey,
  strategyTrendCopyHost,
  tradingLedgerRequestGeneration,
  tradingLedgerRuntime,
  tradingReviewCadence,
  unlockKey,
  unlockPersistence,
  unlockPersistenceRecord,
  unlockPersistenceWarning,
  updateLastConfirmedPortfolioOverview
} from "./context.mjs";
import {
  el
} from "./dom.mjs";
import {
  fetchEncryptedPayload,
  renderUnlockPersistenceStatus
} from "./unlock.mjs";
import {
  number
} from "./format.mjs";
import {
  loadPrivateTradingLedger
} from "./live_channel.mjs";
import {
  resolvePortfolioFreshness,
  validDailyReturnHistoryHealth
} from "./freshness.mjs";
import {
  renderPersonal,
  renderPortfolioOverview
} from "../views/personal.mjs";
import {
  loadPrivateHoldings,
  renderHoldingsSourceAlert,
  renderNavigationAlerts,
  resetHoldingsFilters,
  scheduleLivePolling,
  stopLivePolling
} from "./live_channel.mjs";
import {
  renderTrading
} from "../views/trading_live.mjs";
import {
  renderMacro
} from "../views/macro.mjs";
import {
  renderHoldings
} from "../views/holdings.mjs";
import {
  stopStrategyFreshnessTimer,
  strategyFreshnessDisplayStatus,
  syncStrategyFreshnessTimer
} from "./strategy_freshness.mjs";
import {
  renderStrategy
} from "../views/strategy.mjs";

// @app-block-start b181
export function setDrawerOpen(open) {
  const dashboard = byId("dashboard");
  dashboard.classList.toggle("drawer-open", open);
  byId("drawer-backdrop").hidden = !open;
  byId("mobile-menu-button").setAttribute("aria-expanded", String(open));
}
// @app-block-end b181

// @app-block-start b182
export function renderSnapshotStatus() {
  if (!monitorData) return;
  renderNavigationAlerts();
  const resolved = dashboardStatusForView(
    activeView,
    monitorData.meta?.status,
    holdingsRuntime.state,
    holdingsRuntime.data,
    activeView === "personal" ? resolvePortfolioFreshness(monitorData.personal?.summary).reason
      : activeView === "strategy" ? strategyFreshnessDisplayStatus(monitorData.strategy?.return_freshness) || "MISSING"
      : activeView === "trading" ? monitorData.trading?.live?.data_status || "MISSING" : null,
  );
  const status = byId("snapshot-status");
  if (activeView === "trading") {
    const ledgerV2 = monitorData.trading?.cashflow_ledger_v2;
    const fxStatus = String(
      ledgerV2?.fx?.usd_cny_status || monitorData.meta?.usd_cny_status || "MISSING",
    ).toUpperCase();
    const fxStale = Boolean(
      monitorData.meta?.fx_stale ||
        ledgerV2?.fx?.fx_stale ||
        fxStatus === "STALE" ||
        fxStatus === "MISSING" ||
        fxStatus === "FAILED",
    );
    const v2Coverage = String(ledgerV2?.coverage_status || "").toUpperCase();
    const hasBrokerIssue = (monitorData.trading?.sources || []).some(
      (source) => String(source?.status || "MISSING").toUpperCase() !== "OK",
    );
    if (fxStale) {
      status.textContent = fxStatus === "MISSING" ? "降级 · 汇率状态缺失" : "降级 · 外汇汇率滞后";
      status.className = "status-pill warning";
      return;
    }
    if (v2Coverage && v2Coverage !== "COMPLETE") {
      status.textContent = v2Coverage === "MISSING" ? "缺失 · 交易统计不完整" : "部分 · 待补齐对账";
      status.className = `status-pill ${v2Coverage === "MISSING" ? "bad" : "warning"}`;
      return;
    }
    if (hasBrokerIssue) {
      status.textContent = "部分 · 券商待核对";
      status.className = "status-pill warning";
      return;
    }
  }
  status.textContent = resolved.text;
  status.className = `status-pill ${resolved.tone}`;
}
// @app-block-end b182

// @app-block-start b183
export function switchView(view) {
  if (!VIEW_META[view]) view = "personal";
  if (activeView !== view) resetHoldingsFilters();
  __set_activeView(view);
  localStorage.setItem("zzao-monitor-view", view);
  const dashboard = byId("dashboard");
  dashboard.dataset.activeView = view;
  byId("portfolio-overview").hidden = view !== "personal";
  if (byId("risk-cockpit")) byId("risk-cockpit").hidden = view !== "personal";
  Object.keys(VIEW_META).forEach((key) => {
    byId(`panel-${key}`).hidden = key !== view;
    byId(`nav-${key}`).setAttribute("aria-current", key === view ? "page" : "false");
  });
  const meta = VIEW_META[view];
  byId("page-eyebrow").textContent = meta.eyebrow;
  byId("page-title").textContent = meta.title;
  byId("page-subtitle").textContent = meta.subtitle;
  renderSnapshotStatus();
  const chartTooltip = byId("trading-chart-tooltip");
  if (chartTooltip) chartTooltip.hidden = true;
  setDrawerOpen(false);
  window.scrollTo({
    top: 0,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
  });
  if (view === "trading" && unlockKey && typeof tradingLedgerRuntime !== "undefined" && tradingLedgerRuntime.state === "idle") {
    const initialPeriod = typeof tradingReviewCadence !== "undefined" ? tradingReviewCadence : tradingLedgerRuntime.period;
    void loadPrivateTradingLedger({ period: initialPeriod || "month" });
  }
  if (view === "holdings" && unlockKey && holdingsRuntime.state !== "loading") {
    void loadPrivateHoldings();
  }
  // Strategy freshness rechecks live only while the strategy view is the
  // active one; every other view cancels the bounded interval.
  syncStrategyFreshnessTimer();
}
// @app-block-end b183

// @app-block-start b184
export function renderCurrencyControl() {
  const rate = Number(monitorData?.meta?.usd_cny_rate);
  const cnyAvailable = Number.isFinite(rate) && rate > 0;
  if (!cnyAvailable && displayCurrency === "CNY") __set_displayCurrency("USD");
  document.querySelectorAll(".currency-option").forEach((button) => {
    const selected = button.dataset.currency === displayCurrency;
    button.setAttribute("aria-pressed", String(selected));
    if (button.dataset.currency === "CNY") {
      button.disabled = !cnyAvailable;
      button.title = cnyAvailable
        ? `按 FRED DEXCHUS ${monitorData.meta.usd_cny_as_of || "最新"} 汇率换算`
        : "汇率数据暂不可用";
    }
  });
}
// @app-block-end b184

// @app-block-start b185
export function setCurrency(currency) {
  if (!['USD', 'CNY'].includes(currency)) return;
  if (currency === "CNY" && !Number(monitorData?.meta?.usd_cny_rate)) return;
  __set_displayCurrency(currency);
  localStorage.setItem("zzao-monitor-currency", currency);
  renderCurrencyControl();
  renderPortfolioOverview();
  renderPersonal();
  renderHoldings();
  renderMacro();
  renderTrading();
  renderStrategy();
}
// @app-block-end b185

// @app-block-start b186
export function applyThemePreference(preference) {
  const allowed = ["system", "light", "dark"];
  const selected = allowed.includes(preference) ? preference : "system";
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const actual = selected === "system" ? (systemDark ? "dark" : "light") : selected;
  document.documentElement.dataset.theme = actual;
  document.documentElement.dataset.themePreference = selected;
  localStorage.setItem("zzao-monitor-theme", selected);
  const labels = { system: "跟随系统", light: "浅色模式", dark: "深色模式" };
  const icons = { system: "◐", light: "☼", dark: "☾" };
  byId("theme-label").textContent = labels[selected];
  byId("theme-icon").textContent = icons[selected];
  byId("theme-button").title = `当前：${labels[selected]}；点击切换`;
}
// @app-block-end b186

// @app-block-start b187
export function readStoredThemePreference() {
  try {
    const stored = localStorage.getItem("zzao-monitor-theme");
    return ["system", "light", "dark"].includes(stored) ? stored : "";
  } catch (error) {
    return "";
  }
}
// @app-block-end b187

// @app-block-start b188
export function cycleTheme() {
  const current = document.documentElement.dataset.themePreference || "system";
  const order = ["system", "light", "dark"];
  applyThemePreference(order[(order.indexOf(current) + 1) % order.length]);
}
// @app-block-end b188

// @app-block-start b189
export function renderDashboard() {
  const { meta } = monitorData;
  byId("asof-line").replaceChildren(
    el("span", "", `市场截至 ${meta.market_as_of || "—"} ET`),
    el("span", "", `持仓读取 ${meta.portfolio_retrieved_at || "—"}`),
    el("span", "", meta.session_boundary),
    el(
      "span",
      "fx-line",
      meta.usd_cny_rate
        ? `展示汇率 1 USD = ${number(meta.usd_cny_rate, 4)} CNY · FRED ${meta.usd_cny_as_of || "—"}`
        : "CNY 展示汇率暂不可用",
    ),
  );
  renderSnapshotStatus();
  byId("personal-tab-alert").textContent = monitorData.personal.alerts.length
    ? `· ${monitorData.personal.alerts.length}`
    : "";
  byId("macro-tab-alert").textContent = monitorData.macro.alerts.length
    ? `· ${monitorData.macro.alerts.length}`
    : "";
  const failedBrokerSources = (monitorData.trading?.sources || []).filter(
    (source) => source.status !== "OK",
  ).length;
  byId("trading-source-alert").textContent = failedBrokerSources
    ? `· ${failedBrokerSources}`
    : "";
  byId("strategy-source-alert").textContent = monitorData.strategy?.status === "COMPLETE"
    ? ""
    : "· !";
  renderHoldingsSourceAlert();
  renderCurrencyControl();
  renderPortfolioOverview();
  renderPersonal();
  renderHoldings();
  renderMacro();
  renderTrading();
  renderStrategy();
  switchView(activeView);
}
// @app-block-end b189

// @app-block-start b190
export function activateDashboard(unlocked, { persistenceRecord = null, persistenceWarning = "" } = {}) {
  __set_monitorData(unlocked.data);
  __set_portfolioCurrentSummary(currentPortfolioDisplaySummary(
    monitorData.personal?.summary,
  ));
  __set_portfolioReturnWeightSummary(updateLastConfirmedPortfolioOverview(
    null,
    monitorData.personal?.summary?.last_confirmed_overview,
  ));
  __set_portfolioOverviewSummary(updateLastConfirmedPortfolioOverview(
    null,
    monitorData.personal?.summary?.last_confirmed_overview,
  ));
  __set_portfolioReturnReferenceSummary(currentPortfolioReturnReferenceSummary(
    monitorData.personal?.summary,
  ));
  // CR-20261029-01: static pages channel delivers the DTO on the risk-gate
  // summary (personal.summary.daily_return_history_health once the transport
  // allowlist ships it); absent/invalid stays null and renders 无法确认.
  __set_portfolioHistoryHealth(validDailyReturnHistoryHealth(
    monitorData.personal?.summary?.daily_return_history_health,
  ));
  __set_unlockKey(unlocked.key);
  __set_unlockPersistenceRecord(persistenceRecord);
  __set_unlockPersistenceWarning(persistenceWarning);
  renderDashboard();
  renderUnlockPersistenceStatus();
  void loadPrivateHoldings();
  byId("unlock-view").hidden = true;
  byId("dashboard").hidden = false;
  scheduleLivePolling(0);
  requestAnimationFrame(() => {
    byId("dashboard").scrollIntoView({ block: "start" });
  });
}
// @app-block-end b190

// @app-block-start b191
export function clearUnlockedDashboard() {
  resetHoldingsFilters();
  stopLivePolling();
  stopStrategyFreshnessTimer();
  __set_strategyFreshnessBadgesHost(null);
  __set_strategyTrendCopyHost(null);
  __set_strategyFreshnessRenderedKey("");
  __set_holdingsRequestGeneration(holdingsRequestGeneration + (1));
  if (typeof tradingLedgerRequestGeneration !== "undefined" && typeof __set_tradingLedgerRequestGeneration === "function") {
    __set_tradingLedgerRequestGeneration(tradingLedgerRequestGeneration + (1));
  }
  __set_unlockKey(null);
  __set_unlockPersistenceRecord(null);
  __set_unlockPersistenceWarning("");
  holdingsRuntime.state = LIVE_CLIENT.holdingsUrl ? "idle" : "disabled";
  holdingsRuntime.data = null;
  holdingsRuntime.error = "";
  if (typeof tradingLedgerRuntime !== "undefined" && tradingLedgerRuntime) {
    tradingLedgerRuntime.state = LIVE_CLIENT.tradingLedgerUrl ? "idle" : "disabled";
    tradingLedgerRuntime.data = null;
    tradingLedgerRuntime.error = "";
    tradingLedgerRuntime.overrideState = "idle";
    tradingLedgerRuntime.overrideMessage = "";
  }
  const overrideDialog = byId("tr5-override-dialog");
  if (overrideDialog) {
    if (typeof overrideDialog.close === "function" && overrideDialog.open) overrideDialog.close();
    overrideDialog.remove();
  }
  __set_monitorData(null);
  __set_portfolioCurrentSummary(null);
  __set_portfolioOverviewSummary(null);
  __set_portfolioReturnReferenceSummary(null);
  __set_portfolioReturnWeightSummary(null);
  __set_portfolioHistoryHealth(null);
  liveRuntime.transportStatus = LIVE_CLIENT.payloadUrl ? "EXPECTED_LAG" : "MISSING";
  liveRuntime.pollState = LIVE_CLIENT.payloadUrl ? "idle" : "disabled";
  liveRuntime.refreshState = LIVE_CLIENT.refreshUrl ? "idle" : "disabled";
  liveRuntime.error = "";
  liveRuntime.cooldownUntil = 0;
  liveRuntime.pendingRefresh = null;
  byId("personal-content").replaceChildren();
  byId("macro-content").replaceChildren();
  byId("trading-content").replaceChildren();
  byId("strategy-content").replaceChildren();
  byId("holdings-content").replaceChildren();
  for (const id of ["trading-chart-tooltip", "portfolio-overview", "risk-cockpit"]) {
    const host = byId(id);
    if (host) { host.replaceChildren(); host.hidden = true; }
  }
  const rememberDevice = byId("remember-device");
  if (rememberDevice) rememberDevice.checked = false;
  byId("dashboard").hidden = true;
  byId("unlock-view").hidden = false;
}
// @app-block-end b191

// @app-block-start b192
export async function restorePersistedUnlock() {
  const button = byId("unlock-button");
  const passwordInput = byId("password");
  const storageNote = byId("unlock-storage-note");
  button.disabled = true;
  passwordInput.disabled = true;
  button.textContent = "正在恢复…";
  storageNote.textContent = "正在检查本设备的安全解锁记录…";
  let record = null;
  try {
    record = await unlockPersistence.restore();
    if (!record) {
      storageNote.textContent = "";
      return;
    }
    const data = await fetchEncryptedPayload(payloadUrl, record.key);
    storageNote.textContent = "";
    activateDashboard(
      { data, key: record.key },
      { persistenceRecord: record },
    );
  } catch (restoreError) {
    if (record && restoreError?.code === "UNLOCK_KEY_REJECTED") {
      try {
        await unlockPersistence.discard(record);
        storageNote.textContent = "已保存的解锁记录失效，请重新输入密码。";
      } catch {
        try {
          const lockResult = await unlockPersistence.lockCurrentSession();
          storageNote.textContent = lockResult.trustedCleared
            ? "已保存的解锁记录失效；因浏览器无法保存会话锁，已清除本设备信任。"
            : "已保存的解锁记录失效且暂时无法删除；当前浏览会话已停止自动恢复。";
        } catch {
          storageNote.textContent =
            "已保存的解锁记录失效，但浏览器无法删除记录或保存锁定状态；刷新仍可能再次尝试恢复。请清除本站点数据。";
        }
      }
    } else if (record) {
      storageNote.textContent = "加密数据暂时无法读取；安全解锁记录已保留，刷新即可重试。";
    } else {
      storageNote.textContent = "当前浏览器无法保存安全会话；仍可正常输入密码解锁。";
    }
  } finally {
    button.disabled = false;
    passwordInput.disabled = false;
    button.textContent = "解锁监控";
    if (!monitorData) passwordInput.focus();
  }
}
// @app-block-end b192
