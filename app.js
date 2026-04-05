/* ── Config ── */
const POLL_MS = 60_000;
const CONN_KEY = "solar_conn";
const VIEW_KEY = "solar_view";
const ACTIVE_KEY = "solar_active";

/* ── Proxy connection ── */
function saveConn(data) { localStorage.setItem(CONN_KEY, JSON.stringify(data)); }
function loadConn() { try { return JSON.parse(localStorage.getItem(CONN_KEY)); } catch { return null; } }
function clearConn() { localStorage.removeItem(CONN_KEY); }

async function api(method, path, body) {
  const conn = loadConn();
  if (!conn) throw new Error("Not connected");
  const opts = {
    method,
    headers: { "Authorization": `Bearer ${conn.token}`, "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${conn.url}${path}`, opts);
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
  return json;
}

/* ── DOM refs ── */
const $ = (id) => document.getElementById(id);

const els = {
  setupScreen: $("setup-screen"),
  dashScreen: $("dashboard-screen"),
  setupForm: $("setup-form"),
  setupUrl: $("setup-url"),
  setupToken: $("setup-token"),
  setupBtn: $("setup-btn"),
  setupError: $("setup-error"),
  headerTitle: $("header-title"),
  disconnectBtn: $("disconnect-btn"),
  manageBtn: $("manage-btn"),
  statusDot: $("status-dot"),
  systemTabs: $("system-tabs"),
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

const fEls = {
  cardsView: $("cards-view"),
  flowView: $("flow-view"),
  tabCards: $("tab-cards"),
  tabFlow: $("tab-flow"),
  fpSolar: $("fp-solar"),
  fpGen: $("fp-gen"),
  fpLoad: $("fp-load"),
  fpBat: $("fp-bat"),
  flSolar: $("fl-solar"),
  flGen: $("fl-gen"),
  flLoad: $("fl-load"),
  flBat: $("fl-bat"),
  fnSolarBg: $("fn-solar-bg"),
  fnGenBg: $("fn-gen-bg"),
  fnHouseBg: $("fn-house-bg"),
  fnBatBg: $("fn-bat-bg"),
  fnSolarV: $("fn-solar-v"),
  fnGenV: $("fn-gen-v"),
  fnHouseV: $("fn-house-v"),
  fnBatV: $("fn-bat-v"),
  fnBatDetail: $("fn-bat-detail"),
};

/* ── Modals ── */
const addModal = $("add-system-modal");
const addForm = $("add-system-form");
const addError = $("add-error");
const manageModal = $("manage-modal");
const manageList = $("manage-list");

/* ── State ── */
let systems = [];
let activeSystemId = null;
let pollTimer = null;

/* ── View toggle ── */
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

/* ── Helpers ── */
function fmtW(w) {
  const abs = Math.abs(w);
  if (abs >= 10000) return (w / 1000).toFixed(0) + " kW";
  if (abs >= 1000) return (w / 1000).toFixed(1) + " kW";
  return Math.round(w) + " W";
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

/* ── Screens ── */
function showSetup() {
  els.setupScreen.hidden = false;
  els.dashScreen.hidden = true;
}

function showDash() {
  els.setupScreen.hidden = true;
  els.dashScreen.hidden = false;
}

function setStatus(ok) {
  els.statusDot.className = ok ? "dot dot-ok" : "dot dot-err";
}

/* ── System tabs ── */
function renderSystemTabs() {
  els.systemTabs.innerHTML = "";
  if (systems.length <= 1) {
    els.systemTabs.hidden = true;
    if (systems.length === 1) {
      els.headerTitle.textContent = systems[0].name;
    }
    return;
  }
  els.systemTabs.hidden = false;
  els.headerTitle.textContent = "Solar Dashboard";

  for (const sys of systems) {
    const btn = document.createElement("button");
    btn.className = "sys-tab" + (sys.id === activeSystemId ? " active" : "");
    btn.textContent = sys.name;
    btn.addEventListener("click", () => {
      activeSystemId = sys.id;
      localStorage.setItem(ACTIVE_KEY, sys.id);
      renderSystemTabs();
      pollNow();
    });
    els.systemTabs.appendChild(btn);
  }
}

/* ── Render normalized data ── */
function renderData(d) {
  if (!d || d.error) {
    setStatus(false);
    return;
  }

  const bat = d.battery || {};
  const sol = d.solar || {};
  const load = d.load || {};
  const grid = d.grid || {};
  const inv = d.inverter || {};

  /* Battery */
  const soc = bat.soc ?? 0;
  els.batPct.textContent = soc;
  setBar(els.batBar, soc);
  els.batVolts.textContent = (bat.voltage ?? 0).toFixed(1);
  els.batCurrent.textContent = Math.round(bat.current ?? 0);

  const batA = bat.current ?? 0;
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
  const nomPV = inv.nominalPV || 5000;
  const solPct = Math.round(((sol.power ?? 0) / nomPV) * 100);
  els.solPct.textContent = solPct;
  setBar(els.solBar, solPct);
  els.solWatts.textContent = Math.round(sol.power ?? 0);
  els.solPvVolts.textContent = (sol.voltage ?? 0).toFixed(0);

  /* Load */
  const ldPct = load.percent ?? Math.round(((load.power ?? 0) / (inv.ratedPower || 5000)) * 100);
  els.loadPct.textContent = ldPct;
  setBar(els.loadBar, ldPct);
  els.loadWatts.textContent = Math.round(load.power ?? 0);

  /* Generator / Grid */
  const genOn = grid.active ?? false;
  const gridW = grid.power ?? 0;
  const gridV = grid.voltage ?? 0;
  els.genStatus.textContent = genOn ? "ON" : "OFF";
  els.genStatus.className = genOn ? "gen-badge gen-on" : "gen-badge gen-off";
  els.genWatts.textContent = genOn ? Math.abs(Math.round(gridW)) : "0";
  els.genVolts.textContent = genOn ? gridV.toFixed(0) : "--";
  els.genCard.className = genOn ? "card card-gen gen-active" : "card card-gen";

  /* Footer */
  const ts = d.timestamp || "--";
  const timePart = ts.includes(" ") ? ts.split(" ")[1] : ts.includes("T") ? ts.split("T")[1]?.split(".")[0] : ts;
  els.lastUpdate.textContent = `Last update: ${timePart}`;
  if (d.energyToday != null) {
    els.energyToday.textContent = `Today: ${parseFloat(d.energyToday).toFixed(1)} kWh`;
  }

  if (systems.length === 1) {
    els.headerTitle.textContent = d.name || systems[0]?.name || "Solar Dashboard";
  }

  /* Flow */
  renderFlow(d);
  setStatus(true);
}

function renderFlow(d) {
  const solarW = d.solar?.power ?? 0;
  const loadW = d.load?.power ?? 0;
  const gridW = d.grid?.power ?? 0;
  const batA = d.battery?.current ?? 0;
  const batV = d.battery?.voltage ?? 0;
  const soc = d.battery?.soc ?? 0;
  const genOn = d.grid?.active ?? false;

  const solActive = solarW > 10;
  fEls.fpSolar.classList.toggle("active", solActive);
  fEls.fnSolarBg.classList.toggle("active", solActive);
  fEls.fnSolarV.textContent = fmtW(solarW);
  fEls.flSolar.classList.toggle("active", solActive);
  fEls.flSolar.textContent = solActive ? fmtW(solarW) : "";

  fEls.fpGen.classList.toggle("active", genOn);
  fEls.fnGenBg.classList.toggle("active", genOn);
  fEls.fnGenV.textContent = genOn ? fmtW(Math.abs(gridW)) : "OFF";
  fEls.flGen.classList.toggle("active", genOn);
  fEls.flGen.textContent = genOn ? fmtW(Math.abs(gridW)) : "";

  const loadActive = loadW > 10;
  fEls.fpLoad.classList.toggle("active", loadActive);
  fEls.fnHouseBg.classList.toggle("active", loadActive);
  fEls.fnHouseV.textContent = fmtW(loadW);
  fEls.flLoad.classList.toggle("active", loadActive);
  fEls.flLoad.textContent = loadActive ? fmtW(loadW) : "";

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

  const batPower = Math.abs(d.battery?.power ?? batV * batA);
  fEls.flBat.classList.toggle("active", charging || discharging);
  fEls.flBat.textContent = (charging || discharging) ? fmtW(batPower) : "";

  fEls.fnBatBg.classList.remove("charging", "discharging", "idle");
  fEls.fnBatBg.classList.add(charging ? "charging" : discharging ? "discharging" : "idle");

  fEls.fnBatV.textContent = soc + "%";
  const batState = charging ? "Charging" : discharging ? "Discharging" : "Idle";
  fEls.fnBatDetail.textContent = batV.toFixed(1) + "V \u00B7 " + batState;
}

/* ── Polling ── */
async function pollNow() {
  if (!activeSystemId) return;
  try {
    const data = await api("GET", `/api/systems/${activeSystemId}/data`);
    renderData(data);
  } catch (err) {
    console.error("poll error:", err);
    setStatus(false);
  }
}

function startPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  async function tick() {
    await pollNow();
    pollTimer = setTimeout(tick, POLL_MS);
  }
  tick();
}

function stopPolling() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}

/* ── Load systems list ── */
async function loadSystems() {
  systems = await api("GET", "/api/systems");
  const saved = localStorage.getItem(ACTIVE_KEY);
  if (systems.find(s => s.id === saved)) {
    activeSystemId = saved;
  } else if (systems.length) {
    activeSystemId = systems[0].id;
  } else {
    activeSystemId = null;
  }
  renderSystemTabs();
}

/* ── Add System ── */
function openAddModal() {
  manageModal.hidden = true;
  addModal.hidden = false;
  addForm.reset();
  addError.hidden = true;
}

function closeAddModal() {
  addModal.hidden = true;
}

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  addError.hidden = true;
  $("add-submit").disabled = true;
  $("add-submit").textContent = "Adding...";

  try {
    await api("POST", "/api/systems", {
      service: $("add-service").value,
      name: $("add-name").value || undefined,
      user: $("add-user").value,
      password: $("add-pass").value,
    });
    closeAddModal();
    await loadSystems();
    if (systems.length === 1) activeSystemId = systems[0].id;
    renderSystemTabs();
    startPolling();
  } catch (err) {
    addError.textContent = err.message;
    addError.hidden = false;
  } finally {
    $("add-submit").disabled = false;
    $("add-submit").textContent = "Add System";
  }
});

