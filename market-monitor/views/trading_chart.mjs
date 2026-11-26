import {
  __set_tradingChartCadence,
  buildCashflowChartSeries,
  byId,
  tradingChartCadence,
  yearSeriesScope
} from "../lib/context.mjs";
import {
  append,
  el,
  section
} from "../lib/dom.mjs";
import {
  isFiniteMetric,
  number,
  pct,
  usd
} from "../lib/format.mjs";
import {
  negativeMetric,
  settledPeriodComplete,
  tradingSourcesComplete
} from "./trading.mjs";
import {
  renderTrading
} from "./trading_live.mjs";

// @app-block-start b127
export function renderTradingCashflowChart(trading) {
  const yearPeriod = (trading.periods || []).find((period) => period.cadence === "year");
  const yearComplete = Boolean(yearPeriod && settledPeriodComplete(trading, yearPeriod));
  const yearScope = yearSeriesScope(yearPeriod, yearComplete);
  const descriptions = {
    day: "最近30个有记录的美东监控日；分别显示现金流创造、已入账融资/利息与生活开支净现金流，部分覆盖保留可确认小计。",
    week: "最近16周；按周保留时间桶，分别汇总现金流创造、已入账融资/利息与生活开支净现金流。",
    month: "最近12个月；月份不会因局部未知而消失，缺失只形成对应序列断点。",
    year: yearPeriod?.coverage_status === "PARTIAL"
      ? yearPeriod.coverage_reason
      : yearPeriod?.coverage_status === "UNKNOWN"
        ? "共同历史覆盖起点未知，不生成确定性年内累计。"
        : yearComplete
          ? "本年度按月累计现金流创造、已入账融资/利息与生活开支净现金流"
          : "自然年历史存在，但 realized、策略归类、券商来源、股息或利息覆盖不完整；以下仅为年内可确认金额。",
  };
  const card = section("现金流创造与生活开支趋势", descriptions[tradingChartCadence]);
  const controls = el("div", "chart-cadence-control");
  [["day", "日"], ["week", "周"], ["month", "月"], ["year", "年"]].forEach(
    ([value, label]) => {
      const button = el("button", "chart-cadence-button", label);
      button.type = "button";
      button.setAttribute("aria-pressed", String(value === tradingChartCadence));
      button.addEventListener("click", () => {
        __set_tradingChartCadence(value);
        localStorage.setItem("zzao-monitor-trading-chart", value);
        renderTrading();
      });
      controls.appendChild(button);
    },
  );
  card.querySelector(".section-head").appendChild(controls);

  const series = buildCashflowChartSeries(
    trading.daily,
    tradingChartCadence,
    {
      yearPeriod,
      yearComplete,
      periods: trading.periods,
      sourcesComplete: tradingSourcesComplete(trading),
      scopeStart: yearPeriod?.start_date || null,
      scopeEnd: yearPeriod?.end_date || null,
    },
  );
  if (!series.length) {
    card.appendChild(el(
      "p",
      "trading-chart-empty",
      tradingChartCadence === "year" && yearPeriod?.coverage_status === "UNKNOWN"
        ? "共同历史覆盖起点无法确认，未绘制年内累计。"
        : "当前时间范围没有可绘制的已入账数据。",
    ));
    return card;
  }

  const latest = series.at(-1);
  const summary = el("div", "trading-chart-summary");
  const generatedLabel = latest.generatedComplete ? "现金流创造" : "可确认现金流创造";
  const livingLabel = latest.livingComplete ? "生活开支净现金流" : "可确认生活开支净现金流";
  const metricTone = (value) => isFiniteMetric(value)
    ? Number(value) < 0 ? "negative" : "positive"
    : "";
  const summaryItem = (label, value) => {
    const item = el("div", "trading-chart-summary-item");
    append(
      item,
      el("span", "", label),
      el("strong", metricTone(value), usd(value)),
    );
    return item;
  };
  const periodSummary = el("div", "trading-chart-summary-period");
  append(
    periodSummary,
    el("span", "", "当前时间桶"),
    el("strong", "", latest.fullLabel),
  );
  append(
    summary,
    periodSummary,
    summaryItem(generatedLabel, latest.value),
    summaryItem("融资 / 利息", latest.interestValue),
    summaryItem(livingLabel, latest.livingValue),
  );
  card.appendChild(summary);
  const legend = el("div", "trading-chart-legend");
  [
    ["generated", "实线", "现金流创造"],
    ["interest", "点线", "融资 / 利息"],
    ["living", "虚线", "生活开支净现金流"],
  ].forEach(([className, shape, label]) => {
    const item = el("span", "trading-chart-legend-item");
    append(
      item,
      el("i", `trading-chart-legend-swatch ${className}`, ""),
      el("span", "", `${label}（${shape}）`),
    );
    legend.appendChild(item);
  });
  card.appendChild(legend);

  const width = 820;
  const height = 250;
  const left = 72;
  const right = 20;
  const top = 18;
  const bottom = 215;
  const values = series.flatMap((row) =>
    [row.value, row.interestValue, row.livingValue].filter(isFiniteMetric).map(Number),
  );
  let minimum = Math.min(0, ...values);
  let maximum = Math.max(0, ...values);
  if (minimum === maximum) {
    minimum -= 1;
    maximum += 1;
  }
  const padding = (maximum - minimum) * 0.08;
  minimum -= padding;
  maximum += padding;
  const y = (value) =>
    top + ((maximum - Number(value)) / (maximum - minimum)) * (bottom - top);
  const x = (index) =>
    series.length === 1
      ? (left + width - right) / 2
      : left + (index / (series.length - 1)) * (width - left - right);

  const wrap = el("div", "trading-chart-wrap");
  const previousTooltip = byId("trading-chart-tooltip");
  if (previousTooltip) previousTooltip.remove();
  const tooltip = el("div", "trading-chart-tooltip");
  tooltip.id = "trading-chart-tooltip";
  tooltip.setAttribute("role", "status");
  tooltip.setAttribute("aria-live", "polite");
  tooltip.hidden = true;
  let pinnedPoint = null;
  let activePoint = null;
  let guideLine = null;
  const clearActivePoint = () => {
    activePoint?.classList.remove("active");
    activePoint = null;
    if (guideLine) guideLine.setAttribute("visibility", "hidden");
  };
  const closeTooltip = () => {
    pinnedPoint = null;
    tooltip.hidden = true;
    clearActivePoint();
  };
  const showPointTooltip = (anchor, row, pin = false) => {
    if (pin) pinnedPoint = pinnedPoint === anchor ? null : anchor;
    if (pin && !pinnedPoint) {
      tooltip.hidden = true;
      return;
    }
    const head = el("div", "trading-chart-tooltip-head");
    const close = el("button", "trading-chart-tooltip-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "关闭数据提示");
    close.addEventListener("click", closeTooltip);
    append(head, el("strong", "", row.fullLabel), close);
    const total = el("div", "trading-chart-tooltip-total");
    append(
      total,
      el("span", "", row.generatedComplete ? "现金流创造" : "可确认现金流创造"),
      el("strong", metricTone(row.value), usd(row.value)),
    );
    const livingTotal = el("div", "trading-chart-tooltip-total secondary");
    append(
      livingTotal,
      el("span", "", row.livingComplete ? "生活开支净现金流" : "可确认生活开支净现金流"),
      el("strong", metricTone(row.livingValue), usd(row.livingValue)),
    );
    const details = el("div", "trading-chart-tooltip-details");
    [
      ["股票因果同日策略净收益", row.same_day_equity_net_pnl],
      ["已归类跨日残余净收益", row.active_residual_overnight_equity_net_pnl],
      ["期权净入账", row.option_net_pnl],
      ["税后股息", row.dividend_cashflow],
      ["长期持仓融资 / 其他利息", row.account_interest_cashflow],
      ["手续费（已含在交易净额）", isFiniteMetric(row.fees) ? -Math.abs(Number(row.fees)) : null],
    ].forEach(([label, value]) => {
      const detail = el("div");
      append(detail, el("span", "", label), el("strong", "", usd(value)));
      details.appendChild(detail);
    });
    tooltip.replaceChildren(head, total, livingTotal, details);
    tooltip.hidden = false;
    tooltip.style.left = "0px";
    tooltip.style.top = "0px";
    const anchorRect = anchor.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const margin = 12;
    const center = anchorRect.left + anchorRect.width / 2;
    const leftPosition = Math.min(
      window.innerWidth - tooltipRect.width - margin,
      Math.max(margin, center - tooltipRect.width / 2),
    );
    const above = anchorRect.top - tooltipRect.height - 10;
    const topPosition = above >= margin ? above : anchorRect.bottom + 10;
    tooltip.style.left = `${leftPosition}px`;
    tooltip.style.top = `${topPosition}px`;
  };
  document.body.appendChild(tooltip);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "trading-cashflow-chart");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", `${yearScope || "现金流"}${descriptions[tradingChartCadence]}趋势图`);

  [maximum, 0, minimum].forEach((value) => {
    const line = document.createElementNS(svg.namespaceURI, "line");
    line.setAttribute("x1", String(left));
    line.setAttribute("x2", String(width - right));
    line.setAttribute("y1", String(y(value)));
    line.setAttribute("y2", String(y(value)));
    line.setAttribute("class", value === 0 ? "trading-chart-zero" : "trading-chart-grid");
    svg.appendChild(line);
    const label = document.createElementNS(svg.namespaceURI, "text");
    label.setAttribute("x", String(left - 9));
    label.setAttribute("y", String(y(value) + 4));
    label.setAttribute("text-anchor", "end");
    label.setAttribute("class", "trading-chart-axis-label");
    label.textContent = usd(value, true);
    svg.appendChild(label);
  });

  const appendSeriesSegments = (valueKey, className) => {
    let segment = [];
    const flush = () => {
      if (!segment.length) return;
      if (segment.length === 1) {
        const marker = document.createElementNS(svg.namespaceURI, "circle");
        marker.setAttribute("cx", String(segment[0][0]));
        marker.setAttribute("cy", String(segment[0][1]));
        marker.setAttribute("r", "2.25");
        marker.setAttribute("class", `trading-chart-series-point ${className}`.trim());
        svg.appendChild(marker);
      } else {
        const line = document.createElementNS(svg.namespaceURI, "polyline");
        line.setAttribute("points", segment.map((point) => point.join(",")).join(" "));
        line.setAttribute("class", `trading-chart-line ${className}`.trim());
        svg.appendChild(line);
      }
      segment = [];
    };
    series.forEach((row, index) => {
      if (!isFiniteMetric(row[valueKey])) {
        flush();
        return;
      }
      segment.push([x(index), y(row[valueKey])]);
    });
    flush();
  };
  appendSeriesSegments("value", "generated");
  appendSeriesSegments("interestValue", "interest");
  appendSeriesSegments("livingValue", "living");

  guideLine = document.createElementNS(svg.namespaceURI, "line");
  guideLine.setAttribute("y1", String(top));
  guideLine.setAttribute("y2", String(bottom));
  guideLine.setAttribute("class", "trading-chart-guide");
  guideLine.setAttribute("visibility", "hidden");
  svg.appendChild(guideLine);

  const points = series.map((row, index) => {
    const anchorValue = [row.value, row.livingValue, row.interestValue].find(isFiniteMetric);
    if (!isFiniteMetric(anchorValue)) return null;
    const point = document.createElementNS(svg.namespaceURI, "circle");
    point.setAttribute("cx", String(x(index)));
    point.setAttribute("cy", String(y(anchorValue)));
    point.setAttribute("r", "3.5");
    point.setAttribute("tabindex", "0");
    point.setAttribute("role", "button");
    point.setAttribute(
      "aria-label",
      `${row.fullLabel}，${row.generatedComplete ? "现金流创造" : "可确认现金流创造"} ${usd(row.value)}，` +
      `${row.livingComplete ? "生活开支净现金流" : "可确认生活开支净现金流"} ${usd(row.livingValue)}，` +
      `股票因果同日策略 ${usd(row.same_day_equity_net_pnl)}，已归类跨日残余 ${usd(row.active_residual_overnight_equity_net_pnl)}，期权 ${usd(row.option_net_pnl)}，` +
      `税后股息 ${usd(row.dividend_cashflow)}，利息 ${usd(row.account_interest_cashflow)}，` +
      `手续费 ${usd(negativeMetric(row.fees))}`,
    );
    point.setAttribute("aria-describedby", tooltip.id);
    point.setAttribute("class", !isFiniteMetric(row.value)
      ? "trading-chart-point unknown"
      : Number(row.value) < 0 ? "trading-chart-point loss" : "trading-chart-point win");
    const title = document.createElementNS(svg.namespaceURI, "title");
    title.textContent = `${row.fullLabel}：${row.generatedComplete ? "创造" : "可确认创造"} ${usd(row.value)}；融资/利息 ${usd(row.interestValue)}；${row.livingComplete ? "生活开支净现金流" : "可确认生活开支净现金流"} ${usd(row.livingValue)}`;
    point.appendChild(title);
    svg.appendChild(point);
    return point;
  });

  const activatePoint = (index, pin = false) => {
    const point = points[index];
    const row = series[index];
    if (!point || !row) return;
    activePoint?.classList.remove("active");
    activePoint = point;
    activePoint.classList.add("active");
    guideLine.setAttribute("x1", String(x(index)));
    guideLine.setAttribute("x2", String(x(index)));
    guideLine.removeAttribute("visibility");
    showPointTooltip(point, row, pin);
    if (pin && !pinnedPoint) clearActivePoint();
  };

  points.forEach((point, index) => {
    if (!point) return;
    point.addEventListener("focus", () => activatePoint(index));
    point.addEventListener("blur", () => {
      if (!pinnedPoint) {
        tooltip.hidden = true;
        clearActivePoint();
      }
    });
    point.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activatePoint(index, true);
      }
      if (event.key === "Escape") closeTooltip();
    });
  });
  [0, series.length - 1].forEach((index) => {
    if (index < 0 || !series[index]) return;
    const label = document.createElementNS(svg.namespaceURI, "text");
    label.setAttribute("x", String(x(index)));
    label.setAttribute("y", String(height - 10));
    label.setAttribute("text-anchor", index === 0 ? "start" : "end");
    label.setAttribute("class", "trading-chart-axis-label");
    label.textContent = series[index].label;
    svg.appendChild(label);
  });

  const hitArea = document.createElementNS(svg.namespaceURI, "rect");
  hitArea.setAttribute("x", String(left));
  hitArea.setAttribute("y", String(top));
  hitArea.setAttribute("width", String(width - left - right));
  hitArea.setAttribute("height", String(bottom - top));
  hitArea.setAttribute("class", "trading-chart-hit-area");
  const nearestPointIndex = (event) => {
    const matrix = svg.getScreenCTM();
    let localX;
    if (matrix) {
      const pointer = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      localX = pointer.x;
    } else {
      const bounds = svg.getBoundingClientRect();
      localX = ((event.clientX - bounds.left) / bounds.width) * width;
    }
    if (series.length === 1) return points[0] ? 0 : -1;
    const ratio = (localX - left) / (width - left - right);
    const candidate = Math.max(0, Math.min(series.length - 1, Math.round(ratio * (series.length - 1))));
    return points.reduce((nearest, point, index) => {
      if (!point) return nearest;
      return nearest < 0 || Math.abs(index - candidate) < Math.abs(nearest - candidate)
        ? index
        : nearest;
    }, -1);
  };
  hitArea.addEventListener("pointermove", (event) => {
    const index = nearestPointIndex(event);
    if (!pinnedPoint && index >= 0) activatePoint(index);
  });
  hitArea.addEventListener("pointerleave", () => {
    if (!pinnedPoint) {
      tooltip.hidden = true;
      clearActivePoint();
    }
  });
  hitArea.addEventListener("click", (event) => {
    const index = nearestPointIndex(event);
    if (index >= 0) activatePoint(index, true);
  });
  svg.appendChild(hitArea);
  wrap.appendChild(svg);
  card.appendChild(wrap);
  return card;
}

