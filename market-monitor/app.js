import {
  byId,
  monitorData,
  unlockKey,
  unlockPersistence
} from "./lib/context.mjs";
import {
  decryptPayload
} from "./lib/unlock.mjs";
import {
  renderLiveOnly
} from "./views/trading_live.mjs";
import {
  scheduleLivePolling,
  stopLivePolling
} from "./lib/live_channel.mjs";
import {
  refreshStrategyFreshnessDisplay,
  stopStrategyFreshnessTimer,
  syncStrategyFreshnessTimer
} from "./lib/strategy_freshness.mjs";
import {
  activateDashboard,
  applyThemePreference,
  clearUnlockedDashboard,
  cycleTheme,
  readStoredThemePreference,
  restorePersistedUnlock,
  setCurrency,
  setDrawerOpen,
  switchView
} from "./lib/session.mjs";

"use strict";
// @app-block b001 lib/context.mjs
// @app-block b002 lib/context.mjs

// @app-block b003 lib/context.mjs
// @app-block b004 lib/context.mjs
// @app-block b005 lib/context.mjs

// @app-block b006 lib/context.mjs
// @app-block b007 lib/context.mjs
// @app-block b008 lib/context.mjs
// @app-block b009 lib/context.mjs
// @app-block b010 lib/context.mjs
// @app-block b011 lib/context.mjs
// CR-20261029-01: last VALIDATED daily-return-history health snapshot. The
// live risk-gate summary is replaced wholesale on every merge and the static
// pages summary is rebuilt field-by-field by the transport allowlist, so the
// health DTO is kept here (validated, dated by its own computed_at) instead
// of being read implicitly from monitorData. Never holds an unvalidated dict.
// @app-block b012 lib/context.mjs
// @app-block b013 lib/context.mjs
// @app-block b014 lib/context.mjs
// @app-block b015 lib/context.mjs
// @app-block b016 lib/context.mjs
// @app-block b017 lib/context.mjs
// @app-block b018 lib/context.mjs
// @app-block b019 lib/context.mjs
// @app-block b020 lib/context.mjs
// @app-block b021 lib/context.mjs
// @app-block b022 lib/context.mjs
// @app-block b023 lib/context.mjs

// @app-block b024 lib/context.mjs
// @app-block b025 lib/context.mjs
// @app-block b026 lib/context.mjs
// @app-block b027 lib/context.mjs
// @app-block b028 lib/context.mjs
// @app-block b029 lib/context.mjs
// @app-block b030 lib/context.mjs

// @app-block b031 lib/context.mjs

// @app-block b032 lib/context.mjs

// @app-block b033 lib/context.mjs

// @app-block b034 lib/dom.mjs

// @app-block b035 lib/dom.mjs

// @app-block b036 lib/context.mjs

// @app-block b037 lib/dom.mjs

// @app-block b038 lib/dom.mjs

// @app-block b039 lib/dom.mjs

// @app-block b040 lib/dom.mjs

// @app-block b041 lib/unlock.mjs

// @app-block b042 lib/unlock.mjs

// @app-block b043 lib/unlock.mjs

// @app-block b044 lib/unlock.mjs

// @app-block b045 lib/unlock.mjs

// @app-block b046 lib/unlock.mjs

// @app-block b047 lib/unlock.mjs

// @app-block b048 lib/unlock.mjs

// @app-block b049 lib/format.mjs

// @app-block b050 lib/format.mjs

// @app-block b051 lib/format.mjs

// @app-block b052 lib/format.mjs

// @app-block b053 lib/format.mjs

// @app-block b054 lib/format.mjs

// @app-block b055 lib/format.mjs

// @app-block b056 lib/format.mjs

// @app-block b057 lib/format.mjs

// @app-block b058 lib/format.mjs

// @app-block b059 lib/format.mjs

// @app-block b060 lib/format.mjs

// @app-block b061 lib/format.mjs

// @app-block b062 views/trading_live.mjs

// @app-block b063 lib/context.mjs

// @app-block b064 lib/context.mjs
// @app-block b065 lib/context.mjs
// @app-block b066 lib/context.mjs
// @app-block b067 lib/context.mjs

// CR-20261029-01 daily return history health - begin
// Client boundary of the public `personal.risk_gate.daily_return_history_health`
// DTO (schema_version 1, flat, exactly 16 fields). Mirrors the core
// sanitizer: unknown fields drop the WHOLE metadata object (private keys are
// never copied through), counts must be native integers (booleans and
// numeric strings are rejected), dates are canonical and cannot be in the
// future (America/New_York EOD bound: before 20:00 ET the bound is the prior
// day), computed_at must be an aware UTC timestamp, and the cross-field
// relationships (stored vs continuous vs expected/missing, gap receipt vs
// gap reason, calendar availability) must hold. Fail-closed: any violation
// yields null and the UI renders 历史状态未提供 · 无法确认 — never 积累中,
// never a zero for an unknown count.
// @app-block b068 lib/context.mjs
// @app-block b069 lib/context.mjs
// @app-block b070 lib/context.mjs
// @app-block b071 lib/context.mjs
// A REJECTED gap may only carry a coarse non-success observation reason.
// @app-block b072 lib/context.mjs
// Closed public mapping for coarse gap reasons: raw codes never render.
// @app-block b073 lib/context.mjs

