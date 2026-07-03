import { loadSystemConfig } from "./credentials.js";

/**
 * Worker-owned history snapshots in KV (same SYSTEMS namespace as system configs).
 *
 * Keys:
 *   history:day:<systemId>:<YYYY-MM-DD>  — daily document (points + dailySummary)
 *   history:index:<systemId>             — date list, newest first (for listing/prune)
 *
 * Cron (see wrangler.toml [triggers]) calls appendSnapshot per system each tick;
 * pruneOld removes days older than DEFAULT_RETENTION_DAYS. History API routes serve
 * stored documents first, then fall back to vendor fetchHistory for backfill.
 */
export const DEFAULT_RETENTION_DAYS = 90;
export const INTERVAL_MINUTES = 5;

export function dayKey(systemId, date) {
  return `history:day:${systemId}:${date}`;
}

export function indexKey(systemId) {
  return `history:index:${systemId}`;
}

/** Parse normalized timestamp and floor to 5-minute bucket. */
export function parseDataTimestamp(timestamp) {
  const match = String(timestamp).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
  if (!match) throw new Error(`Invalid timestamp: ${timestamp}`);
  const [, date, hh, mm] = match;
  const floored = Math.floor(Number(mm) / INTERVAL_MINUTES) * INTERVAL_MINUTES;
  const bucketTime = `${hh}:${String(floored).padStart(2, "0")}`;
  return { date, bucketTime };
}

/** Extract a history point from normalized fetchData output (no credentials). */
export function pointFromData(data, bucketTime) {
  return {
    time: bucketTime,
    solar: data.solar?.power ?? 0,
    load: data.load?.power ?? 0,
    battery: data.battery?.power ?? 0,
    soc: Number.isFinite(data.battery?.soc) ? data.battery.soc : null,
    energyToday: Number.isFinite(data.energyToday) ? data.energyToday : null,
  };
}

/** Append or replace a point in chronological order; dedupe by time bucket. */
export function appendPoint(points, point) {
  const next = [...points];
  const idx = next.findIndex((p) => p.time === point.time);
  if (idx >= 0) {
    next[idx] = point;
  } else {
    next.push(point);
    next.sort((a, b) => a.time.localeCompare(b.time));
  }
  return next;
}

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

export function buildDayDocument(systemId, date, points, updatedAt) {
  return {
    systemId,
    date,
    source: "snapshot",
    intervalMinutes: INTERVAL_MINUTES,
    points,
    dailySummary: computeDailySummary(points),
    updatedAt,
  };
}

/** Merge a date into the index, newest first. */
export function upsertDateIndex(dates, date) {
  const set = new Set(Array.isArray(dates) ? dates : []);
  set.add(date);
  return [...set].sort().reverse();
}

