const CONTRACT = "intent_income_report_v1";
const CARD_NUMBERS = ["target", "settled_income_usd", "settled_income", "gap", "daily_reference", "today_remaining",
  "remaining_including_today", "daily_reference_usd", "daily_reference_cny", "principal_usd", "principal_cny", "target_rate", "cash_return", "fx_rate"];
const number = value => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid intent report number");
  return value;
};
const choice = (value, values) => {
  if (!values.includes(value)) throw new Error("Invalid intent report state");
  return value;
};
const text = (value, pattern) => {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error("Invalid intent report metadata");
  return value;
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function sanitizeIntentIncome(value) {
  if (value?.contract_id !== CONTRACT) throw new Error("Invalid intent report contract");
  if (value.state === "UNAVAILABLE") return { contract_id: CONTRACT, state: "UNAVAILABLE" };
  const safe = { contract_id: CONTRACT, generation_id: text(value.generation_id, /^[a-f0-9]{64}$/),
    state: choice(value.state, ["LIVE", "CLOSED"]), trade_date: text(value.trade_date, DAY),
    checked_at: text(value.checked_at, STAMP), economic_cutoff: text(value.economic_cutoff, STAMP),
    income_contract: choice(value.income_contract, ["intent_realized_income_v1"]),
    pace_contract: choice(value.pace_contract, ["intent_income_pace_v1"]),
    audit_status: choice(value.audit_status, ["OK", "PARTIAL", "MISMATCH"]) };
  safe.metrics = {};
  for (const key of ["trading", "living"]) {
    const row = value.metrics[key];
    const total = number(row.formal_total), subtotal = number(row.confirmed_subtotal);
    const coverage = choice(row.coverage, ["COMPLETE", "PARTIAL"]);
    if ((total !== null) !== (coverage === "COMPLETE") || subtotal === null || (total !== null && total !== subtotal)
      || !Number.isInteger(row.pending_count) || row.pending_count < 0) throw new Error("Invalid intent coverage");
    safe.metrics[key] = { formal_total: total, confirmed_subtotal: subtotal, coverage, pending_count: row.pending_count };
  }
  safe.components = Object.fromEntries(["active_equity", "options", "core", "dividends", "interest"].map(k => [k, number(value.components[k])]));
  for (const k of ["execution_fees", "confirmed_execution_fees", "execution_count", "premium_received", "economic_pnl", "monthly_core_income", "monthly_income_without_core", "open_active_stock_cost", "open_active_unrealized"]) safe[k] = number(value[k]);
  safe.monthly_core_coverage=choice(value.monthly_core_coverage,["COMPLETE","PARTIAL"]);
  safe.pace = {};
  for (const kind of ["month", "year"]) {
    const row = value.pace[kind];
    const count = row.remaining_sessions;
    if (count !== null && (!Number.isInteger(count) || count < 0)) throw new Error("Invalid session count");
    safe.pace[kind] = { ...Object.fromEntries(CARD_NUMBERS.map(k => [k, number(row[k])])),
      period: text(row.period, kind === "month" ? /^\d{4}-\d{2}$/ : /^\d{4}$/),
      state: choice(row.state, ["LIVE", "PREVIEW", "ENDED"]), coverage: choice(row.coverage, ["COMPLETE", "PARTIAL"]),
      target_currency: choice(row.target_currency, kind === "month" ? ["CNY"] : ["USD", "CNY"]), remaining_sessions: count,
      baseline_quality: choice(row.baseline_quality ?? (kind === "month" ? "NOT_APPLICABLE" : row.principal_usd != null ? "PROVEN" : "UNAVAILABLE"),
        kind === "month" ? ["NOT_APPLICABLE"] : ["PROVEN", "USER_ESTIMATE", "UNAVAILABLE"]) };
    if (kind === "year" && ((row.target_currency === "CNY") !== (safe.pace.year.baseline_quality === "USER_ESTIMATE"))) throw new Error("Invalid annual estimate label");
  }
  safe.history = (value.history || []).map(row => ({ trade_date: text(row.trade_date, DAY),
    coverage: choice(row.coverage, ["COMPLETE", "PARTIAL"]), net_income: number(row.net_income), confirmed_subtotal: number(row.confirmed_subtotal) }));
  safe.trends={};
  for (const kind of ["day","week","month","year"]) safe.trends[kind]=(value.trends?.[kind] || []).map(row=>{
    const coverage=choice(row.coverage,["COMPLETE","PARTIAL"]);
    const values=Object.fromEntries(["net_income","trading_income","interest","active_equity","options","core","dividends","confirmed_subtotal","provisional_net_income"].map(k=>[k,number(row[k])]));
    if (typeof row.provisional !== "boolean" || (values.net_income !== null) !== (coverage === "COMPLETE")) throw new Error("Invalid trend coverage");
    return {label:text(row.label,/^\d{4}-\d{2}(?:-\d{2})?$/),start:text(row.start,DAY),end:text(row.end,DAY),coverage,provisional:row.provisional,...values};
  });
  safe.monthly_history=(value.monthly_history || []).map(row=>({period:text(row.period,/^\d{4}-\d{2}$/),status:choice(row.status,["SETTLED","MTD"]),coverage:choice(row.coverage,["COMPLETE","PARTIAL"]),
    ...Object.fromEntries(["net_income","confirmed_subtotal","income_without_core"].map(k=>[k,number(row[k])]))}));
  safe.period_history=(value.period_history || []).map(row=>({kind:choice(row.kind,["week","year"]),start:text(row.start,DAY),end:text(row.end,DAY),coverage:choice(row.coverage,["COMPLETE","PARTIAL"]),net_income:number(row.net_income),confirmed_subtotal:number(row.confirmed_subtotal)}));
  safe.income_statistics=(value.income_statistics || []).map(row=>{
    const window=choice(row.window_months,[3,6,12]);
    if (!Number.isInteger(row.covered_months) || row.covered_months<0 || row.covered_months>window) throw new Error("Invalid income statistic");
    return {window_months:window,covered_months:row.covered_months,coverage:choice(row.coverage,["COMPLETE","PARTIAL"]),mean:number(row.mean),median:number(row.median)};
  });
  return safe;
}

export function selectIntentIncome(previous, incoming) {
  if (!incoming) return previous ? { contract_id: CONTRACT, state: "UNAVAILABLE" } : null;
  const next = sanitizeIntentIncome(incoming);
  if (previous?.generation_id && next.generation_id && Date.parse(previous.checked_at) > Date.parse(next.checked_at)) return previous;
  return next;
}

export function intentRiskMessage(gate) {
  if (gate?.value === "RED" && gate.status === "OK") return {
    tone: "red", headline: "组合红色闸门：停止新增日内风险",
    message: "盈利目标进度不能覆盖组合风险；先处理已有敞口并核对保证金。",
  };
  if (gate?.status !== "OK") return { tone: "amber", headline: "组合风险资料待确认", message: "先刷新持仓与保证金信息，目标进度不能替代风险判断。" };
  return { tone: "amber", headline: "目标仅作收入进度参考", message: "组合风险与保证金约束优先；月度、年度参考不构成追加交易要求。" };
}

const money = (value, currency = "USD") => value === null || value === undefined ? "—" : new Intl.NumberFormat("zh-CN", {
  style: "currency", currency, maximumFractionDigits: 2, minimumFractionDigits: 2,
}).format(value);
const node = (doc, tag, className, copy) => {
  const element = doc.createElement(tag);
  element.className = className;
  if (copy !== undefined) element.textContent = copy;
  return element;
};

export function renderIntentIncome(raw, doc = document) {
  const report = sanitizeIntentIncome(raw);
  const card = node(doc, "section", "live-trading-card intent-income-card");
  card.append(node(doc, "p", "eyebrow", "已实现收益 · 按交易归属核算"));
  if (report.state === "UNAVAILABLE") {
    card.append(node(doc, "h2", "", "收益账本待确认"), node(doc, "p", "", "成本基线、成交或归属资料尚未齐全，暂不判断净收入与目标进度。"));
    return card;
  }
  card.append(node(doc, "h2", "", `${report.trade_date} ${report.state === "LIVE" ? "截至当前 · 暂定" : "盘后已结束"}`));
  card.append(node(doc, "p", "live-trading-window", `按美东夜盘开始至对应交易日盘后结束统计；本金与未实现盈亏不计入。收益截止 ${report.economic_cutoff}。`));
  const primary = node(doc, "div", "intent-income-primary");
  for (const [key, title] of [["trading", "已实现交易净收益（含底仓减持）"], ["living", "生活开支净收入参考"]]) {
    const metric = report.metrics[key], item = node(doc, "div", "live-detail-item");
    item.append(node(doc, "span", "", title), node(doc, "strong", metric.formal_total < 0 ? "negative" : "", money(metric.formal_total)));
    item.append(node(doc, "small", "", metric.coverage === "COMPLETE"
      ? key === "living" ? "包含税后股息、已入账利息净额及融资支出" : "交易费用已扣除"
      : `可确认小计 ${money(metric.confirmed_subtotal)} · ${metric.pending_count} 项待确认，小计不是总收益或下限`));
    primary.append(item);
  }
  card.append(primary);
  const components = node(doc, "div", "live-detail-grid");
  for (const [key, title] of [["active_equity","中短线股票"],["options","期权已实现"],["core","底仓减持"],["dividends","税后股息"],["interest","已入账利息净额"]]) {
    const item = node(doc,"div","live-detail-item");
    item.append(node(doc,"span","",`${title} · 可确认`),node(doc,"strong","",money(report.components[key])));
    components.append(item);
  }
  card.append(components, node(doc, "p", "live-target-note", `卖出开仓权利金（成交） ${money(report.premium_received)}（另列，不重复计入利润）；全部成交费用 ${money(report.execution_fees)}（已在相应已实现利润中分摊）。`));
  card.append(renderIntentTrends(report.trends,doc));
  card.append(node(doc,"p","live-target-note",`本月已结算底仓收益${report.monthly_core_coverage === "PARTIAL" ? "可确认小计" : ""} ${money(report.monthly_core_income)}；不含底仓的净收入 ${money(report.monthly_income_without_core)}。底仓兑现可能包含多年积累利润，不代表每月可重复获得。`));
  card.append(node(doc, "h3", "", "交易节奏参考"),node(doc,"p","live-target-note","按已入账净收入计算。月度与年度是同一收益的两个目标，日参考不相加，也不要求为达标增加风险。"));
  const goals = node(doc, "div", "intent-goal-grid");
  for (const [kind, label] of [["month","月度目标"],["year","年度目标"]]) {
    const goal = report.pace[kind], item = node(doc,"section","intent-goal");
    const currency = goal.target_currency;
    item.append(node(doc,"h4","",`${goal.period} · ${label}`));
    const estimated = goal.baseline_quality === "USER_ESTIMATE";
    item.append(node(doc,"p","",kind === "month" ? `净收入 ${money(goal.target,"CNY")}` : `${estimated ? "年初本金估算" : "固定年初净资产"} ${money(estimated ? goal.principal_cny : goal.principal_usd,goal.target_currency)} × ${goal.target_rate === null ? "—" : `${(goal.target_rate*100).toFixed(0)}%`} = ${money(goal.target,goal.target_currency)}`));
    if (kind === "year") item.append(node(doc,"p","",`已结算现金收益率${estimated ? "（估算）" : ""}：${goal.cash_return === null ? "—" : `${(goal.cash_return * 100).toFixed(2)}%`}`));
    if (estimated) item.append(node(doc,"p","intent-note","本金由用户按年初净资产口径估计；年度差额与每日参考均为估算，实际净收入仍须完整确认。"));
    const rows = [["已结算净收入",money(goal.settled_income,currency)], ["已结算剩余目标",money(goal.gap,currency)],
      [goal.state === "LIVE" ? "剩余交易日（含今日）" : "剩余交易日",goal.remaining_sessions ?? "—"],
      [goal.state === "PREVIEW" ? "每日平均参考 · 预览" : "每日平均参考",`${money(goal.daily_reference_cny,"CNY")} / ${money(goal.daily_reference_usd)}`],
      ["今日已实现 · 暂定",report.state === "LIVE" ? money(report.metrics.living.formal_total) : "—"],
      ["今日还差",money(goal.today_remaining,currency)],["含今日的本期剩余",money(goal.remaining_including_today,currency)]];
    for (const [title,value] of rows) {
      const row=node(doc,"div","live-fact-row"); row.append(node(doc,"span","",title),node(doc,"strong","",String(value))); item.append(row);
    }
    item.append(node(doc,"small","",goal.state === "ENDED" ? "本期已结束" : goal.coverage === "COMPLETE" ? "日参考以此前已结算收益为基线，盘中不随今日盈利降低。" : "历史收入、本金、汇率或日历覆盖待确认，缺失项不按零处理。"));
    goals.append(item);
  }
  card.append(goals);
  card.append(node(doc,"p","live-target-note",`开放短线股票成本 ${money(report.open_active_stock_cost)}；未实现损益 ${money(report.open_active_unrealized)}（缺少同刻估值时保持未知，不计入已实现收入）。`));
  const monthly=node(doc,"details","intent-history"); monthly.append(node(doc,"summary","","周 / 月 / 年净收入与生活现金流稳定性"));
  for (const row of report.income_statistics) monthly.append(node(doc,"p","",`近${row.window_months}个月 · 完整覆盖${row.covered_months}个月 · 已覆盖完整月均值 ${money(row.mean)}，中位数 ${money(row.median)}${row.coverage === "PARTIAL" ? "（覆盖不全，不代表完整区间）" : ""}`));
  for (const row of report.period_history) monthly.append(node(doc,"p","",`${row.kind === "week" ? "本周" : "本年"} ${row.start}—${row.end} · ${row.coverage === "COMPLETE" ? money(row.net_income) : `待确认，小计 ${money(row.confirmed_subtotal)}`}`));
  for (const row of [...report.monthly_history].reverse()) monthly.append(node(doc,"p","",`${row.period} ${row.status === "MTD" ? "已结算月内" : "完整月"} · ${row.coverage === "COMPLETE" ? money(row.net_income) : `待确认，小计 ${money(row.confirmed_subtotal)}`} · 不含底仓 ${money(row.income_without_core)}`));
  card.append(monthly);
  const history=node(doc,"details","intent-history"); history.append(node(doc,"summary","","已结算净收入记录"));
  for (const row of [...report.history].reverse()) history.append(node(doc,"p","",`${row.trade_date} · ${row.coverage === "COMPLETE" ? money(row.net_income) : `待确认，小计 ${money(row.confirmed_subtotal)}`}`));
  card.append(history,node(doc,"p","live-target-note",`账户经济损益（含未实现变化）：${money(report.economic_pnl)} · 核对：${{OK:"一致",PARTIAL:"证据待齐全",MISMATCH:"存在差异，需核对"}[report.audit_status]} · 检查时间 ${report.checked_at}`));
  return card;
}
import { renderIntentTrends } from "./intent_income_trends.mjs";
