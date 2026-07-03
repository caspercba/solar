export const DEFAULT_RETENTION_DAYS = 90;
export const INTERVAL_MINUTES = 5;
export const FULL_DAY_BUCKETS = (24 * 60) / INTERVAL_MINUTES;
export const SPARSE_COVERAGE_RATIO = 0.5;

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

/** Expected 5-minute buckets for a date (full day, or elapsed buckets for today). */
export function expectedBuckets(date, nowMs = Date.now()) {
  const today = formatDateISO(new Date(nowMs));
  if (date !== today) return FULL_DAY_BUCKETS;
  const now = new Date(nowMs);
  const elapsed = now.getUTCHours() * 60 + now.getUTCMinutes();
  return Math.max(1, Math.floor(elapsed / INTERVAL_MINUTES) + 1);
}

/** True when stored points cover less than half of expected intervals. */
export function isSparse(points, date, nowMs = Date.now()) {
  if (!points?.length) return true;
  return points.length < expectedBuckets(date, nowMs) * SPARSE_COVERAGE_RATIO;
}

/** Merge vendor gaps into stored points; stored values win on duplicate times. */
export function mergeHistoryPoints(storedPoints, vendorPoints) {
  const byTime = new Map();
  for (const p of vendorPoints || []) {
    byTime.set(p.time, { ...p });
  }
  for (const p of storedPoints || []) {
    byTime.set(p.time, { ...p });
  }
  return [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time));
}

/** Last N calendar days ending on referenceDate (YYYY-MM-DD), oldest first. */
export function lastNDates(days, referenceDate) {
  const dates = [];
  const ref = new Date(`${referenceDate}T12:00:00Z`);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(ref);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(formatDateISO(d));
  }
  return dates;
}

function resolveQueryDate(systemConfig, adapter, dateParam, nowMs) {
  if (dateParam) return dateParam;
  if (adapter?.defaultHistoryDate) return adapter.defaultHistoryDate(systemConfig, nowMs);
  return formatDateISO(new Date(nowMs));
}

/** Serve KV snapshot when complete; otherwise vendor fetch with optional merge. */
export async function resolveDayHistory(env, systemConfig, adapter, dateParam, nowMs = Date.now()) {
  const date = resolveQueryDate(systemConfig, adapter, dateParam, nowMs);
  const stored = await getDay(env, systemConfig.id, date);
  const storedPoints = stored?.points ?? [];

  if (storedPoints.length > 0 && !isSparse(storedPoints, date, nowMs)) {
    return {
      systemId: systemConfig.id,
      name: systemConfig.name,
      service: systemConfig.service,
      date,
      source: "snapshot",
      intervalMinutes: INTERVAL_MINUTES,
      points: storedPoints,
      dailySummary: stored.dailySummary ?? computeDailySummary(storedPoints),
      updatedAt: stored.updatedAt,
    };
  }

  if (!adapter?.fetchHistory) {
    throw new Error("History not supported");
  }

  const vendor = await adapter.fetchHistory(systemConfig, date);
  const vendorPoints = vendor.points ?? [];

  if (storedPoints.length === 0) {
    return {
      systemId: systemConfig.id,
      name: systemConfig.name,
      service: systemConfig.service,
      date: vendor.date || date,
      timezoneOffset: vendor.timezoneOffset,
      source: "vendor",
      intervalMinutes: vendor.intervalMinutes ?? INTERVAL_MINUTES,
      points: vendorPoints,
      dailySummary: computeDailySummary(vendorPoints),
    };
  }

  const mergedPoints = mergeHistoryPoints(storedPoints, vendorPoints);
  return {
    systemId: systemConfig.id,
    name: systemConfig.name,
    service: systemConfig.service,
    date: vendor.date || date,
    timezoneOffset: vendor.timezoneOffset,
    source: "merged",
    intervalMinutes: INTERVAL_MINUTES,
    points: mergedPoints,
    dailySummary: computeDailySummary(mergedPoints),
    updatedAt: stored.updatedAt,
  };
}

/** Daily energy totals for bar chart; stored KV first, vendor fallback per day. */
export async function resolveHistorySummary(env, systemConfig, adapter, days, nowMs = Date.now()) {
  const referenceDate = formatDateISO(new Date(nowMs));
  const dates = lastNDates(days, referenceDate);
  const summary = [];

  for (const date of dates) {
    const stored = await getDay(env, systemConfig.id, date);
    if (stored?.dailySummary) {
      summary.push({
        date,
        solarKwh: stored.dailySummary.solarKwh,
        loadKwh: stored.dailySummary.loadKwh,
      });
      continue;
    }

    if (adapter?.fetchHistory) {
      try {
        const vendor = await adapter.fetchHistory(systemConfig, date);
        const daily = computeDailySummary(vendor.points ?? []);
        summary.push({ date, solarKwh: daily.solarKwh, loadKwh: daily.loadKwh });
        continue;
      } catch {
        // fall through to zero row
      }
    }

    summary.push({ date, solarKwh: 0, loadKwh: 0 });
  }

  if (adapter?.fetchBatChartSummary) {
    try {
      const batByDate = await adapter.fetchBatChartSummary(systemConfig);
      if (batByDate) {
        for (const entry of summary) {
          const enrich = batByDate[entry.date];
          if (enrich) {
            entry.batteryChargeKwh = enrich.batteryChargeKwh;
            entry.batteryDischargeKwh = enrich.batteryDischargeKwh;
          }
        }
      }
    } catch {
      // optional Growatt enrichment
    }
  }

  return summary;
}