export function formatDateISO(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Return dates older than retention window (YYYY-MM-DD strings). */
export function selectDatesToPrune(dates, retentionDays, referenceDate) {
  const ref = new Date(`${referenceDate}T00:00:00Z`);
  const cutoff = new Date(ref);
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  const cutoffStr = formatDateISO(cutoff);
  return (dates || []).filter((d) => d < cutoffStr);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/** Build a time → SOC map from history points. */
export function socMapFromPoints(points) {
  const map = new Map();
  for (const p of points || []) {
    if (Number.isFinite(p.soc)) map.set(p.time, p.soc);
  }
  return map;
}

/** Fill missing SOC on points from a time → SOC map (stored or vendor supplement). */
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

/** Fill missing minSoc/maxSoc on summary days from vendor supplement map. */
export function supplementSummarySoc(series, socByDate) {
  if (!socByDate || !series?.length) return series;
  return series.map((day) => {
    if (day.minSoc != null && day.maxSoc != null) return day;
    const sup = socByDate[day.date];
    if (!sup) return day;
    return {
      ...day,
      minSoc: day.minSoc ?? sup.minSoc,
      maxSoc: day.maxSoc ?? sup.maxSoc,
    };
  });
}

function storedDocToIntraday(stored, systemConfig) {
  return {
    systemId: systemConfig.id,
    name: systemConfig.name,
    service: systemConfig.service,
    date: stored.date,
    timezoneOffset: 0,
    intervalMinutes: stored.intervalMinutes || INTERVAL_MINUTES,
    points: stored.points || [],
    source: "snapshot",
  };
}

/**
 * Resolve intraday history: vendor power series with SOC from stored snapshots
 * and optional adapter SOC supplement (e.g. Growatt socChart).
 */
export async function resolveIntradayHistory(env, systemConfig, adapter, dateParam) {
  let vendorData = null;
  let vendorError = null;

  try {
    vendorData = await adapter.fetchHistory(systemConfig, dateParam || null);
  } catch (err) {
    vendorError = err;
  }

  const queryDate = vendorData?.date || dateParam || formatDateISO(new Date());
  const stored = await getDay(env, systemConfig.id, queryDate);

  if (vendorData?.points?.length) {
    let points = vendorData.points;
    if (stored?.points?.length) {
      points = mergeSocIntoPoints(points, socMapFromPoints(stored.points));
    }
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
    const source = stored?.points?.length ? "merged" : "vendor";
    return { ...vendorData, points, source };
  }

  if (stored?.points?.length) {
    return storedDocToIntraday(stored, systemConfig);
  }

  if (vendorData) return vendorData;
  throw vendorError || new Error("No history data available");
}

export async function appendSnapshot(env, systemId, data, nowMs = Date.now()) {
  const { date, bucketTime } = parseDataTimestamp(data.timestamp);
  const point = pointFromData(data, bucketTime);

  const key = dayKey(systemId, date);
  const existing = await env.SYSTEMS.get(key, "json");
  const points = appendPoint(existing?.points ?? [], point);
  const doc = buildDayDocument(systemId, date, points, new Date(nowMs).toISOString());

  await env.SYSTEMS.put(key, JSON.stringify(doc));

  const dates = await env.SYSTEMS.get(indexKey(systemId), "json");
  await env.SYSTEMS.put(indexKey(systemId), JSON.stringify(upsertDateIndex(dates, date)));

  return doc;
}

export async function getDay(env, systemId, date) {
  return env.SYSTEMS.get(dayKey(systemId, date), "json");
}

export async function listDates(env, systemId) {
  return (await env.SYSTEMS.get(indexKey(systemId), "json")) ?? [];
}

/** Build consecutive calendar dates ending on endDate (YYYY-MM-DD), oldest first. */
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

function summaryFromDayDoc(doc) {
  if (!doc?.dailySummary) return null;
  return {
    solarKwh: doc.dailySummary.solarKwh ?? 0,
    loadKwh: doc.dailySummary.loadKwh ?? 0,
    peakSolarW: doc.dailySummary.peakSolarW ?? 0,
    minSoc: doc.dailySummary.minSoc ?? null,
    maxSoc: doc.dailySummary.maxSoc ?? null,
    source: doc.source || "snapshot",
  };
}

/** Daily energy totals for the last N days from stored KV snapshots. */
export async function getHistorySummary(env, systemId, days = 7, endDate = null) {
  const end = endDate || formatDateISO(new Date());
  const dates = dateRange(end, days);
  const docs = await Promise.all(dates.map((date) => getDay(env, systemId, date)));

  const series = dates.map((date, i) => {
    const summary = summaryFromDayDoc(docs[i]);
    if (!summary) {
      return { date, solarKwh: null, loadKwh: null, peakSolarW: null, minSoc: null, maxSoc: null, source: null };
    }
    return { date, ...summary };
  });

  return { systemId, days, endDate: end, series };
}

export async function pruneOld(
  env,
  systemId,
  retentionDays = DEFAULT_RETENTION_DAYS,
  nowMs = Date.now(),
) {
  const referenceDate = formatDateISO(new Date(nowMs));
  const dates = await listDates(env, systemId);
  const toRemove = selectDatesToPrune(dates, retentionDays, referenceDate);

  for (const date of toRemove) {
    await env.SYSTEMS.delete(dayKey(systemId, date));
  }

  const remaining = dates.filter((d) => !toRemove.includes(d));
  await env.SYSTEMS.put(indexKey(systemId), JSON.stringify(remaining));

  return { removed: toRemove, kept: remaining.length };
}

/** Remove all stored history keys for a system (day buckets + date index). */
export async function deleteHistory(env, systemId) {
  const dates = await listDates(env, systemId);
  for (const date of dates) {
    await env.SYSTEMS.delete(dayKey(systemId, date));
  }
  await env.SYSTEMS.delete(indexKey(systemId));
  return { removed: dates.length };
}

/** Cron handler: fetch realtime data for each system and append to daily history. */
export async function runScheduledSnapshots(env, adapters, nowMs = Date.now()) {
  const index = await env.SYSTEMS.get("_index", "json");
  if (!index?.length) return { checked: 0, appended: 0, failed: 0 };

  const results = await Promise.allSettled(
    index.map(async (entry) => {
      const raw = await loadSystemConfig(env, entry.id);
      if (!raw) {
        console.error(`History snapshot skipped for ${entry.id}: system not found`);
        return { systemId: entry.id, ok: false, error: "Not found" };
      }
      const adapter = adapters[raw.service];
      if (!adapter) {
        console.error(`History snapshot skipped for ${entry.id}: no adapter for ${raw.service}`);
        return { systemId: entry.id, ok: false, error: "No adapter" };
      }
      try {
        const data = await adapter.fetchData(raw);
        await appendSnapshot(env, entry.id, data, nowMs);
        return { systemId: entry.id, ok: true };
      } catch (err) {
        console.error(`History snapshot failed for ${entry.id}:`, err.message);
        return { systemId: entry.id, ok: false, error: err.message };
      }
    }),
  );

  let appended = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.ok) appended++;
    else failed++;
  }

  return { checked: index.length, appended, failed };
}
