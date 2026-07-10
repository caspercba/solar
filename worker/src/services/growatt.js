/**
 * Growatt service adapter.
 *
 * Auth flow: POST /login with password (HTTPS), receive JSESSIONID cookie.
 * Cookie-based session for all subsequent requests. Session cookies are cached in KV
 * alongside the password to skip a login round-trip on a cold isolate; the password
 * is kept (encrypted at rest via CREDENTIALS_KEY) so re-login on real session expiry
 * always succeeds.
 */

import { saveSystemConfig } from "../credentials.js";
import { isGridActive } from "../gridDetect.js";
import {
  computeDailySummary,
  computeSocExtrema,
  dateRange,
  mergeSocIntoPoints,
  socMapFromPoints,
  supplementSummarySoc,
} from "../history.js";

const BASE = "https://mqtt.growatt.com";

export const STATUS_MAP = {
  "-1": "Offline", "0": "Standby",
  "1": "PV&Grid Supporting Loads", "2": "Battery Discharging",
  "3": "Fault", "4": "Flash", "5": "PV Charging",
  "6": "Grid Charging", "7": "PV&Grid Charging",
  "8": "PV&Grid Charging+Grid Bypass", "9": "PV Charging+Grid Bypass",
  "10": "Grid Charging+Grid Bypass", "11": "Grid Bypass",
  "12": "PV Charging+Loads Supporting", "13": "PV Discharging",
  "14": "PV&Battery Discharging", "15": "Gen Charging",
  "16": "Gen Charging+Gen Bypass", "17": "PV&Gen Charging",
  "18": "PV&Gen Charging+Gen Bypass", "19": "PV Charging+Gen Bypass",
  "20": "Gen Bypass",
  "21": "PV Export to Grid", "22": "PV Export to Grid+Loads Supporting",
  "23": "PV Charging+Export to Grid", "24": "PV Charging+Export to Grid+Loads Supporting",
  "25": "Battery Export to Grid", "26": "Battery Export to Grid+Loads Supporting",
  "27": "Battery&PV Export to Grid", "28": "Battery&PV Export to Grid+Loads Supporting",
};

/* ── Cookie-based session management ── */

const sessionCache = new Map();
const SESSION_TTL = 240_000; // 4 min (Growatt sessions expire quickly)

export class SessionExpiredError extends Error {
  constructor(message = "Growatt session expired") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

/** Attach KV env so successful auth can persist session cookies (and migrate legacy creds). */
export function withAdapterContext(systemConfig, env) {
  if (!env) return systemConfig;
  return { ...systemConfig, _adapterContext: { env } };
}

function parseCookies(response) {
  const cookies = {};
  const raw = response.headers.getAll?.("set-cookie") || [];
  for (const header of raw) {
    const match = header.match(/^([^=]+)=([^;]*)/);
    if (match) cookies[match[1]] = match[2];
  }
  return cookies;
}

function cookieString(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
}

async function login(user, password) {
  const body = new URLSearchParams({
    account: user,
    password: password,
    validateCode: "",
    isReadPact: "0",
    lang: "en",
  });

  const resp = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    redirect: "manual",
  });

  const text = await resp.text();
  let result;
  try { result = JSON.parse(text); } catch { throw new Error("Login response not JSON"); }
  if (result.result !== 1) throw new Error("Growatt login failed");

  const cookies = {};
  const setCookieHeaders = resp.headers.getAll ? resp.headers.getAll("set-cookie") : [];
  if (setCookieHeaders.length === 0) {
    const single = resp.headers.get("set-cookie");
    if (single) {
      for (const part of single.split(/,(?=[A-Z])/)) {
        const m = part.trim().match(/^([^=]+)=([^;]*)/);
        if (m) cookies[m[1]] = m[2];
      }
    }
  } else {
    for (const h of setCookieHeaders) {
      const m = h.match(/^([^=]+)=([^;]*)/);
      if (m) cookies[m[1]] = m[2];
    }
  }

  return { cookies, ts: Date.now() };
}

function isAuthFailureResponse(resp, text, parsed) {
  if (resp.status === 401 || resp.status === 403) return true;
  if (!parsed) return true;
  if (parsed.result === -1 || parsed.result === 0) {
    const msg = String(parsed.msg || parsed.message || "").toLowerCase();
    if (msg.includes("login") || msg.includes("session") || msg.includes("auth")) return true;
  }
  return false;
}

