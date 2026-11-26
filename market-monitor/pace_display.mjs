/** Display progress without converting a monthly shortfall into a daily goal. */
export function renderMonthlyProgress(target, calendarStatus, {el, append, cny}) {
  const head = el("div", "live-target-head");
  append(head, el("strong", "", "月度目标进度"),
    el("span", "", target.status === "OK" ? "已结算进度" : target.referenceAvailable ? "可确认参考 · 不参与达标判断" : "收入覆盖待确认"));
  const scheduled = target.scheduledSessionsInMonth;
  const fixedBaseline = calendarStatus === "OK" && Number.isInteger(scheduled) && scheduled > 0 && scheduled <= 31
    && typeof target.monthlyTargetCny === "number" && Number.isFinite(target.monthlyTargetCny) && target.monthlyTargetCny > 0
    ? target.monthlyTargetCny / scheduled : null;
  const settled = target.status === "OK" ? cny(target.settledMtdActiveNetPnlCny)
    : target.referenceAvailable ? `可确认小计 ${cny(target.confirmedSettledMtdActiveNetPnlCny)}` : "待确认";
  const text = `月目标 ${cny(target.monthlyTargetCny)} · 本月已结算 ${settled}`
    + (fixedBaseline === null ? "" : `。月度固定均分参考 ${cny(fixedBaseline)} / 交易日（${scheduled} 个计划交易日）`);
  return [head, el("p", "live-target-formula", text),
    el("p", "live-target-note", "目标差额仅用于观察月度进度，不自动增加风险、仓位或交易次数。")];
}
