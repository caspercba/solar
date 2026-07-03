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
  inverterStatus: $("inverter-status"),
};

const fEls = {
  cardsView: $("cards-view"),
  flowView: $("flow-view"),
  chartView: $("chart-view"),
  tabCards: $("tab-cards"),
  tabFlow: $("tab-flow"),
  tabChart: $("tab-chart"),
  chartDate: $("chart-date"),
  powerChart: $("power-chart"),
  chartEmpty: $("chart-empty"),
  chartLoading: $("chart-loading"),
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
let hasData = false;
let currentView = "cards";
let historyLoading = false;

/* ── Loading skeleton ── */
const skeletonTargets = () => [
  els.batPct, els.batDirection, els.batRate,
  els.batVolts, els.batCurrent,
  els.solPct, els.solWatts, els.solPvVolts,
  els.loadPct, els.loadWatts,
  els.genStatus, els.genWatts, els.genVolts,
  els.inverterStatus,
];
const skeletonBars = () => [
  els.batBar.parentElement,
  els.solBar.parentElement,
  els.loadBar.parentElement,
];

function setLoading(on) {
  const cls = "skeleton";
  for (const el of skeletonTargets()) {
    if (!el) continue;
    el.classList.toggle(cls, on);
    if (on) el.textContent = "\u00A0";
  }
  for (const bar of skeletonBars()) {
    if (!bar) continue;
    bar.classList.toggle(cls, on);
  }
  const flowCls = "skeleton-flow";
  for (const el of [fEls.fnSolarV, fEls.fnGenV, fEls.fnHouseV, fEls.fnBatV, fEls.fnBatDetail]) {
    if (!el) continue;
    el.classList.toggle(flowCls, on);
    if (on) el.textContent = "";
  }
}

/* ── View toggle ── */
function setView(view) {
  currentView = view;
  localStorage.setItem(VIEW_KEY, view);
  const isFlow = view === "flow";
  const isChart = view === "chart";
  fEls.cardsView.hidden = isFlow || isChart;
  fEls.flowView.hidden = !isFlow;
  fEls.chartView.hidden = !isChart;
  fEls.tabCards.classList.toggle("active", view === "cards");
  fEls.tabFlow.classList.toggle("active", isFlow);
  fEls.tabChart.classList.toggle("active", isChart);
  if (isChart) loadHistory(fEls.chartDate.value || null);
}

fEls.tabCards.addEventListener("click", () => setView("cards"));
fEls.tabFlow.addEventListener("click", () => setView("flow"));
fEls.tabChart.addEventListener("click", () => setView("chart"));
fEls.chartDate.addEventListener("change", () => loadHistory(fEls.chartDate.value));

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

function setInverterStatus(text) {
  const el = els.inverterStatus;
  if (!el) return;
  const value = text || "--";
  el.textContent = value;
  const unavailable = value === "--";
  el.classList.toggle("status-unavailable", unavailable);
  el.classList.toggle("status-offline", !unavailable && /offline/i.test(value));
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
      if (sys.id === activeSystemId) return;
      activeSystemId = sys.id;
      localStorage.setItem(ACTIVE_KEY, sys.id);
      hasData = false;
      setLoading(true);
      renderSystemTabs();
      if (currentView === "chart") {
        loadHistory(fEls.chartDate.value || null);
      } else {
        pollNow();
      }
    });
    els.systemTabs.appendChild(btn);
  }
}

/* ── Render normalized data ── */
function renderData(d) {
  if (!d || d.error) {
    setInverterStatus("--");
    setStatus(false);
    return;
  }

  setLoading(false);
  hasData = true;

  const bat = d.battery || {};
  const sol = d.solar || {};
  const load = d.load || {};
  const grid = d.grid || {};
  const inv = d.inverter || {};

  setInverterStatus(d.status);

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

/* ── Intraday chart ── */
const CHART_COLORS = {
  solar: "#f59e0b",
  load: "#3b82f6",
  battery: "#22c55e",
  grid: "#2a2d3a",
  text: "#8b8fa3",
};

function setChartLoading(on) {
  historyLoading = on;
  if (fEls.chartLoading) fEls.chartLoading.hidden = !on;
  if (fEls.powerChart) fEls.powerChart.hidden = on;
  if (on && fEls.chartEmpty) fEls.chartEmpty.hidden = true;
}

function renderChart(data) {
  const canvas = fEls.powerChart;
  if (!canvas) return;

  const points = data?.points || [];
  if (!points.length) {
    canvas.hidden = true;
    if (fEls.chartEmpty) fEls.chartEmpty.hidden = false;
    return;
  }

  canvas.hidden = false;
  if (fEls.chartEmpty) fEls.chartEmpty.hidden = true;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(280, Math.round(rect.width || 500));
  const height = 220;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.height = height + "px";

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const pad = { top: 16, right: 12, bottom: 28, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  let yMin = 0;
  let yMax = 0;
  for (const p of points) {
    yMin = Math.min(yMin, p.solar ?? 0, p.load ?? 0, p.battery ?? 0);
    yMax = Math.max(yMax, p.solar ?? 0, p.load ?? 0, p.battery ?? 0);
  }
  if (yMax === 0 && yMin === 0) yMax = 1000;
  const yPad = (yMax - yMin) * 0.08 || 100;
  yMin -= yPad;
  yMax += yPad;

  function xAt(i) {
    return pad.left + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  }
  function yAt(w) {
    return pad.top + plotH - ((w - yMin) / (yMax - yMin)) * plotH;
  }

  ctx.strokeStyle = CHART_COLORS.grid;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
  }

  ctx.fillStyle = CHART_COLORS.text;
  ctx.font = "11px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i++) {
    const val = yMax - ((yMax - yMin) * i) / 4;
    const y = pad.top + (plotH * i) / 4;
    ctx.fillText(fmtW(val), pad.left - 6, y);
  }

  const labelCount = Math.min(6, points.length);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = 0; i < labelCount; i++) {
    const idx = labelCount <= 1 ? 0 : Math.round((i / (labelCount - 1)) * (points.length - 1));
    ctx.fillText(points[idx].time || "", xAt(idx), pad.top + plotH + 8);
  }

  function drawSeries(key, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < points.length; i++) {
      const val = points[i][key] ?? 0;
      const x = xAt(i);
      const y = yAt(val);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  drawSeries("solar", CHART_COLORS.solar);
  drawSeries("load", CHART_COLORS.load);
  drawSeries("battery", CHART_COLORS.battery);
}

