/* ── SHA-1 (minimal, from jsSHA public domain) ── */
/* eslint-disable */
function sha1(msg){function f(s,x,y,z){switch(s){case 0:return(x&y)^(~x&z);case 1:case 3:return x^y^z;case 2:return(x&y)^(x&z)^(y&z)}};function rl(n,s){return(n<<s)|(n>>>(32-s))};var B=Math.pow(2,32);var H=[0x67452301,0xEFCDAB89,0x98BADCFE,0x10325476,0xC3D2E1F0];var K=[0x5A827999,0x6ED9EBA1,0x8F1BBCDC,0xCA62C1D6];var l=msg.length;var bA=[];for(var i=0;i<l;i++){bA.push(msg.charCodeAt(i))}bA.push(0x80);var zeros=(64-((l+9)%64))%64;for(var i=0;i<zeros;i++)bA.push(0);var hi=Math.floor(l*8/B);var lo=(l*8)%B;bA.push((hi>>>24)&0xFF,(hi>>>16)&0xFF,(hi>>>8)&0xFF,hi&0xFF);bA.push((lo>>>24)&0xFF,(lo>>>16)&0xFF,(lo>>>8)&0xFF,lo&0xFF);for(var b=0;b<bA.length;b+=64){var w=[];for(var j=0;j<16;j++)w[j]=(bA[b+j*4]<<24)|(bA[b+j*4+1]<<16)|(bA[b+j*4+2]<<8)|bA[b+j*4+3];for(var j=16;j<80;j++)w[j]=rl(w[j-3]^w[j-8]^w[j-14]^w[j-16],1);var a=H[0],bb=H[1],c=H[2],d=H[3],e=H[4];for(var j=0;j<80;j++){var s=Math.floor(j/20);var T=(rl(a,5)+f(s,bb,c,d)+e+K[s]+w[j])%B;if(T<0)T+=B;e=d;d=c;c=rl(bb,30);bb=a;a=T}H[0]=(H[0]+a)%B;H[1]=(H[1]+bb)%B;H[2]=(H[2]+c)%B;H[3]=(H[3]+d)%B;H[4]=(H[4]+e)%B;for(var i=0;i<5;i++)if(H[i]<0)H[i]+=B}return H.map(function(v){return("00000000"+v.toString(16)).slice(-8)}).join("")}
/* eslint-enable */

/* ── Config ── */
const API_BASE = "https://web.shinemonitor.com/public/";
const COMPANY_KEY = "bnrl_frRFjEz8Mkn";
const PLANT_ID = "77218";
const DEVICE = { pn: "B1419120275203", devcode: "697", sn: "FFFFFFFF", devaddr: "4" };
const POLL_MS = 60_000;

/*
 * Battery SOC range — based on inverter charge profile (not exposed via API).
 * Low cutoff: voltage at which inverter stops discharging (~42V).
 * Float voltage: voltage the charger holds once the battery is full (~53.5V).
 * Anything at or above float = 100%. Bulk/absorption charging runs at ~56V
 * but that's the charger pushing harder, not the battery being over 100%.
 */
let batLowV = 42.0;
let batHighV = 53.5;
let solarMaxW = 5000;
let inverterMaxVA = 5000;

