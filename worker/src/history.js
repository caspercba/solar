/**
 * History helpers for vendor intraday series (SOC merge, etc.).
 * KV snapshot storage has been removed; cron runs alerts only.
 */

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
