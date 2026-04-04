/* ── SHA-1 (minimal, from jsSHA public domain) ── */
/* eslint-disable */
function sha1(msg){function f(s,x,y,z){switch(s){case 0:return(x&y)^(~x&z);case 1:case 3:return x^y^z;case 2:return(x&y)^(x&z)^(y&z)}};function rl(n,s){return(n<<s)|(n>>>(32-s))};var B=Math.pow(2,32);var H=[0x67452301,0xEFCDAB89,0x98BADCFE,0x10325476,0xC3D2E1F0];var K=[0x5A827999,0x6ED9EBA1,0x8F1BBCDC,0xCA62C1D6];var l=msg.length;var bA=[];for(var i=0;i<l;i++){bA.push(msg.charCodeAt(i))}bA.push(0x80);var zeros=(64-((l+9)%64))%64;for(var i=0;i<zeros;i++)bA.push(0);var hi=Math.floor(l*8/B);var lo=(l*8)%B;bA.push((hi>>>24)&0xFF,(hi>>>16)&0xFF,(hi>>>8)&0xFF,hi&0xFF);bA.push((lo>>>24)&0xFF,(lo>>>16)&0xFF,(lo>>>8)&0xFF,lo&0xFF);for(var b=0;b<bA.length;b+=64){var w=[];for(var j=0;j<16;j++)w[j]=(bA[b+j*4]<<24)|(bA[b+j*4+1]<<16)|(bA[b+j*4+2]<<8)|bA[b+j*4+3];for(var j=16;j<80;j++)w[j]=rl(w[j-3]^w[j-8]^w[j-14]^w[j-16],1);var a=H[0],bb=H[1],c=H[2],d=H[3],e=H[4];for(var j=0;j<80;j++){var s=Math.floor(j/20);var T=(rl(a,5)+f(s,bb,c,d)+e+K[s]+w[j])%B;if(T<0)T+=B;e=d;d=c;c=rl(bb,30);bb=a;a=T}H[0]=(H[0]+a)%B;H[1]=(H[1]+bb)%B;H[2]=(H[2]+c)%B;H[3]=(H[3]+d)%B;H[4]=(H[4]+e)%B;for(var i=0;i<5;i++)if(H[i]<0)H[i]+=B}return H.map(function(v){return("00000000"+v.toString(16)).slice(-8)}).join("")}
/* eslint-enable */

/* ── Config ── */
const API_BASE = "https://web.shinemonitor.com/public/";
const COMPANY_KEY = "bnrl_frRFjEz8Mkn";
const PLANT_ID = "77218";
const DEVICE = { pn: "B1419120275203", devcode: "697", sn: "FFFFFFFF", devaddr: "4" };
const SOLAR_MAX_W = 5000;
const INVERTER_MAX_VA = 5000;
const POLL_MS = 60_000;

/* 48 V lead-acid voltage-to-SOC (resting, approximate) */
const SOC_TABLE = [
  [52.0, 100], [51.6, 95], [51.2, 90], [50.8, 80], [50.4, 75],
  [50.0, 65],  [49.6, 55], [49.2, 50], [48.8, 40], [48.4, 30],
  [48.0, 25],  [47.2, 15], [46.0, 5],  [44.0, 0]
];

function voltageToSoc(v) {
  if (v >= SOC_TABLE[0][0]) return 100;
  if (v <= SOC_TABLE[SOC_TABLE.length - 1][0]) return 0;
  for (let i = 0; i < SOC_TABLE.length - 1; i++) {
    const [v1, s1] = SOC_TABLE[i];
    const [v2, s2] = SOC_TABLE[i + 1];
    if (v >= v2) return Math.round(s2 + (s1 - s2) * (v - v2) / (v1 - v2));
  }
  return 0;
}

/* ── Session helpers ── */
const SS_KEY = "solar_session";

function saveSession(data) {
  localStorage.setItem(SS_KEY, JSON.stringify(data));
}

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SS_KEY)); } catch { return null; }
}

function clearSession() {
  localStorage.removeItem(SS_KEY);
}

function isSessionValid(sess) {
  if (!sess || !sess.token || !sess.secret) return false;
  const age = (Date.now() - sess.ts) / 1000;
  return age < (sess.expire || 432000);
}

