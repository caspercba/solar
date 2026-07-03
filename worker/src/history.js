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
