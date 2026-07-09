import {
  fmtW,
  fmtChartDate,
  sanitizeExportName,
  historyToCsv,
  escapeAttr,
  clampPct,
  solarPctFromPower,
  loadPercent,
  todayIsoDate,
  addIsoDays,
  isIsoDateAfter,
  clampIsoDateToToday,
  buildWeekStripDates,
  fmtWeekStripWeekday,
  fmtWeekStripDay,
  shouldShowEstimatedSocBadge,
  normalizePollIntervalSec,
  pollIntervalSecToMs,
  POLL_INTERVAL_OPTIONS_SEC,
  estimateBatteryTimeToEmpty,
  formatWeatherStrip,
  findLowestSocIds,
  THEME_STORAGE_KEY,
  THEME_LABELS,
  THEME_META_COLORS,
  normalizeTheme,
  resolveInitialTheme,
  getNextTheme,
  isEditableElement,
  matchesDashboardRefreshShortcut,
} from "./frontend/lib.js";
import {
  loadStoredLocale,
  setLocale,
  getLocale,
  t,
  applyTranslations,
  syncLangToggle,
  formatPollIntervalLabelI18n,
} from "./frontend/i18n.js";

/* ── Config ── */
const POLL_INTERVAL_KEY = "solar_poll_interval";
const CONN_KEY = "solar_conn";
const VIEW_KEY = "solar_view";
const ACTIVE_KEY = "solar_active";
const CHART_DATE_KEY = "solar_chart_date";
const CHART_SWIPE_THRESHOLD = 50;

/* ── Proxy connection ── */
function saveConn(data) { localStorage.setItem(CONN_KEY, JSON.stringify(data)); }
function loadConn() { try { return JSON.parse(localStorage.getItem(CONN_KEY)); } catch { return null; } }
function clearConn() { localStorage.removeItem(CONN_KEY); }

function getPollIntervalSec() {
  return normalizePollIntervalSec(localStorage.getItem(POLL_INTERVAL_KEY));
}

function getPollMs() {
  return pollIntervalSecToMs(getPollIntervalSec());
}

function savePollIntervalSec(sec) {
  localStorage.setItem(POLL_INTERVAL_KEY, String(normalizePollIntervalSec(sec)));
}

function syncPollIntervalSelect() {
  const select = $("poll-interval");
  if (!select) return;
  select.value = String(getPollIntervalSec());
}

function restartPollingIfActive() {
  if (pollTimer) {
    stopPolling();
    startPolling();
  }
}

async function api(method, path, body) {
  const conn = loadConn();
  if (!conn) throw new Error(t("notConnected"));
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
  batEmptyIn: $("bat-empty-in"),
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
  weatherStrip: $("weather-strip"),
  weatherText: $("weather-text"),
  pollErrorToast: $("poll-error-toast"),
  pollErrorMsg: $("poll-error-msg"),
  pollRetryBtn: $("poll-retry-btn"),
  themeBtn: $("theme-btn"),
  setupThemeBtn: $("setup-theme-btn"),
  themeSelect: $("theme-select"),
};