async function postJson(session, path, bodyObj = {}) {
  const body = new URLSearchParams(bodyObj);
  const resp = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      "Cookie": cookieString(session.cookies),
    },
    body: body.toString(),
  });
  const text = await resp.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    if (isAuthFailureResponse(resp, text, null)) {
      throw new SessionExpiredError();
    }
    throw new Error("Session expired or invalid response");
  }
  if (isAuthFailureResponse(resp, text, parsed)) {
    throw new SessionExpiredError();
  }
  return parsed;
}

function sessionFromCookies(cookies) {
  return { cookies, ts: Date.now() };
}

async function persistSessionCredentials(systemConfig, cookies) {
  const creds = systemConfig.credentials;
  const sameSession = creds.sessionCookies?.JSESSIONID === cookies.JSESSIONID;
  if (sameSession) return;

  const nextCredentials = {
    ...creds,
    sessionCookies: cookies,
  };

  systemConfig.credentials = nextCredentials;

  const env = systemConfig._adapterContext?.env;
  if (!env) return;

  await saveSystemConfig(env, {
    ...systemConfig,
    credentials: nextCredentials,
  });
}

async function loginAndPersist(systemConfig) {
  const creds = systemConfig.credentials;
  if (!creds.password) {
    throw new SessionExpiredError("Growatt session expired and no password stored for re-login");
  }
  const sess = await login(creds.user, creds.password);
  sessionCache.set(systemConfig.id, sess);
  await persistSessionCredentials(systemConfig, sess.cookies);
  return sess;
}

async function getSession(systemConfig, { forceLogin = false } = {}) {
  const key = systemConfig.id;
  if (!forceLogin) {
    const cached = sessionCache.get(key);
    if (cached && Date.now() - cached.ts < SESSION_TTL) return cached;

    const stored = systemConfig.credentials.sessionCookies;
    if (stored?.JSESSIONID) {
      const sess = sessionFromCookies(stored);
      sessionCache.set(key, sess);
      return sess;
    }
  } else {
    sessionCache.delete(key);
  }

  return loginAndPersist(systemConfig);
}

async function postJsonWithRetry(systemConfig, path, bodyObj = {}) {
  let session = await getSession(systemConfig);
  try {
    return await postJson(session, path, bodyObj);
  } catch (err) {
    if (!(err instanceof SessionExpiredError)) throw err;
    session = await getSession(systemConfig, { forceLogin: true });
    return postJson(session, path, bodyObj);
  }
}

/* ── Discovery ── */

export async function discover(credentials, plantId = null) {
  const sess = await login(credentials.user, credentials.password);

  const plantsResp = await postJson(sess, "/index/getPlantListTitle");
  const plantList = Array.isArray(plantsResp) ? plantsResp : [];
  if (!plantList.length) throw new Error("No plants found on Growatt account");

  const plants = plantList.map((p) => ({
    id: String(p.id),
    name: p.plantName || `Plant ${p.id}`,
  }));

  if (!plantId && plants.length > 1) {
    return { plants, requiresPlantSelection: true };
  }

  const selectedId = plantId || plants[0].id;
  const plant = plantList.find((p) => String(p.id) === String(selectedId));
  if (!plant) throw new Error(`Plant not found: ${selectedId}`);

  const devicesResp = await postJson(sess, "/panel/getDevicesByPlantList", { currPage: "1", plantId: selectedId });

  let storageSn, nominalPower, deviceModel;

  if (devicesResp.result === 1 && devicesResp.obj?.datas?.length) {
    const dev = devicesResp.obj.datas[0];
    storageSn = dev.sn;
    nominalPower = parseFloat(dev.nominalPower) || 3500;
    deviceModel = dev.deviceModel || "";
  } else {
    throw new Error("No devices found on Growatt account");
  }

  const plantResp = await postJson(sess, `/panel/getPlantData?plantId=${selectedId}`);
  const nominalPV = plantResp.result === 1 ? parseFloat(plantResp.obj?.nominalPower) || nominalPower : nominalPower;

  return {
    plants,
    plantId: selectedId,
    storageSn,
    plantName: plant.plantName || "Growatt Plant",
    nominalPower,
    nominalPV,
    deviceModel,
    sessionCookies: sess.cookies,
  };
}

