/**
 * History helpers for vendor intraday series (SOC merge, etc.).
 * KV snapshot storage has been removed; cron runs alerts only.
 */

const INTERVAL_MINUTES = 5;

function round1(n) {
  return Math.round(n * 10) / 10;
}

export function formatDateISO(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Aggregate intraday points into daily solar/load totals. */
export function computeDailySummary(points) {
  if (!points?.length) {
    return { solarKwh: 0, loadKwh: 0, peakSolarW: 0, minSoc: null, maxSoc: null };
  }

  const intervalHours = INTERVAL_MINUTES / 60;
  let solarKwh = 0;
  let loadKwh = 0;
  let peakSolarW = 0;
  let minSoc = null;
  let maxSoc = null;

  for (const p of points) {
    const solar = p.solar ?? 0;
    const load = p.load ?? 0;
    solarKwh += solar * intervalHours / 1000;
    loadKwh += load * intervalHours / 1000;
    peakSolarW = Math.max(peakSolarW, solar);
    if (Number.isFinite(p.soc)) {
      minSoc = minSoc == null ? p.soc : Math.min(minSoc, p.soc);
      maxSoc = maxSoc == null ? p.soc : Math.max(maxSoc, p.soc);
    }
  }

  return {
    solarKwh: round1(solarKwh),
    loadKwh: round1(loadKwh),
    peakSolarW,
    minSoc,
    maxSoc,
  };
}

/** Inclusive date list ending on endDate (YYYY-MM-DD), oldest first. */
export function dateRange(endDate, days) {
  const end = new Date(`${endDate}T00:00:00Z`);
  const dates = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(formatDateISO(d));
  }
  return dates;
}

/** Build a time → SOC map from history points. */
export function socMapFromPoints(points) {
  const map = new Map();
  for (const p of points || []) {
    if (Number.isFinite(p.soc)) map.set(p.time, p.soc);
  }
  return map;
}

/** Fill missing SOC on points from a time → SOC map (vendor supplement). */
export function mergeSocIntoPoints(points, socByTime) {
  if (!points?.length || !socByTime?.size) return points;
  return points.map((p) => {
    if (Number.isFinite(p.soc)) return p;
    const soc = socByTime.get(p.time);
    return Number.isFinite(soc) ? { ...p, soc } : p;
  });
}

/** Min/max SOC from a list of numeric samples (ignores invalid / negative). */
export function computeSocExtrema(values) {
  let minSoc = null;
  let maxSoc = null;
  for (const v of values) {
    if (!Number.isFinite(v) || v < 0) continue;
    minSoc = minSoc == null ? v : Math.min(minSoc, v);
    maxSoc = maxSoc == null ? v : Math.max(maxSoc, v);
  }
  return { minSoc, maxSoc };
}

/**
 * Resolve intraday history from vendor APIs with optional adapter SOC supplement
 * (e.g. Growatt socChart).
 */
export async function resolveIntradayHistory(_env, systemConfig, adapter, dateParam) {
  let vendorData = null;
  let vendorError = null;

  try {
    vendorData = await adapter.fetchHistory(systemConfig, dateParam || null);
  } catch (err) {
    vendorError = err;
  }

  if (vendorData?.points?.length) {
    let points = vendorData.points;
    if (adapter.fetchSocChart) {
      try {
        const socPoints = await adapter.fetchSocChart(systemConfig, vendorData.date);
        if (socPoints?.length) {
          points = mergeSocIntoPoints(points, socMapFromPoints(socPoints));
        }
      } catch {
        /* optional supplement */
      }
    }
    return { ...vendorData, points, source: "vendor" };
  }

  if (vendorData) return vendorData;
  throw vendorError || new Error("No history data available");
}