$("add-cancel").addEventListener("click", closeAddModal);

/* ── Manage Systems ── */
function openManageModal() {
  manageModal.hidden = false;
  manageList.innerHTML = "";

  if (!systems.length) {
    manageList.innerHTML = '<p class="manage-empty">No systems configured.</p>';
    return;
  }

  for (const sys of systems) {
    const row = document.createElement("div");
    row.className = "manage-row";

    const info = document.createElement("div");
    info.className = "manage-info";
    info.innerHTML = `<strong>${sys.name}</strong><span class="manage-service">${sys.service}</span>`;

    const del = document.createElement("button");
    del.className = "manage-delete";
    del.textContent = "Remove";
    del.addEventListener("click", async () => {
      if (!confirm(`Remove "${sys.name}"?`)) return;
      await api("DELETE", `/api/systems/${sys.id}`);
      await loadSystems();
      openManageModal();
      if (activeSystemId === sys.id && systems.length) {
        activeSystemId = systems[0].id;
        renderSystemTabs();
        startPolling();
      }
    });

    row.appendChild(info);
    row.appendChild(del);
    manageList.appendChild(row);
  }
}

els.manageBtn.addEventListener("click", openManageModal);
$("manage-close").addEventListener("click", () => { manageModal.hidden = true; });
$("manage-add").addEventListener("click", openAddModal);