/* ── Weather ── */

/** Parse getWeatherByPlantId response into optional normalized weather fields. */
export function parseGrowattWeather(resp) {
  if (!resp || resp.result !== 1) return null;

  const obj = resp.obj || {};
  const heWeather = obj.data?.HeWeather6?.[0];
  if (!heWeather) return null;

  const now = heWeather.now || {};
  const weather = {};

  const temp = parseFloat(now.tmp);
  if (Number.isFinite(temp)) weather.temperature = temp;

  const hum = parseFloat(now.hum);
  if (Number.isFinite(hum)) weather.humidity = Math.round(hum);

  if (now.cond_txt) weather.condition = String(now.cond_txt);

  const radiant = obj.radiant;
  if (radiant != null && radiant !== "" && radiant !== "--") {
    const irradiance = parseFloat(radiant);
    if (Number.isFinite(irradiance)) weather.irradiance = irradiance;
  }

  const city = obj.city || heWeather.basic?.location;
  if (city) weather.city = String(city);

  return Object.keys(weather).length ? weather : null;
}

export async function fetchWeather(systemConfig) {
  const { plantId } = systemConfig.credentials;
  const resp = await postJsonWithRetry(
    systemConfig,
    `/index/getWeatherByPlantId?plantId=${plantId}`,
    {},
  );
  return parseGrowattWeather(resp);
}

/* ── Data fetch + normalize ── */

export async function fetchData(systemConfig) {
  const { plantId, storageSn, nominalPower, nominalPV } = systemConfig.credentials;

  const [statusResp, totalsResp, weatherResp] = await Promise.all([
    postJsonWithRetry(systemConfig, `/panel/storage/getStorageStatusData?plantId=${plantId}`, { storageSn }),
    postJsonWithRetry(systemConfig, `/panel/storage/getStorageTotalData?plantId=${plantId}`, { storageSn }),
    postJsonWithRetry(systemConfig, `/index/getWeatherByPlantId?plantId=${plantId}`, {}).catch(() => null),
  ]);

  if (statusResp.result !== 1) throw new Error("Failed to fetch Growatt status data");

  const d = statusResp.obj;
  const solarW = parseFloat(d.panelPower) || 0;
  const pvV = parseFloat(d.vPv1) || 0;
  const batV = parseFloat(d.vBat) || 0;
  const soc = parseInt(d.capacity) || 0;
  const batPower = parseFloat(d.batPower) || 0;
  const loadW = parseFloat(d.loadPower) || 0;
  const loadPct = parseFloat(d.loadPrecent) || 0;
  const gridW = parseFloat(d.gridPower) || 0;
  const gridV = parseFloat(d.vAcInput) || 0;
  const statusCode = d.status || "-1";
  const statusText = statusLabel(statusCode);
  const ratedPower = nominalPower || 3500;

  const batCurrent = batV > 0 ? batPower / batV : 0;
  const genOn = isGridActive(gridV, gridW, systemConfig.gridDetect);

  let energyToday = null;
  if (totalsResp.result === 1) {
    energyToday = parseFloat(totalsResp.obj?.epvToday) || 0;
  }

  const payload = {
    systemId: systemConfig.id,
    name: systemConfig.name,
    service: "growatt",
    timestamp: new Date().toISOString(),
    battery: { voltage: batV, soc, current: Math.round(batCurrent * 10) / 10, power: batPower },
    solar: { power: solarW, voltage: pvV },
    load: { power: loadW, percent: loadPct },
    grid: { power: gridW, voltage: gridV, active: genOn },
    inverter: { ratedPower, nominalPV: nominalPV || ratedPower },
    status: statusText,
    energyToday,
  };

  const weather = parseGrowattWeather(weatherResp);
  if (weather) payload.weather = weather;

  return payload;
}

export function statusLabel(statusCode) {
  const key = String(statusCode ?? "-1");
  return STATUS_MAP[key] || `Unknown (${key})`;
}

