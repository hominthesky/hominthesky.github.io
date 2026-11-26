import {
  BROKER_RETURN_CONTRACT,
  MANUAL_RETURN_REFERENCE_CONTRACT,
  MANUAL_RETURN_REFERENCE_V2_CONTRACT,
  PORTFOLIO_RETURN_CONTRACT,
  PORTFOLIO_RETURN_REASON_LABELS,
  TERM_DEFINITIONS,
  anchoredPortfolioReturnReference,
  byId,
  monitorData,
  portfolioCurrentSummary,
  portfolioHistoryHealth,
  portfolioOverviewPresentation,
  portfolioOverviewSummary,
  portfolioReturnReferenceSummary,
  portfolioReturnWeightSummary
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
  liveTime,
  number,
  pct,
  usd,
  usdExact
} from "../lib/format.mjs";
import {
  brokerDisplayNote,
  brokerDisplayTier,
  dailyReturnHistoryHealthView,
  resolvePortfolioFreshness,
  systemCalculatedPendingNote
} from "../lib/freshness.mjs";
import {
  actionTone,
  portfolioMetricGuidance
} from "../lib/presentation.mjs";

// @app-block-start b082
export function overviewMetric(label, value, note, options = {}) {
  const item = el("div", "portfolio-overview-metric");
  const labelNode = options.definition
    ? term(label, options.definition, "portfolio-overview-label")
    : el("span", "portfolio-overview-label", label);
  const valueNode = el("strong", `portfolio-overview-value ${options.tone || ""}`.trim(), value);
  if (options.valueAria) valueNode.setAttribute("aria-label", options.valueAria);
  append(
    item,
    labelNode,
    valueNode,
    el("span", `portfolio-overview-note ${options.noteClass || ""}`.trim(), note),
  );
  if (Array.isArray(options.details) && options.details.length) {
    const details = el("div", "portfolio-overview-details");
    options.details.forEach(({ label: detailLabel, value: detailValue, note: detailNote, origin: detailOrigin, tier: detailTier }) => {
      const row = el("div", "portfolio-overview-detail");
      if (detailOrigin) row.dataset.origin = detailOrigin;
      if (detailTier) row.dataset.tier = detailTier;
      append(
        row,
        el("span", "portfolio-overview-detail-label", detailLabel),
        el("strong", "portfolio-overview-detail-value", detailValue),
        detailNote ? el("span", "portfolio-overview-detail-note", detailNote) : null,
      );
      details.append(row);
    });
    item.append(details);
  }
  return item;
}
// @app-block-end b082