/* ── Setup (proxy connection) ── */
els.setupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.setupError.hidden = true;
  els.setupBtn.disabled = true;
  els.setupBtn.textContent = "Connecting...";

  const url = els.setupUrl.value.trim().replace(/\/+$/, "");
  const token = els.setupToken.value.trim();

  try {
    const resp = await fetch(`${url}/api/systems`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error("Invalid token or proxy URL");
    await resp.json();

    saveConn({ url, token });
    await loadSystems();
    showDash();

    if (!systems.length) {
      openAddModal();
    } else {
      startPolling();
    }
  } catch (err) {
    els.setupError.textContent = err.message;
    els.setupError.hidden = false;
  } finally {
    els.setupBtn.disabled = false;
    els.setupBtn.textContent = "Connect";
  }
});

els.disconnectBtn.addEventListener("click", () => {
  clearConn();
  stopPolling();
  showSetup();
});

/* ── Boot ── */
setView(localStorage.getItem(VIEW_KEY) || "cards");

(async function boot() {
  const params = new URLSearchParams(location.search);
  const urlProxy = params.get("proxy");
  const urlToken = params.get("token");

  if (urlProxy && urlToken) {
    const url = urlProxy.replace(/\/+$/, "");
    saveConn({ url, token: urlToken });
  }

  const conn = loadConn();
  if (!conn) { showSetup(); return; }

  try {
    await loadSystems();
    showDash();
    if (systems.length) {
      startPolling();
    } else {
      openAddModal();
    }
  } catch {
    showSetup();
  }
})();
