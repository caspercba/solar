import { computeDailySummary, dateRange } from "../history.js";

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

async function apiGet(session, actionCore) {
  const action = `${actionCore}&i18n=en_US&lang=en_US`;
  const salt = Date.now();
  const sign = await signPublic(salt, session.secret, session.token, action);
  const enc = encodeAction(action);
  const url = `${API_BASE}?sign=${sign}&salt=${salt}&token=${session.token}${enc}`;
  const resp = await fetch(url);
  const json = await resp.json();
  if (json.err !== 0) throw new Error(json.desc || `API error ${json.err}`);
  return json.dat;
}

/* ── Session cache (in-memory, per-Worker isolate) ── */

const sessionCache = new Map();
const SESSION_TTL = 300_000; // 5 min

async function getSession(systemConfig) {
  const key = systemConfig.id;
  const cached = sessionCache.get(key);
  if (cached && Date.now() - cached.ts < SESSION_TTL) return cached;

  const sess = await apiAuth(systemConfig.credentials.user, systemConfig.credentials.pwdSha1);
  sessionCache.set(key, sess);
  return sess;
}

/* ── Discovery: find plant + device info on first setup ── */

export async function discover(credentials, plantId = null) {
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
  const collectors = devData?.collector || [];
  if (!collectors.length || !collectors[0].device?.length) throw new Error("No devices found");

  const collector = collectors[0];
  const dev = collector.device[0];

  return {
    plants,
    pwdSha1,
    plantId: selectedId,
    plantName: plant.pname || plantInfo.name || "Unknown",
    device: {
      pn: collector.pn,
      devcode: String(dev.devcode),
      sn: dev.sn,
      devaddr: String(dev.devaddr),
    },
    nominalPower: plantInfo.nominalPower ? parseFloat(plantInfo.nominalPower) * 1000 : 5000,
    timezone: plantInfo.address?.timezone ?? 0,
  };
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

export async function fetchHistory(systemConfig, date) {
  const sess = await getSession(systemConfig);
  const { device, timezone } = systemConfig.credentials;
  const tzOffset = timezone ?? 0;
  const today = localDate(tzOffset);
  let queryDate = date || today;

  let { titles, rows } = await fetchAllDeviceData(sess, device, queryDate);

  // When no explicit date, fall back to yesterday if today's series is not ready yet.
  if (!rows.length && !date && queryDate === today) {
    queryDate = localDate(tzOffset - 86400);
    ({ titles, rows } = await fetchAllDeviceData(sess, device, queryDate));
  }

  const { points, socSource } = parseHistoryRows(titles, rows);

  return {
    systemId: systemConfig.id,
    name: systemConfig.name,
    service: "shinemonitor",
    date: queryDate,
    timezoneOffset: tzOffset,
    intervalMinutes: 5,
    points,
    socSource,
  };
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
  const sess = await getSession(systemConfig);
  const { plantId, device, timezone } = systemConfig.credentials;
  const tzOffset = timezone ?? 0;
  const today = localDate(tzOffset);

  async function fetchDeviceData(date) {
    return apiGet(sess, `&action=queryDeviceDataOneDayPaging&pn=${device.pn}&devcode=${device.devcode}&sn=${device.sn}&devaddr=${device.devaddr}&date=${date}&page=0&pagesize=1`);
  }

  const plantCurrentPromise = apiGet(sess, `&action=queryPlantCurrentData&plantid=${plantId}&par=CURRENT_POWER,ENERGY_TODAY,BATTERY_SOC`);

  let devData;
  try {
    devData = await fetchDeviceData(today);
  } catch {
    const yesterday = localDate(tzOffset - 86400);
    devData = await fetchDeviceData(yesterday);
  }

  const plantCurrent = await plantCurrentPromise;

  const titles = devData?.title || [];
  const fields = devData?.row?.[0]?.field || [];

  function fieldVal(name) {
    const i = titles.findIndex(t => t.title === name);
    return i >= 0 ? fields[i] : null;
  }

  const batV = parseFloat(fieldVal("Battery Voltage")) || 0;
  const batA = parseFloat(fieldVal("Batt Current")) || 0;
  const solarW = parseFloat(fieldVal("Charger Power")) || 0;
  const pvV = parseFloat(fieldVal("PV Voltage")) || 0;
  const loadW = parseFloat(fieldVal("PLoad")) || 0;
  const gridW = parseFloat(fieldVal("PGrid")) || 0;
  const gridV = parseFloat(fieldVal("Grid Voltage")) || 0;
  const ratedW = parseFloat(fieldVal("rated power")) || 0;
  const workState = fieldVal("work state") || "";
  const ts = fieldVal("Timestamp") || "";

  const nominalPV = systemConfig.credentials.nominalPower || 5000;
  const ratedPower = ratedW || 5000;

  const { soc, socSource } = resolveBatterySoc(plantCurrent, batV);

  const genOn = gridV > 30 && Math.abs(gridW) > 5;

  let energyToday = null;
  if (Array.isArray(plantCurrent)) {
    const item = plantCurrent.find(i => i.key === "ENERGY_TODAY");
    if (item) energyToday = parseFloat(item.val);
  }

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
  };
}
