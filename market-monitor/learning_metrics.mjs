export function learningMetrics(row) {
  const n=value=>typeof value==='number' && Number.isFinite(value)?value:null;
  const wins=n(row?.wins),losses=n(row?.losses),count=n(row?.closed_trades);
  const win=n(row?.average_win),loss=n(row?.average_loss),fees=n(row?.fees),profit=n(row?.gross_profit);
  const validCount=value=>Number.isSafeInteger(value) && value>=0;
  const decisive=validCount(wins) && validCount(losses) ? wins+losses : null;
  const consistent=validCount(count) && (decisive===null || decisive<=count);
  const zeroCounts=['wins','losses'].every(key=>row?.[key]==null || row[key]===0);
  const expected=consistent && count===0 && zeroCounts?0
    :consistent && decisive!==null && count>0 && (wins===0 || win!==null) && (losses===0 || loss!==null)
    ? ((wins===0?0:wins*win)+(losses===0?0:losses*loss))/count:null;
  return {payoff_ratio:n(win!==null && loss!==null && loss<0?win/Math.abs(loss):null),expectancy_usd:n(expected),fee_to_gross_profit:n(fees!==null && profit!==null && profit>0?fees/profit:null)};
}