// @app-block-start b090
export function renderPortfolioOverview() {
  const root = byId("portfolio-overview");
  if (!root || !monitorData) return;
  root.replaceChildren();
  const riskSummary = monitorData.personal?.summary || {};
  const presentation = portfolioOverviewPresentation(
    resolvePortfolioFreshness(portfolioCurrentSummary).summary,
    portfolioOverviewSummary,
  );
  const summary = presentation;
  const lastConfirmed = presentation.last_confirmed;
  const referenceSummary = portfolioReturnReferenceSummary || {};
  const brokerRows = Array.isArray(summary.broker_breakdown)
    ? summary.broker_breakdown.filter((row) => ["Futu", "Tiger", "IBKR"].includes(row?.broker))
    : [];
  const brokerByName = new Map(brokerRows.map((row) => [row.broker, row]));
  const orderedBrokers = ["Futu", "Tiger", "IBKR"]
    .map((broker) => brokerByName.get(broker)).filter(Boolean);
  const currentComplete = summary.source_status === "OK";
  const displaySummary = summary.display_summary || {};
  const displayMode = displaySummary.mode || "INCOMPLETE";
  const mixedDisplay = displayMode === "MIXED_LKG" && displaySummary.mixed_timepoints === true;
  const missingBrokerLabel = summary.current_missing_brokers.length
    ? summary.current_missing_brokers.join("/") : "部分券商";
  const noDisplayBrokerLabel = summary.missing_brokers.length
    ? summary.missing_brokers.join("/") : "部分券商";
  const oldestLkgTime = displaySummary.oldest_lkg_as_of
    ? liveTime(displaySummary.oldest_lkg_as_of) : "";
  const mixedFlagNote = "含陈旧数据 · 混合时间点";
  const navNote = currentComplete
    ? `当前完整批次 · ${liveTime(summary.source_retrieved_at)}`
    : mixedDisplay
      ? `${mixedFlagNote} · 最早历史值截至 ${oldestLkgTime}`
      : displayMode === "MIXED_LKG"
        ? `合计按逐券商可显示值计算 · ${liveTime(summary.source_retrieved_at)}`
        : summary.missing_brokers.length
          ? `当前批次缺 ${missingBrokerLabel}，${noDisplayBrokerLabel === missingBrokerLabel ? "" : `${noDisplayBrokerLabel} `}暂无可用数据，合计不计算${summary.source_retrieved_at ? ` · ${liveTime(summary.source_retrieved_at)}` : ""}`
          : summary.source_retrieved_at
            ? `当前批次缺 ${missingBrokerLabel}，合计不计算 · ${liveTime(summary.source_retrieved_at)}`
            : "当前券商批次不可确认";
  const navValueAria = mixedDisplay
    ? `${usd(summary.derived_nav_usd, true)}（${mixedFlagNote}，最早历史值截至 ${oldestLkgTime}，非当前完整批次）`
    : null;
  const leverageNote = currentComplete && isFiniteMetric(summary.gross_leverage_red)
    ? `当前完整批次 · 治理红线 ${number(summary.gross_leverage_red, 2)}x`
    : mixedDisplay
      ? `${mixedFlagNote} · 治理红线 ${number(summary.gross_leverage_red, 2)}x`
      : displayMode === "MIXED_LKG"
        ? `合计按逐券商可显示值计算 · 治理红线 ${number(summary.gross_leverage_red, 2)}x`
        : summary.source_retrieved_at
          ? `当前批次缺 ${missingBrokerLabel}，组合杠杆不计算`
          : "当前覆盖不足不估算";
  const staleFlagClass = mixedDisplay
    ? displaySummary.worst_age_tier === "SEVERE"
      ? "portfolio-overview-flag portfolio-overview-flag-severe"
      : "portfolio-overview-flag"
    : "";
  const historicalNavDetail = !currentComplete && lastConfirmed
    ? [{
      label: "上次完整三券商",
      value: usd(lastConfirmed.derived_nav_usd, true),
      note: `仅供历史参考 · ${liveTime(lastConfirmed.source_retrieved_at)}`,
    }]
    : [];
  const historicalLeverageDetail = !currentComplete && lastConfirmed
    ? [{
      label: "上次完整三券商",
      value: isFiniteMetric(lastConfirmed.gross_leverage)
        ? `${number(lastConfirmed.gross_leverage, 2)}x` : "—",
      note: `仅供历史参考 · ${liveTime(lastConfirmed.source_retrieved_at)}`,
    }]
    : [];
  const referenceRows = Array.isArray(referenceSummary.broker_breakdown)
    ? referenceSummary.broker_breakdown.filter((row) => ["Futu", "Tiger", "IBKR"].includes(row?.broker))
    : [];
  const referenceByName = new Map(referenceRows.map((row) => [row.broker, row]));
  const orderedReferenceBrokers = ["Futu", "Tiger", "IBKR"]
    .map((broker) => referenceByName.get(broker)).filter(Boolean);
  const portfolioReturn = riskSummary.portfolio_return || {};
  const governedReturn = portfolioReturn.contract_id === PORTFOLIO_RETURN_CONTRACT.id
    && portfolioReturn.formula === PORTFOLIO_RETURN_CONTRACT.formula;
  const cumulative = governedReturn && isFiniteMetric(portfolioReturn.cumulative_total_return)
    ? portfolioReturn.cumulative_total_return
    : null;
  const annualized = governedReturn && isFiniteMetric(portfolioReturn.annualized_total_return)
    ? portfolioReturn.annualized_total_return
    : null;
  const anchoredReference = anchoredPortfolioReturnReference(
    referenceSummary,
    portfolioReturnWeightSummary,
  );
  const referenceEndDateLabel = Object.entries(anchoredReference?.reference_end_dates || {})
    .filter(([, value]) => value)
    .map(([broker, value]) => `${broker} ${value}`)
    .join(" / ");
  const displayedAnnualized = annualized ?? anchoredReference?.portfolio_annualized_reference ?? null;
  const referenceMissingBrokers = Array.isArray(anchoredReference?.missing_reference_brokers)
    ? anchoredReference.missing_reference_brokers : [];
  const reasonCodes = Array.isArray(portfolioReturn.reason_codes)
    ? portfolioReturn.reason_codes
    : [];
  const reason = reasonCodes
    .map((code) => PORTFOLIO_RETURN_REASON_LABELS[code])
    .find(Boolean);
  const returnCoverage = portfolioReturn.start_date
    ? `${portfolioReturn.start_date} 起`
    : "共同历史尚未建立";
  // CR-20261029-01: blind "历史积累中" fallbacks are retired — an absent
  // reason code renders an honest unknown; explicit mapped reasons (including
  // the legit HISTORY_ACCUMULATING label) keep rendering via `reason`.
  const returnNote = cumulative !== null
    ? `累计 ${pct(cumulative, 1)} · ${returnCoverage}${annualized === null ? ` · ${reason || "年化条件未确认"}` : ""}`
    : `${reason || "历史状态未提供 · 无法确认"} · 覆盖不足不估算${referenceMissingBrokers.length
      ? ` · 参考缺口：${referenceMissingBrokers.join("/")} 年化尚未满足`
      : ""}`;
  // L0: one appended sentence on the return-card note. L1: one existing
  // detail row. Both come from the VALIDATED health snapshot only.
  const historyHealthView = dailyReturnHistoryHealthView(
    portfolioHistoryHealth,
    orderedReferenceBrokers.length > 0,
  );
  const historyHealthSuffix = ` · ${historyHealthView.note}`;
  const head = el("div", "portfolio-overview-head");
  append(
    head,
    el("strong", "", "资产增长概览"),
    el("span", "", "长期组合总回报 · 与下方生活现金流分开"),
  );
  const grid = el("div", "portfolio-overview-grid");
  append(
    grid,
    overviewMetric(
      // A mixed-timepoint total must never be titled as a current value:
      // the label itself, the flagged note and the value's aria-label all
      // state that the number mixes current and historical broker values.
      mixedDisplay ? "跨券商展示总净资产" : "跨券商当前总净资产",
      usd(summary.derived_nav_usd, true),
      navNote,
      {
        definition: TERM_DEFINITIONS.portfolioNav,
        noteClass: staleFlagClass,
        valueAria: navValueAria,
        details: [
          ...orderedBrokers.map((row) => ({
            label: row.broker,
            value: usd(row.display?.derived_nav_usd, true),
            note: brokerDisplayNote(row),
            origin: row.display?.origin === "LKG" ? "lkg" : row.display?.origin === "CURRENT" ? "current" : "none",
            tier: brokerDisplayTier(row.display),
          })),
          ...historicalNavDetail,
        ],
      },
    ),
    overviewMetric(
      annualized === null && displayedAnnualized !== null
        ? "跨券商综合年化参考（估算）"
        : "组合年化总回报",
      displayedAnnualized === null ? "—" : pct(displayedAnnualized, 1),
      annualized === null && displayedAnnualized !== null
        ? `最近完整日终 NAV 加权参考 · NAV 权重截至 ${anchoredReference.nav_as_of || "—"} · 收益分别截至 ${referenceEndDateLabel || "—"} · 比较估算，非正式组合回报${historyHealthSuffix}`
        : `${returnNote}${historyHealthSuffix}`,
      {
        definition: TERM_DEFINITIONS.portfolioTotalReturn,
        tone: displayedAnnualized === null ? "" : displayedAnnualized >= 0 ? "positive" : "negative",
        details: orderedReferenceBrokers.flatMap((row) => {
          if (row.broker === "Futu") {
            const details = [];
            const manual = row.manual_return_reference || {};
            const governedManualV2 = manual.contract_id === MANUAL_RETURN_REFERENCE_V2_CONTRACT.id
              && manual.formula === MANUAL_RETURN_REFERENCE_V2_CONTRACT.formula
              && manual.broker === "Futu" && manual.scope === "US_EQUITIES"
              && manual.method === "BROKER_APP_USER_CONFIRMED"
              && manual.verification_status === "USER_CONFIRMED"
              && manual.currency === "USD" && manual.auto_refresh === false
              && isFiniteMetric(manual.time_weighted_return)
              && isFiniteMetric(manual.money_weighted_return)
              && Number.isInteger(manual.observation_count) && manual.observation_count >= 2;
            const governedManual = manual.contract_id === MANUAL_RETURN_REFERENCE_CONTRACT.id
              && manual.formula === MANUAL_RETURN_REFERENCE_CONTRACT.formula
              && manual.broker === "Futu" && manual.scope === "US_EQUITIES"
              && manual.method === "BROKER_APP_CASH_WEIGHTED"
              && manual.verification_status === "USER_CONFIRMED"
              && manual.currency === "USD" && manual.auto_refresh === false
              && isFiniteMetric(manual.cash_weighted_return)
              && isFiniteMetric(manual.interval_profit_usd);
            if (governedManualV2) details.push({
              label: "Futu · App TWR 锚定年化估算",
              value: anchoredReference?.futu_annualized_estimate == null ? "—" : pct(anchoredReference.futu_annualized_estimate, 1),
              note: `用户确认券商 App TWR ${pct(manual.time_weighted_return, 2)}、MWR ${pct(manual.money_weighted_return, 2)}（最新交易日 ${manual.anchor_effective_date || "—"}，锚点不会自动更新）· 连续核验 ${manual.observed_start_date || "—"}—${manual.observed_end_date || "—"}，共 ${manual.observation_count} 个交易日 · ${anchoredReference?.continuation_status === "CONTINUING" ? "后续系统日终已续算" : "等待锚点后的完整系统日终续算"} · 累计 ${anchoredReference ? pct(anchoredReference.futu_cumulative, 1) : "—"} · ${manual.start_date || "—"}—${anchoredReference?.end_date || liveTime(manual.as_of)} · 混合方法估算`,
            });
            if (governedManual) details.push({
              label: "Futu · 锚定年化估算",
              value: anchoredReference?.futu_annualized_estimate == null ? "—" : pct(anchoredReference.futu_annualized_estimate, 1),
              note: `券商 App 现金加权锚点 ${pct(manual.cash_weighted_return, 2)}、区间收益 ${usdExact(manual.interval_profit_usd)}（截至 ${manual.anchor_effective_date || "—"}，锚点不会自动更新）· ${anchoredReference?.continuation_status === "CONTINUING" ? "后续系统日终已续算" : anchoredReference?.continuation_status === "ANCHOR_ONLY_REANCHOR_REQUIRED" ? `仅保留锚点参考；首个系统基线为 ${anchoredReference.system_baseline_date || "—"}，缺锚点日分券商 NAV，未跨缺口续算` : "等待锚点后的完整系统日终续算"} · 累计 ${anchoredReference ? pct(anchoredReference.futu_cumulative, 1) : "—"} · ${manual.start_date || "—"}—${anchoredReference?.end_date || liveTime(manual.as_of)} · 混合方法估算`,
            });
            const calculated = row.calculated_return || {};
            const governed = calculated.contract_id === BROKER_RETURN_CONTRACT.id
              && calculated.formula === BROKER_RETURN_CONTRACT.formula
              && calculated.method === "SYSTEM_CALCULATED"
              && calculated.broker === "Futu";
            const calculatedAnnualized = governed && isFiniteMetric(calculated.annualized_total_return)
              ? calculated.annualized_total_return : null;
            const calculatedCumulative = governed && isFiniteMetric(calculated.cumulative_total_return)
              ? calculated.cumulative_total_return : null;
            const calculatedReason = (Array.isArray(calculated.reason_codes) ? calculated.reason_codes : [])
              .map((code) => PORTFOLIO_RETURN_REASON_LABELS[code])
              .find(Boolean);
            if (calculatedAnnualized !== null) details.push({
              label: "Futu · 系统",
              value: pct(calculatedAnnualized, 1),
              note: `系统自算 · 累计 ${pct(calculatedCumulative, 1)} · ${calculated.start_date || "—"}—${calculated.end_date || "—"}`,
            });
            else if (calculatedCumulative !== null) details.push({
              label: "Futu · 系统",
              value: `累计 ${pct(calculatedCumulative, 1)}`,
              note: `系统自算 · ${calculatedReason || "满 30 个自然日后显示年化"} · ${calculated.start_date || "—"}—${calculated.end_date || "—"}`,
            });
            else details.push({
              label: "Futu · 系统",
              value: "—",
              note: systemCalculatedPendingNote(calculatedReason),
            });
            return details;
          }
          const details = [];
          const native = row.native_return || {};
          const nativeAnnualized = isFiniteMetric(native.annualized_total_return)
            ? native.annualized_total_return : null;
          const nativeCumulative = isFiniteMetric(native.cumulative_total_return)
            ? native.cumulative_total_return : null;
          if (native.coverage_status === "COMPLETE") details.push({
            label: row.broker === "IBKR" ? "IBKR · 原生 TWR" : `${row.broker} · 原生`,
            value: nativeAnnualized !== null ? pct(nativeAnnualized, 1) : "—",
            note: nativeAnnualized !== null
              ? `${row.broker === "IBKR" ? "Universal Account Flex 原生区间 TWR，ACT/365 年化参考" : "证券账户（SEC）券商原生年化"} · 累计 ${pct(nativeCumulative, 1)} · ${native.start_date || "—"}—${native.end_date || "—"}`
              : `原生累计 ${pct(nativeCumulative, 1)} · 满 30 个自然日后显示 ACT/365 年化参考`,
          });
          else if (row.broker === "IBKR") details.push({
            label: "IBKR · 原生 TWR",
            value: "—",
            note: (native.reason_codes || []).includes("BROKER_NATIVE_RETURN_DISABLED")
              ? "原生收益通道未启用 · 待配置只读 Flex 报表"
              : "原生收益报表未通过覆盖校验 · 与系统日终历史独立",
          });
          const calculated = row.calculated_return || {};
          const governed = calculated.contract_id === BROKER_RETURN_CONTRACT.id
            && calculated.formula === BROKER_RETURN_CONTRACT.formula
            && calculated.method === "SYSTEM_CALCULATED"
            && calculated.broker === row.broker;
          const calculatedAnnualized = governed && isFiniteMetric(calculated.annualized_total_return)
            ? calculated.annualized_total_return : null;
          const calculatedCumulative = governed && isFiniteMetric(calculated.cumulative_total_return)
            ? calculated.cumulative_total_return : null;
          const calculatedReason = (Array.isArray(calculated.reason_codes) ? calculated.reason_codes : [])
            .map((code) => PORTFOLIO_RETURN_REASON_LABELS[code])
            .find(Boolean);
          details.push({
            label: `${row.broker} · 系统`,
            value: calculatedAnnualized !== null
              ? pct(calculatedAnnualized, 1)
              : calculatedCumulative !== null
                ? `累计 ${pct(calculatedCumulative, 1)}`
                : "—",
            note: calculatedCumulative !== null
              ? `系统自算 · ${calculatedReason || "满 30 个自然日后显示年化"} · ${calculated.start_date || "—"}—${calculated.end_date || "—"}`
              : systemCalculatedPendingNote(calculatedReason),
          });
          return details;
        })
        // CR-20261029-01 L1: exactly one appended detail row in the same
        // existing structure — no new panel, no CSS, no per-broker rewrite.
          .concat(historyHealthView.detail ? [historyHealthView.detail] : []),
      },
    ),
    overviewMetric(
      "组合毛杠杆",
      isFiniteMetric(summary.gross_leverage)
        ? `${number(summary.gross_leverage, 2)}x`
        : "—",
      leverageNote,
      {
        definition: TERM_DEFINITIONS.grossLeverage,
        noteClass: staleFlagClass,
        tone:
          isFiniteMetric(summary.gross_leverage) &&
          isFiniteMetric(summary.gross_leverage_red) &&
          summary.gross_leverage >= summary.gross_leverage_red
            ? "negative"
            : "",
        details: [
          ...orderedBrokers.map((row) => ({
            label: row.broker,
            value: isFiniteMetric(row.display?.gross_leverage) ? `${number(row.display.gross_leverage, 2)}x` : "—",
            note: brokerDisplayNote(row),
            origin: row.display?.origin === "LKG" ? "lkg" : row.display?.origin === "CURRENT" ? "current" : "none",
            tier: brokerDisplayTier(row.display),
          })),
          ...historicalLeverageDetail,
        ],
      },
    ),
  );
  append(root, head, grid);
}
// @app-block-end b090

