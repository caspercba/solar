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

/** True when intraday chart should show the voltage-estimated SOC badge. */
export function shouldShowEstimatedSocBadge(historyData) {
  const src = historyData?.socSource;
  return src === "estimated" || src === "mixed";
}
