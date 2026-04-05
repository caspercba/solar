/**
 * Growatt service adapter.
 *
 * Auth flow: POST /login with plaintext password (HTTPS), receive JSESSIONID cookie.
 * Cookie-based session for all subsequent requests.
 */

const BASE = "https://mqtt.growatt.com";

const STATUS_MAP = {
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
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Session expired or invalid response");
  }
}

async function getSession(systemConfig) {
  const key = systemConfig.id;
  const cached = sessionCache.get(key);
  if (cached && Date.now() - cached.ts < SESSION_TTL) return cached;

  const creds = systemConfig.credentials;
  const sess = await login(creds.user, creds.password);
  sessionCache.set(key, sess);
  return sess;
}

/* ── Discovery ── */

export async function discover(credentials) {
  const sess = await login(credentials.user, credentials.password);

  const plantsResp = await postJson(sess, "/index/getPlantListTitle");
  const plants = Array.isArray(plantsResp) ? plantsResp : [];
  if (!plants.length) throw new Error("No plants found on Growatt account");

  const plantId = plants[0].id;
  const plantName = plants[0].plantName || "Growatt Plant";

  const devicesResp = await postJson(sess, "/panel/getDevicesByPlantList", { currPage: "1", plantId });

  let storageSn, nominalPower, deviceModel;

  if (devicesResp.result === 1 && devicesResp.obj?.datas?.length) {
    const dev = devicesResp.obj.datas[0];
    storageSn = dev.sn;
    nominalPower = parseFloat(dev.nominalPower) || 3500;
    deviceModel = dev.deviceModel || "";
  } else {
    throw new Error("No devices found on Growatt account");
  }

  const plantResp = await postJson(sess, `/panel/getPlantData?plantId=${plantId}`);
  const nominalPV = plantResp.result === 1 ? parseFloat(plantResp.obj?.nominalPower) || nominalPower : nominalPower;

  return {
    plantId,
    storageSn,
    plantName,
    nominalPower,
    nominalPV,
    deviceModel,
  };
}

/* ── Data fetch + normalize ── */

export async function fetchData(systemConfig) {
  const sess = await getSession(systemConfig);
  const { plantId, storageSn, nominalPower, nominalPV } = systemConfig.credentials;

  const [statusResp, totalsResp] = await Promise.all([
    postJson(sess, `/panel/storage/getStorageStatusData?plantId=${plantId}`, { storageSn }),
    postJson(sess, `/panel/storage/getStorageTotalData?plantId=${plantId}`, { storageSn }),
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
  const statusText = STATUS_MAP[statusCode] || `Unknown (${statusCode})`;
  const ratedPower = nominalPower || 3500;

  const batCurrent = batV > 0 ? batPower / batV : 0;
  const genOn = gridV > 30 && gridW > 5;

  let energyToday = null;
  if (totalsResp.result === 1) {
    energyToday = parseFloat(totalsResp.obj?.epvToday) || 0;
  }

  return {
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
}