export function formatIntervalTime(index) {
  const mins = index * 5;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Map Growatt energy-day chart arrays to normalized intraday points. */
export function parseEnergyDayPoints(ppv = [], userLoad = [], batPower = []) {
  const count = Math.max(ppv.length, userLoad.length, batPower.length);
  const points = [];
  for (let i = 0; i < count; i++) {
    points.push({
      time: formatIntervalTime(i),
      solar: Math.round(parseFloat(ppv[i]) || 0),
      load: Math.round(parseFloat(userLoad[i]) || 0),
      battery: Math.round(parseFloat(batPower[i]) || 0),
    });
  }
  return points;
}

/** Map getStorageBatChart socChart.capacity to intraday SOC points (skips invalid samples). */
export function parseSocCapacityPoints(capacity = []) {
  const points = [];
  for (let i = 0; i < capacity.length; i++) {
    const soc = Math.round(parseFloat(capacity[i]));
    if (!Number.isFinite(soc) || soc < 0) continue;
    points.push({ time: formatIntervalTime(i), soc });
  }
  return points;
}

export async function fetchHistory(systemConfig, date) {
  const { plantId, storageSn } = systemConfig.credentials;
  const queryDate = date || new Date().toISOString().slice(0, 10);

  const [energyResp, lineResp] = await Promise.all([
    postJsonWithRetry(systemConfig, "/panel/storage/getStorageEnergyDayChart", { plantId, storageSn, date: queryDate }),
    postJsonWithRetry(systemConfig, "/panel/storage/getStorageLineChartData", { plantId, storageSn, date: queryDate }).catch(() => null),
  ]);

  if (energyResp.result !== 1) throw new Error("Failed to fetch Growatt history");

  const obj = energyResp.obj || {};
  const batPower = lineResp?.result === 1 ? (lineResp.obj?.batPower || []) : [];
  const points = parseEnergyDayPoints(obj.ppv, obj.userLoad, batPower);

  let mergedPoints = points;
  try {
    const socPoints = await fetchSocChart(systemConfig, queryDate);
    if (socPoints.length) {
      mergedPoints = mergeSocIntoPoints(points, socMapFromPoints(socPoints));
    }
  } catch {
    /* optional SOC supplement */
  }

  return {
    systemId: systemConfig.id,
    name: systemConfig.name,
    service: "growatt",
    date: queryDate,
    timezoneOffset: 0,
    intervalMinutes: 5,
    points: mergedPoints,
    socSource: mergedPoints.some((p) => Number.isFinite(p.soc)) ? "api" : null,
  };
}

/** Intraday SOC series from getStorageBatChart (valid only for obj.date). */
export async function fetchSocChart(systemConfig, date) {
  const { plantId, storageSn } = systemConfig.credentials;
  const queryDate = date || new Date().toISOString().slice(0, 10);

  const resp = await postJsonWithRetry(systemConfig, "/panel/storage/getStorageBatChart", { plantId, storageSn });
  if (resp.result !== 1) return [];

  const obj = resp.obj || {};
  if (obj.date !== queryDate) return [];

  return parseSocCapacityPoints(obj.socChart?.capacity);
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

/** Aggregate daily solar/load kWh for the last N days via fetchHistory. */
export async function fetchHistorySummary(systemConfig, days = 7, endDate = null) {
  const end = endDate || new Date().toISOString().slice(0, 10);
  const dates = dateRange(end, days);

  let series = await Promise.all(
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

  try {
    const socByDate = await fetchSocDailySummary(systemConfig, end, days);
    series = supplementSummarySoc(series, socByDate);
  } catch {
    // optional SOC enrichment
  }

  return {
    systemId: systemConfig.id,
    days,
    endDate: end,
    series,
  };
}

/** Daily min/max SOC for the chart day when stored snapshots lack SOC. */
export async function fetchSocDailySummary(_systemConfig, _endDate, _days) {
  const { plantId, storageSn } = _systemConfig.credentials;

  const resp = await postJsonWithRetry(_systemConfig, "/panel/storage/getStorageBatChart", { plantId, storageSn });
  if (resp.result !== 1) return {};

  const obj = resp.obj || {};
  const capacity = (obj.socChart?.capacity || []).map((v) => parseFloat(v));
  const { minSoc, maxSoc } = computeSocExtrema(capacity);
  if (minSoc == null) return {};

  return { [obj.date]: { minSoc, maxSoc } };
}
