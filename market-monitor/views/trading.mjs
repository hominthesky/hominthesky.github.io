import {
  DEFAULT_MONTHLY_TARGET_CNY,
  LIVE_CLIENT,
  TERM_DEFINITIONS,
  byId,
  calculateLivingExpenseCoverage,
  combineHealthStatuses,
  deriveFxStatus,
  isPeriodCoverageComplete,
  monitorData,
  periodDecisionComplete,
  resolvePeriodCashflowDisplay,
  tradingLedgerRuntime,
  unlockKey,
  yearCoverageLabel
} from "../lib/context.mjs";
import {
  append,
  el,
  section,
  term
} from "../lib/dom.mjs";
import {
  cny,
  easternCalendarDate,
  isFiniteMetric,
  number,
  pct,
  readPositiveLocalNumber,
  usd,
  usdExact
} from "../lib/format.mjs";
import {
  loadPrivateTradingLedger,
  submitTradingOverride
} from "../lib/live_channel.mjs";

// @app-block-start b116
export function cadenceLabel(value, period = null) {
  if (value === "year") {
    return yearCoverageLabel(period?.coverage_status);
  }
  return { day: "最近完整交易日", week: "本周", month: "本月" }[value] || value;
}
// @app-block-end b116

// @app-block-start b117
export function tradingSourcesComplete(trading) {
  const expected = Array.isArray(trading.expected_brokers)
    ? trading.expected_brokers
    : ["Futu", "Tiger"];
  const sources = Array.isArray(trading.sources) ? trading.sources : [];
  const counts = new Map();
  sources.forEach((source) => {
    const broker = String(source?.broker || "");
    counts.set(broker, (counts.get(broker) || 0) + 1);
  });
  const sourcesComplete =
    expected.length > 0 &&
    new Set(expected).size === expected.length &&
    sources.length === expected.length &&
    expected.every((broker) => {
      const source = sources.find((row) => row?.broker === broker);
      return counts.get(broker) === 1 &&
        source?.status === "OK" &&
        Number(source?.fee_coverage_ratio) >= 1;
    });
  return sourcesComplete;
}
// @app-block-end b117

// @app-block-start b118
export function periodCashflowHealth(trading, period) {
  const expected = Array.isArray(trading?.expected_brokers)
    ? trading.expected_brokers
    : ["Futu", "Tiger"];
  const sources = Array.isArray(trading?.sources) ? trading.sources : [];
  const sourceStatuses = expected.map((broker) => {
    const matches = sources.filter((source) => source?.broker === broker);
    if (matches.length !== 1) return "MISSING";
    if (!Number.isFinite(Number(matches[0]?.fee_coverage_ratio))) return "MISSING";
    if (Number(matches[0].fee_coverage_ratio) < 1) return "PARTIAL";
    return matches[0]?.status;
  });
  if (new Set(expected).size !== expected.length || sources.length !== expected.length) {
    sourceStatuses.push("MISSING");
  }
  return combineHealthStatuses([
    ...sourceStatuses,
    period?.coverage_status,
    period?.realized_coverage_status,
    period?.active_scope_coverage_status,
    period?.dividend_coverage_status ?? period?.passive_cashflow_coverage_status,
    period?.interest_coverage_status ?? period?.passive_cashflow_coverage_status,
  ]);
}
// @app-block-end b118

// @app-block-start b119
export function settledPeriodComplete(trading, period) {
  return periodCashflowHealth(trading, period) === "OK";
}
// @app-block-end b119

// @app-block-start b120
export function periodCashflowDisplay(trading, period) {
  return resolvePeriodCashflowDisplay(period, {
    cadence: period?.cadence || "day",
    sourcesComplete: tradingSourcesComplete(trading) && isPeriodCoverageComplete(period),
    yearComplete: period?.cadence !== "year" || period?.coverage_status === "COMPLETE",
  });
}
// @app-block-end b120