const fEls = {
  cardsView: $("cards-view"),
  flowView: $("flow-view"),
  chartView: $("chart-view"),
  compareView: $("compare-view"),
  compareGrid: $("compare-grid"),
  tabCards: $("tab-cards"),
  tabFlow: $("tab-flow"),
  tabChart: $("tab-chart"),
  tabCompare: $("tab-compare"),
  chartDate: $("chart-date"),
  chartPrev: $("chart-prev"),
  chartNext: $("chart-next"),
  chartWeekStrip: $("chart-week-strip"),
  chartSwipeArea: $("chart-swipe-area"),
  chartExportBtn: $("chart-export-btn"),
  powerChart: $("power-chart"),
  chartEmpty: $("chart-empty"),
  chartEmptyMsg: $("chart-empty-msg"),
  chartRetryBtn: $("chart-retry-btn"),
  chartLoading: $("chart-loading"),
  energyChart: $("energy-chart"),
  energyEmpty: $("energy-empty"),
  energyEmptyMsg: $("energy-empty-msg"),
  energyRetryBtn: $("energy-retry-btn"),
  energyLoading: $("energy-loading"),
  socEstimatedBadge: $("soc-estimated-badge"),
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
let pollRetrying = false;
let dashboardRefreshing = false;
let hasData = false;
let currentView = "cards";
let historyLoading = false;
let chartHistory = null;
let lastEnergySummary = null;
let lastRenderData = null;
let lastCompareData = null;

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
  if (els.batEmptyIn) {
    els.batEmptyIn.hidden = true;
    if (on) els.batEmptyIn.textContent = "";
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
function updateCompareTabVisibility() {
  const show = systems.length >= 2;
  if (fEls.tabCompare) fEls.tabCompare.hidden = !show;
  if (!show && currentView === "compare") setView("cards");
}

function setView(view, { persist = true } = {}) {
  if (view === "compare" && systems.length < 2) view = "cards";
  currentView = view;
  if (persist) localStorage.setItem(VIEW_KEY, view);
  const isFlow = view === "flow";
  const isChart = view === "chart";
  const isCompare = view === "compare";
  fEls.cardsView.hidden = isFlow || isChart || isCompare;
  fEls.flowView.hidden = !isFlow;
  fEls.chartView.hidden = !isChart;
  if (fEls.compareView) fEls.compareView.hidden = !isCompare;
  fEls.tabCards.classList.toggle("active", view === "cards");
  fEls.tabFlow.classList.toggle("active", isFlow);
  fEls.tabChart.classList.toggle("active", isChart);
  if (fEls.tabCompare) fEls.tabCompare.classList.toggle("active", isCompare);
  if (isCompare) {
    els.systemTabs.hidden = true;
    loadCompareView();
  } else if (systems.length > 1) {
    els.systemTabs.hidden = false;
  }
  if (isChart) loadChartView();
}

function loadCompareView() {
  if (systems.length < 2) return;
  if (!hasData) setCompareLoading(true);
  pollNow();
}

function setCompareLoading(on) {
  if (!fEls.compareGrid) return;
  if (!on) return;
  fEls.compareGrid.innerHTML = "";
  for (const sys of systems) {
    const card = document.createElement("article");
    card.className = "compare-card skeleton";
    card.innerHTML = `
      <div class="compare-card-header">
        <h3 class="compare-name">${escapeAttr(sys.name)}</h3>
      </div>
      <div class="compare-metrics">
        <div class="compare-metric compare-metric-soc">
          <span class="compare-label">${t("cardBattery")}</span>
          <span class="compare-value">--%</span>
          <div class="compare-bar-wrap"><div class="compare-bar" style="width:0%"></div></div>
        </div>
        <div class="compare-metric compare-metric-solar">
          <span class="compare-label">${t("cardSolar")}</span>
          <span class="compare-value">-- W</span>
        </div>
        <div class="compare-metric compare-metric-load">
          <span class="compare-label">${t("cardLoad")}</span>
          <span class="compare-value">-- W</span>
        </div>
        <div class="compare-metric compare-metric-gen">
          <span class="compare-label">${t("cardGenerator")}</span>
          <span class="compare-value">--</span>
        </div>
      </div>
      <p class="compare-status">--</p>
    `;
    fEls.compareGrid.appendChild(card);
  }
}

function renderComparison(allData) {
  if (!fEls.compareGrid) return;
  hasData = true;
  lastCompareData = allData;

  const lowestIds = new Set(findLowestSocIds(allData));
  let latestTs = null;

  fEls.compareGrid.innerHTML = "";
  for (const d of allData) {
    const card = document.createElement("article");
    const hasError = !d || d.error;
    const genOn = !hasError && (d.grid?.active ?? false);
    const isLowest = !hasError && lowestIds.has(d.systemId);

    card.className = "compare-card"
      + (isLowest ? " compare-lowest-soc" : "")
      + (genOn ? " compare-gen-active" : "");

    if (hasError) {
      const name = d?.name || systems.find((s) => s.id === d?.systemId)?.name || "System";
      card.innerHTML = `
        <div class="compare-card-header">
          <h3 class="compare-name">${escapeAttr(name)}</h3>
        </div>
        <p class="compare-error">${escapeAttr(d?.error || t("compareUnavailable"))}</p>
      `;
      fEls.compareGrid.appendChild(card);
      continue;
    }

    const soc = d.battery?.soc ?? 0;
    const solarW = Math.round(d.solar?.power ?? 0);
    const loadW = Math.round(d.load?.power ?? 0);
    const badges = [];
    if (isLowest && lowestIds.size > 0) {
      badges.push(`<span class="compare-highlight compare-highlight-lowest">${t("compareLowestSoc")}</span>`);
    }
    if (genOn) {
      badges.push(`<span class="compare-highlight compare-highlight-gen">${t("compareGeneratorOn")}</span>`);
    }

    card.innerHTML = `
      <div class="compare-card-header">
        <h3 class="compare-name">${escapeAttr(d.name)}</h3>
        ${badges.length ? `<div class="compare-badges">${badges.join("")}</div>` : ""}
      </div>
      <div class="compare-metrics">
        <div class="compare-metric compare-metric-soc">
          <span class="compare-label">${t("cardBattery")}</span>
          <span class="compare-value">${soc}%</span>
          <div class="compare-bar-wrap"><div class="compare-bar" style="width:${clampPct(soc)}%"></div></div>
        </div>
        <div class="compare-metric compare-metric-solar">
          <span class="compare-label">${t("cardSolar")}</span>
          <span class="compare-value">${solarW} W</span>
        </div>
        <div class="compare-metric compare-metric-load">
          <span class="compare-label">${t("cardLoad")}</span>
          <span class="compare-value">${loadW} W</span>
        </div>
        <div class="compare-metric compare-metric-gen">
          <span class="compare-label">${t("cardGenerator")}</span>
          <span class="gen-badge ${genOn ? "gen-on" : "gen-off"}">${genOn ? t("genOn") : t("genOff")}</span>
        </div>
      </div>
      <p class="compare-status">${escapeAttr(d.status || "--")}</p>
    `;
    fEls.compareGrid.appendChild(card);

    const ts = d.timestamp;
    if (ts && (!latestTs || ts > latestTs)) latestTs = ts;
  }

  if (latestTs) {
    const timePart = latestTs.includes(" ")
      ? latestTs.split(" ")[1]
      : latestTs.includes("T")
        ? latestTs.split("T")[1]?.split(".")[0]
        : latestTs;
    els.lastUpdate.textContent = `Last update: ${timePart}`;
  }

  setStatus(allData.some((d) => d && !d.error));
}

fEls.tabCards.addEventListener("click", () => setView("cards"));
fEls.tabFlow.addEventListener("click", () => setView("flow"));
fEls.tabChart.addEventListener("click", () => setView("chart"));
if (fEls.tabCompare) fEls.tabCompare.addEventListener("click", () => setView("compare"));
fEls.chartDate.addEventListener("change", () => selectChartDate(fEls.chartDate.value));
if (fEls.chartPrev) {
  fEls.chartPrev.addEventListener("click", () => navigateChartDay(-1));
}
if (fEls.chartNext) {
  fEls.chartNext.addEventListener("click", () => navigateChartDay(1));
}
if (fEls.chartExportBtn) fEls.chartExportBtn.addEventListener("click", exportChartCsv);
if (fEls.chartRetryBtn) {
  fEls.chartRetryBtn.addEventListener("click", () => {
    loadChartView();
  });
}
if (fEls.energyRetryBtn) {
  fEls.energyRetryBtn.addEventListener("click", () => loadEnergySummary());
}
initChartSwipe();

/* ── Helpers ── */
function setBar(barEl, pct) {
  barEl.style.width = clampPct(pct) + "%";
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
    els.batRate.textContent = t("batRateSlow");
    els.batRate.className = "bat-rate rate-slow";
  } else if (absAmps < 40) {
    els.batRate.textContent = t("batRateMid");
    els.batRate.className = "bat-rate rate-mid";
  } else {
    els.batRate.textContent = t("batRateFast");
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
  els.statusDot.title = t(ok ? "statusConnected" : "statusDisconnected");
}

function showPollError(message) {
  if (!els.pollErrorToast || !els.pollErrorMsg) return;
  els.pollErrorMsg.textContent = message;
  els.pollErrorToast.hidden = false;
}

function hidePollError() {
  if (!els.pollErrorToast) return;
  els.pollErrorToast.hidden = true;
  if (els.pollRetryBtn) {
    els.pollRetryBtn.disabled = false;
    els.pollRetryBtn.textContent = t("retry");
  }
  pollRetrying = false;
}

function setPollRetrying(retrying) {
  pollRetrying = retrying;
  if (!els.pollRetryBtn) return;
  els.pollRetryBtn.disabled = retrying;
  els.pollRetryBtn.textContent = retrying ? t("retrying") : t("retry");
}

/* ── System tabs ── */
function renderSystemTabs() {
  els.systemTabs.innerHTML = "";
  updateCompareTabVisibility();
  if (currentView === "compare") {
    els.systemTabs.hidden = true;
    return;
  }
  if (systems.length <= 1) {
    els.systemTabs.hidden = true;
    if (systems.length === 1) {
      els.headerTitle.textContent = systems[0].name;
    }
    return;
  }
  els.systemTabs.hidden = false;
  els.headerTitle.textContent = t("appTitle");

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
        loadChartView();
      } else {
        pollNow();
      }
    });
    els.systemTabs.appendChild(btn);
  }
}

