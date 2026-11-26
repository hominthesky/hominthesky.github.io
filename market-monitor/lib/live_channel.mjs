import {
  LIVE_CLIENT,
  LIVE_POLL_INTERVAL_MS,
  MANUAL_REFRESH_TIMEOUT_MS,
  __set_holdingsRequestGeneration,
  __set_livePollInFlight,
  __set_livePollTimer,
  __set_portfolioCurrentSummary,
  __set_portfolioHistoryHealth,
  __set_portfolioOverviewSummary,
  __set_portfolioReturnReferenceSummary,
  __set_portfolioReturnWeightSummary,
  __set_tradingLedgerRequestGeneration,
  applyLiveRiskGate,
  byId,
  currentPortfolioDisplaySummary,
  currentPortfolioReturnReferenceSummary,
  effectiveHoldingsStatus,
  holdingsFilters,
  holdingsRequestGeneration,
  holdingsRuntime,
  liveFinancialFingerprint,
  livePollInFlight,
  livePollTimer,
  liveRuntime,
  monitorData,
  portfolioCurrentSummary,
  portfolioHistoryHealth,
  portfolioOverviewSummary,
  portfolioReturnReferenceSummary,
  portfolioReturnWeightSummary,
  refreshProofMessage,
  resolvePendingManualRefresh,
  sanitizeCashflowLedgerV2,
  sanitizePrivateHoldings,
  sanitizePrivateTradingLedgerClient,
  selectIntentIncome,
  tradingLedgerRequestGeneration,
  tradingLedgerRuntime,
  unlockKey,
  updateLastConfirmedPortfolioOverview
} from "./context.mjs";
import {
  b64bytes,
  bytesB64Url,
  fetchEncryptedPayload
} from "./unlock.mjs";
import {
  renderLiveOnly,
  renderTrading
} from "../views/trading_live.mjs";
import {
  validDailyReturnHistoryHealth
} from "./freshness.mjs";
import {
  renderHoldings
} from "../views/holdings.mjs";
import {
  renderSnapshotStatus
} from "./session.mjs";