async function loadHistory(date) {
  if (!activeSystemId || currentView !== "chart") return;
  setChartLoading(true);
  try {
    const qs = date ? `?date=${encodeURIComponent(date)}` : "";
    const data = await api("GET", `/api/systems/${activeSystemId}/history${qs}`);
    if (data.date && fEls.chartDate) fEls.chartDate.value = data.date;
    renderChart(data);
    setStatus(true);
  } catch (err) {
    console.error("history error:", err);
    renderChart({ points: [] });
    setStatus(false);
  } finally {
    setChartLoading(false);
  }
}

/* ── Polling ── */
async function pollNow() {
  if (!activeSystemId) return;
  if (!hasData) setLoading(true);
  try {
    const data = await api("GET", `/api/systems/${activeSystemId}/data`);
    renderData(data);
  } catch (err) {
    console.error("poll error:", err);
    setLoading(false);
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
const addPlantGroup = $("add-plant-group");
const addPlantSelect = $("add-plant");

function hidePlantPicker() {
  addPlantGroup.hidden = true;
  addPlantSelect.innerHTML = "";
  addPlantSelect.required = false;
}

function showPlantPicker(plants) {
  addPlantSelect.innerHTML = "";
  for (const p of plants) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    addPlantSelect.appendChild(opt);
  }
  addPlantGroup.hidden = false;
  addPlantSelect.required = true;
}

function openAddModal() {
  manageModal.hidden = true;
  addModal.hidden = false;
  addForm.reset();
  hidePlantPicker();
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

  const body = {
    service: $("add-service").value,
    name: $("add-name").value || undefined,
    user: $("add-user").value,
    password: $("add-pass").value,
  };
  if (!addPlantGroup.hidden && addPlantSelect.value) {
    body.plantId = addPlantSelect.value;
  }

  try {
    const result = await api("POST", "/api/systems", body);
    if (result.requiresPlantSelection) {
      showPlantPicker(result.plants);
      return;
    }
    closeAddModal();
    hidePlantPicker();
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

/* ── Pull to refresh ── */
{
  const ptr = $("ptr");
  const dash = $("dashboard-screen");
  const THRESHOLD = 60;
  const MAX_PULL = 90;
  let startY = 0;
  let pulling = false;
  let refreshing = false;

  function isAtTop() {
    return window.scrollY <= 0;
  }

  dash.addEventListener("touchstart", (e) => {
    if (refreshing || !isAtTop()) return;
    startY = e.touches[0].clientY;
    pulling = true;
  }, { passive: true });

  dash.addEventListener("touchmove", (e) => {
    if (!pulling || refreshing) return;
    const dy = Math.max(0, e.touches[0].clientY - startY);
    if (dy === 0) return;
    const clamped = Math.min(dy, MAX_PULL);
    const h = Math.round(clamped * 0.6);
    ptr.style.height = h + "px";
    ptr.className = clamped >= THRESHOLD ? "ptr armed" : "ptr pulling";
  }, { passive: true });

  dash.addEventListener("touchend", () => {
    if (!pulling) return;
    pulling = false;
    const armed = ptr.classList.contains("armed");
    if (armed && !refreshing) {
      refreshing = true;
      ptr.className = "ptr refreshing";
      ptr.style.height = "36px";
      if (pollTimer) clearTimeout(pollTimer);
      const refresh = currentView === "chart"
        ? loadHistory(fEls.chartDate.value || null)
        : pollNow();
      refresh.then(() => {
        if (currentView !== "chart") pollTimer = setTimeout(() => startPolling(), POLL_MS);
      }).finally(() => {
        refreshing = false;
        ptr.className = "ptr";
        ptr.style.height = "0";
      });
    } else {
      ptr.className = "ptr";
      ptr.style.height = "0";
    }
  });
}

/* ── Service worker ── */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

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