/* ── Render normalized data ── */
function renderWeatherStrip(weather) {
  if (!els.weatherStrip || !els.weatherText) return;
  const label = formatWeatherStrip(weather);
  if (!label) {
    els.weatherStrip.hidden = true;
    return;
  }
  els.weatherText.textContent = label;
  els.weatherStrip.hidden = false;
}

function renderData(d) {
  if (!d || d.error) {
    setInverterStatus("--");
    setStatus(false);
    renderWeatherStrip(null);
    return;
  }

  lastRenderData = d;
  setLoading(false);
  hasData = true;

  const bat = d.battery || {};
  const sol = d.solar || {};
  const load = d.load || {};
  const grid = d.grid || {};
  const inv = d.inverter || {};

  setInverterStatus(d.status);
  renderWeatherStrip(d.weather);

  /* Battery */
  const soc = bat.soc ?? 0;
  els.batPct.textContent = soc;
  setBar(els.batBar, soc);
  els.batVolts.textContent = (bat.voltage ?? 0).toFixed(1);
  els.batCurrent.textContent = Math.round(bat.current ?? 0);

  const batA = bat.current ?? 0;
  const absA = Math.abs(batA);
  if (absA < 2) {
    els.batDirection.textContent = t("batIdle");
    els.batDirection.className = "bat-direction dir-idle";
    els.batRate.textContent = "";
    els.batRate.className = "bat-rate";
  } else if (batA < 0) {
    els.batDirection.textContent = t("batCharging");
    els.batDirection.className = "bat-direction dir-charging";
    setBatRate(absA);
  } else {
    els.batDirection.textContent = t("batDischarging");
    els.batDirection.className = "bat-direction dir-discharging";
    setBatRate(absA);
  }

  const timeToEmpty = estimateBatteryTimeToEmpty(bat, grid, { load, translate: t });
  if (els.batEmptyIn) {
    if (timeToEmpty) {
      els.batEmptyIn.textContent = timeToEmpty.label;
      els.batEmptyIn.hidden = false;
    } else {
      els.batEmptyIn.textContent = "";
      els.batEmptyIn.hidden = true;
    }
  }

  /* Solar */
  const solPct = solarPctFromPower(sol.power, inv.nominalPV || 5000);
  els.solPct.textContent = solPct;
  setBar(els.solBar, solPct);
  els.solWatts.textContent = Math.round(sol.power ?? 0);
  els.solPvVolts.textContent = (sol.voltage ?? 0).toFixed(0);

  /* Load */
  const ldPct = loadPercent(load, inv.ratedPower || 5000);
  els.loadPct.textContent = ldPct;
  setBar(els.loadBar, ldPct);
  els.loadWatts.textContent = Math.round(load.power ?? 0);

  /* Generator / Grid */
  const genOn = grid.active ?? false;
  const gridW = grid.power ?? 0;
  const gridV = grid.voltage ?? 0;
  els.genStatus.textContent = genOn ? t("genOn") : t("genOff");
  els.genStatus.className = genOn ? "gen-badge gen-on" : "gen-badge gen-off";
  els.genWatts.textContent = genOn ? Math.abs(Math.round(gridW)) : "0";
  els.genVolts.textContent = genOn ? gridV.toFixed(0) : "--";
  els.genCard.className = genOn ? "card card-gen gen-active" : "card card-gen";

  /* Footer */
  const ts = d.timestamp || "--";
  const timePart = ts.includes(" ") ? ts.split(" ")[1] : ts.includes("T") ? ts.split("T")[1]?.split(".")[0] : ts;
  els.lastUpdate.textContent = t("lastUpdate", { time: timePart });
  if (d.energyToday != null) {
    els.energyToday.textContent = t("energyToday", { kwh: parseFloat(d.energyToday).toFixed(1) });
  }

  if (systems.length === 1) {
    els.headerTitle.textContent = d.name || systems[0]?.name || t("appTitle");
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
  fEls.fnGenV.textContent = genOn ? fmtW(Math.abs(gridW)) : t("genOff");
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
  const batState = charging ? t("batCharging") : discharging ? t("batDischarging") : t("batIdle");
  let batDetail = batV.toFixed(1) + "V \u00B7 " + batState;
  const timeToEmpty = estimateBatteryTimeToEmpty(d.battery, d.grid, { load: d.load, translate: t });
  if (timeToEmpty) batDetail += " \u00B7 " + timeToEmpty.label;
  fEls.fnBatDetail.textContent = batDetail;
}

/* ── Theme ── */
const THEME_ICONS = {
  dark: "\u{1F319}",
  light: "\u2600",
  "high-contrast": "\u25C9",
};

function getSystemThemePrefs() {
  return {
    prefersLight: window.matchMedia("(prefers-color-scheme: light)").matches,
    prefersHighContrast: window.matchMedia("(prefers-contrast: more)").matches,
  };
}

function getCurrentTheme() {
  return normalizeTheme(document.documentElement.getAttribute("data-theme"))
    || resolveInitialTheme(localStorage.getItem(THEME_STORAGE_KEY), getSystemThemePrefs());
}

function getChartColors() {
  const style = getComputedStyle(document.documentElement);
  const pick = (name) => style.getPropertyValue(name).trim();
  return {
    solar: pick("--accent-sol"),
    load: pick("--accent-load"),
    battery: pick("--accent-bat"),
    soc: pick("--accent-soc"),
    grid: pick("--chart-grid"),
    text: pick("--text-dim"),
  };
}

function updateThemeUi(theme) {
  const label = THEME_LABELS[theme] || THEME_LABELS.dark;
  const icon = THEME_ICONS[theme] || THEME_ICONS.dark;
  const title = `Theme: ${label} (click to change)`;
  for (const btn of [els.themeBtn, els.setupThemeBtn]) {
    if (!btn) continue;
    btn.textContent = icon;
    btn.title = title;
    btn.setAttribute("aria-label", title);
  }
  if (els.themeSelect && els.themeSelect.value !== theme) {
    els.themeSelect.value = theme;
  }
}

function updateMetaThemeColor(theme) {
  const color = THEME_META_COLORS[theme] || THEME_META_COLORS.dark;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = color;
}

function refreshChartsForTheme() {
  if (currentView !== "chart") return;
  if (chartHistory?.points?.length) renderChart(chartHistory);
  if (lastEnergySummary) renderEnergyChart(lastEnergySummary);
}

function applyTheme(theme) {
  const next = normalizeTheme(theme) || "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(THEME_STORAGE_KEY, next);
  updateThemeUi(next);
  updateMetaThemeColor(next);
  refreshChartsForTheme();
}

function initTheme() {
  const theme = resolveInitialTheme(localStorage.getItem(THEME_STORAGE_KEY), getSystemThemePrefs());
  applyTheme(theme);
}

function cycleTheme() {
  applyTheme(getNextTheme(getCurrentTheme()));
}

/* ── Intraday chart ── */

function setIntradayChartState(state, opts = {}) {
  historyLoading = state === "loading";
  const showPanel = state === "empty" || state === "error";
  if (fEls.chartLoading) fEls.chartLoading.hidden = state !== "loading";
  if (fEls.powerChart) fEls.powerChart.hidden = state !== "ready";
  if (fEls.chartEmpty) {
    fEls.chartEmpty.hidden = !showPanel;
    fEls.chartEmpty.classList.toggle("chart-empty-error", state === "error");
  }
  if (fEls.chartEmptyMsg) {
    if (state === "error") {
      fEls.chartEmptyMsg.textContent = opts.message || t("chartLoadError");
    } else if (state === "empty") {
      fEls.chartEmptyMsg.textContent = opts.message || t("chartEmptyDetail");
    }
  }
  if (fEls.chartRetryBtn) fEls.chartRetryBtn.hidden = state !== "error";
  if (state !== "ready") {
    const socLegend = document.querySelector(".legend-soc-item");
    if (socLegend) socLegend.hidden = true;
    if (fEls.socEstimatedBadge) fEls.socEstimatedBadge.hidden = true;
  }
  updateChartExportBtn();
  refreshChartDateNav();
}

function setEnergyChartState(state, opts = {}) {
  const showPanel = state === "empty" || state === "error";
  if (fEls.energyLoading) fEls.energyLoading.hidden = state !== "loading";
  if (fEls.energyChart) fEls.energyChart.hidden = state !== "ready";
  if (fEls.energyEmpty) {
    fEls.energyEmpty.hidden = !showPanel;
    fEls.energyEmpty.classList.toggle("chart-empty-error", state === "error");
  }
  if (fEls.energyEmptyMsg) {
    if (state === "error") {
      fEls.energyEmptyMsg.textContent = opts.message || t("energyLoadError");
    } else if (state === "empty") {
      fEls.energyEmptyMsg.textContent = opts.message || t("energyEmptyDetail");
    }
  }
  if (fEls.energyRetryBtn) fEls.energyRetryBtn.hidden = state !== "error";
  if (state !== "ready") {
    const socLegend = document.querySelector(".legend-soc-range-item");
    if (socLegend) socLegend.hidden = true;
  }
}

function chartErrorMessage(err, fallback) {
  const msg = err?.message?.trim();
  return msg || fallback;
}

function updateChartExportBtn() {
  const btn = fEls.chartExportBtn;
  if (!btn) return;
  const points = chartHistory?.points;
  btn.disabled = historyLoading || !points?.length;
}

async function downloadCsvFile(filename, csv) {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const file = new File([blob], filename, { type: "text/csv" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 250);
}

function exportChartCsv() {
  const points = chartHistory?.points;
  if (!points?.length) return;
  const name = chartHistory.name
    || systems.find((s) => s.id === activeSystemId)?.name
    || "system";
  const date = chartHistory.date || fEls.chartDate?.value || "unknown-date";
  const filename = `${sanitizeExportName(name)}-${date}.csv`;
  downloadCsvFile(filename, historyToCsv(points));
}

function renderChart(data) {
  const canvas = fEls.powerChart;
  if (!canvas) return false;

  const points = data?.points || [];
  const socLegend = document.querySelector(".legend-soc-item");
  const hasSoc = points.some((p) => Number.isFinite(p.soc));
  if (socLegend) socLegend.hidden = !hasSoc;
  if (fEls.socEstimatedBadge) {
    fEls.socEstimatedBadge.hidden = !hasSoc || !shouldShowEstimatedSocBadge(data);
  }

  if (!points.length) return false;

  setIntradayChartState("ready");
  const CHART_COLORS = getChartColors();

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

  const pad = { top: 16, right: hasSoc ? 40 : 12, bottom: 28, left: 44 };
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
  function ySocAt(pct) {
    return pad.top + plotH - (pct / 100) * plotH;
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

  if (hasSoc) {
    ctx.textAlign = "left";
    for (let i = 0; i <= 4; i++) {
      const pct = 100 - (100 * i) / 4;
      const y = pad.top + (plotH * i) / 4;
      ctx.fillText(`${Math.round(pct)}%`, pad.left + plotW + 6, y);
    }
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

  if (hasSoc) {
    ctx.strokeStyle = CHART_COLORS.soc;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < points.length; i++) {
      const soc = points[i].soc;
      if (!Number.isFinite(soc)) continue;
      const x = xAt(i);
      const y = ySocAt(soc);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  return true;
}

function renderEnergyChart(data) {
  const canvas = fEls.energyChart;
  if (!canvas) return false;

  const series = data?.series || [];
  const socLegend = document.querySelector(".legend-soc-range-item");
  const hasSoc = series.some((d) => d.minSoc != null && d.maxSoc != null);
  if (socLegend) socLegend.hidden = !hasSoc;

  const hasData = series.some((d) => (d.solarKwh ?? 0) > 0 || (d.loadKwh ?? 0) > 0 || hasSoc);
  if (!series.length || !hasData) return false;

  setEnergyChartState("ready");
  const CHART_COLORS = getChartColors();

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(280, Math.round(rect.width || 500));
  const height = 180;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.height = height + "px";

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const pad = { top: 16, right: hasSoc ? 36 : 12, bottom: 32, left: 40 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const n = series.length;
  const groupW = plotW / n;
  const barGap = Math.min(4, groupW * 0.08);
  const barW = Math.max(6, (groupW - barGap * 3) / 2);

  let yMax = 0;
  for (const d of series) {
    yMax = Math.max(yMax, d.solarKwh ?? 0, d.loadKwh ?? 0);
  }
  if (yMax === 0) yMax = 1;
  const yPad = yMax * 0.1 || 0.5;
  yMax += yPad;

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
    const val = yMax - (yMax * i) / 4;
    const y = pad.top + (plotH * i) / 4;
    ctx.fillText(val < 10 ? val.toFixed(1) : Math.round(val).toString(), pad.left - 6, y);
  }

  if (hasSoc) {
    ctx.textAlign = "left";
    for (let i = 0; i <= 4; i++) {
      const pct = 100 - (100 * i) / 4;
      const y = pad.top + (plotH * i) / 4;
      ctx.fillText(`${Math.round(pct)}%`, pad.left + plotW + 6, y);
    }
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = 0; i < n; i++) {
    const cx = pad.left + groupW * i + groupW / 2;
    ctx.fillText(fmtChartDate(series[i].date, getLocale()), cx, pad.top + plotH + 8);
    const day = series[i];
    if (day.minSoc != null && day.maxSoc != null) {
      ctx.fillStyle = CHART_COLORS.soc;
      ctx.font = "10px sans-serif";
      ctx.fillText(`${day.minSoc}–${day.maxSoc}%`, cx, pad.top + plotH + 22);
      ctx.fillStyle = CHART_COLORS.text;
      ctx.font = "11px sans-serif";
    }
  }

  function barHeight(kwh) {
    return ((kwh ?? 0) / yMax) * plotH;
  }
  function ySocAt(pct) {
    return pad.top + plotH - (pct / 100) * plotH;
  }

  for (let i = 0; i < n; i++) {
    const baseX = pad.left + groupW * i + barGap;
    const solarH = barHeight(series[i].solarKwh);
    const loadH = barHeight(series[i].loadKwh);
    const yBase = pad.top + plotH;

    ctx.fillStyle = CHART_COLORS.solar;
    ctx.fillRect(baseX, yBase - solarH, barW, solarH);

    ctx.fillStyle = CHART_COLORS.load;
    ctx.fillRect(baseX + barW + barGap, yBase - loadH, barW, loadH);

    const day = series[i];
    if (day.minSoc != null && day.maxSoc != null) {
      const cx = pad.left + groupW * i + groupW - barGap * 2;
      const yTop = ySocAt(day.maxSoc);
      const yBot = ySocAt(day.minSoc);
      ctx.strokeStyle = CHART_COLORS.soc;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, yTop);
      ctx.lineTo(cx, yBot);
      ctx.stroke();
      ctx.fillStyle = CHART_COLORS.soc;
      ctx.beginPath();
      ctx.arc(cx, yTop, 2, 0, Math.PI * 2);
      ctx.arc(cx, yBot, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return true;
}

function loadChartDate() {
  try {
    return localStorage.getItem(CHART_DATE_KEY);
  } catch {
    return null;
  }
}

function saveChartDate(date) {
  try {
    localStorage.setItem(CHART_DATE_KEY, date);
  } catch {
    /* ignore quota errors */
  }
}

function getSelectedChartDate() {
  const today = todayIsoDate();
  const raw = fEls.chartDate?.value || loadChartDate() || today;
  return clampIsoDateToToday(raw, today);
}

function initChartDateInput() {
  const today = todayIsoDate();
  if (!fEls.chartDate) return;
  fEls.chartDate.max = today;
  const stored = loadChartDate();
  if (stored) {
    fEls.chartDate.value = clampIsoDateToToday(stored, today);
  }
}

function refreshChartDateNav() {
  const selected = getSelectedChartDate();
  const today = todayIsoDate();
  renderChartWeekStrip(selected, today);
}

function renderChartWeekStrip(selectedDate, today = todayIsoDate()) {
  const strip = fEls.chartWeekStrip;
  if (!strip) return;

  strip.innerHTML = "";
  const dates = buildWeekStripDates(selectedDate, 7);
  for (const date of dates) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chart-day-btn";
    if (date === selectedDate) btn.classList.add("active");
    if (date === today) btn.classList.add("is-today");
    btn.dataset.date = date;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", date === selectedDate ? "true" : "false");
    btn.setAttribute("aria-label", date);
    btn.disabled = historyLoading;

    const wd = document.createElement("span");
    wd.className = "chart-day-wd";
    wd.textContent = fmtWeekStripWeekday(date, getLocale());

    const num = document.createElement("span");
    num.className = "chart-day-num";
    num.textContent = fmtWeekStripDay(date);

    btn.append(wd, num);
    btn.addEventListener("click", () => {
      if (date !== getSelectedChartDate()) selectChartDate(date);
    });
    strip.appendChild(btn);
  }

  if (fEls.chartPrev) fEls.chartPrev.disabled = historyLoading;
  if (fEls.chartNext) {
    fEls.chartNext.disabled = historyLoading || selectedDate >= today;
  }
}

function selectChartDate(dateStr) {
  const today = todayIsoDate();
  const date = clampIsoDateToToday(dateStr || today, today);
  saveChartDate(date);
  if (fEls.chartDate) {
    fEls.chartDate.max = today;
    fEls.chartDate.value = date;
  }
  renderChartWeekStrip(date, today);
  loadChartView();
}

function navigateChartDay(delta) {
  if (historyLoading || !delta) return;
  const current = getSelectedChartDate();
  const next = addIsoDays(current, delta);
  const today = todayIsoDate();
  if (isIsoDateAfter(next, today)) return;
  selectChartDate(next);
}

function initChartSwipe() {
  const area = fEls.chartSwipeArea;
  if (!area) return;

  let startX = 0;
  let startY = 0;
  let tracking = false;

  area.addEventListener("touchstart", (e) => {
    if (historyLoading || e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });

  area.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Math.abs(dx) < CHART_SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
    if (dx > 0) navigateChartDay(-1);
    else navigateChartDay(1);
  }, { passive: true });

  area.addEventListener("touchcancel", () => {
    tracking = false;
  }, { passive: true });
}

function historySummaryQuery(endDate) {
  const end = endDate || getSelectedChartDate();
  return `/api/systems/${activeSystemId}/history/summary?days=7&end=${encodeURIComponent(end)}`;
}

async function loadEnergySummary() {
  if (!activeSystemId || currentView !== "chart") return;
  setEnergyChartState("loading");
  try {
    const data = await api("GET", historySummaryQuery(getSelectedChartDate()));
    lastEnergySummary = data;
    if (renderEnergyChart(data)) return;
    setEnergyChartState("empty");
  } catch (err) {
    lastEnergySummary = null;
    console.error("energy summary error:", err);
    setEnergyChartState("error", {
      message: chartErrorMessage(err, t("energyLoadError")),
    });
  }
}

async function loadChartView() {
  if (!activeSystemId || currentView !== "chart") return;
  initChartDateInput();
  const date = getSelectedChartDate();
  if (fEls.chartDate) fEls.chartDate.value = date;
  renderChartWeekStrip(date, todayIsoDate());
  setIntradayChartState("loading");
  setEnergyChartState("loading");
  const qs = `?date=${encodeURIComponent(date)}`;
  const [historyResult, summaryResult] = await Promise.allSettled([
    api("GET", `/api/systems/${activeSystemId}/history${qs}`),
    api("GET", historySummaryQuery(date)),
  ]);

  let historyOk = false;
  if (historyResult.status === "fulfilled") {
    const history = historyResult.value;
    chartHistory = history;
    if (history.date) {
      saveChartDate(history.date);
      if (fEls.chartDate) fEls.chartDate.value = history.date;
      renderChartWeekStrip(history.date, todayIsoDate());
    }
    if (renderChart(history)) {
      historyOk = true;
    } else {
      setIntradayChartState("empty");
      historyOk = true;
    }
  } else {
    console.error("chart view history error:", historyResult.reason);
    chartHistory = null;
    setIntradayChartState("error", {
      message: chartErrorMessage(historyResult.reason, t("chartLoadError")),
    });
  }

  if (summaryResult.status === "fulfilled") {
    lastEnergySummary = summaryResult.value;
    if (!renderEnergyChart(summaryResult.value)) {
      setEnergyChartState("empty");
    }
  } else {
    lastEnergySummary = null;
    console.error("chart view summary error:", summaryResult.reason);
    setEnergyChartState("error", {
      message: chartErrorMessage(summaryResult.reason, t("energyLoadError")),
    });
  }

  setStatus(historyOk);
}

/* ── Polling ── */
async function pollNow() {
  if (currentView === "compare") {
    if (systems.length < 2) return;
    if (!hasData) setCompareLoading(true);
    try {
      const data = await api("GET", "/api/systems/all/data");
      renderComparison(data);
      hidePollError();
    } catch (err) {
      console.error("compare poll error:", err);
      setCompareLoading(false);
      setStatus(false);
      showPollError(chartErrorMessage(err, t("compareLoadError")));
    } finally {
      setPollRetrying(false);
    }
    return;
  }

  if (!activeSystemId) return;
  if (!hasData) setLoading(true);
  try {
    const data = await api("GET", `/api/systems/${activeSystemId}/data`);
    renderData(data);
    hidePollError();
  } catch (err) {
    console.error("poll error:", err);
    setLoading(false);
    setStatus(false);
    showPollError(chartErrorMessage(err, t("pollLoadError")));
  } finally {
    setPollRetrying(false);
  }
}

async function retryPollNow() {
  if (currentView === "compare") {
    if (systems.length < 2 || pollRetrying) return;
    setPollRetrying(true);
    await pollNow();
    return;
  }
  if (!activeSystemId || pollRetrying) return;
  setPollRetrying(true);
  await pollNow();
}

function startPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  async function tick() {
    await pollNow();
    pollTimer = setTimeout(tick, getPollMs());
  }
  tick();
}

function stopPolling() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  hidePollError();
}

/** Same refresh path as pull-to-refresh (cards/flow → poll, chart → history). */
async function refreshDashboardNow() {
  if (dashboardRefreshing || els.dashScreen.hidden) return;
  dashboardRefreshing = true;
  try {
    if (pollTimer) clearTimeout(pollTimer);
    const refresh = currentView === "chart"
      ? loadChartView()
      : pollNow();
    await refresh;
    if (currentView !== "chart") pollTimer = setTimeout(() => startPolling(), getPollMs());
  } finally {
    dashboardRefreshing = false;
  }
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
const addDeviceGroup = $("add-device-group");
const addDeviceSelect = $("add-device");

function hidePlantPicker() {
  addPlantGroup.hidden = true;
  addPlantSelect.innerHTML = "";
  addPlantSelect.required = false;
}

function hideDevicePicker() {
  addDeviceGroup.hidden = true;
  addDeviceSelect.innerHTML = "";
  addDeviceSelect.required = false;
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

function showDevicePicker(devices) {
  addDeviceSelect.innerHTML = "";
  const aggregateOpt = document.createElement("option");
  aggregateOpt.value = "__aggregate__";
  aggregateOpt.textContent = "All inverters (combined)";
  addDeviceSelect.appendChild(aggregateOpt);
  for (const d of devices) {
    const opt = document.createElement("option");
    opt.value = d.key;
    opt.textContent = d.label;
    addDeviceSelect.appendChild(opt);
  }
  addDeviceGroup.hidden = false;
  addDeviceSelect.required = true;
}

function openAddModal() {
  manageModal.hidden = true;
  addModal.hidden = false;
  addForm.reset();
  hidePlantPicker();
  hideDevicePicker();
  addError.hidden = true;
}

function closeAddModal() {
  addModal.hidden = true;
}

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  addError.hidden = true;
  $("add-submit").disabled = true;
  $("add-submit").textContent = t("adding");

  const body = {
    service: $("add-service").value,
    name: $("add-name").value || undefined,
    user: $("add-user").value,
    password: $("add-pass").value,
  };
  if (!addPlantGroup.hidden && addPlantSelect.value) {
    body.plantId = addPlantSelect.value;
  }
  if (!addDeviceGroup.hidden && addDeviceSelect.value) {
    if (addDeviceSelect.value === "__aggregate__") {
      body.deviceMode = "aggregate";
    } else {
      body.deviceKey = addDeviceSelect.value;
    }
  }

  try {
    const result = await api("POST", "/api/systems", body);
    if (result.requiresPlantSelection) {
      showPlantPicker(result.plants);
      return;
    }
    if (result.requiresDeviceSelection) {
      showDevicePicker(result.devices);
      return;
    }
    closeAddModal();
    hidePlantPicker();
    hideDevicePicker();
    await loadSystems();
    if (systems.length === 1) activeSystemId = systems[0].id;
    renderSystemTabs();
    startPolling();
  } catch (err) {
    addError.textContent = err.message;
    addError.hidden = false;
  } finally {
    $("add-submit").disabled = false;
    $("add-submit").textContent = t("addSystem");
  }
});

$("add-cancel").addEventListener("click", closeAddModal);

/* ── Manage Systems ── */
function renderCredentialForm(sys) {
  const form = document.createElement("div");
  form.className = "manage-credentials";
  form.innerHTML = `
    <p class="manage-section-title">${escapeAttr(t("credPortalTitle"))}</p>
    <label>${escapeAttr(t("username"))}</label>
    <input type="text" class="cred-user" required value="${escapeAttr(sys.username || "")}">
    <label>${escapeAttr(t("password"))}</label>
    <input type="password" class="cred-pass" required placeholder="${escapeAttr(t("credNewPasswordPlaceholder"))}">
    <div class="cred-plant-group" hidden>
      <label>${escapeAttr(t("plant"))}</label>
      <select class="cred-plant"></select>
    </div>
    <button type="button" class="cred-save">${escapeAttr(t("credSave"))}</button>
    <p class="cred-msg" hidden></p>
  `;

  const msg = form.querySelector(".cred-msg");
  const plantGroup = form.querySelector(".cred-plant-group");
  const plantSelect = form.querySelector(".cred-plant");

  function hidePlantPicker() {
    plantGroup.hidden = true;
    plantSelect.innerHTML = "";
    plantSelect.required = false;
  }

  function showPlantPicker(plants) {
    plantSelect.innerHTML = "";
    for (const p of plants) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      plantSelect.appendChild(opt);
    }
    plantGroup.hidden = false;
    plantSelect.required = true;
  }

  form.querySelector(".cred-save").addEventListener("click", async () => {
    msg.hidden = true;
    const btn = form.querySelector(".cred-save");
    const userInput = form.querySelector(".cred-user");
    const passInput = form.querySelector(".cred-pass");

    if (!userInput.value.trim() || !passInput.value) {
      msg.textContent = t("credRequired");
      msg.className = "cred-msg cred-err";
      msg.hidden = false;
      return;
    }

    btn.disabled = true;
    btn.textContent = t("credSaving");

    const body = {
      user: userInput.value.trim(),
      password: passInput.value,
    };
    if (!plantGroup.hidden && plantSelect.value) {
      body.plantId = plantSelect.value;
    }

    try {
      const result = await api("PUT", `/api/systems/${sys.id}/credentials`, body);
      if (result.requiresPlantSelection) {
        showPlantPicker(result.plants);
        msg.textContent = t("credSelectPlant");
        msg.className = "cred-msg cred-ok";
        msg.hidden = false;
        return;
      }
      sys.username = result.username || body.user;
      passInput.value = "";
      hidePlantPicker();
      msg.textContent = t("credUpdated");
      msg.className = "cred-msg cred-ok";
      msg.hidden = false;
      startPolling();
    } catch (err) {
      msg.textContent = err.message;
      msg.className = "cred-msg cred-err";
      msg.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = t("credSave");
    }
  });

  return form;
}

function renderAlertForm(sys) {
  const alerts = sys.alerts || {};
  const form = document.createElement("div");
  form.className = "manage-alerts";
  form.innerHTML = `
    <label class="alert-toggle">
      <input type="checkbox" class="alert-enabled" ${alerts.enabled ? "checked" : ""}>
      ${escapeAttr(t("alertsEnable"))}
    </label>
    <label>${escapeAttr(t("alertsWebhook"))}</label>
    <input type="url" class="alert-webhook" placeholder="${escapeAttr(t("alertsWebhookPlaceholder"))}" value="${escapeAttr(alerts.webhookUrl || "")}">
    <div class="alert-grid">
      <div>
        <label>${escapeAttr(t("alertsLowSoc"))}</label>
        <input type="number" class="alert-threshold" min="0" max="100" value="${alerts.lowSocThreshold ?? 20}">
      </div>
      <div>
        <label>${escapeAttr(t("alertsCooldown"))}</label>
        <input type="number" class="alert-cooldown" min="5" max="1440" value="${alerts.cooldownMinutes ?? 60}">
      </div>
    </div>
    <div class="alert-checks">
      <label><input type="checkbox" class="alert-low-soc" ${alerts.notifyLowSoc !== false ? "checked" : ""}> ${escapeAttr(t("alertsLowBattery"))}</label>
      <label><input type="checkbox" class="alert-generator" ${alerts.notifyGenerator !== false ? "checked" : ""}> ${escapeAttr(t("alertsGeneratorOn"))}</label>
    </div>
    <button type="button" class="alert-save">${escapeAttr(t("alertsSave"))}</button>
    <p class="alert-msg" hidden></p>
  `;

  const msg = form.querySelector(".alert-msg");
  form.querySelector(".alert-save").addEventListener("click", async () => {
    msg.hidden = true;
    const btn = form.querySelector(".alert-save");
    btn.disabled = true;
    btn.textContent = t("alertsSaving");
    try {
      const body = {
        enabled: form.querySelector(".alert-enabled").checked,
        webhookUrl: form.querySelector(".alert-webhook").value.trim(),
        lowSocThreshold: Number(form.querySelector(".alert-threshold").value),
        cooldownMinutes: Number(form.querySelector(".alert-cooldown").value),
        notifyLowSoc: form.querySelector(".alert-low-soc").checked,
        notifyGenerator: form.querySelector(".alert-generator").checked,
      };
      sys.alerts = await api("PUT", `/api/systems/${sys.id}/alerts`, body);
      msg.textContent = t("alertsSaved");
      msg.className = "alert-msg alert-ok";
      msg.hidden = false;
    } catch (err) {
      msg.textContent = err.message;
      msg.className = "alert-msg alert-err";
      msg.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = t("alertsSave");
    }
  });

  return form;
}

function renderGridDetectForm(sys) {
  const gridDetect = sys.gridDetect || {};
  const form = document.createElement("div");
  form.className = "manage-alerts manage-grid-detect";
  form.innerHTML = `
    <p class="manage-section-title">${escapeAttr(t("gridDetectTitle"))}</p>
    <p class="manage-hint">${escapeAttr(t("gridDetectHint"))}</p>
    <div class="alert-grid">
      <div>
        <label>${escapeAttr(t("gridDetectVoltage"))}</label>
        <input type="number" class="grid-voltage" min="0" max="500" step="1" value="${gridDetect.voltageMin ?? 30}">
      </div>
      <div>
        <label>${escapeAttr(t("gridDetectPower"))}</label>
        <input type="number" class="grid-power" min="0" max="50000" step="1" value="${gridDetect.powerMin ?? 5}">
      </div>
    </div>
    <button type="button" class="grid-save">${escapeAttr(t("gridDetectSave"))}</button>
    <p class="grid-msg" hidden></p>
  `;

  const msg = form.querySelector(".grid-msg");
  form.querySelector(".grid-save").addEventListener("click", async () => {
    msg.hidden = true;
    const btn = form.querySelector(".grid-save");
    btn.disabled = true;
    btn.textContent = t("gridDetectSaving");
    try {
      const body = {
        voltageMin: Number(form.querySelector(".grid-voltage").value),
        powerMin: Number(form.querySelector(".grid-power").value),
      };
      sys.gridDetect = await api("PUT", `/api/systems/${sys.id}/grid-detect`, body);
      msg.textContent = t("gridDetectSaved");
      msg.className = "grid-msg alert-ok";
      msg.hidden = false;
    } catch (err) {
      msg.textContent = err.message;
      msg.className = "grid-msg alert-err";
      msg.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = t("gridDetectSave");
    }
  });

  return form;
}

function openManageModal() {
  manageModal.hidden = false;
  syncPollIntervalSelect();
  updateThemeUi(getCurrentTheme());
  manageList.innerHTML = "";

  if (!systems.length) {
    manageList.innerHTML = `<p class="manage-empty">${t("noSystems")}</p>`;
    return;
  }

  for (const sys of systems) {
    const row = document.createElement("div");
    row.className = "manage-row manage-row-expanded";

    const top = document.createElement("div");
    top.className = "manage-row-top";

    const info = document.createElement("div");
    info.className = "manage-info";
    const alertBadge = sys.alerts?.enabled
      ? `<span class="alert-badge">${escapeAttr(t("alertsOnBadge"))}</span>`
      : "";
    info.innerHTML = `<strong>${sys.name}</strong><span class="manage-service">${sys.service}${alertBadge}</span>`;

    const del = document.createElement("button");
    del.className = "manage-delete";
    del.textContent = t("remove");
    del.addEventListener("click", async () => {
      if (!confirm(t("removeConfirm", { name: sys.name }))) return;
      await api("DELETE", `/api/systems/${sys.id}`);
      await loadSystems();
      openManageModal();
      if (activeSystemId === sys.id && systems.length) {
        activeSystemId = systems[0].id;
        renderSystemTabs();
        startPolling();
      }
    });

    top.appendChild(info);
    top.appendChild(del);
    row.appendChild(top);
    row.appendChild(renderCredentialForm(sys));
    row.appendChild(renderGridDetectForm(sys));
    row.appendChild(renderAlertForm(sys));
    manageList.appendChild(row);
  }
}

els.manageBtn.addEventListener("click", openManageModal);
$("manage-close").addEventListener("click", () => { manageModal.hidden = true; });
$("manage-add").addEventListener("click", openAddModal);

const pollIntervalSelect = $("poll-interval");

function refreshPollIntervalOptions() {
  if (!pollIntervalSelect) return;
  const current = pollIntervalSelect.value || String(getPollIntervalSec());
  pollIntervalSelect.innerHTML = POLL_INTERVAL_OPTIONS_SEC.map((sec) => {
    return `<option value="${sec}">${formatPollIntervalLabelI18n(sec)}</option>`;
  }).join("");
  pollIntervalSelect.value = current;
}

function changeLocale(locale) {
  setLocale(locale);
  applyTranslations();
  syncLangToggle();
  refreshPollIntervalOptions();
  renderSystemTabs();
  if (lastRenderData) renderData(lastRenderData);
  if (currentView === "compare" && lastCompareData) renderComparison(lastCompareData);
  if (els.pollErrorToast && !els.pollErrorToast.hidden) {
    setPollRetrying(pollRetrying);
  }
  if (currentView === "chart") {
    refreshChartDateNav();
    if (chartHistory && fEls.powerChart && !fEls.powerChart.hidden) {
      renderChart(chartHistory);
    }
    if (lastEnergySummary && fEls.energyChart && !fEls.energyChart.hidden) {
      renderEnergyChart(lastEnergySummary);
    }
  }
  if (!manageModal.hidden) openManageModal();
}

function initLangToggle() {
  document.querySelectorAll("[data-lang]").forEach((btn) => {
    btn.addEventListener("click", () => changeLocale(btn.dataset.lang));
  });
}

if (pollIntervalSelect) {
  refreshPollIntervalOptions();
  pollIntervalSelect.addEventListener("change", () => {
    savePollIntervalSec(pollIntervalSelect.value);
    restartPollingIfActive();
  });
}

if (els.themeBtn) els.themeBtn.addEventListener("click", cycleTheme);
if (els.setupThemeBtn) els.setupThemeBtn.addEventListener("click", cycleTheme);
if (els.themeSelect) {
  els.themeSelect.addEventListener("change", () => applyTheme(els.themeSelect.value));
}

/* ── Setup (proxy connection) ── */
els.setupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.setupError.hidden = true;
  els.setupBtn.disabled = true;
  els.setupBtn.textContent = t("connecting");

  const url = els.setupUrl.value.trim().replace(/\/+$/, "");
  const token = els.setupToken.value.trim();

  try {
    const resp = await fetch(`${url}/api/systems`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error(t("invalidTokenOrUrl"));
    await resp.json();

    saveConn({ url, token });
    await loadSystems();
    showDash();
    setView(localStorage.getItem(VIEW_KEY) || "cards");

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
    els.setupBtn.textContent = t("connect");
  }
});

els.disconnectBtn.addEventListener("click", () => {
  clearConn();
  stopPolling();
  showSetup();
});

if (els.pollRetryBtn) {
  els.pollRetryBtn.addEventListener("click", () => retryPollNow());
}

/* ── Desktop keyboard refresh (F5 / Ctrl|Cmd+R) ── */
document.addEventListener("keydown", (e) => {
  if (els.dashScreen.hidden) return;
  if (isEditableElement(document.activeElement)) return;
  if (!matchesDashboardRefreshShortcut(e)) return;
  e.preventDefault();
  refreshDashboardNow();
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
    if (refreshing || dashboardRefreshing || !isAtTop()) return;
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
    if (armed && !refreshing && !dashboardRefreshing) {
      refreshing = true;
      ptr.className = "ptr refreshing";
      ptr.style.height = "36px";
      refreshDashboardNow().finally(() => {
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
initTheme();
loadStoredLocale();
applyTranslations();
syncLangToggle();
initLangToggle();
// Systems aren't loaded yet, so a stored "compare" view would be wrongly
// downgraded here; paint optimistically without persisting that downgrade.
setView(localStorage.getItem(VIEW_KEY) || "cards", { persist: false });

(async function boot() {
  const params = new URLSearchParams(location.search);
  const urlProxy = params.get("proxy");
  const urlToken = params.get("token");

  if (urlProxy && urlToken) {
    const url = urlProxy.replace(/\/+$/, "");
    saveConn({ url, token: urlToken });
  }

  const conn = loadConn();
  if (!conn) {
    setView("cards");
    showSetup();
    return;
  }

  try {
    await loadSystems();
    showDash();
    setView(localStorage.getItem(VIEW_KEY) || "cards");
    if (systems.length) {
      startPolling();
    } else {
      openAddModal();
    }
  } catch {
    setView("cards");
    showSetup();
  }
})();