// @app-block-start b121
export function livingExpenseCoverage(period, trading, display = periodCashflowDisplay(trading, period)) {
  const cashflowHealth = periodCashflowHealth(trading, period);
  const decisionComplete = periodDecisionComplete(display);
  const generatedAtMs = Date.parse(monitorData?.meta?.generated_at || "");
  const referenceDate = easternCalendarDate(
    Number.isFinite(generatedAtMs) ? new Date(generatedAtMs) : new Date(),
  );
  const fxStatus = deriveFxStatus({
    explicitStatus: monitorData?.meta?.usd_cny_status,
    rate: monitorData?.meta?.usd_cny_rate,
    asOfDate: monitorData?.meta?.usd_cny_as_of,
    referenceDate,
  });
  return calculateLivingExpenseCoverage({
    monthlyTargetCny:
      readPositiveLocalNumber("zzao-monitor-monthly-target-cny") ??
      trading?.plan?.monthly_target_cny ??
      DEFAULT_MONTHLY_TARGET_CNY,
    livingExpenseNetCashflowUsd: decisionComplete ? display.livingValue : null,
    usdCnyRate: monitorData?.meta?.usd_cny_rate,
    coverageStatus: decisionComplete
      ? cashflowHealth
      : combineHealthStatuses([cashflowHealth, "PARTIAL"]),
    fxStatus,
  });
}
// @app-block-end b121

// @app-block-start b122
export function tradingAction(period, portfolioSummary, display) {
  if (portfolioSummary.portfolio_gate === "RED") {
    return "组合仍处红色风险闸门：停止新增风险，先核对账户与安全垫。";
  }
  if (!periodDecisionComplete(display)) {
    return "数据覆盖不完整：仅用于核对，不据此判断可分配现金、扩大仓位或结束当日交易。";
  }
  const trades = Number(period.same_day_equity_matched_set_count || 0) + Number(period.option_closed_trades || 0);
  const pnl = Number(period.active_net_pnl || 0);
  const weak = [period.same_day_equity_profit_factor, period.option_profit_factor]
    .filter((value) => value !== null && value !== undefined)
    .some((value) => Number(value) < 1);
  if (!trades) return "尚无已完成周期；不要把未平仓浮盈当作可分配现金。";
  if (trades < 20) return "已完成周期少于20个：胜率与利润因子仅作早期观察，不据此放大仓位。";
  if (pnl < 0 || weak) return "净收益为负或利润因子低于1：缩小单笔风险，先复盘亏损集中来源。";
  if (display.livingValue < 0) {
    return "账户生活开支净现金流为负：融资成本已超过本期现金创造；缺口不构成追单理由。";
  }
  if (portfolioSummary.portfolio_gate === "RED") {
    return "组合仍处红色风险闸门：已实现现金优先降低融资与补足安全垫，不扩大杠杆。";
  }
  return "先保留税费与风险准备金；仅将稳定、可重复的已实现净现金按风险预算再分配。";
}
// @app-block-end b122

// @app-block-start b123
export function cashflowMetric(label, amount, definition, emphasis = false, unknownText = null) {
  const item = el("div", `cashflow-metric ${emphasis ? "primary" : ""}`.trim());
  const numericAmount = isFiniteMetric(amount) ? Number(amount) : NaN;
  const valueClass = Number.isFinite(numericAmount)
    ? numericAmount < 0
      ? "negative"
      : numericAmount > 0
        ? "positive"
        : ""
    : "";
  append(
    item,
    term(label, definition, "cashflow-metric-label"),
    el(
      "strong",
      `cashflow-metric-value ${valueClass}`.trim(),
      !isFiniteMetric(amount) && unknownText ? unknownText : usd(amount),
    ),
  );
  return item;
}
// @app-block-end b123

// @app-block-start b124
export function negativeMetric(value) {
  return isFiniteMetric(value) ? -Number(value) : null;
}
// @app-block-end b124

// @app-block-start b125
export function cashflowGroup(title, subtitle, tone, metrics, footer) {
  const group = el("section", `cashflow-group ${tone}`);
  const head = el("div", "cashflow-group-head");
  append(head, el("strong", "", title), el("span", "", subtitle));
  const list = el("div", "cashflow-metric-list");
  metrics.forEach((metric) => {
    list.appendChild(
      cashflowMetric(metric.label, metric.value, metric.definition, metric.primary, metric.unknownText),
    );
  });
  append(group, head, list, el("p", "cashflow-group-footer", footer));
  return group;
}
// @app-block-end b125

