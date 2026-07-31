import { computeDailySummary, dateRange } from "../history.js";
import { isGridActive } from "../gridDetect.js";

/**
 * ShineMonitor service adapter.
 *
 * Auth flow: SHA1(password) -> SHA1(salt + pwdSha1 + action) for login,
 * then SHA1(salt + secret + token + encodedAction) for authenticated calls.
 */

const API_BASE = "https://web.shinemonitor.com/public/";
const COMPANY_KEY = "bnrl_frRFjEz8Mkn";

/* ── SHA-1 via Web Crypto (available in Workers) ── */

export async function sha1Hex(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-1", data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function encodeAction(a) {
  return a.replace(/#/g, "%23").replace(/'/g, "%27").replace(/ /g, "%20");
}

export async function signAuth(salt, pwdSha1, action) {
  return sha1Hex(String(salt) + pwdSha1 + action);
}

export async function signPublic(salt, secret, token, action) {
  return sha1Hex(String(salt) + secret + token + encodeAction(action));
}

/* ── API helpers ── */

async function apiAuth(user, pwdSha1) {
  const salt = Date.now();
  const usr = encodeURIComponent(user).replace(/\+/g, "%2B").replace(/'/g, "%27");
  const action = `&action=auth&usr=${usr}&company-key=${COMPANY_KEY}`;
  const sign = await signAuth(salt, pwdSha1, action);
  const url = `${API_BASE}?sign=${sign}&salt=${salt}${action}`;
  const resp = await fetch(url);
  const json = await resp.json();
  if (json.err !== 0) throw new Error(json.desc || "Auth failed");
  return { ...json.dat, ts: Date.now() };
}

/** Thrown when the vendor rejects token/secret — triggers one re-login retry. */
export class ShineMonitorAuthError extends Error {
  constructor(message, errCode = null) {
    super(message);
    this.name = "ShineMonitorAuthError";
    this.errCode = errCode;
  }
}

/** Detect expired/invalid token or sign failures from vendor JSON or HTTP status. */
export function isAuthFailure(json, httpStatus = 200) {
  if (httpStatus === 401 || httpStatus === 403) return true;
  if (!json || json.err === 0) return false;
  const desc = String(json.desc || "").toUpperCase();
  if (/TOKEN|SIGN|AUTH|LOGIN|EXPIR|SESSION|UNAUTHORIZED/.test(desc)) return true;
  return false;
}

async function apiGet(session, actionCore) {
  const action = `${actionCore}&i18n=en_US&lang=en_US`;
  const salt = Date.now();
  const sign = await signPublic(salt, session.secret, session.token, action);
  const enc = encodeAction(action);
  const url = `${API_BASE}?sign=${sign}&salt=${salt}&token=${session.token}${enc}`;
  const resp = await fetch(url);
  const json = await resp.json();
  if (json.err !== 0) {
    const message = json.desc || `API error ${json.err}`;
    if (isAuthFailure(json, resp.status)) throw new ShineMonitorAuthError(message, json.err);
    throw new Error(message);
  }
  return json.dat;
}

/* ── Session cache (in-memory, per-Worker isolate) ── */

const sessionCache = new Map();
const SESSION_TTL = 300_000; // 5 min

function invalidateSession(systemConfig) {
  sessionCache.delete(systemConfig.id);
}

/** @internal Test helper — clears in-memory session cache between test cases. */
export function _clearSessionCacheForTests() {
  sessionCache.clear();
}

async function loginSession(systemConfig) {
  const sess = await apiAuth(systemConfig.credentials.user, systemConfig.credentials.pwdSha1);
  sessionCache.set(systemConfig.id, sess);
  return sess;
}

async function getSession(systemConfig) {
  const key = systemConfig.id;
  const cached = sessionCache.get(key);
  if (cached && Date.now() - cached.ts < SESSION_TTL) return cached;
  return loginSession(systemConfig);
}

/**
 * Run an operation with a cached session; on auth failure, re-login once and retry.
 * Persistent auth failure surfaces as a clear Error for 502 mapping upstream.
 */
async function withAuthRetry(systemConfig, operation) {
  let session = await getSession(systemConfig);
  try {
    return await operation(session);
  } catch (err) {
    if (!(err instanceof ShineMonitorAuthError)) throw err;
    invalidateSession(systemConfig);
    session = await loginSession(systemConfig);
    try {
      return await operation(session);
    } catch (retryErr) {
      if (retryErr instanceof ShineMonitorAuthError) {
        throw new Error(`ShineMonitor authentication failed: ${retryErr.message}`);
      }
      throw retryErr;
    }
  }
}

/* ── Discovery: find plant + device info on first setup ── */

/** Stable key for a ShineMonitor device (pn + sn + devaddr). */
export function deviceKey({ pn, sn, devaddr }) {
  return `${pn}|${sn}|${devaddr}`;
}

/**
 * Flatten collector/device tree from queryPlantDeviceStatus into selectable entries.
 * @returns {Array<{ key: string, label: string, device: object }>}
 */
export function parseCollectorDevices(collectors) {
  const devices = [];
  for (const collector of collectors || []) {
    const pn = collector.pn;
    const alias = collector.alias || pn;
    for (const dev of collector.device || []) {
      const device = {
        pn,
        devcode: String(dev.devcode),
        sn: dev.sn,
        devaddr: String(dev.devaddr),
      };
      devices.push({
        key: deviceKey(device),
        label: `${alias} — ${dev.sn}`,
        device,
      });
    }
  }
  return devices;
}

/** Devices to query for fetchData/fetchHistory based on stored credentials. */
export function getActiveDevices(credentials) {
  if (credentials.deviceMode === "aggregate" && credentials.devices?.length) {
    return credentials.devices;
  }
  return [credentials.device];
}

export async function discover(credentials, plantId = null, options = {}) {
  const { deviceKey: selectedKey, deviceMode } = options;
  const pwdSha1 = await sha1Hex(credentials.password);
  const sess = await apiAuth(credentials.user, pwdSha1);

  const plantsData = await apiGet(sess, "&action=queryPlantsInfo");
  const plantList = plantsData?.info || [];
  if (!plantList.length) throw new Error("No plants found");

  const plants = plantList.map((p) => ({
    id: String(p.pid),
    name: p.pname || `Plant ${p.pid}`,
  }));

  if (!plantId && plants.length > 1) {
    return { plants, requiresPlantSelection: true, pwdSha1 };
  }

  const selectedId = plantId || plants[0].id;
  const plant = plantList.find((p) => String(p.pid) === String(selectedId));
  if (!plant) throw new Error(`Plant not found: ${selectedId}`);

  const plantInfo = await apiGet(sess, `&action=queryPlantInfo&plantid=${selectedId}`);

  const devData = await apiGet(sess, `&action=queryPlantDeviceStatus&plantid=${selectedId}`);
  const allEntries = parseCollectorDevices(devData?.collector || []);
  if (!allEntries.length) throw new Error("No devices found");

  const allDeviceObjects = allEntries.map((e) => e.device);
  const base = {
    plants,
    pwdSha1,
    plantId: selectedId,
    plantName: plant.pname || plantInfo.name || "Unknown",
    nominalPower: plantInfo.nominalPower ? parseFloat(plantInfo.nominalPower) * 1000 : 5000,
    timezone: plantInfo.address?.timezone ?? 0,
    devices: allDeviceObjects,
  };

  if (allEntries.length === 1) {
    return { ...base, device: allEntries[0].device, deviceMode: "primary" };
  }

  if (deviceMode === "aggregate") {
    return { ...base, device: allEntries[0].device, deviceMode: "aggregate" };
  }

  if (!selectedKey) {
    return {
      ...base,
      requiresDeviceSelection: true,
      deviceOptions: allEntries.map(({ key, label }) => ({ key, label })),
    };
  }

  const picked = allEntries.find((e) => e.key === selectedKey);
  if (!picked) throw new Error(`Device not found: ${selectedKey}`);

  return { ...base, device: picked.device, deviceMode: "primary" };
}

/* ── Data fetch + normalize ── */

const BAT_LOW_V = 42.0;
const BAT_HIGH_V = 53.5;

function estimateSocFromVoltage(batV) {
  if (batV >= BAT_HIGH_V) return 100;
  if (batV <= BAT_LOW_V) return 0;
  return Math.round(((batV - BAT_LOW_V) / (BAT_HIGH_V - BAT_LOW_V)) * 100);
}

/** @returns {{ soc: number, socSource: 'api' | 'estimated' }} */
export function resolveBatterySoc(plantCurrent, batV) {
  if (Array.isArray(plantCurrent)) {
    const item = plantCurrent.find(i => i.key === "BATTERY_SOC");
    if (item?.val != null && item.val !== "") {
      const apiSoc = parseFloat(item.val);
      if (!Number.isNaN(apiSoc) && apiSoc >= 0 && apiSoc !== -1) {
        return { soc: Math.round(apiSoc), socSource: "api" };
      }
    }
  }
  return { soc: estimateSocFromVoltage(batV), socSource: "estimated" };
}

export function localDate(tzOffsetSeconds) {
  const now = new Date(Date.now() + tzOffsetSeconds * 1000);
  return now.toISOString().slice(0, 10);
}

function buildFieldLookup(titles) {
  const indexByName = new Map();
  for (let i = 0; i < titles.length; i++) {
    indexByName.set(titles[i].title, i);
  }
  return (name, fields) => {
    const i = indexByName.get(name);
    return i != null ? fields[i] : null;
  };
}

/**
 * Parse paginated device rows into normalized history points (chronological).
 * @returns {{ points: Array, socSource: 'api' | 'estimated' | 'mixed' | null }}
 */
export function parseHistoryRows(titles, rows) {
  const fieldVal = buildFieldLookup(titles);
  const points = [];
  let hasApiSoc = false;
  let hasEstimatedSoc = false;

  for (const row of rows) {
    const fields = row?.field || [];
    const ts = fieldVal("Timestamp", fields) || "";
    const batV = parseFloat(fieldVal("Battery Voltage", fields)) || 0;
    const batA = parseFloat(fieldVal("Batt Current", fields)) || 0;
    const solarW = parseFloat(fieldVal("Charger Power", fields)) || 0;
    const loadW = parseFloat(fieldVal("PLoad", fields)) || 0;
    const socRaw = fieldVal("BATTERY_SOC", fields);
    let soc;
    if (socRaw != null && socRaw !== "" && socRaw !== "-1") {
      const parsed = parseFloat(socRaw);
      if (Number.isFinite(parsed) && parsed >= 0) {
        soc = Math.round(parsed);
        hasApiSoc = true;
      }
    }
    if (soc == null && batV > 0) {
      soc = estimateSocFromVoltage(batV);
      hasEstimatedSoc = true;
    }

    const point = {
      time: ts.includes(" ") ? ts.split(" ")[1].slice(0, 5) : ts.slice(0, 5),
      solar: Math.round(solarW),
      load: Math.round(loadW),
      battery: Math.round(batV * batA),
    };
    if (soc != null) point.soc = soc;
    points.push(point);
  }

  let socSource = null;
  if (hasEstimatedSoc && hasApiSoc) socSource = "mixed";
  else if (hasEstimatedSoc) socSource = "estimated";
  else if (hasApiSoc) socSource = "api";

  return { points, socSource };
}

async function fetchAllDeviceData(sess, device, date) {
  const pageSize = 288;
  let page = 0;
  let allRows = [];
  let titles = [];
  let total = Infinity;

  while (allRows.length < total) {
    const devData = await apiGet(
      sess,
      `&action=queryDeviceDataOneDayPaging&pn=${device.pn}&devcode=${device.devcode}&sn=${device.sn}&devaddr=${device.devaddr}&date=${date}&page=${page}&pagesize=${pageSize}`,
    );
    titles = devData?.title || titles;
    total = devData?.total ?? 0;
    const rows = devData?.row || [];
    if (!rows.length) break;
    allRows.push(...rows);
    page++;
    if (rows.length < pageSize || allRows.length >= total) break;
  }

  return { titles, rows: allRows.reverse() };
}

function parseDeviceFieldRow(titles, fields) {
  function fieldVal(name) {
    const i = titles.findIndex((t) => t.title === name);
    return i >= 0 ? fields[i] : null;
  }

  return {
    batV: parseFloat(fieldVal("Battery Voltage")) || 0,
    batA: parseFloat(fieldVal("Batt Current")) || 0,
    solarW: parseFloat(fieldVal("Charger Power")) || 0,
    pvV: parseFloat(fieldVal("PV Voltage")) || 0,
    loadW: parseFloat(fieldVal("PLoad")) || 0,
    gridW: parseFloat(fieldVal("PGrid")) || 0,
    gridV: parseFloat(fieldVal("Grid Voltage")) || 0,
    ratedW: parseFloat(fieldVal("rated power")) || 0,
    workState: fieldVal("work state") || "",
    ts: fieldVal("Timestamp") || "",
  };
}

async function fetchLatestDeviceRow(sess, device, date) {
  const devData = await apiGet(
    sess,
    `&action=queryDeviceDataOneDayPaging&pn=${device.pn}&devcode=${device.devcode}&sn=${device.sn}&devaddr=${device.devaddr}&date=${date}&page=0&pagesize=1`,
  );
  const titles = devData?.title || [];
  const fields = devData?.row?.[0]?.field || [];
  return parseDeviceFieldRow(titles, fields);
}

/**
 * Merge per-device realtime snapshots. Sums power metrics; battery V/A from primary (first) device.
 */
export function aggregateDeviceSnapshots(snapshots) {
  if (!snapshots.length) {
    return {
      batV: 0, batA: 0, solarW: 0, pvV: 0, loadW: 0, gridW: 0, gridV: 0,
      ratedW: 0, workState: "", ts: "",
    };
  }

  const primary = snapshots[0];
  let solarW = 0;
  let loadW = 0;
  let gridW = 0;
  let ratedW = 0;
  let pvV = 0;
  let gridV = 0;
  let ts = "";

  for (const s of snapshots) {
    solarW += s.solarW;
    loadW += s.loadW;
    gridW += s.gridW;
    ratedW += s.ratedW;
    if (s.pvV > pvV) pvV = s.pvV;
    if (s.gridV > gridV) gridV = s.gridV;
    if (s.ts > ts) ts = s.ts;
  }

  return {
    batV: primary.batV,
    batA: primary.batA,
    solarW,
    pvV,
    loadW,
    gridW,
    gridV,
    ratedW,
    workState: primary.workState,
    ts: ts || primary.ts,
  };
}

/** Merge intraday points by time; sum power columns across inverters. */
export function mergeHistoryByTime(devicePointLists) {
  const byTime = new Map();

  for (const points of devicePointLists) {
    for (const p of points) {
      const existing = byTime.get(p.time);
      if (!existing) {
        byTime.set(p.time, { ...p });
        continue;
      }
      existing.solar += p.solar;
      existing.load += p.load;
      existing.battery += p.battery;
      if (p.soc != null) {
        existing.soc = existing.soc == null ? p.soc : Math.round((existing.soc + p.soc) / 2);
      }
    }
  }

  return [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time));
}

export async function fetchHistory(systemConfig, date) {
  return withAuthRetry(systemConfig, async (sess) => {
    const { timezone } = systemConfig.credentials;
    const devices = getActiveDevices(systemConfig.credentials);
    const tzOffset = timezone ?? 0;
    const today = localDate(tzOffset);
    const queryDate = date || today;

    async function fetchRowsForDate(d) {
      const results = await Promise.all(
        devices.map((device) => fetchAllDeviceData(sess, device, d)),
      );
      if (devices.length === 1) {
        return results[0];
      }
      const titles = results[0]?.titles || [];
      const mergedPoints = mergeHistoryByTime(
        results.map((r) => parseHistoryRows(r.titles, r.rows).points),
      );
      return { titles, rows: [], _mergedPoints: mergedPoints };
    }

    const result = await fetchRowsForDate(queryDate);

    let points;
    let socSource;
    if (result._mergedPoints) {
      points = result._mergedPoints;
      socSource = devices.length > 1 ? "mixed" : null;
    } else {
      ({ points, socSource } = parseHistoryRows(result.titles, result.rows));
    }

    return {
      systemId: systemConfig.id,
      name: systemConfig.name,
      service: "shinemonitor",
      date: queryDate,
      timezoneOffset: tzOffset,
      intervalMinutes: 5,
      points,
      socSource,
      deviceMode: systemConfig.credentials.deviceMode || "primary",
      deviceCount: devices.length,
    };
  });
}

function emptySummaryDay(date) {
  return {
    date,
    solarKwh: null,
    loadKwh: null,
    peakSolarW: null,
    minSoc: null,
    maxSoc: null,
    source: null,
  };
}

/** Aggregate daily solar/load kWh for the last N plant-local days via fetchHistory. */
export async function fetchHistorySummary(systemConfig, days = 7, endDate = null) {
  const tzOffset = systemConfig.credentials.timezone ?? 0;
  const end = endDate || localDate(tzOffset);
  const dates = dateRange(end, days);

  const series = await Promise.all(
    dates.map(async (date) => {
      try {
        const history = await fetchHistory(systemConfig, date);
        if (!history.points?.length) return emptySummaryDay(date);
        const summary = computeDailySummary(history.points);
        return {
          date,
          solarKwh: summary.solarKwh,
          loadKwh: summary.loadKwh,
          peakSolarW: summary.peakSolarW,
          minSoc: summary.minSoc,
          maxSoc: summary.maxSoc,
          source: "vendor",
        };
      } catch {
        return emptySummaryDay(date);
      }
    }),
  );

  return {
    systemId: systemConfig.id,
    days,
    endDate: end,
    series,
  };
}

export async function fetchData(systemConfig) {
  return withAuthRetry(systemConfig, async (sess) => {
    const { plantId, timezone } = systemConfig.credentials;
    const devices = getActiveDevices(systemConfig.credentials);
    const tzOffset = timezone ?? 0;
    const today = localDate(tzOffset);

    const plantCurrentPromise = apiGet(sess, `&action=queryPlantCurrentData&plantid=${plantId}&par=CURRENT_POWER,ENERGY_TODAY,BATTERY_SOC`);

    async function fetchSnapshotsForDate(date) {
      return Promise.all(devices.map((device) => fetchLatestDeviceRow(sess, device, date)));
    }

    let snapshots;
    try {
      snapshots = await fetchSnapshotsForDate(today);
    } catch (err) {
      if (err instanceof ShineMonitorAuthError) throw err;
      const yesterday = localDate(tzOffset - 86400);
      snapshots = await fetchSnapshotsForDate(yesterday);
    }

    const plantCurrent = await plantCurrentPromise;
    const merged = aggregateDeviceSnapshots(snapshots);
    const { batV, batA, solarW, pvV, loadW, gridW, gridV, ratedW, workState, ts } = merged;

    const nominalPV = systemConfig.credentials.nominalPower || 5000;
    const ratedPower = ratedW || 5000;

    const { soc, socSource } = resolveBatterySoc(plantCurrent, batV);

    const genOn = isGridActive(gridV, gridW, systemConfig.gridDetect, { useAbsPower: true });

    let energyToday = null;
    if (Array.isArray(plantCurrent)) {
      const item = plantCurrent.find(i => i.key === "ENERGY_TODAY");
      if (item) energyToday = parseFloat(item.val);
    }

    const deviceMode = systemConfig.credentials.deviceMode || "primary";

    return {
      systemId: systemConfig.id,
      name: systemConfig.name,
      service: "shinemonitor",
      timestamp: ts,
      battery: { voltage: batV, soc, socSource, current: batA, power: Math.round(batV * batA) },
      solar: { power: solarW, voltage: pvV },
      load: { power: loadW, percent: Math.round((loadW / ratedPower) * 100) },
      grid: { power: gridW, voltage: gridV, active: genOn },
      inverter: { ratedPower, nominalPV },
      status: workState,
      energyToday,
      deviceMode,
      deviceCount: devices.length,
    };
  });
}