// @app-block-start b112
export function renderActionList(actions) {
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
// @app-block-end b112

// @app-block-start b113
export function renderPositionRows(positions) {
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
// @app-block-end b113

// @app-block-start b114
export function renderRiskCockpit() {
  const root = byId("risk-cockpit");
  if (!root || !monitorData) return;
  root.replaceChildren();
  const raw = monitorData.personal?.summary || {};
  const freshness = resolvePortfolioFreshness(raw);
  const risk = raw.position_risk;
  const events = monitorData.macro?.event_calendar;
  const state = raw.portfolio_gate === "RED" ? "需要处理" : freshness.isFresh ? "数据最新" : "数据不可确认";
  const grid = el("div", "cockpit-grid");
  append(grid,
    metricCard("总体状态", state, raw.portfolio_gate === "RED" ? "停止新增风险" : freshness.isFresh ? "继续核对风险事实" : "先刷新来源"),
    metricCard("最低保证金缓冲", freshness.isFresh ? pct(risk?.minimum_cushion_ratio) : "—", risk?.minimum_cushion_broker || "尚无完整证据"),
    metricCard("未来14日事件", events?.known_event_count_14d != null ? `${events.known_event_count_14d} 项已知` : "—", events?.status === "OK" ? "覆盖完整" : "事件来源部分覆盖"),
    metricCard("最大主题敞口", freshness.isFresh ? pct(raw.maximum_theme_exposure_pct_nav) : "—", raw.maximum_theme_label || "待持仓主题覆盖"));
  root.appendChild(grid);
}
// @app-block-end b114

// @app-block-start b115
export function renderPersonal() {
  renderRiskCockpit();
  const root = byId("personal-content");
  root.replaceChildren();
  const data = monitorData.personal;
  const freshness = resolvePortfolioFreshness(data.summary);
  const summary = freshness.summary;
  const personalAlert = (data.alerts || [])[0];
  const sourceStatus = String(summary.source_status || "MISSING").toUpperCase();
  const isRed = summary.portfolio_gate === "RED";
  const sourceLabel = summary.source_label || "持仓风险快照";
  const brokerNativeSource = summary.snapshot_source === "broker_portfolio" || summary.is_broker_snapshot === true || String(sourceLabel).includes("券商账户快照");
  const sourceIncomplete = !freshness.isFresh || (sourceStatus !== "OK" && brokerNativeSource);
  const sourceUncertain = sourceStatus !== "OK" && !isRed;
  const liveGateOnly = data.live_risk_gate_only === true;
  const coverage = isFiniteMetric(summary.broker_coverage) ? Number(summary.broker_coverage) : NaN;
  const coverageText = Number.isFinite(coverage)
    ? `，券商覆盖 ${(coverage * 100).toFixed(0)}%`
    : "";

  const banner = el("section", `risk-banner ${summary.portfolio_gate === "RED" ? "" : "amber"}`);
  const bannerText = el("div");
  append(
    bannerText,
    el(
      "h2",
      "",
      isRed
        ? "组合红色闸门"
        : sourceUncertain
        ? "券商账户数据不确定"
        : personalAlert?.headline || "个人风险预算",
    ),
    el(
      "p",
      "",
      isRed
        ? `${sourceLabel}触发风险阻断（${summary.quality_flags || "红色风险证据"}）；来源状态 ${sourceStatus}${coverageText}。停止新增风险，券商原生来源不完整时不推导具体减仓标的或金额。`
        : sourceUncertain
        ? `${sourceLabel}来源状态为 ${sourceStatus}；风险闸门未知${freshness.asOfLabel ? `（数据截至 ${liveTime(freshness.asOfLabel)}）` : ""}；先刷新来源数据再判断。`
        : personalAlert?.evidence ||
          `当前组合毛杠杆 ${number(summary.gross_leverage, 2)}x，风险闸门 ${summary.portfolio_gate}。`,
    ),
  );
  append(banner, el("div", "risk-bar"), bannerText);
  root.appendChild(banner);

  const metrics = el("section", "metric-grid");
  const guidance = portfolioMetricGuidance(summary);
  const metricCards = [
    metricCard(
      "组合毛杠杆",
      isFiniteMetric(summary.gross_leverage)
        ? `${number(summary.gross_leverage, 2)}x`
        : "—",
      `治理红线 ${number(summary.gross_leverage_red, 2)}x`,
      guidance.leverage,
    ),
  ];
  if (isFiniteMetric(summary.derived_nav_usd) || !freshness.isFresh) {
    metricCards.unshift(
      metricCard(
        "券商账户净资产",
        usd(summary.derived_nav_usd, true),
        "全部已接入券商 net liquidation 合计",
        {
          definition: "全部预期券商本次快照返回的账户净清算值合计，不含未接入的银行、基金或其它券商资产。",
          meaning: "它是组合毛杠杆的分母；下降会使同样的毛敞口对应更高杠杆。",
          action: "与券商 App 的账户权益核对；来源不完整时不据此调整仓位。",
          tone: "tone-neutral",
        },
      ),
    );
  }
  if (isFiniteMetric(summary.gross_market_value_usd) || !freshness.isFresh) {
    metricCards.push(
      metricCard(
        "绝对毛持仓价值",
        usd(summary.gross_market_value_usd, true),
        "多空绝对值合计，不做方向抵消",
        {
          definition: "券商账户股票与期权多空持仓价值的绝对值合计，用于观察总风险占用而非净方向。",
          meaning: "↑ 总风险占用扩大；↓ 组合去杠杆，但不代表一定盈利或亏损。",
          action: "结合净资产、保证金和逐标的集中度判断，不单独用该金额做买卖决定。",
          tone: "tone-neutral",
        },
      ),
    );
  }
  if (
    isFiniteMetric(summary.required_gross_reduction_usd_to_red) &&
    Number(summary.required_gross_reduction_usd_to_red) > 0
  ) {
    metricCards.push(metricCard(
      "回到红线需降毛敞口",
      usd(summary.required_gross_reduction_usd_to_red, true),
      "静态一阶估算，执行前须用券商实时数据重算",
      guidance.reduction,
    ));
  }
  if (isFiniteMetric(summary.attack_exposure_pct_nav)) {
    metricCards.push(metricCard(
      "高进攻敞口 / NAV",
      pct(summary.attack_exposure_pct_nav),
      `目标 ${pct(summary.attack_target_pct_nav)}`,
      guidance.attack,
    ));
  }
  if (isFiniteMetric(summary.highest_account_gross_leverage)) {
    metricCards.push(metricCard(
      "最高账户杠杆",
      `${number(summary.highest_account_gross_leverage, 2)}x`,
      `${summary.highest_leverage_account || "—"} · 先核对 house requirement`,
      guidance.account,
    ));
  }
  append(metrics, ...metricCards);
  root.appendChild(metrics);

  const risk = data.summary?.position_risk;
  if (risk) {
    const freshRisk = freshness.isFresh && risk.status !== "STALE";
    const facts = section("保证金与名义敞口", "缓冲与名义杠杆为补充事实；新告警阈值待配置，现有毛杠杆口径保持。");
    const cards = el("div", "metric-grid");
    append(cards,
      metricCard("最低保证金缓冲", freshRisk ? pct(risk.minimum_cushion_ratio) : "—", risk.minimum_cushion_broker || "来源不完整"),
      metricCard("保守名义杠杆", freshRisk && isFiniteMetric(risk.gross_notional_leverage) ? `${number(risk.gross_notional_leverage,2)}x` : "—", "期权按底层名义计算"),
      metricCard("Delta 名义杠杆", freshRisk && isFiniteMetric(risk.gross_delta_leverage) ? `${number(risk.gross_delta_leverage,2)}x` : "—", "Greeks 未取得时不可用"));
    facts.appendChild(cards);
    for (const row of risk.brokers || []) facts.appendChild(el("p", "section-note", `${row.broker} · ${freshRisk ? pct(row.cushion_ratio) : "—"} · ${row.cushion_method === "MAINTENANCE_APPROX" ? "维持保证金近似" : row.cushion_method === "EXCESS_LIQUIDITY" ? "剩余流动性" : "不可用"}`));
    if (freshRisk && (risk.expiry_weeks || []).length) facts.appendChild(table([
      {key:"week",label:"到期周"},{key:"contracts",label:"张数",render:number},
      {key:"short_put_assignment_usd",label:"卖 Put 指派资金 USD",render:usd},
      {key:"short_call_delivery_shares",label:"卖 Call 交付股数",render:number}],risk.expiry_weeks));
    if (freshRisk && (risk.stress || []).length) facts.appendChild(table([
      {key:"qqq_return",label:"QQQ 情景",render:pct},{key:"estimated_nav_usd",label:"估算 NAV USD",render:usd}],risk.stress));
    facts.appendChild(el("p","section-note","压力测试采用可用 Delta/Beta；模型分支使用历史波动率与零股息欧式假设估算 Gamma/Vega，IV 并非市场隐含波动率。缺证据及券商追保结果保持未知。"));
    root.appendChild(facts);
  }

  const actions = section("今天先做什么", "按个人风险预算排序；不是自动交易指令。");
  const visibleActions = isRed
    ? [
        {
          priority_rank: 1,
          action_label: "停止新增杠杆",
          entity_label: "组合整体",
          fact: `${sourceLabel}触发 ${summary.quality_flags || "RED"}；来源状态 ${sourceStatus}${coverageText}。`,
          inference: "盈利目标与旧机会信号不能覆盖当前组合风险。",
          execution_condition: "先在券商 App 核对账户、保证金和开放仓位；只有完整新快照恢复 CLEAR 后再重新评估。",
          action: "停止新增日内和期权风险；本实时聚合不提供具体减仓标的或手数。",
        },
      ]
    : sourceUncertain
      ? [
        {
          priority_rank: 1,
          action_label: "先刷新券商数据",
          entity_label: "全部预期券商",
          fact: `账户风险来源状态为 ${sourceStatus}，无法确认当前组合闸门。`,
          inference: "旧的持仓动作可能已过期，不应继续展示为当前建议。",
          execution_condition: "全部预期券商来源均恢复为 OK，且账户快照不超过 10 分钟。",
          action: "刷新券商账户净值、毛持仓与保证金信息；恢复前停止依据本页增加风险。",
        },
        ]
      : liveGateOnly
        ? [
            {
              priority_rank: 1,
              action_label: "等待确认",
              entity_label: "组合整体",
              fact: "实时账户闸门为 CLEAR，但逐标的派生分析已因新快照而失效。",
              inference: "旧快照生成的机会与持仓动作不再作为当前建议展示。",
              execution_condition: "等待下一次完整页面计算，或只在券商 App 中按既定计划人工复核。",
              action: "不依据旧逐标的动作新增风险；完整页面刷新后再评估。",
            },
          ]
        : data.actions || [];
  actions.appendChild(renderActionList(visibleActions));
  root.appendChild(actions);

  const positions = section("持仓风险与行动", "仅显示个人持仓事实和对应风险动作，不混入宏观板块列表。");
  if (sourceIncomplete || liveGateOnly) {
    positions.appendChild(
      el(
        "p",
        "section-note",
        isRed
          ? "红色闸门的账户覆盖不完整或实时快照已变化；请在券商 App 核对开放仓位，本页不猜测具体减仓标的。"
          : "账户快照已变化或不完整；暂不展示可能已经过期的逐标的动作。",
      ),
    );
  } else {
    positions.appendChild(renderPositionRows(data.positions || []));
  }
  root.appendChild(positions);

  const strategyRows = sourceIncomplete || liveGateOnly
    ? []
    : (data.strategy || []).filter(
        (row) => isFiniteMetric(row.target_pct_nav),
      );
  if (strategyRows.length) {
    const strategy = section("策略敞口与目标", "实际敞口按组合 NAV 重算。");
    strategy.appendChild(table(
      [
        { key: "strategy", label: "策略" },
        { key: "actual_pct_nav", label: "实际 / NAV", numeric: true, render: pct },
        { key: "target_pct_nav", label: "目标 / NAV", numeric: true, render: pct },
        { key: "gap_pct_nav", label: "偏离", numeric: true, render: pct },
        { key: "actual_market_value_usd", label: "毛敞口", numeric: true, render: usd },
      ],
      strategyRows,
    ));
    root.appendChild(strategy);
  }
}
// @app-block-end b115