// @app-block b074 lib/freshness.mjs

// @app-block b075 lib/freshness.mjs

// Future bound mirrors the core: the ET calendar date, minus one day before
// the 20:00 ET completion boundary. hour % 24 guards h24 formatting at midnight.
// @app-block b076 lib/freshness.mjs

// Exact timestamp contract shared with the transport validators
// (build_live_payload.mjs / build_github_pages.mjs) and the core
// ``sanitize_daily_return_history_health``: strict shape, canonical UTC
// suffix only, real calendar date (V8 Date.parse would alias both a space
// separator and 2026-02-30), and never in the future. Returns parsed UTC
// milliseconds, else null.
// @app-block b077 lib/context.mjs

// @app-block b078 lib/freshness.mjs

// @app-block b079 lib/freshness.mjs

// Display model for the approved in-place presentation: an L0 note fragment
// appended to the existing return-card note plus ONE existing detail row.
// Valuation-point counts are storage facts only — no copy promises that
// returns become computable after N points, and no next-session date is
// shown (the field is not in the first-release contract).
// @app-block b080 lib/freshness.mjs

// CR-20261029-01: per-broker "· 系统" rows without a governed reason must
// render an honest unknown; the EXPLICIT legit HISTORY_ACCUMULATING reason
// explains the minimum valuation facts instead of a "recorder is writing"
// progress claim. Mapped reasons keep their existing labels untouched.
// @app-block b081 lib/freshness.mjs
// CR-20261029-01 daily return history health - end

// @app-block b082 views/personal.mjs

// Current-batch collector status phrasing. These labels state only what the
// current collection round proved; an owner-online transient collector
// failure must read as "this round failed", never as "broker disconnected".
// @app-block b083 lib/context.mjs

// @app-block b084 lib/freshness.mjs

// Age text differs per tier so staleness is never color-only. Tiers follow
// the presentation contract: <10 min delayed, 10–30 min warning, >=30 min
// severely stale (display escalation only; no notification thresholds).
// @app-block b085 lib/freshness.mjs

// @app-block b086 lib/freshness.mjs

// @app-block b087 lib/freshness.mjs

// @app-block b088 lib/freshness.mjs

// @app-block b089 lib/freshness.mjs

// @app-block b090 views/personal.mjs

// @app-block b091 lib/live_channel.mjs

// @app-block b092 lib/live_channel.mjs

// @app-block b093 lib/live_channel.mjs

// @app-block b094 lib/live_channel.mjs

// @app-block b095 lib/live_channel.mjs

// @app-block b096 lib/live_channel.mjs

// @app-block b097 lib/live_channel.mjs

// @app-block b098 lib/live_channel.mjs

// @app-block b099 lib/live_channel.mjs

// @app-block b100 lib/live_channel.mjs

// @app-block b101 lib/live_channel.mjs

// @app-block b102 lib/presentation.mjs

// @app-block b103 lib/presentation.mjs

// @app-block b104 lib/presentation.mjs

// @app-block b105 lib/presentation.mjs

// @app-block b106 lib/presentation.mjs

// @app-block b107 lib/presentation.mjs

// @app-block b108 lib/dom.mjs

// @app-block b109 lib/dom.mjs

// @app-block b110 lib/dom.mjs

// @app-block b111 lib/dom.mjs

// @app-block b112 views/personal.mjs

// @app-block b113 views/personal.mjs

// @app-block b114 views/personal.mjs

// @app-block b115 views/personal.mjs

// @app-block b116 views/trading.mjs

// @app-block b117 views/trading.mjs

// @app-block b118 views/trading.mjs

// @app-block b119 views/trading.mjs

// @app-block b120 views/trading.mjs

// @app-block b121 views/trading.mjs

// @app-block b122 views/trading.mjs

// @app-block b123 views/trading.mjs

// @app-block b124 views/trading.mjs

// @app-block b125 views/trading.mjs

// @app-block b126 views/trading.mjs

// @app-block b127 views/trading_chart.mjs

// @app-block b128 views/trading_live.mjs

// @app-block b129 views/trading_live.mjs

// @app-block b130 views/trading_live.mjs

// @app-block b131 views/trading_live.mjs

// @app-block b132 views/trading_live.mjs

// @app-block b133 views/trading_live.mjs

// @app-block b134 views/trading_live.mjs

