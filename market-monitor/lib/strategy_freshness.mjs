import {
  STRATEGY_ANALYSIS_CONTRACT,
  STRATEGY_ANALYSIS_FORMULA,
  STRATEGY_FRESHNESS_GRACE_DAYS,
  STRATEGY_FRESHNESS_RECHECK_MS,
  STRATEGY_FRESHNESS_STATUS_SEVERITY,
  __set_strategyFreshnessRenderedKey,
  __set_strategyFreshnessTimer,
  activeView,
  monitorData,
  strategyFreshnessBadgesHost,
  strategyFreshnessRenderedKey,
  strategyFreshnessTimer,
  strategyTrendCopyHost
} from "./context.mjs";
import {
  el
} from "./dom.mjs";
import {
  easternCalendarDate
} from "./format.mjs";

// @app-block-start b157
export function strategyFreshnessMonthEnd(year, month) {
  const last = new Date(Date.UTC(year, month, 0));
  const pad = (part) => String(part).padStart(2, "0");
  return `${last.getUTCFullYear()}-${pad(last.getUTCMonth() + 1)}-${pad(last.getUTCDate())}`;
}
// @app-block-end b157

// @app-block-start b158
export function strategyNyToday(nowMs = Date.now()) {
  return easternCalendarDate(new Date(nowMs));
}
// @app-block-end b158

// @app-block-start b160
export function strategyFreshnessWorse(aged, transported) {
  return STRATEGY_FRESHNESS_STATUS_SEVERITY[aged] >= STRATEGY_FRESHNESS_STATUS_SEVERITY[transported]
    ? aged
    : transported;
}
// @app-block-end b160

// @app-block-start b161
export function strategyFreshnessDisplayStatus(freshness, nowMs = Date.now()) {
  if (!freshness || typeof freshness !== "object"
    || !["OK", "EXPECTED_LAG", "STALE", "MISSING"].includes(freshness.status)) return null;
  // MISSING is preserved verbatim whatever the local clock claims.
  if (freshness.status === "MISSING") return "MISSING";
  const edge = freshness.evidence_edge;
  if (edge === null || edge === undefined) return null;
  if (typeof edge !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(edge)) return null;
  const today = strategyNyToday(nowMs);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const monthEnd = strategyFreshnessMonthEnd(year, month);
    const ageDays = Math.round((todayMs - Date.parse(`${monthEnd}T00:00:00Z`)) / 86400000);
    if (ageDays >= STRATEGY_FRESHNESS_GRACE_DAYS) {
      const previous = strategyFreshnessMonthEnd(
        month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1,
      );
      const aged = edge >= monthEnd ? "OK" : edge >= previous ? "EXPECTED_LAG" : "STALE";
      // One-way aging: display the worse of the browser recomputation and
      // the transported server status; a slow clock can keep or worsen the
      // verdict but never soften it.
      return strategyFreshnessWorse(aged, freshness.status);
    }
    year = month === 1 ? year - 1 : year;
    month = month === 1 ? 12 : month - 1;
  }
  return null;
}
// @app-block-end b161

// @app-block-start b162
export function strategyFreshnessPillNode(displayStatus, freshnessEdge) {
  if (displayStatus === "EXPECTED_LAG" || displayStatus === "STALE") {
    return el("span", `status-pill strategy-freshness-pill ${displayStatus === "STALE" ? "red" : "amber"}`,
      `收益输入${displayStatus === "STALE" ? "已过期" : "滞后"}（证据截至 ${freshnessEdge}）`);
  }
  if (displayStatus === "MISSING") {
    return el("span", "status-pill strategy-freshness-pill red", "收益输入缺失");
  }
  return null;
}
// @app-block-end b162

// @app-block-start b163
export function strategyTrendCopyText(displayStatus, freshnessEdge) {
  return "年度看券商原生 TWR/MWR；月度只展示有证据支持的走势口径，缺失不补零。 "
    + (displayStatus === "STALE"
      ? `收益证据截至 ${freshnessEdge}，此后月份未更新；缺失月份不补零。`
      : "");
}
// @app-block-end b163

// @app-block-start b169
export function strategyFreshnessRenderKey(displayStatus, freshnessEdge, nyToday) {
  return `${displayStatus ?? "none"}|${freshnessEdge ?? "none"}|${nyToday}`;
}
// @app-block-end b169

// @app-block-start b170
export function stopStrategyFreshnessTimer() {
  if (strategyFreshnessTimer === null) return;
  window.clearInterval(strategyFreshnessTimer);
  __set_strategyFreshnessTimer(null);
}
// @app-block-end b170

// @app-block-start b171
export function syncStrategyFreshnessTimer() {
  if (activeView !== "strategy" || document.hidden || !monitorData) {
    stopStrategyFreshnessTimer();
    return;
  }
  // At most one bounded interval: repeated renders or view switches must
  // never stack listeners or accumulate timers.
  if (strategyFreshnessTimer !== null) return;
  __set_strategyFreshnessTimer(window.setInterval(
    () => refreshStrategyFreshnessDisplay(),
    STRATEGY_FRESHNESS_RECHECK_MS,
  ));
}
// @app-block-end b171

// @app-block-start b172
export function refreshStrategyFreshnessDisplay() {
  if (!monitorData || activeView !== "strategy") return false;
  const data = monitorData.strategy || {};
  if (data.contract_id !== STRATEGY_ANALYSIS_CONTRACT || data.formula !== STRATEGY_ANALYSIS_FORMULA) {
    return false;
  }
  const freshness = data.return_freshness;
  const freshnessEdge = typeof freshness?.evidence_edge === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(freshness.evidence_edge) ? freshness.evidence_edge : null;
  const displayStatus = strategyFreshnessDisplayStatus(freshness);
  const key = strategyFreshnessRenderKey(displayStatus, freshnessEdge, strategyNyToday());
  if (key === strategyFreshnessRenderedKey) return false;
  if (strategyFreshnessBadgesHost) {
    strategyFreshnessBadgesHost.querySelectorAll(".strategy-freshness-pill").forEach((pill) => pill.remove());
    const pill = strategyFreshnessPillNode(displayStatus, freshnessEdge);
    if (pill) strategyFreshnessBadgesHost.appendChild(pill);
  }
  if (strategyTrendCopyHost) {
    strategyTrendCopyHost.textContent = strategyTrendCopyText(displayStatus, freshnessEdge);
  }
  __set_strategyFreshnessRenderedKey(key);
  return true;
}
// @app-block-end b172
