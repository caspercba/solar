/**
 * ShineMonitor service adapter.
 *
 * Auth flow: SHA1(password) -> SHA1(salt + pwdSha1 + action) for login,
 * then SHA1(salt + secret + token + encodedAction) for authenticated calls.
 */

const API_BASE = "https://web.shinemonitor.com/public/";
const COMPANY_KEY = "bnrl_frRFjEz8Mkn";

/* ── SHA-1 via Web Crypto (available in Workers) ── */

async function sha1Hex(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-1", data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function encodeAction(a) {
  return a.replace(/#/g, "%23").replace(/'/g, "%27").replace(/ /g, "%20");
}

async function signAuth(salt, pwdSha1, action) {
  return sha1Hex(String(salt) + pwdSha1 + action);
}

async function signPublic(salt, secret, token, action) {
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

export async function discover(credentials) {
  const pwdSha1 = await sha1Hex(credentials.password);
  const sess = await apiAuth(credentials.user, pwdSha1);

  const plantsData = await apiGet(sess, "&action=queryPlantsInfo");
  const plantList = plantsData?.info || [];
  if (!plantList.length) throw new Error("No plants found");

  const plant = plantList[0];
  const plantId = String(plant.pid);

  const plantInfo = await apiGet(sess, `&action=queryPlantInfo&plantid=${plantId}`);

  const devData = await apiGet(sess, `&action=queryPlantDeviceStatus&plantid=${plantId}`);
  const collectors = devData?.collector || [];
  if (!collectors.length || !collectors[0].device?.length) throw new Error("No devices found");

  const collector = collectors[0];
  const dev = collector.device[0];

  return {
    pwdSha1,
    plantId,
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

function localDate(tzOffsetSeconds) {
  const now = new Date(Date.now() + tzOffsetSeconds * 1000);
  return now.toISOString().slice(0, 10);
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

  const batLowV = 42.0;
  const batHighV = 53.5;
  let soc;
  if (batV >= batHighV) soc = 100;
  else if (batV <= batLowV) soc = 0;
  else soc = Math.round(((batV - batLowV) / (batHighV - batLowV)) * 100);

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
    battery: { voltage: batV, soc, current: batA, power: Math.round(batV * batA) },
    solar: { power: solarW, voltage: pvV },
    load: { power: loadW, percent: Math.round((loadW / ratedPower) * 100) },
    grid: { power: gridW, voltage: gridV, active: genOn },
    inverter: { ratedPower, nominalPV },
    status: workState,
    energyToday,
  };
}