// @app-block-start b126
export function renderTradingPerformance(trading, portfolioSummary) {
  const sources = trading.sources || [];
  const connected = sources.filter((row) => row.status === "OK");
  const card = section(
    "现金流创造与生活开支覆盖",
    "美东 [T-1 20:00, T 20:00) 为一日；现金创造只统计已完成交易周期和税后已入账股息，长期持仓融资单列。",
  );
  const sourceLine = el("div", "broker-source-line");
  if (!sources.length) {
    sourceLine.appendChild(el("span", "broker-source missing", "Futu / Tiger API 未连接"));
  } else {
    sources.forEach((source) => {
      const statusClass = source.status === "OK" ? "ok" : source.status === "FAILED" ? "failed" : "missing";
      const chip = el("span", `broker-source ${statusClass}`);
      const backfillStart = source.backfill_start || trading.meta?.backfill_start;
      const latestDate = String(source.latest_observation_at || "").slice(0, 10);
      const scope = backfillStart ? `${backfillStart} 起累计` : "累计";
      const freshness = latestDate ? ` · 最新成交 ${latestDate}` : "";
      chip.title = [
        `${scope}成交记录；不是当日成交笔数。`,
        latestDate ? `最近一笔成交时间：${source.latest_observation_at}` : "",
        source.notes || "",
      ].filter(Boolean).join("\n");
      chip.textContent = `${source.broker} · ${source.status === "OK" ? `${scope} ${Number(source.records || 0).toLocaleString()} 笔${freshness}` : source.status}`;
      sourceLine.appendChild(chip);
    });
  }
  card.appendChild(sourceLine);

  if (!connected.length) {
    const empty = el("div", "trading-empty");
    append(
      empty,
      el("strong", "", "等待只读 API 授权"),
      el("p", "", "连接后将自动回填 2026-01-01 起的美股与期权成交，并按日 / 周 / 月 / 年计算净收益、胜率与现金流贡献。"),
    );
    card.appendChild(empty);
    return card;
  }

  const periodList = el("div", "trading-period-list");
  (trading.periods || []).forEach((period) => {
    const realizedComplete = period?.realized_coverage_status === "COMPLETE";
    const historyComplete = isPeriodCoverageComplete(period);
    const display = periodCashflowDisplay(trading, period);
    const displayedGeneratedCashflow = display.value;
    const accountInterest = display.interestValue;
    const livingCashflow = display.livingValue;
    const expenseCoverage = livingExpenseCoverage(period, trading, display);
    const periodTone = isFiniteMetric(displayedGeneratedCashflow)
      ? Number(displayedGeneratedCashflow) < 0 ? "tone-red" : "tone-green"
      : "";
    const row = el("article", `trading-period ${periodTone}`.trim());
    const head = el("div", "trading-period-head");
    append(
      head,
      el("strong", "", cadenceLabel(period.cadence, period)),
      el("span", "", `${period.start_date || "起点未知"} — ${period.end_date}`),
    );
    const primary = el(
      "div",
      `trading-primary ${
        isFiniteMetric(displayedGeneratedCashflow)
          ? Number(displayedGeneratedCashflow) < 0 ? "loss" : "win"
          : ""
      }`.trim(),
    );
    const primaryCopy = el("div");
    append(
      primaryCopy,
      term(
        display.generatedComplete ? "现金流创造" : "可确认现金流创造",
        TERM_DEFINITIONS.generatedCashflow,
        "trading-primary-label",
      ),
      el(
        "span",
        "trading-primary-formula",
        display.generatedComplete
          ? "主动股票净收益（含已归类隔夜）+ 期权净收益 + 税后股息"
          : period.active_scope_coverage_status !== "COMPLETE"
            ? `另有 ${period.unclassified_overnight_realization_count || 0} 笔隔夜股票待归类；完整总额未知`
          : !realizedComplete
            ? `已排除期初成本不明的 ${(period.excluded_instruments || []).length || period.excluded_instrument_count || 0} 个标的，不显示代码`
            : !historyComplete
              ? `仅统计 ${period.start_date || "未知起点"} — ${period.end_date} 的可确认历史`
            : (period.dividend_coverage_status ?? period.passive_cashflow_coverage_status) !== "COMPLETE"
              ? "股息流水未覆盖全部券商；缺失不可按零处理"
              : "券商来源或费用覆盖不完整，仅供核对",
      ),
    );
    append(
      primary,
      primaryCopy,
      el("strong", "trading-primary-value", usd(displayedGeneratedCashflow)),
    );
    const bridge = el("div", "cashflow-bridge");
    const interestRow = el("div", "cashflow-bridge-row");
    append(
      interestRow,
      el("span", "", "长期持仓融资及账户利息"),
      el("strong", Number(accountInterest) < 0 ? "negative" : "", usd(accountInterest)),
    );
    const livingRow = el("div", "cashflow-bridge-row result");
    append(
      livingRow,
      term(
        display.livingComplete ? "生活开支净现金流" : "可确认生活开支净现金流",
        TERM_DEFINITIONS.livingExpenseCashflow,
      ),
      el(
        "strong",
        isFiniteMetric(livingCashflow) ? Number(livingCashflow) < 0 ? "negative" : "positive" : "",
        usd(livingCashflow),
      ),
    );
    append(bridge, interestRow, livingRow);
    if (period.cadence === "month") {
      const coverageRow = el("div", "cashflow-bridge-row target");
      const coverageLabel = expenseCoverage.status === "OK"
        ? `月生活现金流目标覆盖 ${pct(expenseCoverage.coverageRatio)}`
        : "月生活现金流目标覆盖待确认";
      const variance = expenseCoverage.status === "OK"
        ? expenseCoverage.surplusCny >= 0
          ? `盈余 ${cny(expenseCoverage.surplusCny)}`
          : `缺口 ${cny(Math.abs(expenseCoverage.surplusCny))}`
        : "—";
      append(coverageRow, el("span", "", coverageLabel), el("strong", "", variance));
      bridge.appendChild(coverageRow);
      bridge.appendChild(el("p", "cashflow-bridge-note", expenseCoverage.reason));
    }
    const inputsHead = el("div", "cashflow-input-head");
    append(
      inputsHead,
      el("strong", "", "现金流输入拆解"),
      el("span", "", "按类别从未扣成本金额核对到实际净入账"),
    );
    const inputs = el("div", "cashflow-groups");
    append(
      inputs,
      cashflowGroup(
        "股票主动交易",
        `${number(period.same_day_equity_matched_set_count, 0)} 个因果同日 realization + ${number(period.active_residual_overnight_equity_closed_trades, 0)} 个已归类跨日残余周期`,
        "stock",
        [
          { label: "毛收益（未扣手续费）", value: period.active_equity_gross_pnl, definition: TERM_DEFINITIONS.grossTradingPnl },
          { label: "手续费成本（完整周期分摊）", value: negativeMetric(period.active_equity_fees), definition: "已分摊到主动股票完整周期的佣金及费用，以负数显示。", unknownText: "不可得" },
          { label: "扣费后主动净收益", value: period.active_equity_net_pnl, definition: TERM_DEFINITIONS.netTradingPnl, primary: true },
        ],
        `其中因果同日策略 ${usd(period.same_day_equity_net_pnl)} · 已归类跨日残余 ${usd(period.active_residual_overnight_equity_net_pnl)} · 现金流贡献 ${pct(period.active_equity_cashflow_contribution)}`,
      ),
      cashflowGroup(
        "期权",
        `${number(period.option_closed_trades, 0)} 个完成周期`,
        "option",
        [
          { label: "毛收益（未扣手续费）", value: period.option_gross_pnl, definition: TERM_DEFINITIONS.grossTradingPnl },
          { label: "手续费成本（完整周期分摊）", value: negativeMetric(period.option_fees), definition: "已分摊到期权完整持仓周期的佣金及费用，以负数显示。", unknownText: "不可得" },
          { label: "扣费后净入账", value: period.option_net_pnl, definition: TERM_DEFINITIONS.netTradingPnl, primary: true },
        ],
        `胜率 ${pct(period.option_win_rate)} · 利润因子 ${number(period.option_profit_factor, 2)} · 现金流贡献 ${pct(period.option_cashflow_contribution)}`,
      ),
      cashflowGroup(
        "股息分红",
        "已入账 USD 现金股息",
        "dividend",
        [
          { label: "税前现金股息", value: period.dividend_gross_cashflow, definition: "券商已入账的 USD 现金股息毛额，尚未扣除股息预扣税。" },
          { label: "股息预扣税", value: period.dividend_tax_cashflow, definition: "券商已入账的 USD 股息预扣税，通常为负值。" },
          { label: "税后实际入账", value: period.dividend_cashflow, definition: TERM_DEFINITIONS.dividendIncome, primary: true },
        ],
        `现金流贡献 ${pct(period.dividend_cashflow_contribution)} · 不含未入账应收股息`,
      ),
      cashflowGroup(
        "长期持仓融资",
        "账户级现金调整",
        "cost",
        [
          { label: display.generatedComplete ? "现金流创造" : "可确认现金流创造", value: displayedGeneratedCashflow, definition: TERM_DEFINITIONS.generatedCashflow },
          { label: "融资 / 借券 / 其他利息", value: accountInterest, definition: "服务长期持仓的融资成本及账户其他已入账利息净额；负值减少生活开支可用现金，但不归因给日内或期权策略。" },
          { label: display.livingComplete ? "生活开支净现金流" : "可确认生活开支净现金流", value: livingCashflow, definition: TERM_DEFINITIONS.livingExpenseCashflow, primary: true },
        ],
        "不等于安全可提现金额；仍需结算现金、保证金安全垫与税务准备金。",
      ),
    );
    const scopeNote = period.cashflow_scope === "ACTIVE_PLUS_PASSIVE"
      ? `贡献度只分解主动股票、期权和税后股息；长期持仓融资利息仅调整生活开支净现金流${period.long_term_realization_count ? `；已排除 ${period.long_term_realization_count} 笔长期资产处置` : ""}${period.excluded_non_usd_cashflow_records ? `；另有 ${period.excluded_non_usd_cashflow_records} 条非 USD 流水未换汇、已排除` : ""}。`
      : `${period.passive_cashflow_coverage_reason || "股息 / 利息流水覆盖不完整。"} 当前金额仅含可确认来源，不可作为可分配现金、追加交易或结束当日交易的依据。`;
    const coverageNote = !realizedComplete
      ? `Realized 配对仅部分覆盖：排除 ${period.excluded_instrument_count || 0} 个标的、${period.excluded_realization_count || 0} 笔无法可靠配对的平仓；不得把本卡金额视为账户全部已实现收益。`
      : period.active_scope_coverage_status !== "COMPLETE"
        ? `有 ${period.unclassified_overnight_realization_count || 0} 笔隔夜股票尚未标记为主动或长期；已确认小计不代表完整总额。`
      : period.coverage_status === "PARTIAL"
        ? "Realized 配对覆盖完整，但历史范围不完整；本卡金额只代表上述实际覆盖期。"
        : period.coverage_status === "UNKNOWN"
          ? "共同历史起点无法确认，未生成确定性累计金额。"
            : (period.dividend_coverage_status ?? period.passive_cashflow_coverage_status) !== "COMPLETE" ||
                (period.interest_coverage_status ?? period.passive_cashflow_coverage_status) !== "COMPLETE"
              ? "股息或利息现金流水覆盖不完整；本卡仅显示可确认来源金额。"
              : periodDecisionComplete(display)
            ? "Realized 与历史覆盖完整。"
            : "券商来源或费用覆盖不完整，本卡仅用于核对。";
    const advice = el(
      "p",
      "trading-advice",
      `${period.coverage_reason || ""} ${coverageNote} ${tradingAction(period, portfolioSummary, display)} ${scopeNote}`,
    );
    append(row, head, primary, bridge, inputsHead, inputs, advice);
    periodList.appendChild(row);
  });
  card.appendChild(periodList);
  if ((trading.strategies || []).length) {
    const breakdownTitle = el("h3", "trading-breakdown-title", "回填期收益来源");
    const breakdown = el("div", "trading-breakdown");
    trading.strategies.slice(0, 12).forEach((item) => {
      const row = el("div", `trading-breakdown-row ${Number(item.net_pnl) < 0 ? "loss" : "win"}`);
      const identity = el("div");
      append(
        identity,
        el("strong", "", item.symbol),
        el("span", "", `${item.broker} · ${item.category}`),
      );
      const result = el("div", "trading-breakdown-result");
      append(
        result,
        el("strong", "", usd(item.net_pnl)),
        el("span", "", `${item.closed_trades} 个周期 · 胜率 ${pct(item.win_rate)}`),
      );
      append(row, identity, result);
      breakdown.appendChild(row);
    });
    append(card, breakdownTitle, breakdown);
  }
  if (trading.meta?.methodology) {
    card.appendChild(el("p", "trading-method", trading.meta.methodology));
  }
  return card;
}