function renderTradingV2AttributionSection({ model, toneFor }) {
  const attributionSection = el("section", "tr5-attribution-section");
  const { swing, options, core, passive } = model.pillars;
  const pillarsGrid = el("div", "tr5-pillars-grid");

  const swingCard = el("article", "tr5-pillar-card");
  const swingHead = el("div", "tr5-pillar-head");
  append(swingHead, el("h3", "", "中短线主动波段"), el("span", "tr5-pillar-tag", `${swing.trades ?? "—"} 笔`));
  append(
    swingCard,
    swingHead,
    el("strong", `tr5-pillar-value ${toneFor(swing.netPnlUsd)}`.trim(), usd(swing.netPnlUsd)),
    el("p", "tr5-pillar-line", `胜率 ${swing.winRate !== null ? pct(swing.winRate) : "—"} · 胜/负 ${swing.wins ?? "—"} / ${swing.losses ?? "—"}`),
    el("p", "tr5-pillar-line", `毛利 ${usd(swing.grossPnlUsd)} · 税费 ${usd(swing.feesUsd !== null ? -Math.abs(swing.feesUsd) : null)}`),
  );

  const optionsCard = el("article", "tr5-pillar-card");
  const optionsHead = el("div", "tr5-pillar-head");
  append(optionsHead, el("h3", "", "期权交易"), el("span", "tr5-pillar-tag", `${options.trades ?? "—"} 笔`));
  append(
    optionsCard,
    optionsHead,
    el("strong", `tr5-pillar-value ${toneFor(options.netPnlUsd)}`.trim(), usd(options.netPnlUsd)),
    el("p", "tr5-pillar-line", `权利金/平仓毛利 ${usd(options.grossPnlUsd)}`),
    el("p", "tr5-pillar-line", `手续费与规费 ${usd(options.feesUsd !== null ? -Math.abs(options.feesUsd) : null)}`),
  );

  const coreCard = el("article", "tr5-pillar-card");
  const coreHead = el("div", "tr5-pillar-head");
  append(
    coreHead,
    el("h3", "", "长线底仓减持"),
    el("span", `tr5-pillar-tag ${core.costBaselineStatus === "COMPLETE" ? "ok" : "warning"}`, core.costBaselineStatus === "COMPLETE" ? "成本基线完整" : "成本基线待补"),
  );
  append(
    coreCard,
    coreHead,
    el("strong", `tr5-pillar-value ${toneFor(core.realizedNetProfitUsd)}`.trim(), `净盈亏 ${usd(core.realizedNetProfitUsd)}`),
    el("p", "tr5-pillar-line", `释放底仓本金 ${usd(core.releasedPrincipalUsd)}（单独回笼现金）`),
    el("p", "tr5-pillar-line", `减持回流总额 ${usd(core.totalCashInflowUsd)} · 卖出费用 ${usd(core.sellFeesUsd !== null ? -Math.abs(core.sellFeesUsd) : null)}`),
  );

  const passiveCard = el("article", "tr5-pillar-card");
  const passiveHead = el("div", "tr5-pillar-head");
  append(passiveHead, el("h3", "", "股息与账户利息"), el("span", "tr5-pillar-tag", "被动现金"));
  const accruedNote = passive.accruedInterestReferenceUsd !== null
    ? ` · 应计利息参考 ${usd(passive.accruedInterestReferenceUsd)}`
    : "";
  append(
    passiveCard,
    passiveHead,
    el("strong", `tr5-pillar-value ${toneFor(passive.passiveNetUsd)}`.trim(), usd(passive.passiveNetUsd)),
    el("p", "tr5-pillar-line", `税后股息 ${usd(passive.netDividendUsd)} · 券商杂费 ${usd(passive.brokerFeeUsd !== null ? -Math.abs(passive.brokerFeeUsd) : null)}`),
    el("p", "tr5-pillar-line", `已入账利息 ${usd(passive.interestUsd)}${accruedNote}`),
  );

  append(pillarsGrid, swingCard, optionsCard, coreCard, passiveCard);

  const trendCard = el("article", "tr5-trend-card");
  const trendDetail = el("div", "tr5-trend-detail", "点击或移动至柱条查看各期交易、股息利息与自由现金明细");
  trendDetail.id = "tr5-trend-detail";
  trendDetail.setAttribute("aria-live", "polite");
  const trendPoints = model.trend || [];
  const updateTrendDetail = (pt) => {
    trendDetail.textContent = `${pt.date}${pt.provisional ? "（盘中未结算）" : ""} · 净收益 ${usd(pt.netIncomeUsd)} · 交易 ${usd(pt.tradingUsd)} · 股息利息 ${usd(pt.passiveUsd)} · 自由流入 ${usd(pt.freeInflowUsd)}`;
  };
  const chartHeader = el("div", "tr5-trend-head");
  append(
    chartHeader,
    el("h3", "", `${{ day: "近30个交易日", week: "近16周", month: "近12个月", year: "本年逐月累计" }[model.cadence]}现金流走势`),
    trendDetail,
  );
  trendCard.appendChild(chartHeader);

  if (!trendPoints.length) {
    trendCard.appendChild(el("p", "section-note", "暂无足够历史结算点位，待数据完善后展示趋势。"));
  } else {
    const svgNs = "http://www.w3.org/2000/svg";
    const width = 680;
    const height = 180;
    const padX = 24;
    const padY = 18;
    const vals = trendPoints.flatMap((p) => [p.netIncomeUsd, p.freeInflowUsd]).filter(isFiniteMetric);
    const maxAbs = Math.max(10, ...vals.map((v) => Math.abs(v)));
    const midY = height / 2;
    const scaleY = (height / 2 - padY) / maxAbs;
    const slotW = (width - padX * 2) / Math.max(trendPoints.length, 1);
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("class", "tr5-trend-svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "交易现金流走势图");
    const axis = document.createElementNS(svgNs, "line");
    axis.setAttribute("x1", String(padX));
    axis.setAttribute("x2", String(width - padX));
    axis.setAttribute("y1", String(midY));
    axis.setAttribute("y2", String(midY));
    axis.setAttribute("class", "tr5-trend-zero-line");
    svg.appendChild(axis);

    const lastComplete = [...trendPoints].reverse().find((p) => p.netIncomeUsd !== null) || trendPoints.at(-1);
    if (lastComplete) updateTrendDetail(lastComplete);

    trendPoints.forEach((pt, idx) => {
      const cx = padX + idx * slotW + slotW / 2;
      const barW = Math.max(6, Math.min(20, slotW * 0.62));
      if (isFiniteMetric(pt.netIncomeUsd)) {
        const val = Number(pt.netIncomeUsd);
        const h = Math.max(3, Math.abs(val) * scaleY);
        const rect = document.createElementNS(svgNs, "rect");
        rect.setAttribute("x", (cx - barW / 2).toFixed(1));
        rect.setAttribute("y", (val >= 0 ? midY - h : midY).toFixed(1));
        rect.setAttribute("width", barW.toFixed(1));
        rect.setAttribute("height", h.toFixed(1));
        rect.setAttribute("rx", "3");
        rect.setAttribute("tabindex", "0");
        rect.setAttribute("role", "button");
        rect.setAttribute("aria-label", `${pt.label} 净现金收益 ${usd(pt.netIncomeUsd)}`);
        rect.setAttribute(
          "class",
          `tr5-trend-bar ${val >= 0 ? "pos" : "neg"} ${pt.provisional ? "provisional" : ""}`.trim(),
        );
        rect.addEventListener("mouseenter", () => updateTrendDetail(pt));
        rect.addEventListener("focus", () => updateTrendDetail(pt));
        rect.addEventListener("click", () => updateTrendDetail(pt));
        rect.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            updateTrendDetail(pt);
          }
        });
        svg.appendChild(rect);
      } else {
        const gapMark = document.createElementNS(svgNs, "circle");
        gapMark.setAttribute("cx", cx.toFixed(1));
        gapMark.setAttribute("cy", String(midY));
        gapMark.setAttribute("r", "3");
        gapMark.setAttribute("class", "tr5-trend-gap");
        gapMark.addEventListener("click", () => updateTrendDetail(pt));
        svg.appendChild(gapMark);
      }
    });
    trendCard.appendChild(svg);
  }

  append(attributionSection, pillarsGrid, trendCard);
  return attributionSection;
}
// @app-block-end b127

export { renderTradingV2AttributionSection };