function voltageToSoc(v) {
  if (v >= batHighV) return 100;
  if (v <= batLowV) return 0;
  return Math.round(((v - batLowV) / (batHighV - batLowV)) * 100);
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

async function fetchDeviceCtrlValue(session, id) {
  return apiGet(session,
    `&action=queryDeviceCtrlValue&pn=${DEVICE.pn}&devcode=${DEVICE.devcode}&sn=${DEVICE.sn}&devaddr=${DEVICE.devaddr}&id=${id}`
  );
}

async function fetchPlantInfo(session) {
  return apiGet(session, `&action=queryPlantInfo&plantid=${PLANT_ID}`);
}

async function fetchInverterSettings(session) {
  try {
    const plantInfo = await fetchPlantInfo(session);
    const nominal = parseFloat(plantInfo.nominalPower);
    if (nominal > 0) solarMaxW = nominal * 1000;
    console.log(`Settings: battery ${batLowV}–${batHighV}V, solar max ${solarMaxW}W`);
  } catch (err) {
    console.warn("Could not fetch plant info, using defaults:", err);
  }
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
  batDirection: $("bat-direction"),
  batRate: $("bat-rate"),
  batVolts: $("bat-volts"),
  batCurrent: $("bat-current"),
  solPct: $("sol-pct"),
  solBar: $("sol-bar"),
  solWatts: $("sol-watts"),
  solPvVolts: $("sol-pv-volts"),
  loadPct: $("load-pct"),
  loadBar: $("load-bar"),
  loadWatts: $("load-watts"),
  genStatus: $("gen-status"),
  genWatts: $("gen-watts"),
  genVolts: $("gen-volts"),
  genCard: $("card-gen"),
  lastUpdate: $("last-update"),
  energyToday: $("energy-today"),
};

/* Flow view DOM refs */
const fEls = {
  cardsView:  $("cards-view"),
  flowView:   $("flow-view"),
  tabCards:   $("tab-cards"),
  tabFlow:    $("tab-flow"),
  fpSolar:    $("fp-solar"),
  fpGen:      $("fp-gen"),
  fpLoad:     $("fp-load"),
  fpBat:      $("fp-bat"),
  flSolar:    $("fl-solar"),
  flGen:      $("fl-gen"),
  flLoad:     $("fl-load"),
  flBat:      $("fl-bat"),
  fnSolarBg:  $("fn-solar-bg"),
  fnGenBg:    $("fn-gen-bg"),
  fnHouseBg:  $("fn-house-bg"),
  fnBatBg:    $("fn-bat-bg"),
  fnSolarV:   $("fn-solar-v"),
  fnGenV:     $("fn-gen-v"),
  fnHouseV:   $("fn-house-v"),
  fnBatV:     $("fn-bat-v"),
  fnBatDetail:$("fn-bat-detail"),
};

/* ── View toggle ── */
const VIEW_KEY = "solar_view";

function setView(view) {
  localStorage.setItem(VIEW_KEY, view);
  const isFlow = view === "flow";
  fEls.cardsView.hidden = isFlow;
  fEls.flowView.hidden = !isFlow;
  fEls.tabCards.classList.toggle("active", !isFlow);
  fEls.tabFlow.classList.toggle("active", isFlow);
}

fEls.tabCards.addEventListener("click", () => setView("cards"));
fEls.tabFlow.addEventListener("click", () => setView("flow"));

function fmtW(w) {
  const abs = Math.abs(w);
  if (abs >= 10000) return (w / 1000).toFixed(0) + " kW";
  if (abs >= 1000) return (w / 1000).toFixed(1) + " kW";
  return Math.round(w) + " W";
}

function renderFlow(d) {
  const { solarW, loadW, gridW, batA, batV, soc, genOn } = d;

  /* Solar */
  const solActive = solarW > 10;
  fEls.fpSolar.classList.toggle("active", solActive);
  fEls.fnSolarBg.classList.toggle("active", solActive);
  fEls.fnSolarV.textContent = fmtW(solarW);
  fEls.flSolar.classList.toggle("active", solActive);
  fEls.flSolar.textContent = solActive ? fmtW(solarW) : "";

  /* Generator */
  fEls.fpGen.classList.toggle("active", genOn);
  fEls.fnGenBg.classList.toggle("active", genOn);
  fEls.fnGenV.textContent = genOn ? fmtW(Math.abs(gridW)) : "OFF";
  fEls.flGen.classList.toggle("active", genOn);
  fEls.flGen.textContent = genOn ? fmtW(Math.abs(gridW)) : "";

  /* House */
  const loadActive = loadW > 10;
  fEls.fpLoad.classList.toggle("active", loadActive);
  fEls.fnHouseBg.classList.toggle("active", loadActive);
  fEls.fnHouseV.textContent = fmtW(loadW);
  fEls.flLoad.classList.toggle("active", loadActive);
  fEls.flLoad.textContent = loadActive ? fmtW(loadW) : "";

  /* Battery */
  const charging = batA < -2;
  const discharging = batA > 2;

  fEls.fpBat.classList.remove("active", "charging", "discharging");
  if (charging) {
    fEls.fpBat.setAttribute("d", "M250,235 L250,340");
    fEls.fpBat.classList.add("active", "charging");
  } else if (discharging) {
    fEls.fpBat.setAttribute("d", "M250,340 L250,235");
    fEls.fpBat.classList.add("active", "discharging");
  }

  const batPower = Math.abs(batV * batA);
  fEls.flBat.classList.toggle("active", charging || discharging);
  fEls.flBat.textContent = (charging || discharging) ? fmtW(batPower) : "";

  fEls.fnBatBg.classList.remove("charging", "discharging", "idle");
  fEls.fnBatBg.classList.add(charging ? "charging" : discharging ? "discharging" : "idle");

  fEls.fnBatV.textContent = soc + "%";
  const batState = charging ? "Charging" : discharging ? "Discharging" : "Idle";
  fEls.fnBatDetail.textContent = batV.toFixed(1) + "V \u00B7 " + batState;
}

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

function setBatRate(absAmps) {
  if (absAmps < 15) {
    els.batRate.textContent = "Slow";
    els.batRate.className = "bat-rate rate-slow";
  } else if (absAmps < 40) {
    els.batRate.textContent = "Mid";
    els.batRate.className = "bat-rate rate-mid";
  } else {
    els.batRate.textContent = "Fast";
    els.batRate.className = "bat-rate rate-fast";
  }
}

function fieldIndex(titles, name) {
  return titles.findIndex(t => t.title === name);
}

function renderDevice(dat) {
  if (!dat || !dat.row || !dat.row.length) return;
  const titles = dat.title;
  const f = dat.row[0].field;

  const idx = {
    ts:       fieldIndex(titles, "Timestamp"),
    batV:     fieldIndex(titles, "Battery Voltage"),
    pvV:      fieldIndex(titles, "PV Voltage"),
    batA:     fieldIndex(titles, "Batt Current"),
    solarW:   fieldIndex(titles, "Charger Power"),
    loadW:    fieldIndex(titles, "PLoad"),
    gridW:    fieldIndex(titles, "PGrid"),
    gridV:    fieldIndex(titles, "Grid Voltage"),
    workState:fieldIndex(titles, "work state"),
    ratedW:   fieldIndex(titles, "rated power"),
  };

  const ts     = idx.ts >= 0 ? f[idx.ts] : "--";
  const batV   = idx.batV >= 0 ? parseFloat(f[idx.batV]) : 0;
  const pvV    = idx.pvV >= 0 ? parseFloat(f[idx.pvV]) : 0;
  const batA   = idx.batA >= 0 ? parseFloat(f[idx.batA]) : 0;
  const solarW = idx.solarW >= 0 ? parseFloat(f[idx.solarW]) : 0;
  const loadW  = idx.loadW >= 0 ? parseFloat(f[idx.loadW]) : 0;
  const gridW  = idx.gridW >= 0 ? parseFloat(f[idx.gridW]) : 0;
  const gridV  = idx.gridV >= 0 ? parseFloat(f[idx.gridV]) : 0;
  const workState = idx.workState >= 0 ? f[idx.workState] : "";
  const ratedW = idx.ratedW >= 0 ? parseFloat(f[idx.ratedW]) : 0;

  if (ratedW > 0) inverterMaxVA = ratedW;

  /* Battery */
  const soc = voltageToSoc(batV);
  els.batPct.textContent = soc;
  setBar(els.batBar, soc);
  els.batVolts.textContent = batV.toFixed(1);
  els.batCurrent.textContent = batA.toFixed(0);

  const absA = Math.abs(batA);
  if (absA < 2) {
    els.batDirection.textContent = "Idle";
    els.batDirection.className = "bat-direction dir-idle";
    els.batRate.textContent = "";
    els.batRate.className = "bat-rate";
  } else if (batA < 0) {
    els.batDirection.textContent = "Charging";
    els.batDirection.className = "bat-direction dir-charging";
    setBatRate(absA);
  } else {
    els.batDirection.textContent = "Discharging";
    els.batDirection.className = "bat-direction dir-discharging";
    setBatRate(absA);
  }

  /* Solar */
  const solPct = Math.round((solarW / solarMaxW) * 100);
  els.solPct.textContent = solPct;
  setBar(els.solBar, solPct);
  els.solWatts.textContent = Math.round(solarW);
  els.solPvVolts.textContent = pvV.toFixed(0);

  /* Load */
  const ldPct = Math.round((loadW / inverterMaxVA) * 100);
  els.loadPct.textContent = ldPct;
  setBar(els.loadBar, ldPct);
  els.loadWatts.textContent = Math.round(loadW);

  /* Generator */
  const genOn = gridV > 30 && Math.abs(gridW) > 5;
  els.genStatus.textContent = genOn ? "ON" : "OFF";
  els.genStatus.className = genOn ? "gen-badge gen-on" : "gen-badge gen-off";
  els.genWatts.textContent = genOn ? Math.abs(Math.round(gridW)) : "0";
  els.genVolts.textContent = genOn ? gridV.toFixed(0) : "--";
  els.genCard.className = genOn ? "card card-gen gen-active" : "card card-gen";

  const timePart = (ts.split(" ")[1]) || ts;
  els.lastUpdate.textContent = `Last update: ${timePart}`;

  renderFlow({ solarW, loadW, gridW, gridV, batA, batV, soc, genOn });
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

let batterySettingsLoaded = false;

async function poll() {
  const sess = loadSession();
  if (!isSessionValid(sess)) { clearSession(); showLogin(); return; }

  if (!batterySettingsLoaded) {
    await fetchInverterSettings(sess);
    batterySettingsLoaded = true;
  }

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
  batterySettingsLoaded = false;
  showLogin();
});

/* ── Boot ── */
setView(localStorage.getItem(VIEW_KEY) || "cards");

(async function boot() {
  const sess = loadSession();
  if (isSessionValid(sess)) {
    showDash();
    startPolling();
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const user = params.get("user");
  const pass = params.get("pass");
  if (user && pass) {
    window.history.replaceState({}, "", window.location.pathname);
    try {
      const sess = await apiAuth(user, pass);
      saveSession(sess);
      showDash();
      startPolling();
      return;
    } catch (_) { /* fall through to login screen */ }
  }

  showLogin();
})();