// @app-block-start b091
export function mergeLivePayload(payload) {
  let riskAdvanced = false;
  const incomingRiskGate = payload?.personal?.risk_gate;
  const incomingTrading = payload?.trading;
  // Browser-local receipt ordering is separate from the financial as-of time:
  // a failed collection may have no financial timestamp, or retain an old one.
  const previousRiskAt = Date.parse(monitorData.meta?.portfolio_risk_financial_at
    || monitorData.personal?.summary?.source_retrieved_at || "");
  const previousRiskObservedAt = Date.parse(monitorData.meta?.portfolio_risk_observed_at
    || monitorData.personal?.summary?.source_retrieved_at || "");
  const incomingRiskAt = Date.parse(incomingRiskGate?.source_retrieved_at || "");
  const riskClocks = [incomingRiskAt, Date.parse(incomingTrading?.meta?.retrieved_at || ""),
    Date.parse(incomingTrading?.meta?.checked_at || ""), Date.parse(incomingTrading?.live?.checked_at || "")]
    .filter(Number.isFinite);
  const incomingRiskObservedAt = riskClocks.length ? Math.max(...riskClocks) : NaN;
  const riskUnavailable = ["FAILED", "MISSING", "STALE", "PARTIAL"].includes(incomingRiskGate?.source_status);
  if (incomingRiskGate && typeof incomingRiskGate === "object"
    && Number.isFinite(incomingRiskObservedAt)
    && (!Number.isFinite(previousRiskObservedAt) || incomingRiskObservedAt >= previousRiskObservedAt)
    && (riskUnavailable || (Number.isFinite(incomingRiskAt)
      && (!Number.isFinite(previousRiskAt) || incomingRiskAt >= previousRiskAt)))) {
    riskAdvanced = !Number.isFinite(previousRiskObservedAt) || incomingRiskObservedAt > previousRiskObservedAt
      || (!riskUnavailable && (!Number.isFinite(previousRiskAt) || incomingRiskAt > previousRiskAt));
    __set_portfolioCurrentSummary(currentPortfolioDisplaySummary(incomingRiskGate));
    __set_portfolioReturnWeightSummary(updateLastConfirmedPortfolioOverview(
      portfolioReturnWeightSummary,
      incomingRiskGate.last_confirmed_overview,
    ));
    __set_portfolioOverviewSummary(updateLastConfirmedPortfolioOverview(
      portfolioOverviewSummary,
      incomingRiskGate.last_confirmed_overview,
    ));
    __set_portfolioReturnReferenceSummary(currentPortfolioReturnReferenceSummary(incomingRiskGate));
    // CR-20261029-01: consume the actual delivered live property
    // (personal.risk_gate.daily_return_history_health). Every SUCCESSFULLY
    // accepted risk gate REPLACES the health snapshot with the validated
    // current DTO: absent or poisoned metadata renders 无法确认 — never a
    // stale implicit last-known-good, never a raw dict, never 积累中, and no
    // monotonic newest-wins guard (the delivered snapshot IS the approved
    // current snapshot). Transport failure or "no new payload" never reaches
    // this line, so the last validated facts stay; locking clears as before.
    __set_portfolioHistoryHealth(validDailyReturnHistoryHealth(
      incomingRiskGate.daily_return_history_health,
    ));
    monitorData.personal = applyLiveRiskGate(monitorData.personal, incomingRiskGate);
    monitorData.meta = {
      ...monitorData.meta,
      portfolio_retrieved_at: incomingRiskGate.source_retrieved_at || null,
      portfolio_risk_financial_at: !riskUnavailable ? incomingRiskGate.source_retrieved_at
        : Number.isFinite(previousRiskAt) ? new Date(previousRiskAt).toISOString() : null,
      portfolio_risk_observed_at: new Date(incomingRiskObservedAt).toISOString(),
    };
  }
  let intentChanged = false;
  if (incomingTrading && Object.hasOwn(incomingTrading, "intent_income")) {
    try {
      monitorData.trading = {...monitorData.trading,
        intent_income: selectIntentIncome(monitorData.trading?.intent_income, incomingTrading.intent_income)};
      intentChanged = true;
    } catch (error) {
      monitorData.trading = {...monitorData.trading,
        intent_income: {contract_id: "intent_income_report_v1", state: "UNAVAILABLE", reason: "INVALID_INTENT_PAYLOAD"}};
    }
  }
  let ledgerV2Changed = false;
  if (incomingTrading && Object.hasOwn(incomingTrading, "cashflow_ledger_v2")) {
    const cleanV2 = sanitizeCashflowLedgerV2(incomingTrading.cashflow_ledger_v2);
    if (cleanV2) {
      monitorData.trading = { ...monitorData.trading, cashflow_ledger_v2: cleanV2 };
      ledgerV2Changed = true;
    }
  }
  const incomingLive = incomingTrading?.live;
  let heartbeatAdvanced = riskAdvanced;
  let financialChanged = riskAdvanced;
  let skippedOlder = false;
  if (incomingLive && typeof incomingLive === "object") {
    const normalizedLive = {
      ...incomingLive,
      checked_at: incomingLive.checked_at || incomingTrading.meta?.checked_at,
      sources: Array.isArray(incomingLive.sources) ? incomingLive.sources
        : Array.isArray(incomingTrading.sources) ? incomingTrading.sources : [],
    };
    const incomingCheckedAt = Date.parse(normalizedLive.checked_at || "");
    const previousCheckedAt = Date.parse(monitorData.trading?.live?.checked_at || "");
    skippedOlder = Number.isFinite(previousCheckedAt) && incomingCheckedAt < previousCheckedAt;
    if (Number.isFinite(incomingCheckedAt) && !skippedOlder) {
      const previousLive = monitorData.trading?.live;
      heartbeatAdvanced = heartbeatAdvanced || incomingCheckedAt > (Number.isFinite(previousCheckedAt) ? previousCheckedAt : 0);
      financialChanged = financialChanged || liveFinancialFingerprint(normalizedLive) !== liveFinancialFingerprint(previousLive);
      monitorData.trading = {...monitorData.trading, live: normalizedLive, sources: normalizedLive.sources,
        plan: incomingTrading.plan && typeof incomingTrading.plan === "object" ? incomingTrading.plan : monitorData.trading?.plan};
    } else if (!Number.isFinite(incomingCheckedAt) && !incomingRiskGate && !intentChanged && !ledgerV2Changed) {
      throw new Error("实时数据缺少有效检查时间，已保留上次成功数据。");
    }
  } else if (!incomingRiskGate && !intentChanged && !ledgerV2Changed) {
    throw new Error("实时数据格式不完整，已保留上次成功数据。");
  }
  return { heartbeatAdvanced, financialChanged, riskAdvanced, skippedOlder };
}
// @app-block-end b091