const TR5_INTENT_LABELS = {
  SWING_ATTACHED: "短线波段（附加关联）",
  SWING_NEARBY: "短线波段（当日认领）",
  SWING_SHORT_COVER: "短线空头回补",
  CORE: "长线底仓减持",
  MIXED: "混合归属",
  OPTION_CLOSE: "期权平仓",
  OPTION_EXPIRATION: "期权到期",
  OPTION_ASSIGNMENT: "期权行权指派",
  OPTION_EXERCISE: "期权主动行权",
  OVERRIDE_CORE: "手工设为底仓减持",
  OVERRIDE_SWING: "手工设为短线波段",
  DIVIDEND: "税前股息入账",
  DIVIDEND_TAX: "股息预扣税",
  PTP_WITHHOLDING: "合伙企业预扣税",
  BROKER_FEE: "券商账户杂费",
  INTEREST: "融资/现金利息",
};

function tr5IntentLabel(kind, intent) {
  return TR5_INTENT_LABELS[intent] || kind || "现金流水";
}

function tr5ExtractSellFillId(eventId) {
  return String(eventId || "").trim().replace(/^(?:swing|core|short_cover)\|/, "");
}

function tr5FormatQty(qty) {
  return Number.isInteger(qty) ? number(qty, 0) : number(qty, 2);
}