// @app-block b135 views/macro.mjs

// @app-block b136 views/macro.mjs

// @app-block b137 views/macro.mjs

// @app-block b138 views/strategy.mjs

// @app-block b139 views/strategy.mjs

// @app-block b140 views/strategy.mjs

// @app-block b141 views/strategy.mjs

// @app-block b142 views/strategy.mjs

// @app-block b143 views/strategy.mjs

// @app-block b144 views/strategy.mjs

// @app-block b145 views/holdings.mjs

// @app-block b146 views/holdings.mjs

// @app-block b147 views/holdings.mjs

// @app-block b148 views/holdings.mjs

// Single source for header labels, column classes and detail-field labels:
// the header row, the per-cell classes and the detail disclosure all derive
// from this descriptor, so a label reorder can never silently shift column
// classes. `currency: true` marks the label that tracks the display currency.
// @app-block b149 lib/context.mjs

// @app-block b150 lib/context.mjs

// Detail rows are display:none until opened, so they never occupy table
// layout rows; opening one inside a merged strategy group grows the group's
// rowSpan so the four merged group cells keep covering the whole group.
// @app-block b151 views/holdings.mjs

// @app-block b152 views/holdings.mjs

// @app-block b153 views/holdings.mjs

// @app-block b154 views/holdings.mjs

// @app-block b155 views/holdings.mjs

// @app-block b156 lib/context.mjs

// MANUAL_INPUT_MONTHLY_CADENCE_V1 evaluated in the browser against the
// current America/New_York calendar day, so a frozen static payload cannot
// keep a stale input green. Third implementation of the same rule (Python
// producer, Pages sanitizer, here); existence and constants are pinned by
// test_ui_static_contract.mjs.
// @app-block b157 lib/strategy_freshness.mjs

// The NY calendar day drives the freshness verdict and its lifecycle
// rechecks; always derived from a timestamp (default: the mockable wall
// clock), never cached from page load.
// @app-block b158 lib/strategy_freshness.mjs

// Display severity: the browser may only AGE the transported verdict
// (OK -> EXPECTED_LAG -> STALE -> MISSING), never improve it — a device
// clock running behind must not wash a server STALE back to green.
// @app-block b159 lib/context.mjs

// @app-block b160 lib/strategy_freshness.mjs

// @app-block b161 lib/strategy_freshness.mjs

// Freshness-dependent presentation, isolated so the bounded lifecycle
// recheck (refreshStrategyFreshnessDisplay) can patch exactly these nodes
// without re-rendering charts, filters or focus.
// @app-block b162 lib/strategy_freshness.mjs

// @app-block b163 lib/strategy_freshness.mjs

// Long-lived strategy tabs: freshness only moves with the NY calendar day,
// so a bounded interval re-evaluates it while the strategy view is the
// active, visible view; visibility recovery re-evaluates immediately.
// @app-block b164 lib/context.mjs
// @app-block b165 lib/context.mjs
// @app-block b166 lib/context.mjs
// @app-block b167 lib/context.mjs
// @app-block b168 lib/context.mjs

// @app-block b169 lib/strategy_freshness.mjs

// @app-block b170 lib/strategy_freshness.mjs

// @app-block b171 lib/strategy_freshness.mjs

// Recomputes the freshness display from the current NY day and patches only
// the hero pill and the trend copy. Returns true when the DOM changed, so
// callers and tests can distinguish a real boundary update from a no-op tick.
// @app-block b172 lib/strategy_freshness.mjs

// CR-20261027-01: independent system-calculated monthly return evidence.
// This source is decoupled from the manual strategy contract — it renders
// from monitorData.broker_return_periods even when strategy data is missing
// or its contract guard trips. Values are Modified Dietz ESTIMATES from
// retained daily-close evidence: never broker-app native TWR/MWR, never
// spliced into the native annual lanes above, never a substitute for them.
// @app-block b173 lib/context.mjs
// @app-block b174 lib/context.mjs
// @app-block b175 lib/context.mjs
// @app-block b176 lib/context.mjs
// @app-block b177 lib/context.mjs

// Render-side boundary of that contract (the Pages sanitizer rejects
// invalid contracts before shipping; this is the display defense): a
// missing/unknown root normalizes to the empty contract, rows keep only
// schema-valid identity, and return values must be native finite numbers or
// null — booleans and numeric strings are treated as unknown so a gap can
// never render as 0. Missing rows keep their dates labeled as the REQUIRED
// window, never as covered evidence.
// @app-block b178 views/strategy.mjs

// @app-block b179 views/strategy.mjs

// @app-block b180 views/strategy.mjs

// @app-block b181 lib/session.mjs

// @app-block b182 lib/session.mjs

// @app-block b183 lib/session.mjs

// @app-block b184 lib/session.mjs

// @app-block b185 lib/session.mjs

