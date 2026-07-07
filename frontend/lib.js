/** Pure helpers — importable without DOM (unit-testable). */

export function fmtW(w) {
  const abs = Math.abs(w);
  if (abs >= 10000) return (w / 1000).toFixed(0) + " kW";
  if (abs >= 1000) return (w / 1000).toFixed(1) + " kW";
  return Math.round(w) + " W";
}

export function fmtChartDate(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr.slice(5);
  return d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
}

export function sanitizeExportName(name) {
  const safe = String(name || "system")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 64);
  return safe || "system";
}

export function csvCell(value) {
  if (value == null || value === "") return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function historyToCsv(points) {
  const lines = ["time,solar_w,load_w,battery_w,soc"];
  for (const p of points) {
    lines.push([
      csvCell(p.time),
      csvCell(p.solar ?? 0),
      csvCell(p.load ?? 0),
      csvCell(p.battery ?? 0),
      csvCell(Number.isFinite(p.soc) ? p.soc : ""),
    ].join(","));
  }
  return lines.join("\r\n");
}

export function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

export function clampPct(pct) {
  return Math.max(0, Math.min(100, pct));
}

export function solarPctFromPower(power, nominalPV = 5000) {
  return Math.round(((power ?? 0) / nominalPV) * 100);
}

export function loadPercent(load, ratedPower = 5000) {
  if (load?.percent != null) return load.percent;
  return Math.round(((load?.power ?? 0) / ratedPower) * 100);
}

/** Local calendar date as YYYY-MM-DD (no UTC drift). */
export function todayIsoDate(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Add calendar days to an ISO date string. */
export function addIsoDays(dateStr, delta) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isIsoDateAfter(a, b) {
  return a > b;
}

/** Clamp a date to today when it would otherwise be in the future. */
export function clampIsoDateToToday(dateStr, today = todayIsoDate()) {
  return isIsoDateAfter(dateStr, today) ? today : dateStr;
}

/** Consecutive dates ending on selectedDate, oldest first. */
export function buildWeekStripDates(selectedDate, count = 7) {
  const n = Math.max(1, count);
  const dates = [];
  for (let i = n - 1; i >= 0; i--) {
    dates.push(addIsoDays(selectedDate, -i));
  }
  return dates;
}

export function fmtWeekStripWeekday(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

export function fmtWeekStripDay(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr.slice(8);
  return String(d.getDate());
}

/** True when intraday chart should show the voltage-estimated SOC badge. */
export function shouldShowEstimatedSocBadge(historyData) {
  const src = historyData?.socSource;
  return src === "estimated" || src === "mixed";
}

export const DEFAULT_POLL_INTERVAL_SEC = 60;
export const POLL_INTERVAL_OPTIONS_SEC = [30, 60, 120];

/** Normalize stored poll interval to a supported seconds value. */
export function normalizePollIntervalSec(value, options = POLL_INTERVAL_OPTIONS_SEC, defaultSec = DEFAULT_POLL_INTERVAL_SEC) {
  const sec = Number.parseInt(String(value ?? ""), 10);
  if (options.includes(sec)) return sec;
  return defaultSec;
}

export function pollIntervalSecToMs(sec) {
  return normalizePollIntervalSec(sec) * 1000;
}

export function formatPollIntervalLabel(sec) {
  if (sec < 60) return `${sec} seconds`;
  if (sec > 60 && sec % 60 === 0) {
    const mins = sec / 60;
    return `${mins} minutes`;
  }
  return `${sec} seconds`;
}

/** 48V off-grid voltage endpoints (matches shinemonitor adapter voltage-SOC curve). */
export const BAT_LOW_V = 42.0;
export const BAT_HIGH_V = 53.5;

/** Default implied Ah for a 48V-class bank when no nominal capacity is configured. */
export const DEFAULT_BATTERY_AH = 200;

/**
 * Implied battery capacity (Wh) from pack voltage and optional nominal config.
 * Uses nominalCapacityAh when provided; otherwise defaults by voltage tier
 * (48V → 200 Ah, 24V → 100 Ah, 12V → 50 Ah) anchored to the BAT_LOW_V..BAT_HIGH_V span.
 */
export function impliedBatteryCapacityWh(voltage, nominalCapacityAh) {
  const v = voltage ?? 48;
  let ah = nominalCapacityAh;
  if (!Number.isFinite(ah) || ah <= 0) {
    if (v >= 40) ah = DEFAULT_BATTERY_AH;
    else if (v >= 22) ah = DEFAULT_BATTERY_AH / 2;
    else ah = DEFAULT_BATTERY_AH / 4;
  }
  const nominalV = (BAT_LOW_V + BAT_HIGH_V) / 2;
  return ah * nominalV;
}

/**
 * Format hours until empty as a compact label (e.g. "4h 5m", "45m", "<1m").
 */
export function formatTimeToEmpty(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return "";
  const totalMin = Math.round(hours * 60);
  if (totalMin < 1) return "<1m";
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Estimate time until battery empty while discharging.
 *
 * Formula (energy balance):
 *   remaining_Wh = (soc / 100) × impliedCapacityWh(voltage)
 *   discharge_W = positive battery power, or voltage × positive current
 *   hours = remaining_Wh / discharge_W
 *
 * impliedCapacityWh uses battery.nominalCapacityAh when set, otherwise defaults
 * by voltage tier using the 42.0–53.5 V curve midpoint as nominal pack voltage.
 *
 * Returns null when charging, grid active, SOC unavailable, load ≤ 0, or discharge ≤ 0.
 * @returns {{ hours: number, label: string } | null}
 */
export function estimateBatteryTimeToEmpty(battery, grid, { load } = {}) {
  if (grid?.active) return null;

  const soc = battery?.soc;
  if (!Number.isFinite(soc) || soc <= 0) return null;

  const loadW = load?.power;
  if (!Number.isFinite(loadW) || loadW <= 0) return null;

  const current = battery?.current ?? 0;
  const voltage = battery?.voltage ?? 0;
  const power = battery?.power;

  const charging = (Number.isFinite(power) && power < -5) || current < -2;
  const discharging = (Number.isFinite(power) && power > 5) || current > 2;
  if (charging || !discharging) return null;

  let dischargeW = 0;
  if (Number.isFinite(power) && power > 0) dischargeW = power;
  else if (current > 0 && voltage > 0) dischargeW = voltage * current;
  if (dischargeW <= 0) return null;

  const capacityWh = impliedBatteryCapacityWh(voltage, battery?.nominalCapacityAh);
  const hours = ((soc / 100) * capacityWh) / dischargeW;
  if (!Number.isFinite(hours) || hours <= 0) return null;

  return { hours, label: `~${formatTimeToEmpty(hours)} left` };
}