/* ── API signing ── */
function encodeAction(a) {
  return a.replace(/#/g, "%23").replace(/'/g, "%27").replace(/ /g, "%20");
}

function signAuth(salt, pwdSha1, action) {
  return sha1(String(salt) + pwdSha1 + action);
}

function signPublic(salt, secret, token, action) {
  return sha1(String(salt) + secret + token + encodeAction(action));
}

/* ── API calls ── */
async function apiAuth(user, password) {
  const pwdSha1 = sha1(password);
  const salt = Date.now();
  const usr = encodeURIComponent(user).replace(/\+/g, "%2B").replace(/'/g, "%27");
  const action = `&action=auth&usr=${usr}&company-key=${COMPANY_KEY}`;
  const sign = signAuth(salt, pwdSha1, action);
  const url = `${API_BASE}?sign=${sign}&salt=${salt}${action}`;
  const resp = await fetch(url);
  const json = await resp.json();
  if (json.err !== 0) throw new Error(json.desc || "Auth failed");
  return { ...json.dat, pwdSha1, ts: Date.now() };
}

async function apiGet(session, actionCore) {
  const action = `${actionCore}&i18n=en_US&lang=en_US`;
  const salt = Date.now();
  const sign = signPublic(salt, session.secret, session.token, action);
  const enc = encodeAction(action);
  const url = `${API_BASE}?sign=${sign}&salt=${salt}&token=${session.token}${enc}`;
  const resp = await fetch(url);
  const json = await resp.json();
  if (json.err !== 0) throw new Error(json.desc || `API error ${json.err}`);
  return json.dat;
}

async function fetchDeviceData(session) {
  const today = new Date().toISOString().slice(0, 10);
  return apiGet(session,
    `&action=queryDeviceDataOneDayPaging&pn=${DEVICE.pn}&devcode=${DEVICE.devcode}&sn=${DEVICE.sn}&devaddr=${DEVICE.devaddr}&date=${today}&page=0&pagesize=1`
  );
}

async function fetchPlantCurrent(session) {
  return apiGet(session,
    `&action=queryPlantCurrentData&plantid=${PLANT_ID}&par=CURRENT_POWER,ENERGY_TODAY,BATTERY_SOC`
  );
}

/* ── DOM refs ── */
const $ = (id) => document.getElementById(id);

const els = {
  loginScreen: $("login-screen"),
  dashScreen: $("dashboard-screen"),
  loginForm: $("login-form"),
  loginUser: $("login-user"),
  loginPass: $("login-pass"),
  loginBtn: $("login-btn"),
  loginError: $("login-error"),
  logoutBtn: $("logout-btn"),
  statusDot: $("status-dot"),
  batPct: $("bat-pct"),
  batBar: $("bat-bar"),
  batVolts: $("bat-volts"),
  batCurrent: $("bat-current"),
  solPct: $("sol-pct"),
  solBar: $("sol-bar"),
  solWatts: $("sol-watts"),
  solPvVolts: $("sol-pv-volts"),
  loadPct: $("load-pct"),
  loadBar: $("load-bar"),
  loadWatts: $("load-watts"),
  lastUpdate: $("last-update"),
  energyToday: $("energy-today"),
};

/* ── UI updates ── */
function showLogin() {
  els.loginScreen.hidden = false;
  els.dashScreen.hidden = true;
}

function showDash() {
  els.loginScreen.hidden = true;
  els.dashScreen.hidden = false;
}

function setBar(barEl, pct) {
  barEl.style.width = Math.max(0, Math.min(100, pct)) + "%";
}

function renderDevice(dat) {
  if (!dat || !dat.row || !dat.row.length) return;
  const f = dat.row[0].field;
  const ts = f[1];
  const batV = parseFloat(f[2]);
  const pvV = parseFloat(f[3]);
  const batA = parseFloat(f[5]);
  const solarW = parseFloat(f[7]);
  const loadW = parseFloat(f[8]);

  const soc = voltageToSoc(batV);
  els.batPct.textContent = soc;
  setBar(els.batBar, soc);
  els.batVolts.textContent = batV.toFixed(1);
  els.batCurrent.textContent = batA.toFixed(0);

  const solPct = Math.round((solarW / SOLAR_MAX_W) * 100);
  els.solPct.textContent = solPct;
  setBar(els.solBar, solPct);
  els.solWatts.textContent = Math.round(solarW);
  els.solPvVolts.textContent = pvV.toFixed(0);

  const ldPct = Math.round((loadW / INVERTER_MAX_VA) * 100);
  els.loadPct.textContent = ldPct;
  setBar(els.loadBar, ldPct);
  els.loadWatts.textContent = Math.round(loadW);

  const timePart = ts.split(" ")[1] || ts;
  els.lastUpdate.textContent = `Last update: ${timePart}`;
}

function renderPlantCurrent(dat) {
  if (!Array.isArray(dat)) return;
  for (const item of dat) {
    if (item.key === "ENERGY_TODAY") {
      els.energyToday.textContent = `Today: ${parseFloat(item.val).toFixed(1)} kWh`;
    }
  }
}

function setStatus(ok) {
  els.statusDot.className = ok ? "dot dot-ok" : "dot dot-err";
}

/* ── Poll loop ── */
let pollTimer = null;

async function poll() {
  const sess = loadSession();
  if (!isSessionValid(sess)) { clearSession(); showLogin(); return; }
  try {
    const [dev, plant] = await Promise.all([
      fetchDeviceData(sess),
      fetchPlantCurrent(sess),
    ]);
    renderDevice(dev);
    renderPlantCurrent(plant);
    setStatus(true);
  } catch (err) {
    console.error("poll error:", err);
    setStatus(false);
    if (/token|auth|expire|login/i.test(err.message)) {
      clearSession();
      showLogin();
      return;
    }
  }
  pollTimer = setTimeout(poll, POLL_MS);
}

function startPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  poll();
}

/* ── Login handler ── */
els.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.loginError.hidden = true;
  els.loginBtn.disabled = true;
  els.loginBtn.textContent = "Signing in...";
  try {
    const sess = await apiAuth(els.loginUser.value.trim(), els.loginPass.value);
    saveSession(sess);
    els.loginPass.value = "";
    showDash();
    startPolling();
  } catch (err) {
    els.loginError.textContent = err.message;
    els.loginError.hidden = false;
  } finally {
    els.loginBtn.disabled = false;
    els.loginBtn.textContent = "Sign in";
  }
});

els.logoutBtn.addEventListener("click", () => {
  clearSession();
  if (pollTimer) clearTimeout(pollTimer);
  showLogin();
});

/* ── Boot ── */
(function boot() {
  const sess = loadSession();
  if (isSessionValid(sess)) {
    showDash();
    startPolling();
  } else {
    showLogin();
  }
})();
