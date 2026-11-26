import {
  BROKER_CURRENT_STATUS_LABELS,
  DAILY_GAP_REASONS,
  DAILY_GAP_REASON_LABELS,
  DAILY_GAP_RECEIPT_STATUSES,
  DAILY_GAP_REJECTED_REASONS,
  DAILY_HISTORY_COMPUTED_AT_PATTERN,
  DAILY_HISTORY_STATUSES,
  DAILY_RETURN_HISTORY_HEALTH_FIELDS,
  PORTFOLIO_RETURN_REASON_LABELS,
  currentPortfolioDisplaySummary
} from "./context.mjs";
import {
  liveTime
} from "./format.mjs";

// @app-block-start b074
export function validDailyHistoryCount(value) {
  return value === null
    || (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000_000);
}
// @app-block-end b074

// @app-block-start b075
export function validDailyHistoryDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const stamp = Date.UTC(year, month - 1, day);
  const utc = new Date(stamp);
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}
// @app-block-end b075

// @app-block-start b076
export function dailyHistoryEtUpperStamp(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", hour12: false,
  }).formatToParts(new Date(now));
  const pick = (type) => Number(parts.find((part) => part.type === type)?.value);
  const stamp = Date.UTC(pick("year"), pick("month") - 1, pick("day"));
  return (pick("hour") % 24) < 20 ? stamp - 86_400_000 : stamp;
}
// @app-block-end b076

// @app-block-start b078
export function dailyHistoryComputedAtMs(value) {
  if (typeof value !== "string") return null;
  const match = DAILY_HISTORY_COMPUTED_AT_PATTERN.exec(value);
  if (match === null) return null;
  const [, year, month, day, hour, minute, second] = match;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  // Canonical UTC only, exactly like the core ``endswith(("+00:00", "Z"))``.
  if (!value.endsWith("Z") && !value.endsWith("+00:00")) return null;
  const [y, m, d] = [Number(year), Number(month), Number(day)];
  const stamp = Date.UTC(y, m - 1, d, Number(hour), Number(minute), Number(second));
  const round = new Date(stamp);
  if (round.getUTCFullYear() !== y || round.getUTCMonth() !== m - 1
    || round.getUTCDate() !== d) return null;
  // Fraction-inclusive epoch for the future guard (core/Node parity):
  // Date.UTC above drops milliseconds, so a canonical .999 timestamp at a
  // .100 clock must compare via Date.parse, never the truncated stamp. The
  // strict shape/component checks already ran, so no V8 parse alias can
  // reach this point. The returned ms also drives the DTO's own computed_at
  // ET upper bound downstream.
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  // Sub-millisecond future guard: Date.parse truncates the fraction to
  // milliseconds, so .100001 at a .100000 clock would compare equal.
  // Inspect the discarded fraction digits as a string (no float rounding)
  // and compare the conservative ceiling parsed + 1 only against Date.now;
  // the ET upper bound keeps the unrounded parsed ms.
  const fractionStart = value.indexOf(".") + 1;
  const fraction = fractionStart === 0 ? ""
    : value.slice(fractionStart).replace(/(Z|\+00:00)$/, "");
  const futureCheckMs = fraction.length > 3 && /[1-9]/.test(fraction.slice(3))
    ? parsed + 1
    : parsed;
  return futureCheckMs <= Date.now() ? parsed : null;
}
// @app-block-end b078

