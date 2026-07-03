/** History helpers shared by adapters (SOC merge, extrema). */

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