// @app-block-start b092
export async function checkLivePayload() {
  if (!LIVE_CLIENT.payloadUrl || !unlockKey || !monitorData) return false;
  if (livePollInFlight) return livePollInFlight;
  const sessionKey = unlockKey;
  liveRuntime.pollState = "checking";
  liveRuntime.error = "";
  renderLiveOnly();
  __set_livePollInFlight((async () => {
    try {
      const payload = await fetchEncryptedPayload(LIVE_CLIENT.payloadUrl, sessionKey);
      if (unlockKey !== sessionKey || !monitorData) {
        return { heartbeatAdvanced: false, financialChanged: false, cancelled: true };
      }
      const outcome = mergeLivePayload(payload);
      renderNavigationAlerts();
      renderSnapshotStatus();
      if (outcome.riskAdvanced && unlockKey && holdingsRuntime.state !== "loading") void loadPrivateHoldings();
      liveRuntime.transportStatus = "OK";
      liveRuntime.pollState = "idle";
      const completion = resolvePendingManualRefresh(
        liveRuntime.pendingRefresh,
        monitorData.trading?.live,
      );
      if (completion) {
        liveRuntime.refreshState = completion.state;
        liveRuntime.pendingRefresh = null;
      }
      return outcome;
    } catch (error) {
      liveRuntime.transportStatus = "FAILED";
      liveRuntime.pollState = "failed";
      liveRuntime.error = error instanceof Error ? error.message : "实时通道检查失败。";
      return { heartbeatAdvanced: false, financialChanged: false, failed: true };
    } finally {
      __set_livePollInFlight(null);
      renderLiveOnly();
      refreshHoldingsFreshnessDisplay();
    }
  })());
  return livePollInFlight;
}
// @app-block-end b092

// @app-block-start b093
export function stopLivePolling() {
  if (livePollTimer) window.clearTimeout(livePollTimer);
  __set_livePollTimer(null);
  liveRuntime.nextCheckAt = null;
}
// @app-block-end b093

// @app-block-start b094
export function scheduleLivePolling(delayMs = LIVE_POLL_INTERVAL_MS) {
  stopLivePolling();
  if (!LIVE_CLIENT.payloadUrl || !unlockKey || document.hidden) return;
  liveRuntime.nextCheckAt = Date.now() + delayMs;
  renderLiveOnly();
  __set_livePollTimer(window.setTimeout(async () => {
    __set_livePollTimer(null);
    await checkLivePayload();
    scheduleLivePolling();
  }, delayMs));
}
// @app-block-end b094

// @app-block-start b095
export async function deriveRefreshProof(challenge, requestPath) {
  if (!unlockKey) throw new Error("页面已锁定，请重新解锁。");
  const salt = b64bytes(challenge.salt);
  const iterations = Number(challenge.iterations);
  if (!salt.length || !Number.isInteger(iterations) || iterations < 100_000) {
    throw new Error("刷新 challenge 参数无效。");
  }
  const proofKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    unlockKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
  const message = refreshProofMessage(challenge, requestPath);
  const signature = await crypto.subtle.sign(
    "HMAC",
    proofKey,
    new TextEncoder().encode(message),
  );
  return bytesB64Url(signature);
}
// @app-block-end b095