function tr5OpenOverrideDialog({ row, onSubmitted }) {
  const existing = byId("tr5-override-dialog");
  if (existing) existing.remove();
  const dialog = document.createElement("dialog");
  dialog.id = "tr5-override-dialog";
  dialog.className = "tr5-override-dialog";
  const resolvedSellFillId = tr5ExtractSellFillId(row.event_id);
  const heading = el("h3", "tr5-dialog-title", `意图纠偏 · ${row.symbol} (${row.broker})`);
  const desc = el(
    "p",
    "tr5-dialog-desc",
    `交易日期 ${row.monitoring_day} · 成交编号 ${resolvedSellFillId} · 当前分类「${tr5IntentLabel(row.event_kind, row.intent)}」`,
  );
  const form = document.createElement("form");
  form.method = "dialog";
  form.className = "tr5-dialog-form";

  const actionField = el("label", "tr5-dialog-field");
  actionField.appendChild(el("span", "", "选择归属调整方式"));
  const select = document.createElement("select");
  select.id = "tr5-override-action";
  [
    ["SET_CORE", "设为长线底仓减持（释放本金，不冲减波段收益）"],
    ["SET_SWING", "设为短线主动波段（指定买入成交配对）"],
    ["CLEAR", "恢复系统自动配对规则"],
  ].forEach(([val, text]) => {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = text;
    select.appendChild(opt);
  });
  select.value = "SET_CORE";
  actionField.appendChild(select);

  const buyField = el("label", "tr5-dialog-field");
  buyField.id = "tr5-override-buy-wrap";
  buyField.hidden = true;
  buyField.appendChild(el("span", "", "配对买入成交编号"));
  const buyInput = document.createElement("input");
  buyInput.id = "tr5-override-buy-id";
  buyInput.type = "text";
  buyInput.placeholder = "例如: FUTU_BUY_001";
  buyInput.value = row.matched_lots?.[0]?.buy_fill_id || "";
  buyField.appendChild(buyInput);

  const noteField = el("label", "tr5-dialog-field");
  noteField.appendChild(el("span", "", "复盘备注（可选，最多 200 字）"));
  const noteInput = document.createElement("input");
  noteInput.id = "tr5-override-note";
  noteInput.type = "text";
  noteInput.maxLength = 200;
  noteInput.placeholder = "记录调整理由以供日后复盘";
  noteField.appendChild(noteInput);

  const errorNode = el("p", "tr5-dialog-error");
  errorNode.hidden = true;
  select.addEventListener("change", () => {
    buyField.hidden = select.value !== "SET_SWING";
  });

  const footer = el("div", "tr5-dialog-actions");
  const cancelBtn = el("button", "tr5-btn-secondary", "取消");
  cancelBtn.type = "button";
  cancelBtn.setAttribute("autofocus", "");
  cancelBtn.addEventListener("click", () => dialog.close("cancel"));
  const submitBtn = el("button", "tr5-btn-primary", "确认保存纠偏");
  submitBtn.type = "submit";
  footer.append(cancelBtn, submitBtn);

  append(form, heading, desc, actionField, buyField, noteField, errorNode, footer);
  dialog.appendChild(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorNode.hidden = true;
    errorNode.textContent = "";
    submitBtn.disabled = true;
    submitBtn.textContent = "提交中…";
    try {
      await submitTradingOverride({
        sell_fill_id: resolvedSellFillId,
        action: select.value,
        target_buy_fill_id: select.value === "SET_SWING" ? buyInput.value : null,
        broker: row.broker,
        note: noteInput.value,
      });
      if (unlockKey && dialog.open) dialog.close("submitted");
    } catch (err) {
      errorNode.textContent = err instanceof Error ? err.message : "保存纠偏失败，请检查输入。";
      errorNode.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "确认保存纠偏";
    }
  });

  dialog.addEventListener("close", () => {
    const resultValue = dialog.returnValue;
    dialog.returnValue = "";
    dialog.remove();
    if (resultValue === "submitted" && byId("trading-content") && typeof onSubmitted === "function") {
      onSubmitted();
    }
  });

  document.body.appendChild(dialog);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function renderTradingV2PrivateLedgerSection({ model, toneFor, onSubmitted }) {
  const ledgerSection = el("section", "tr5-private-ledger-section");
  const ledgerHead = el("div", "tr5-ledger-head");
  const ledgerTitleWrap = el("div");
  append(
    ledgerTitleWrap,
    el("h3", "", "逐笔卖出配对与流水明细（私有会话）"),
    el("p", "tr5-ledger-subtitle", "仅在已解锁本地会话后经一次性质询认证拉取；锁定看板即立即清除内存与页面状态。"),
  );
  const ledgerActions = el("div", "tr5-ledger-actions");
  if (unlockKey && LIVE_CLIENT.tradingLedgerUrl) {
    const reloadBtn = el(
      "button",
      "tr5-btn-secondary",
      tradingLedgerRuntime.state === "loading" ? "同步账本中…" : "重新加载账本",
    );
    reloadBtn.type = "button";
    reloadBtn.disabled = tradingLedgerRuntime.state === "loading";
    reloadBtn.addEventListener("click", () => void loadPrivateTradingLedger({ period: model.cadence, force: true }));
    ledgerActions.appendChild(reloadBtn);
  }
  append(ledgerHead, ledgerTitleWrap, ledgerActions);
  ledgerSection.appendChild(ledgerHead);

  if (!unlockKey) {
    ledgerSection.appendChild(el("p", "section-note", "看板未解锁，私有逐笔明细已隔离隐藏。"));
    return ledgerSection;
  }
  if (!LIVE_CLIENT.tradingLedgerUrl) {
    ledgerSection.appendChild(el("p", "section-note", "未配置私有账本接口地址，当前仅展示公开聚合视角。"));
    return ledgerSection;
  }
  if (tradingLedgerRuntime.overrideMessage) {
    ledgerSection.appendChild(
      el(
        "div",
        `tr5-override-toast ${tradingLedgerRuntime.overrideState === "error" ? "error" : "ok"}`,
        tradingLedgerRuntime.overrideMessage,
      ),
    );
  }
  if (tradingLedgerRuntime.state === "idle") {
    const triggerBtn = el("button", "tr5-btn-primary", "加载私有逐笔明细");
    triggerBtn.type = "button";
    triggerBtn.addEventListener("click", () => void loadPrivateTradingLedger({ period: model.cadence }));
    ledgerSection.appendChild(triggerBtn);
    return ledgerSection;
  }
  if (tradingLedgerRuntime.state === "loading" && !tradingLedgerRuntime.data) {
    ledgerSection.appendChild(el("p", "section-note", "正在通过安全质询拉取私有逐笔配对数据…"));
    return ledgerSection;
  }
  if (tradingLedgerRuntime.state === "error") {
    const errWrap = el("div", "tr5-ledger-error");
    errWrap.appendChild(el("p", "", tradingLedgerRuntime.error || "私有逐笔账本拉取失败。"));
    const retryBtn = el("button", "tr5-btn-secondary", "重试加载");
    retryBtn.type = "button";
    retryBtn.addEventListener("click", () => void loadPrivateTradingLedger({ period: model.cadence, force: true }));
    errWrap.appendChild(retryBtn);
    ledgerSection.appendChild(errWrap);
    return ledgerSection;
  }
  const events = tradingLedgerRuntime.data?.events || [];
  if (!events.length) {
    ledgerSection.appendChild(el("p", "section-note", "所选统计窗口内暂无卖出平仓或现金流水记录。"));
    return ledgerSection;
  }

  const wrap = el("div", "tr5-ledger-wrap");
  wrap.setAttribute("role", "region");
  wrap.setAttribute("aria-label", "逐笔卖出配对与现金流水表");
  wrap.tabIndex = 0;

  const tableEl = el("table", "tr5-ledger-table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["交易日期", "券商", "标的", "分类归属", "成交价格与费用", "配对买入批次", "已实现 / 回流", "纠偏"].forEach((colTitle) => {
    headRow.appendChild(el("th", "", colTitle));
  });
  thead.appendChild(headRow);
  tableEl.appendChild(thead);

  const tbody = document.createElement("tbody");
  events.slice(0, 80).forEach((ev) => {
    const tr = document.createElement("tr");
    const cell = (label, contentNodeOrText, cls = "") => {
      const td = el("td", cls);
      td.setAttribute("data-label", label);
      if (typeof contentNodeOrText === "string") td.textContent = contentNodeOrText;
      else td.appendChild(contentNodeOrText);
      return td;
    };

    const lotsNode = el("div", "tr5-lots-cell");
    if (ev.matched_lots && ev.matched_lots.length > 0) {
      const details = el("details", "tr5-lots-details");
      details.appendChild(el("summary", "", `${ev.matched_lots.length} 笔配对买入`));
      const list = el("ul", "tr5-lots-list");
      ev.matched_lots.forEach((lot) => {
        list.appendChild(
          el(
            "li",
            "",
            `${lot.buy_fill_id} · ${tr5FormatQty(lot.matched_qty)} 股 @ ${usdExact(lot.buy_price)} (买费 ${usdExact(-Math.abs(lot.alloc_buy_fee))})`,
          ),
        );
      });
      details.appendChild(list);
      lotsNode.appendChild(details);
    } else {
      lotsNode.textContent = ev.event_kind === "CORE" ? "底仓均价池扣减" : "—";
    }

    const feeSum = (ev.sell_fees ?? 0) + (ev.buy_fees ?? 0);
    const execSummary = ev.sell_price !== null && ev.qty !== null
      ? `${tr5FormatQty(ev.qty)} @ ${usdExact(ev.sell_price)} · 费 ${usdExact(-Math.abs(feeSum))}`
      : `净现金 ${usdExact(ev.cashflow_inflow)}`;

    const outcomeVal = ev.realized_net_profit ?? ev.cashflow_inflow;
    const outcomeWrap = el("div", "tr5-outcome-cell");
    outcomeWrap.appendChild(el("strong", toneFor(outcomeVal), usd(outcomeVal)));
    if (ev.released_principal !== null && ev.released_principal > 0) {
      outcomeWrap.appendChild(el("small", "", `释放本金 ${usd(ev.released_principal)}`));
    }

    const actionWrap = el("div");
    if (ev.event_kind === "SWING" || ev.event_kind === "CORE") {
      const btn = el("button", "tr5-override-btn", "意图纠偏");
      btn.type = "button";
      btn.addEventListener("click", () => tr5OpenOverrideDialog({ row: ev, onSubmitted }));
      actionWrap.appendChild(btn);
    } else {
      actionWrap.textContent = "—";
    }

    append(
      tr,
      cell("交易日期", ev.monitoring_day),
      cell("券商", ev.broker),
      cell("标的", ev.symbol, "tr5-symbol-cell"),
      cell("分类归属", tr5IntentLabel(ev.event_kind, ev.intent)),
      cell("成交价格与费用", execSummary),
      cell("配对买入批次", lotsNode),
      cell("已实现 / 回流", outcomeWrap),
      cell("纠偏", actionWrap),
    );
    tbody.appendChild(tr);
  });
  tableEl.appendChild(tbody);
  wrap.appendChild(tableEl);
  ledgerSection.appendChild(wrap);
  return ledgerSection;
}
// @app-block-end b126

export { renderTradingV2PrivateLedgerSection };
