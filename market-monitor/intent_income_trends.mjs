// One calendar-aligned, server-calculated management ledger across every view.
let preferredCadence="day";
const labels={day:"日",week:"周",month:"月",year:"年"};
const amounts=value=>value===null ? "—" : new Intl.NumberFormat("zh-CN",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(value);
const make=(doc,tag,className,text)=>{
  const n=doc.createElement(tag); n.className=className; if(text!==undefined)n.textContent=text; return n;
};
const svgNode=(doc,tag,attrs,text)=>{
  const n=doc.createElementNS("http://www.w3.org/2000/svg",tag);
  for(const [k,v] of Object.entries(attrs)) n.setAttribute(k,String(v));
  if(text!==undefined)n.textContent=text; return n;
};

export function renderIntentTrends(trends,doc=document){
  const root=make(doc,"section","intent-trends");
  const summary=make(doc,"div","intent-period-grid");
  for(const kind of Object.keys(labels)){
    const row=trends[kind]?.at(-1), item=make(doc,"div","intent-period-summary");
    item.append(make(doc,"span","",`当${labels[kind]}净收入`),make(doc,"strong",row?.net_income<0?"negative":"",amounts(row?.net_income??null)),
      make(doc,"small","",row ? `${row.start}—${row.end}${row.provisional ? ` · 今日暂定 ${amounts(row.provisional_net_income)}` : " · 已结算"}${row.coverage==="PARTIAL" && !row.provisional ? " · 待确认" : ""}` : "资料待确认"));
    summary.append(item);
  }
  const controls=make(doc,"div","chart-cadence-control"); controls.setAttribute("aria-label","收益趋势粒度");
  const content=make(doc,"div","intent-trend-content");
  const buttons={};
  const draw=kind=>{
    preferredCadence=kind;
    for(const key of Object.keys(buttons)) buttons[key].setAttribute("aria-pressed",String(key===kind));
    content.replaceChildren();
    const rows=trends[kind]||[];
    const description={day:"最近30个美股交易日，每点为当日净收入。",week:"最近16周，每点为该周净收入。",month:"最近12个月，每点为该月净收入。",year:"本年按月累计，每点为年初至该月的净收入。"}[kind];
    content.append(make(doc,"p","live-target-note",`${description}正式曲线与周/月/年汇总仅含完整结算日；日图单独显示今日暂定点，盘后结算后再纳入累计。空缺保留断点，不补零。金额为美元。`));
    if(!rows.length){content.append(make(doc,"p","","暂无可绘制的数据"));return;}
    const legend=make(doc,"div","intent-trend-legend");
    const curves=[["net_income","完整净收入"],["trading_income","交易净收益"],["interest","利息净额"]];
    for(const [key,label] of curves)legend.append(make(doc,"span",`intent-line-${key}`,label));
    content.append(legend);
    const chart=svgNode(doc,"svg",{viewBox:"0 0 820 290",role:"img","aria-label":`${labels[kind]}收益趋势；可在下方选择期间查看数值`});
    const values=rows.flatMap(r=>[...curves.map(([k])=>r[k]),r.provisional_net_income].filter(v=>v!==null));
    let lo=Math.min(0,...values),hi=Math.max(0,...values);
    if(lo===hi){lo-=1;hi+=1;}
    const x=i=>75+(rows.length===1?350:i*700/(rows.length-1));
    const y=v=>235-(v-lo)/(hi-lo)*210;
    for(let i=0;i<=4;i++){
      const value=lo+(hi-lo)*i/4;
      chart.append(svgNode(doc,"line",{x1:75,x2:775,y1:y(value),y2:y(value),class:"intent-chart-grid"}),
        svgNode(doc,"text",{x:65,y:y(value)+4,"text-anchor":"end",class:"intent-chart-label"},new Intl.NumberFormat("en-US",{maximumFractionDigits:0}).format(value)));
    }
    const detail=make(doc,"div","intent-trend-detail"); detail.setAttribute("aria-live","polite");
    const selector=make(doc,"select","intent-period-select"); selector.setAttribute("aria-label","查看收益期间");
    const show=index=>{
      const row=rows[index]; selector.value=String(index); detail.replaceChildren();
      detail.append(make(doc,"strong","",`${row.start}—${row.end}${kind==="year" ? " · 年内累计" : ""}${row.provisional ? " · 今日尚未结算" : " · 已结算"}`));
      if(row.provisional)detail.append(make(doc,"p","",`今日暂定净收入 ${amounts(row.provisional_net_income)}，单独展示，未计入已结算累计。`));
      else if(row.coverage!=="COMPLETE")detail.append(make(doc,"p","",`资料待确认；可确认小计 ${amounts(row.confirmed_subtotal)}，不能作为完整净收入。`));
      const items=make(doc,"div","intent-period-breakdown");
      for(const [key,label] of [...curves,["active_equity","中短线股票"],["options","期权"],["core","底仓减持"],["dividends","税后股息"]]){
        const item=make(doc,"div",""); item.append(make(doc,"span","",label),make(doc,"strong",row[key]<0?"negative":"",amounts(row[key])));items.append(item);
      }
      detail.append(items);
    };
    rows.forEach((row,i)=>{const option=make(doc,"option","",`${row.label}${row.coverage==="PARTIAL"?" · 待确认":""}${row.provisional?" · 暂定":""}`);option.value=String(i);selector.append(option);});
    selector.addEventListener("change",()=>show(Number(selector.value)));
    for(const [key,label] of curves){
      rows.forEach((row,i)=>{
        const value=row[key]; if(value===null)return;
        if(i>0 && rows[i-1][key]!==null)chart.append(svgNode(doc,"line",{x1:x(i-1),y1:y(rows[i-1][key]),x2:x(i),y2:y(value),class:`intent-chart-line intent-line-${key}${row.provisional?" provisional":""}`}));
        const point=svgNode(doc,"circle",{cx:x(i),cy:y(value),r:row.provisional?5:3.5,class:`intent-chart-point intent-line-${key}${row.provisional?" provisional":""}`,tabindex:0,role:"button","aria-label":`${row.label} ${label} ${amounts(value)}${row.provisional?" 暂定":""}`});
        point.append(svgNode(doc,"title",{},`${row.label} ${label} ${amounts(value)}`));
        point.addEventListener("click",()=>show(i));point.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();show(i);}});chart.append(point);
      });
    }
    rows.forEach((row,i)=>{
      if(!row.provisional || row.provisional_net_income===null)return;
      if(i>0 && rows[i-1].net_income!==null)chart.append(svgNode(doc,"line",{x1:x(i-1),y1:y(rows[i-1].net_income),x2:x(i),y2:y(row.provisional_net_income),class:"intent-chart-line intent-line-net_income provisional"}));
      const point=svgNode(doc,"circle",{cx:x(i),cy:y(row.provisional_net_income),r:5,class:"intent-chart-point intent-line-net_income provisional",tabindex:0,role:"button","aria-label":`${row.label} 今日暂定净收入 ${amounts(row.provisional_net_income)}`});
      point.append(svgNode(doc,"title",{},`${row.label} 暂定 ${amounts(row.provisional_net_income)}`));
      point.addEventListener("click",()=>show(i));point.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();show(i);}});chart.append(point);
    });
    const indices=[...new Set([0,Math.floor((rows.length-1)/3),Math.floor((rows.length-1)*2/3),rows.length-1])];
    for(const i of indices)chart.append(svgNode(doc,"text",{x:x(i),y:267,"text-anchor":"middle",class:"intent-chart-label"},rows[i].label));
    const scroll=make(doc,"div","intent-chart-scroll");scroll.append(chart);content.append(scroll,selector,detail);show(rows.length-1);
  };
  for(const [kind,label] of Object.entries(labels)){
    const button=make(doc,"button","chart-cadence-button",label);button.type="button";button.addEventListener("click",()=>draw(kind));buttons[kind]=button;controls.append(button);
  }
  root.append(make(doc,"h3","","收益概览与趋势"),summary,controls,content);draw(preferredCadence);return root;
}
