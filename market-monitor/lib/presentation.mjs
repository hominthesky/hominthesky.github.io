import {
  TERM_DEFINITIONS
} from "./context.mjs";
import {
  isFiniteMetric,
  number,
  pct
} from "./format.mjs";

// @app-block-start b102
export function riskClass(value) {
  const text = String(value || "").toUpperCase();
  if (text.includes("RED") || text.includes("极端") || text.includes("S4")) return "red";
  if (text.includes("高") || text.includes("S3") || text.includes("S2") || text.includes("PARTIAL")) {
    return "amber";
  }
  if (text.includes("GREEN") || text.includes("S6") || text.includes("OK")) return "green";
  return "";
}
// @app-block-end b102

// @app-block-start b103
export function actionTone(label) {
  const text = String(label || "");
  if (
    ["停止新增杠杆", "降杠杆至红线以下", "优先核对账户保证金", "优先减仓复核"].some(
      (item) => text.includes(item),
    )
  ) {
    return "tone-red";
  }
  if (
    ["暂停加仓", "等待确认", "等待压力", "减仓或保护复核", "持有但不加仓", "控制追涨"].some(
      (item) => text.includes(item),
    )
  ) {
    return "tone-amber";
  }
  if (["小仓分批买入候选", "修复候选"].some((item) => text.includes(item))) {
    return "tone-green";
  }
  return "tone-neutral";
}
// @app-block-end b103

// @app-block-start b104
export function portfolioMetricGuidance(summary) {
  const leverage = isFiniteMetric(summary.gross_leverage)
    ? Number(summary.gross_leverage)
    : null;
  const leverageRed = isFiniteMetric(summary.gross_leverage_red)
    ? Number(summary.gross_leverage_red)
    : null;
  const attackExposure = isFiniteMetric(summary.attack_exposure_pct_nav)
    ? Number(summary.attack_exposure_pct_nav)
    : null;
  const attackTarget = isFiniteMetric(summary.attack_target_pct_nav)
    ? Number(summary.attack_target_pct_nav)
    : null;
  return {
    leverage: {
      definition: TERM_DEFINITIONS.grossLeverage,
      meaning: "↑ 回撤与保证金敏感度增加；↓ 强平安全垫改善。",
      action:
        leverage !== null &&
        leverageRed !== null &&
        leverage > leverageRed
          ? `高于 ${number(leverageRed, 2)}x 红线：停止新增杠杆，先降到红线以下。`
          : leverage === null
            ? "账户覆盖或关键字段不完整：当前不能计算组合毛杠杆，先以券商原生红灯阻断新增风险。"
            : "未越过红线：仍需按券商实时保证金维持安全垫。",
      tone:
        leverage !== null &&
        leverageRed !== null &&
        leverage > leverageRed
          ? "tone-red"
          : "tone-neutral",
    },
    reduction: {
      definition: TERM_DEFINITIONS.deleverAmount,
      meaning: "↑ 离治理红线更远；↓ 更接近风险预算范围。",
      action: "先用券商实时 NAV、融资负债和 house requirement 重算，再决定账户与手数。",
      tone: "tone-red",
    },
    attack: {
      definition: TERM_DEFINITIONS.attackExposure,
      meaning: "↑ 高波动与集中度风险增加；↓ 风险预算逐步恢复。",
      action:
        attackExposure !== null &&
        attackTarget !== null &&
        attackExposure > attackTarget
          ? `高于 ${pct(attackTarget)} 目标：优先复核大额高进攻敞口。`
          : attackExposure === null || attackTarget === null
            ? "策略分类或目标不可用：不据此判断敞口是否处于预算内。"
            : "处于目标内：按 thesis 与风险预算维护，不因短期价格单独加仓。",
      tone:
        attackExposure !== null &&
        attackTarget !== null &&
        attackExposure > attackTarget
          ? "tone-red"
          : "tone-neutral",
    },
    account: {
      definition: TERM_DEFINITIONS.highestAccountLeverage,
      meaning: "↑ 账户更容易先触发保证金约束；↓ 账户安全垫改善。",
      action: `${summary.highest_leverage_account || "最高杠杆账户"}：优先核对实时 house requirement 与压力价格。`,
      tone: "tone-red",
    },
  };
}
// @app-block-end b104

// @app-block-start b105
export function marginMetricGuidance(value) {
  const yoy = value;
  return {
    definition: TERM_DEFINITIONS.finraMarginYoy,
    meaning: "↑ 全市场融资存量扩张、潜在脆弱性累积；↓ 可能是降温，也可能是被动去杠杆。",
    action:
      Number.isFinite(yoy) && yoy > 0
        ? "融资同比仍为正：高价格压力下不新增杠杆，并监控宽度与信用确认。"
        : Number.isFinite(yoy)
          ? "融资同比收缩：先判断健康降温还是被动出清，不直接把下降当买点。"
          : "数据缺失或滞后：不据此改变仓位，等待下一次正式更新。",
    tone: Number.isFinite(yoy) && yoy > 0 ? "tone-amber" : "tone-neutral",
  };
}
// @app-block-end b105

// @app-block-start b106
export function pressureMetricGuidance(universe) {
  const state = universe.state_code || "S0";
  const actions = {
    S4: "优先降低风险并核对保证金；不要在强制去杠杆证据期接飞刀。",
    S3: "避免杠杆抄底；压力连续3日低于70且宽度改善后再重估。",
    S2: "不追涨、不加杠杆；等待压力清除或新的基本面证据。",
    S1: "控制追涨，在既定风险预算内持有并监控宽度背离。",
    S5: "只建立观察清单；等待趋势、宽度和第二证据族确认。",
    S6: "个人风险闸门通过后，才考虑无杠杆、小仓、分批执行。",
    S0: "信号正常或不足；不因单一分位改变仓位。",
  };
  const tones = {
    S4: "tone-red",
    S3: "tone-amber",
    S2: "tone-amber",
    S1: "tone-amber",
    S5: "tone-neutral",
    S6: "tone-green",
    S0: "tone-neutral",
  };
  return {
    definition: TERM_DEFINITIONS.pricePressure,
    meaning: "↑ 卖压、波动、回撤或同步下跌增强；↓ 只表示急性压力缓和。",
    action: actions[state] || actions.S0,
    tone: tones[state] || tones.S0,
  };
}
// @app-block-end b106

// @app-block-start b107
export function coverageMetricGuidance(value) {
  const coverage = value;
  return {
    definition: TERM_DEFINITIONS.fullSessionCoverage,
    meaning: "↑ 数据更完整、判断置信度提高；↓ 盲区扩大，不代表市场风险下降。",
    action:
      !Number.isFinite(coverage) ? "覆盖数据缺失，等待下一次正式更新。" : coverage < 0.7
        ? "完整时段覆盖不足：仅作正常盘代理，不单独确认强制去杠杆。"
        : "时段覆盖较充分：仍需结合资金流、融资与信用证据确认状态。",
    tone:
      Number.isFinite(coverage) && coverage < 0.7
        ? "tone-amber"
        : "tone-neutral",
  };
}
// @app-block-end b107