// @app-block-start b079
export function validDailyReturnHistoryHealth(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== DAILY_RETURN_HISTORY_HEALTH_FIELDS.size
    || !keys.every((key) => DAILY_RETURN_HISTORY_HEALTH_FIELDS.has(key))) return null;
  const computedMs = dailyHistoryComputedAtMs(value.computed_at);
  if (typeof value.schema_version !== "number" || !Number.isInteger(value.schema_version)
    || value.schema_version !== 1 || computedMs === null
    || !["OK", "PARTIAL", "MISSING", "FAILED"].includes(value.metadata_status)
    || !DAILY_HISTORY_STATUSES.has(value.history_status)
    || !["OK", "UNAVAILABLE"].includes(value.calendar_status)
    || (value.latest_gap_receipt_status !== null
      && !DAILY_GAP_RECEIPT_STATUSES.has(value.latest_gap_receipt_status))
    || (value.latest_gap_reason !== null && !DAILY_GAP_REASONS.has(value.latest_gap_reason))) return null;
  const countKeys = ["stored_point_count", "continuous_valuation_point_count",
    "expected_session_count", "missing_session_count"];
  if (!countKeys.every((key) => validDailyHistoryCount(value[key]))) return null;
  // The date upper bound derives from the DTO's OWN computed_at ET EOD
  // (before 20:00 ET the bound is the prior day) — never the browser clock,
  // mirroring the core and both transport validators exactly.
  const upperStamp = dailyHistoryEtUpperStamp(computedMs);
  const dateKeys = ["last_recorded_date", "latest_scope_start_date", "continuous_start_date",
    "first_missing_session_date", "latest_missing_session_date"];
  const dates = {};
  for (const key of dateKeys) {
    if (value[key] !== null) {
      if (!validDailyHistoryDate(value[key]) || Date.parse(`${value[key]}T00:00:00Z`) > upperStamp) return null;
      dates[key] = value[key];
    } else {
      dates[key] = null;
    }
  }
  const [stored, continuous, expected, missing] = countKeys.map((key) => value[key]);
  if ((value.metadata_status === "MISSING" || value.metadata_status === "FAILED") && stored !== null) return null;
  if (value.metadata_status === "OK" && (value.calendar_status !== "OK"
    || value.history_status === "UNAVAILABLE" || !(missing === null || missing === 0))) return null;
  if (stored === null) {
    if (value.history_status !== "UNAVAILABLE"
      || (value.metadata_status !== "MISSING" && value.metadata_status !== "FAILED")
      || countKeys.slice(1).some((key) => value[key] !== null)
      || dateKeys.some((key) => dates[key] !== null)) return null;
  } else if (stored === 0) {
    if ((value.history_status !== "NO_HISTORY" && value.history_status !== "UNAVAILABLE")
      || dateKeys.some((key) => dates[key] !== null)
      || !(continuous === null || continuous === 0)
      || expected !== null || missing !== null
      || value.latest_gap_receipt_status !== null || value.latest_gap_reason !== null
      || (value.calendar_status === "OK" && continuous !== 0)) return null;
  } else {
    if (dates.last_recorded_date === null) return null;
    const start = dates.latest_scope_start_date;
    if (start !== null && start > dates.last_recorded_date) return null;
    if (continuous !== null) {
      if (continuous > stored) return null;
      if (continuous === 0 && dates.continuous_start_date !== null) return null;
      if (continuous > 0 && (dates.continuous_start_date === null || start === null
        || !(start <= dates.continuous_start_date && dates.continuous_start_date <= dates.last_recorded_date))) return null;
    }
    if (value.calendar_status === "OK") {
      if (continuous === null || expected === null || missing === null || start === null
        || !(0 <= missing && missing <= expected)
        || !(continuous <= expected - missing && expected - missing <= stored)) return null;
      const wanted = continuous === 0 ? "CONTINUOUS_ZERO"
        : continuous === 1 ? "ONE_POINT" : "CONTINUOUS_TWO_OR_MORE";
      if (value.history_status !== wanted) return null;
      const spanDays = Math.round(
        (Date.parse(`${dates.last_recorded_date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
      );
      if (expected > spanDays + 1) return null;
      if (missing > 0) {
        if ((value.latest_gap_receipt_status !== "REJECTED" && value.latest_gap_receipt_status !== "UNKNOWN")
          || value.latest_gap_reason === null
          || dates.first_missing_session_date === null || dates.latest_missing_session_date === null
          || !(start < dates.first_missing_session_date)
          || !(dates.first_missing_session_date <= dates.latest_missing_session_date)
          || !(dates.latest_missing_session_date < dates.last_recorded_date)
          || (continuous > 0 && !(dates.latest_missing_session_date < dates.continuous_start_date))) return null;
        if (value.latest_gap_receipt_status === "REJECTED"
          && !DAILY_GAP_REJECTED_REASONS.has(value.latest_gap_reason)) return null;
        if (value.latest_gap_receipt_status === "UNKNOWN"
          && !(value.latest_gap_reason === "UNKNOWN" || value.latest_gap_reason === "NO_RECEIPT")) return null;
      } else if (value.latest_gap_receipt_status !== "NO_GAP" || value.latest_gap_reason !== null
        || dates.first_missing_session_date !== null || dates.latest_missing_session_date !== null) {
        return null;
      } else if (continuous !== expected || dates.continuous_start_date !== start) {
        return null;
      }
    }
  }
  if (value.calendar_status === "UNAVAILABLE"
    && (value.history_status !== "UNAVAILABLE"
      || countKeys.slice(1).some((key) => value[key] !== null)
      || dates.continuous_start_date !== null || dates.first_missing_session_date !== null
      || dates.latest_missing_session_date !== null
      || value.latest_gap_receipt_status !== null || value.latest_gap_reason !== null)) return null;
  if (value.history_status === "UNAVAILABLE" && value.calendar_status !== "UNAVAILABLE") return null;
  return { ...value };
}
// @app-block-end b079

// @app-block-start b080
export function dailyReturnHistoryHealthView(health, hasIndependentLanes) {
  if (health === null || health.metadata_status === "MISSING") {
    return { note: "日终历史状态未提供 · 无法确认", detail: null };
  }
  if (health.metadata_status === "FAILED") {
    return { note: "日终历史未通过校验 · 无法确认", detail: null };
  }
  const isolation = hasIndependentLanes
    ? "Futu App 手工锚点与券商原生收益为独立口径，不代表系统日终历史进度" : "";
  if (health.calendar_status === "UNAVAILABLE") {
    // Calendar unavailable keeps the verified storage facts only; continuous
    // points and gap counts are unknown — never rendered as 0.
    return {
      note: `日终历史：最近 ${health.last_recorded_date} · 已存 ${health.stored_point_count} 点 · 连续估值点未知（交易日历不可用）`,
      detail: {
        label: "日终历史（系统）",
        value: `已存 ${health.stored_point_count} 点`,
        note: `最近记录 ${health.last_recorded_date} · 交易日历不可用 · 连续估值点与缺口数量未知${isolation ? ` · ${isolation}` : ""}`,
      },
    };
  }
  if (health.history_status === "NO_HISTORY") {
    return { note: "日终历史：尚无完整日终历史", detail: null };
  }
  const stored = health.stored_point_count;
  const continuous = health.continuous_valuation_point_count;
  const missing = health.missing_session_count;
  const parts = [];
  if (health.history_status === "ONE_POINT") {
    parts.push("累计收益仍需连续估值与资金流水校验通过");
  } else if (health.history_status === "CONTINUOUS_ZERO") {
    parts.push("当前连续估值点为 0");
  } else {
    parts.push("收益显示仍以既有校验为准");
  }
  if (missing > 0) {
    parts.push(`当前口径区间未存 ${missing} 个交易日 · 最近缺口 ${health.latest_missing_session_date}`);
    if (health.latest_gap_receipt_status === "REJECTED") {
      const reasonLabel = DAILY_GAP_REASON_LABELS[health.latest_gap_reason];
      parts.push(`${health.latest_missing_session_date} 写入未完成 · 已证实原因：${reasonLabel || "未公开"}`);
    } else if (health.latest_gap_reason === "NO_RECEIPT") {
      parts.push("缺口日无写入回执");
    } else {
      parts.push("缺口日写入原因未记录");
    }
  } else {
    parts.push("当前口径区间无缺口（已按交易日历核对）");
  }
  // Stored points beyond the current-scope sessions prove an account-scope
  // change (records before the scope start are archive-only facts).
  if (health.latest_scope_start_date !== null && stored > health.expected_session_count - missing) {
    parts.push(`账户集合自 ${health.latest_scope_start_date} 起变更 · 连续估值口径自该日重算 · 更早记录仅作存档`);
  }
  if (isolation) parts.push(isolation);
  return {
    note: `日终历史：最近 ${health.last_recorded_date} · 连续估值 ${continuous} 点/已存 ${stored}`,
    detail: {
      label: "日终历史（系统）",
      value: `连续 ${continuous} 点/已存 ${stored}`,
      note: parts.join(" · "),
    },
  };
}
// @app-block-end b080

// @app-block-start b081
export function systemCalculatedPendingNote(calculatedReason) {
  if (calculatedReason === PORTFOLIO_RETURN_REASON_LABELS.HISTORY_ACCUMULATING) {
    return "系统自算 · 累计收益仍需连续日终估值与资金流水校验通过";
  }
  return calculatedReason
    ? `系统自算 · ${calculatedReason}`
    : "系统自算 · 历史状态未提供 · 无法确认";
}
// @app-block-end b081

// @app-block-start b084
export function brokerCurrentStatusLabel(sourceStatus) {
  const status = String(sourceStatus || "MISSING").toUpperCase();
  return BROKER_CURRENT_STATUS_LABELS[status] || `来源 ${status}`;
}
// @app-block-end b084

// @app-block-start b085
export function lastKnownGoodAgeLabel(display) {
  if (!display || display.age_ms === null || display.age_ms === undefined) return "";
  const minutes = Math.max(0, Math.round(Number(display.age_ms) / 60_000));
  if (display.age_tier === "SEVERE") return `严重陈旧 ${minutes} 分钟`;
  if (display.age_tier === "WARN") return `延迟 ${minutes} 分钟 · 陈旧警示`;
  return `延迟 ${minutes} 分钟`;
}
// @app-block-end b085

// @app-block-start b086
export function brokerDisplayNote(row) {
  const display = row?.display;
  if (!display) return "暂无可用数据";
  if (display.origin === "CURRENT") {
    return `实时 · ${liveTime(display.source_retrieved_at)}`;
  }
  if (display.origin === "LKG") {
    return `显示历史数据 · 截至 ${liveTime(display.source_retrieved_at)}`
      + ` · ${lastKnownGoodAgeLabel(display) || "数据年龄未知"}`
      + ` · 当前状态：${brokerCurrentStatusLabel(display.current_source_status)}`;
  }
  return `当前状态：${brokerCurrentStatusLabel(display.current_source_status)} · 暂无可用数据`;
}
// @app-block-end b086

// @app-block-start b087
export function brokerDisplayTier(display) {
  return display?.origin === "LKG" ? String(display.age_tier || "DELAYED").toLowerCase() : null;
}
// @app-block-end b087

// @app-block-start b088
export function resolvePortfolioFreshness(summary, nowMs = Date.now()) {
  const current = currentPortfolioDisplaySummary(summary, nowMs) || {source_status: "MISSING"};
  const observed = Date.parse(summary?.source_retrieved_at || "");
  const isFresh = current.source_status === "OK";
  const display = { ...summary, ...current };
  if (!isFresh) {
    for (const key of ["derived_nav_usd", "gross_market_value_usd", "gross_leverage",
      "required_gross_reduction_usd_to_red", "attack_exposure_pct_nav", "highest_account_gross_leverage"]) {
      display[key] = null;
    }
    display.portfolio_gate = summary?.portfolio_gate === "RED" ? "RED" : "UNKNOWN";
  }
  return { isFresh, ageMinutes: Number.isFinite(observed) ? Math.max(0, (nowMs - observed) / 60000) : null,
    asOfLabel: summary?.source_retrieved_at || null, reason: current.source_status, summary: display };
}
// @app-block-end b088

// @app-block-start b089
export function formatStateTag(code, label) {
  const safeCode = String(code || "").trim();
  const safeLabel = String(label || "").trim();
  if (!safeCode || safeLabel === safeCode || safeLabel.startsWith(`${safeCode} `)) return safeLabel || safeCode || "观察";
  return `${safeCode} ${safeLabel || "观察"}`;
}
// @app-block-end b089