// @app-block-start b096
export async function loadPrivateHoldings() {
  if (!LIVE_CLIENT.challengeUrl || !LIVE_CLIENT.holdingsUrl || !unlockKey
    || holdingsRuntime.state === "loading") return;
  const requestGeneration = __set_holdingsRequestGeneration(holdingsRequestGeneration + 1);
  holdingsRuntime.state = "loading";
  holdingsRuntime.error = "";
  renderSnapshotStatus();
  renderHoldings();
  try {
    const holdingsPath = new URL(LIVE_CLIENT.holdingsUrl, window.location.href).pathname;
    const challengeUrl = new URL(LIVE_CLIENT.challengeUrl, window.location.href);
    challengeUrl.searchParams.set("path", holdingsPath);
    const challengeResponse = await fetch(challengeUrl, {
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    if (!challengeResponse.ok) throw new Error("无法取得持仓读取凭证。");
    const challenge = await challengeResponse.json();
    if (!unlockKey || requestGeneration !== holdingsRequestGeneration) return;
    const proof = await deriveRefreshProof(challenge, holdingsPath);
    const response = await fetch(LIVE_CLIENT.holdingsUrl, {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        nonce: challenge.nonce,
        expires_at: challenge.expires_at,
        proof,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!unlockKey || requestGeneration !== holdingsRequestGeneration) return;
    if (!response.ok) throw new Error(payload.message || "精确持仓暂不可用。");
    holdingsRuntime.data = sanitizePrivateHoldings(payload);
    holdingsRuntime.state = "ready";
  } catch (error) {
    if (!unlockKey || requestGeneration !== holdingsRequestGeneration) return;
    holdingsRuntime.data = null;
    holdingsRuntime.state = "error";
    holdingsRuntime.error = error instanceof Error ? error.message : "精确持仓暂不可用。";
  }
  renderHoldings();
  renderHoldingsSourceAlert();
}

async function fetchAuthenticatedTradingEndpoint(targetUrl, bodyPayload, errorFallback) {
  const endpointPath = new URL(targetUrl, window.location.href).pathname;
  const challengeUrl = new URL(LIVE_CLIENT.challengeUrl, window.location.href);
  challengeUrl.searchParams.set("path", endpointPath);
  const challengeResponse = await fetch(challengeUrl, {
    cache: "no-store",
    credentials: "omit",
    headers: { Accept: "application/json" },
  });
  if (!challengeResponse.ok) throw new Error("无法取得私有账本访问凭证。");
  const challenge = await challengeResponse.json();
  if (!unlockKey) throw new Error("会话已锁定。");
  const proof = await deriveRefreshProof(challenge, endpointPath);
  const response = await fetch(targetUrl, {
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      nonce: challenge.nonce,
      expires_at: challenge.expires_at,
      proof,
      ...bodyPayload,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || errorFallback);
  return payload;
}

async function loadPrivateTradingLedger({ period = null, days = 90, force = false } = {}) {
  if (!LIVE_CLIENT.challengeUrl || !LIVE_CLIENT.tradingLedgerUrl || !unlockKey) return;
  if (!force && typeof tradingLedgerRuntime !== "undefined" && tradingLedgerRuntime.state === "loading") return;
  const requestGeneration = __set_tradingLedgerRequestGeneration(tradingLedgerRequestGeneration + 1);
  const activePeriod = ["day", "week", "month", "year"].includes(period) ? period : (tradingLedgerRuntime.period || "month");
  tradingLedgerRuntime.period = activePeriod;
  tradingLedgerRuntime.state = "loading";
  tradingLedgerRuntime.error = "";
  renderTrading();
  try {
    const query = period ? { period: activePeriod } : { days };
    const payload = await fetchAuthenticatedTradingEndpoint(
      LIVE_CLIENT.tradingLedgerUrl,
      query,
      "私有逐笔配对账本暂不可用。",
    );
    if (!unlockKey || requestGeneration !== tradingLedgerRequestGeneration) return;
    tradingLedgerRuntime.data = sanitizePrivateTradingLedgerClient(payload);
    tradingLedgerRuntime.state = "ready";
  } catch (error) {
    if (!unlockKey || requestGeneration !== tradingLedgerRequestGeneration) return;
    tradingLedgerRuntime.data = null;
    tradingLedgerRuntime.state = "error";
    tradingLedgerRuntime.error = error instanceof Error ? error.message : "私有逐笔配对账本暂不可用。";
  }
  if (typeof byId === "function" && byId("trading-content")) renderTrading();
}

async function submitTradingOverride({ sell_fill_id, action, target_buy_fill_id = null, broker = null, note = "" } = {}) {
  if (!LIVE_CLIENT.challengeUrl || !LIVE_CLIENT.tradingOverrideUrl || !unlockKey) {
    throw new Error("当前会话未解锁或未配置覆写接口。");
  }
  const safeAction = String(action || "").toUpperCase();
  if (!["SET_CORE", "SET_SWING", "CLEAR"].includes(safeAction)) {
    throw new TypeError("不支持的纠偏操作类型");
  }
  const cleanSellId = String(sell_fill_id || "").trim();
  if (!cleanSellId || cleanSellId.includes("..") || cleanSellId.includes("/") || cleanSellId.includes("\\")) {
    throw new TypeError("成交标识格式无效");
  }
  const cleanBuyId = target_buy_fill_id ? String(target_buy_fill_id).trim() : null;
  if (safeAction === "SET_SWING" && (!cleanBuyId || cleanBuyId.includes("..") || cleanBuyId.includes("/") || cleanBuyId.includes("\\"))) {
    throw new TypeError("指定波段纠偏需要填写有效的买入成交编号");
  }
  const requestGeneration = tradingLedgerRequestGeneration;
  tradingLedgerRuntime.overrideState = "submitting";
  tradingLedgerRuntime.overrideMessage = "";
  try {
    const body = {
      action: safeAction,
      sell_fill_id: cleanSellId,
      ...(cleanBuyId ? { target_buy_fill_id: cleanBuyId } : {}),
      ...(broker ? { broker } : {}),
      ...(note ? { note: String(note).slice(0, 200) } : {}),
    };
    const result = await fetchAuthenticatedTradingEndpoint(
      LIVE_CLIENT.tradingOverrideUrl,
      body,
      "提交意图纠偏失败。",
    );
    if (!unlockKey || requestGeneration !== tradingLedgerRequestGeneration) return result;
    const recomputeStatus = result?.recompute?.status;
    tradingLedgerRuntime.overrideState = "submitted";
    tradingLedgerRuntime.overrideMessage = recomputeStatus === "cooldown"
      ? "纠偏规则已安全保存；异步重算处于短冷却期，稍后自动同步。"
      : "纠偏规则已安全保存，正在刷新逐笔账本与重算。";
    await loadPrivateTradingLedger({ period: tradingLedgerRuntime.period, force: true });
    return result;
  } catch (error) {
    if (!unlockKey || requestGeneration !== tradingLedgerRequestGeneration) return null;
    tradingLedgerRuntime.overrideState = "error";
    tradingLedgerRuntime.overrideMessage = error instanceof Error ? error.message : "提交意图纠偏失败。";
    renderTrading();
    throw error;
  }
}
// @app-block-end b096

// @app-block-start b097
export function resetHoldingsFilters() {
  Object.assign(holdingsFilters, {query: "", broker: "ALL", strategy: "ALL", instrument: "ALL", direction: "ALL", group: "STRATEGY"});
}
// @app-block-end b097

// @app-block-start b098
export function renderNavigationAlerts() {
  if (!monitorData) return;
  for (const view of ["personal", "macro"]) {
    const count = Math.max(monitorData[view]?.alerts?.length || 0, view === "personal" && monitorData.personal?.summary?.portfolio_gate === "RED" ? 1 : 0);
    byId(`${view}-tab-alert`).textContent = count ? `· ${count}` : "";
  }
  const failed = (monitorData.trading?.sources || []).filter(source => source.status !== "OK").length;
  byId("trading-source-alert").textContent = failed ? `· ${failed}` : "";
  byId("strategy-source-alert").textContent = monitorData.strategy?.status === "COMPLETE" ? "" : "· !";
}
// @app-block-end b098

// @app-block-start b099
export function renderHoldingsSourceAlert() {
  byId("holdings-source-alert").textContent = holdingsRuntime.state === "ready"
    && effectiveHoldingsStatus(holdingsRuntime.data) === "OK" ? "" : "· !";
  renderSnapshotStatus();
}
// @app-block-end b099

// @app-block-start b100
export function refreshHoldingsFreshnessDisplay() {
  if (holdingsRuntime.state !== "ready" || !holdingsRuntime.data) return;
  // Freshness changes with wall-clock time even when the underlying private
  // file does not.  Re-evaluate on the existing live poll heartbeat so a
  // loaded 29-minute snapshot cannot remain visually green after 30 minutes.
  renderHoldings();
  renderHoldingsSourceAlert();
}
// @app-block-end b100

// @app-block-start b101
export async function requestManualRefresh() {
  if (!LIVE_CLIENT.challengeUrl || !LIVE_CLIENT.refreshUrl || !unlockKey) return;
  if (Date.now() < liveRuntime.cooldownUntil) {
    renderLiveOnly();
    return;
  }
  stopLivePolling();
  liveRuntime.refreshState = "requesting";
  liveRuntime.error = "";
  renderLiveOnly();
  const previousCheckedAt = monitorData.trading?.live?.checked_at || null;
  const previousRiskAt = monitorData.personal?.summary?.source_retrieved_at || null;
  try {
    const challengeResponse = await fetch(LIVE_CLIENT.challengeUrl, {
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    if (!challengeResponse.ok) throw new Error("无法取得单次刷新凭证。");
    const challenge = await challengeResponse.json();
    const refreshPath = new URL(LIVE_CLIENT.refreshUrl, window.location.href).pathname;
    const proof = await deriveRefreshProof(challenge, refreshPath);
    const refreshResponse = await fetch(LIVE_CLIENT.refreshUrl, {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        nonce: challenge.nonce,
        expires_at: challenge.expires_at,
        proof,
      }),
    });
    const result = await refreshResponse.json().catch(() => ({}));
    if (refreshResponse.status === 429) {
      const cooldownSeconds = Math.max(1, Number(result.retry_after_seconds) || 60);
      liveRuntime.cooldownUntil = Date.now() + cooldownSeconds * 1000;
      liveRuntime.refreshState = "cooldown";
      liveRuntime.pendingRefresh = null;
      return;
    }
    if (refreshResponse.status !== 202) throw new Error(result.message || "刷新请求未被接受。");
    liveRuntime.pendingRefresh = {
      checkedAt: previousCheckedAt,
      financialFingerprint: liveFinancialFingerprint(monitorData.trading?.live),
    };
    liveRuntime.refreshState = result.status === "merged" ? "checking" : "accepted";
    renderLiveOnly();

    const deadline = Date.now() + MANUAL_REFRESH_TIMEOUT_MS;
    let completed = false;
    let financialChanged = false;
    while (Date.now() < deadline && unlockKey) {
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      if (!unlockKey || !monitorData) return;
      liveRuntime.refreshState = "checking";
      const outcome = await checkLivePayload();
      const nextCheckedAt = monitorData.trading?.live?.checked_at || null;
      const riskProofAdvanced = outcome?.riskAdvanced && monitorData.personal?.summary?.source_retrieved_at !== previousRiskAt;
      if (riskProofAdvanced || (outcome?.heartbeatAdvanced && nextCheckedAt !== previousCheckedAt)) {
        completed = true;
        financialChanged = outcome.financialChanged;
        break;
      }
    }
    liveRuntime.refreshState = completed
      ? financialChanged
        ? "updated"
        : "current"
      : "timeout";
    if (completed) liveRuntime.pendingRefresh = null;
    liveRuntime.cooldownUntil = Math.max(liveRuntime.cooldownUntil, Date.now() + 60_000);
  } catch (error) {
    liveRuntime.refreshState = "failed";
    liveRuntime.pendingRefresh = null;
    liveRuntime.error = error instanceof Error ? error.message : "主动刷新失败。";
  } finally {
    renderLiveOnly();
    scheduleLivePolling();
  }
}
// @app-block-end b101

export { loadPrivateTradingLedger, submitTradingOverride };