// @app-block b186 lib/session.mjs

// @app-block b187 lib/session.mjs

// @app-block b188 lib/session.mjs

// @app-block b189 lib/session.mjs

// @app-block b190 lib/session.mjs

// @app-block b191 lib/session.mjs

// @app-block b192 lib/session.mjs

byId("unlock-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = byId("unlock-button");
  const error = byId("unlock-error");
  const passwordInput = byId("password");
  const rememberDevice = byId("remember-device");
  const storageNote = byId("unlock-storage-note");
  button.disabled = true;
  button.textContent = "正在解密…";
  error.textContent = "";
  storageNote.textContent = "";
  try {
    const unlocked = await decryptPayload(passwordInput.value);
    let persistenceRecord = null;
    let persistenceWarning = "";
    try {
      persistenceRecord = await unlockPersistence.save(unlocked.key, {
        trusted: rememberDevice.checked,
      });
    } catch (storageError) {
      persistenceWarning = storageError instanceof Error
        ? storageError.message
        : "浏览器安全存储不可用。";
      if (storageError?.code === "TRUST_REVOCATION_FAILED") {
        const suppressed = unlockPersistence.suppressAutoRestore();
        window.alert(
          suppressed
            ? "未能确认已撤销旧的受信任设备记录；当前浏览会话已停止自动恢复。请稍后使用“退出并忘记此设备”重试。"
            : "未能确认已撤销旧的受信任设备记录，浏览器也无法保存锁定状态；新的浏览会话仍可能自动恢复。请清除本站点数据。",
        );
      }
    }
    passwordInput.value = "";
    activateDashboard(unlocked, {
      persistenceRecord,
      persistenceWarning,
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

document.querySelectorAll(".drawer-item").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document.querySelectorAll(".currency-option").forEach((button) => {
  button.addEventListener("click", () => setCurrency(button.dataset.currency));
});

byId("theme-button").addEventListener("click", cycleTheme);
applyThemePreference(readStoredThemePreference() || "system");
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (document.documentElement.dataset.themePreference === "system") {
    applyThemePreference("system");
  }
});

byId("mobile-menu-button").addEventListener("click", () => setDrawerOpen(true));
byId("drawer-backdrop").addEventListener("click", () => setDrawerOpen(false));
byId("drawer-toggle").addEventListener("click", () => {
  if (window.matchMedia("(max-width: 900px)").matches) {
    setDrawerOpen(false);
    return;
  }
  const collapsed = byId("dashboard").classList.toggle("drawer-collapsed");
  localStorage.setItem("zzao-monitor-drawer", collapsed ? "collapsed" : "open");
  byId("drawer-toggle").setAttribute("aria-expanded", String(!collapsed));
  byId("drawer-toggle").setAttribute("aria-label", collapsed ? "展开导航" : "收起导航");
});

if (localStorage.getItem("zzao-monitor-drawer") === "collapsed") {
  byId("dashboard").classList.add("drawer-collapsed");
  byId("drawer-toggle").setAttribute("aria-expanded", "false");
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setDrawerOpen(false);
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopLivePolling();
    stopStrategyFreshnessTimer();
    return;
  }
  if (unlockKey && monitorData) {
    scheduleLivePolling(0);
    renderLiveOnly();
  }
  // Freshness is re-derived from the wall clock immediately on recovery —
  // independent of the live channel — then the bounded interval resumes.
  refreshStrategyFreshnessDisplay();
  syncStrategyFreshnessTimer();
});

byId("lock-button").addEventListener("click", async () => {
  let lockMessage = "页面已锁定；当前浏览会话不会自动恢复。";
  try {
    const result = await unlockPersistence.lockCurrentSession();
    if (result.trustedCleared) {
      lockMessage = "页面已锁定；因浏览器无法保存会话锁，已同时清除本设备信任。";
    }
  } catch {
    lockMessage =
      "当前页面已清除，但浏览器无法保存锁定状态或删除设备信任；刷新可能自动恢复。请关闭页面并清除本站点数据。";
  }
  clearUnlockedDashboard();
  byId("unlock-storage-note").textContent = lockMessage;
  byId("password").focus();
});

byId("forget-device-button").addEventListener("click", async () => {
  const confirmed = window.confirm(
    "退出并删除此浏览器保存的全部解锁密钥？之后需要重新输入密码。",
  );
  if (!confirmed) return;
  const button = byId("forget-device-button");
  button.disabled = true;
  try {
    await unlockPersistence.clearAll();
    clearUnlockedDashboard();
    byId("unlock-storage-note").textContent = "已退出并忘记此设备。";
    byId("password").focus();
  } catch {
    window.alert("未能清除此设备的安全解锁记录；页面保持解锁，请稍后重试。");
  } finally {
    button.disabled = false;
  }
});

void restorePersistedUnlock();
