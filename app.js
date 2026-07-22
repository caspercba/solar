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
  normalizeSocWarnThreshold,
  isSocBelowWarnThreshold,
  generatorRuntimeStorageKey,
  GENERATOR_RUNTIME_STORAGE_PREFIX,
  createGeneratorRuntimeState,
  updateGeneratorRuntime,
  totalGeneratorRuntimeSec,
  formatGeneratorRuntime,
  normalizeGridInputLabel,
  gridInputCardKey,
  gridInputFlowKey,
  gridInputCompareOnKey,
  inviteStatusI18nKey,
  inviteStatusBadgeClass,
  isInviteRevocable,
  hasPurgeableInvites,
  inviteAcceptErrorI18nKey,
  adminCreateUserErrorI18nKey,
  canDisableUser,
  canChangeUserRole,
  httpError,
  isUnauthorizedError,
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

function getSystemById(systemId) {
  return systems.find((s) => s.id === systemId) || null;
}

function getGridInputLabel(systemId) {
  return normalizeGridInputLabel(getSystemById(systemId)?.gridInputLabel);
}

function applyGridInputLabels(systemId) {
  const label = getGridInputLabel(systemId);
  if (els.genCardTitle) {
    els.genCardTitle.textContent = t(gridInputCardKey(label));
  }
  if (fEls.flowGenLabel) {
    fEls.flowGenLabel.textContent = t(gridInputFlowKey(label));
  }
}

/* ── Config ── */
const POLL_INTERVAL_KEY = "solar_poll_interval";
const SOC_WARN_KEY = "solar_soc_warn_threshold";
const CONN_KEY = "solar_conn";
const VIEW_KEY = "solar_view";
const ACTIVE_KEY = "solar_active";
const CHART_DATE_KEY = "solar_chart_date";
const CHART_SWIPE_THRESHOLD = 50;

/* ── Proxy connection ── */
function saveConn(data) { localStorage.setItem(CONN_KEY, JSON.stringify(data)); }
function loadConn() { try { return JSON.parse(localStorage.getItem(CONN_KEY)); } catch { return null; } }
function clearConn() { localStorage.removeItem(CONN_KEY); }

/* ── Generator runtime (session-only, per system, resets on disconnect) ── */
function loadGeneratorRuntimeState(systemId) {
  try {
    const raw = localStorage.getItem(generatorRuntimeStorageKey(systemId));
    if (!raw) return createGeneratorRuntimeState();
    const parsed = JSON.parse(raw);
    if (typeof parsed?.accumulatedSec !== "number") return createGeneratorRuntimeState();
    return { accumulatedSec: parsed.accumulatedSec, activeSince: parsed.activeSince ?? null };
  } catch {
    return createGeneratorRuntimeState();
  }
}

function saveGeneratorRuntimeState(systemId, state) {
  try {
    localStorage.setItem(generatorRuntimeStorageKey(systemId), JSON.stringify(state));
  } catch {
    /* ignore quota errors */
  }
}

function clearGeneratorRuntimeState(systemId) {
  localStorage.removeItem(generatorRuntimeStorageKey(systemId));
}

function clearAllGeneratorRuntimeStates() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(GENERATOR_RUNTIME_STORAGE_PREFIX)) keys.push(key);
  }
  for (const key of keys) localStorage.removeItem(key);
}

function renderGeneratorRuntime(totalSec) {
  if (!els.genRuntime || !els.genRuntimeValue) return;
  const label = formatGeneratorRuntime(totalSec, t);
  if (label) {
    els.genRuntimeValue.textContent = label;
    els.genRuntime.hidden = false;
  } else {
    els.genRuntime.hidden = true;
  }
}

function getPollIntervalSec() {
  return normalizePollIntervalSec(localStorage.getItem(POLL_INTERVAL_KEY));
}

function getPollMs() {
  return pollIntervalSecToMs(getPollIntervalSec());
}

function savePollIntervalSec(sec) {
  localStorage.setItem(POLL_INTERVAL_KEY, String(normalizePollIntervalSec(sec)));
}

function getSocWarnThreshold() {
  return normalizeSocWarnThreshold(localStorage.getItem(SOC_WARN_KEY));
}

function saveSocWarnThreshold(pct) {
  localStorage.setItem(SOC_WARN_KEY, String(normalizeSocWarnThreshold(pct)));
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
  let json = null;
  try {
    json = await resp.json();
  } catch {
    /* non-JSON body */
  }
  if (!resp.ok) {
    if (resp.status === 401) forceReLogin();
    throw httpError((json && json.error) || `HTTP ${resp.status}`, resp.status);
  }
  return json;
}

/** Current actor from GET /api/me (role gates admin UI). */
let currentActor = null;

async function refreshCurrentActor() {
  try {
    currentActor = await api("GET", "/api/me");
  } catch (err) {
    currentActor = null;
    // Propagate revoked/disabled sessions so boot/poll can stop; other /api/me
    // failures (e.g. older mocks without the route) stay non-fatal for the dash.
    if (isUnauthorizedError(err)) throw err;
  }
  return currentActor;
}

function isAdminActor() {
  return currentActor?.role === "admin";
}

/** Cached admin invites list (ADR 0003) — emitted vs converted vs revoked/expired. */
let invitesListState = [];

/** Cached admin users list (ADR 0003). */
let usersListState = [];

/** Page origin for Worker-built magic links (strip query/hash; drop index.html). */
function inviteFrontendUrl() {
  try {
    const u = new URL(location.href);
    u.search = "";
    u.hash = "";
    if (u.pathname.endsWith("/index.html")) {
      u.pathname = u.pathname.slice(0, -"index.html".length) || "/";
    }
    const href = u.toString();
    return href.endsWith("/") && u.pathname !== "/" ? href.slice(0, -1) : href;
  } catch {
    return location.origin;
  }
}

/* ── DOM refs ── */
const $ = (id) => document.getElementById(id);

const els = {
  setupScreen: $("setup-screen"),
  inviteScreen: $("invite-screen"),
  dashScreen: $("dashboard-screen"),
  setupForm: $("setup-form"),
  setupUrl: $("setup-url"),
  setupUser: $("setup-user"),
  setupPass: $("setup-pass"),
  setupToken: $("setup-token"),
  setupModePassword: $("setup-mode-password"),
  setupModeToken: $("setup-mode-token"),
  setupPasswordFields: $("setup-password-fields"),
  setupTokenFields: $("setup-token-fields"),
  setupModeHint: $("setup-mode-hint"),
  setupBtn: $("setup-btn"),
  setupError: $("setup-error"),
  inviteForm: $("invite-form"),
  inviteProxyUrl: $("invite-proxy-url"),
  inviteUser: $("invite-user"),
  invitePass: $("invite-pass"),
  invitePassConfirm: $("invite-pass-confirm"),
  inviteAcceptBtn: $("invite-accept-btn"),
  inviteAcceptError: $("invite-accept-error"),
  inviteBackBtn: $("invite-back-btn"),
  inviteThemeBtn: $("invite-theme-btn"),
  headerTitle: $("header-title"),
  disconnectBtn: $("disconnect-btn"),
  manageBtn: $("manage-btn"),
  statusDot: $("status-dot"),
  systemTabs: $("system-tabs"),
  batCard: $("card-battery"),
  batLowBadge: $("bat-low-badge"),
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
  genCardTitle: $("gen-card-title"),
  genRuntime: $("gen-runtime"),
  genRuntimeValue: $("gen-runtime-value"),
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
  adminCreateUserSection: $("admin-create-user-section"),
  adminCreateUserForm: $("admin-create-user-form"),
  createUserUsername: $("create-user-username"),
  createUserPass: $("create-user-pass"),
  createUserPassConfirm: $("create-user-pass-confirm"),
  createUserRole: $("create-user-role"),
  createUserBtn: $("create-user-btn"),
  createUserMsg: $("create-user-msg"),
  adminUsersListSection: $("admin-users-list-section"),
  usersList: $("users-list"),
  usersListEmpty: $("users-list-empty"),
  usersListMsg: $("users-list-msg"),
  adminCreateUserSection: $("admin-create-user-section"),
  adminCreateUserForm: $("admin-create-user-form"),
  createUserUsername: $("create-user-username"),
  createUserPassword: $("create-user-password"),
  createUserRole: $("create-user-role"),
  createUserBtn: $("create-user-btn"),
  createUserMsg: $("create-user-msg"),
  adminInviteSection: $("admin-invite-section"),
  adminInviteForm: $("admin-invite-form"),
  inviteRole: $("invite-role"),
  inviteLabel: $("invite-label"),
  inviteTtl: $("invite-ttl"),
  inviteMintBtn: $("invite-mint-btn"),
  inviteMintMsg: $("invite-mint-msg"),
  inviteResult: $("invite-result"),
  inviteUrl: $("invite-url"),
  inviteCopyBtn: $("invite-copy-btn"),
  inviteExpires: $("invite-expires"),
  adminInvitesListSection: $("admin-invites-list-section"),
  invitesList: $("invites-list"),
  invitesListEmpty: $("invites-list-empty"),
  invitesListMsg: $("invites-list-msg"),
  invitesPurgeBtn: $("invites-purge-btn"),
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
  flowGenLabel: $("flow-gen-label"),
};

/* ── Modals ── */
const addModal = $("add-system-modal");
const addForm = $("add-system-form");
const addError = $("add-error");
const manageModal = $("manage-modal");
const manageList = $("manage-list");
const detailModal = $("system-detail-modal");
const detailTitle = $("detail-title");
const detailBody = $("detail-body");
const detailBack = $("detail-back");
const detailRemove = $("detail-remove");

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
  if (els.genRuntime && on) {
    els.genRuntime.hidden = true;
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
          <span class="compare-label">${t(gridInputCardKey(sys.gridInputLabel))}</span>
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
    const gridLabel = getGridInputLabel(d.systemId);

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
      badges.push(`<span class="compare-highlight compare-highlight-gen">${t(gridInputCompareOnKey(gridLabel))}</span>`);
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
          <span class="compare-label">${t(gridInputCardKey(gridLabel))}</span>
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

/** Plaintext invite secret from ?invite= (held only in memory until accepted). */
let pendingInviteSecret = null;

/* ── Screens ── */
function showSetup({ message } = {}) {
  els.setupScreen.hidden = false;
  if (els.inviteScreen) els.inviteScreen.hidden = true;
  els.dashScreen.hidden = true;
  currentActor = null;
  hideAdminInviteSection();
  if (els.setupPass) els.setupPass.value = "";
  if (els.setupToken) els.setupToken.value = "";
  if (els.setupError) {
    if (message) {
      els.setupError.textContent = message;
      els.setupError.hidden = false;
    } else {
      els.setupError.hidden = true;
      els.setupError.textContent = "";
    }
  }
}

/** Close dashboard overlays when returning to the login screen. */
function closeDashboardOverlays() {
  const manage = $("manage-modal");
  const detail = $("system-detail-modal");
  const add = $("add-system-modal");
  if (manage) manage.hidden = true;
  if (detail) detail.hidden = true;
  if (add) add.hidden = true;
}

/**
 * Clear local bearer and return to setup with a re-login prompt.
 * Used when the Worker rejects a revoked/disabled session (HTTP 401).
 */
let forcingReLogin = false;
function forceReLogin(message = t("sessionExpired")) {
  if (forcingReLogin) return;
  forcingReLogin = true;
  try {
    const conn = loadConn();
    const url = conn?.url;
    clearConn();
    clearAllGeneratorRuntimeStates();
    stopPolling();
    closeDashboardOverlays();
    showSetup({ message });
    if (url && els.setupUrl) els.setupUrl.value = url;
  } finally {
    queueMicrotask(() => {
      forcingReLogin = false;
    });
  }
}

/**
 * Log out: clear local bearer and return to setup, then best-effort revoke on the Worker.
 * Always returns to setup even if the logout request fails (already revoked, offline).
 */
async function logout() {
  const conn = loadConn();
  const url = conn?.url;
  const token = conn?.token;

  clearConn();
  clearAllGeneratorRuntimeStates();
  stopPolling();
  closeDashboardOverlays();
  showSetup();
  if (url && els.setupUrl) els.setupUrl.value = url;

  if (url && token) {
    try {
      await fetch(`${url}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      /* local session already cleared */
    }
  }
}

/** Accept-invite onboarding (ADR 0003) — set username + password from magic link. */
function showInvite({ proxy, invite } = {}) {
  pendingInviteSecret = invite || pendingInviteSecret;
  if (els.setupScreen) els.setupScreen.hidden = true;
  if (els.inviteScreen) els.inviteScreen.hidden = false;
  els.dashScreen.hidden = true;
  currentActor = null;
  hideAdminInviteSection();

  if (els.inviteProxyUrl) {
    const fromSetup = els.setupUrl?.value?.trim();
    const stored = loadConn()?.url;
    els.inviteProxyUrl.value =
      (proxy && String(proxy).replace(/\/+$/, "")) ||
      stored ||
      fromSetup ||
      els.inviteProxyUrl.value;
  }
  if (els.invitePass) els.invitePass.value = "";
  if (els.invitePassConfirm) els.invitePassConfirm.value = "";
  if (els.inviteAcceptError) {
    els.inviteAcceptError.hidden = true;
    els.inviteAcceptError.textContent = "";
  }
  if (els.inviteAcceptBtn) {
    els.inviteAcceptBtn.disabled = false;
    els.inviteAcceptBtn.textContent = t("inviteAccept");
  }
}

function showDash() {
  els.setupScreen.hidden = true;
  if (els.inviteScreen) els.inviteScreen.hidden = true;
  els.dashScreen.hidden = false;
}

/** Drop invite secret from the address bar after accept or when returning to sign-in. */
function clearInviteFromUrl() {
  try {
    const u = new URL(location.href);
    if (!u.searchParams.has("invite") && !u.searchParams.has("proxy")) return;
    u.searchParams.delete("invite");
    // Keep proxy in the URL only when still useful for bookmarks; after login
    // the conn is in localStorage, so strip both to avoid leaving secrets.
    u.searchParams.delete("proxy");
    const qs = u.searchParams.toString();
    history.replaceState(null, "", u.pathname + (qs ? `?${qs}` : "") + u.hash);
  } catch {
    /* ignore */
  }
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
      applyGridInputLabels(sys.id);
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
  applyGridInputLabels(d.systemId || activeSystemId);

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
  const socLow = isSocBelowWarnThreshold(soc, getSocWarnThreshold());
  if (els.batCard) els.batCard.classList.toggle("soc-low", socLow);
  if (els.batLowBadge) {
    els.batLowBadge.hidden = !socLow;
    if (socLow) els.batLowBadge.title = t("socLowWarningTitle", { threshold: getSocWarnThreshold() });
  }
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

  if (d.systemId) {
    const now = Date.now();
    const genState = updateGeneratorRuntime(loadGeneratorRuntimeState(d.systemId), genOn, now);
    saveGeneratorRuntimeState(d.systemId, genState);
    renderGeneratorRuntime(totalGeneratorRuntimeSec(genState, now));
  }

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
  for (const btn of [els.themeBtn, els.setupThemeBtn, els.inviteThemeBtn]) {
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
      if (isUnauthorizedError(err)) return;
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
    if (isUnauthorizedError(err)) return;
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
    // Stop the loop after logout or session expiry cleared the bearer.
    if (!loadConn() || els.dashScreen.hidden) return;
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
    if (!loadConn() || els.dashScreen.hidden) return;
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
  applyGridInputLabels(activeSystemId);
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
    gridInputLabel: $("add-grid-input-label").value,
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

function renderGridInputLabelForm(sys) {
  const label = normalizeGridInputLabel(sys.gridInputLabel);
  const form = document.createElement("div");
  form.className = "manage-alerts manage-grid-input-label";
  form.innerHTML = `
    <p class="manage-section-title">${escapeAttr(t("gridInputLabelTitle"))}</p>
    <p class="manage-hint">${escapeAttr(t("gridInputLabelHint"))}</p>
    <select class="grid-input-label" aria-label="${escapeAttr(t("gridInputLabelTitle"))}">
      <option value="generator">${escapeAttr(t("gridInputLabelGenerator"))}</option>
      <option value="grid">${escapeAttr(t("gridInputLabelGrid"))}</option>
    </select>
    <button type="button" class="grid-input-label-save">${escapeAttr(t("gridInputLabelSave"))}</button>
    <p class="grid-input-label-msg" hidden></p>
  `;

  const select = form.querySelector(".grid-input-label");
  select.value = label;

  const msg = form.querySelector(".grid-input-label-msg");
  form.querySelector(".grid-input-label-save").addEventListener("click", async () => {
    msg.hidden = true;
    const btn = form.querySelector(".grid-input-label-save");
    btn.disabled = true;
    btn.textContent = t("gridInputLabelSaving");
    try {
      const result = await api("PUT", `/api/systems/${sys.id}/grid-input-label`, {
        gridInputLabel: select.value,
      });
      sys.gridInputLabel = result.gridInputLabel;
      if (sys.id === activeSystemId) {
        applyGridInputLabels(sys.id);
        if (lastRenderData) renderData(lastRenderData);
      }
      if (currentView === "compare" && lastCompareData) {
        renderComparison(lastCompareData);
      }
      msg.textContent = t("gridInputLabelSaved");
      msg.className = "grid-input-label-msg alert-ok";
      msg.hidden = false;
    } catch (err) {
      msg.textContent = err.message;
      msg.className = "grid-input-label-msg alert-err";
      msg.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = t("gridInputLabelSave");
    }
  });

  return form;
}

function hideAdminInviteSection() {
  if (els.adminCreateUserSection) els.adminCreateUserSection.hidden = true;
  if (els.adminUsersListSection) els.adminUsersListSection.hidden = true;
  if (els.adminCreateUserSection) els.adminCreateUserSection.hidden = true;
  if (els.adminInviteSection) els.adminInviteSection.hidden = true;
  if (els.adminInvitesListSection) els.adminInvitesListSection.hidden = true;
  clearInviteResult();
  clearCreateUserForm();
  clearUsersList();
  clearInvitesList();
}

function clearCreateUserMsg() {
  if (!els.createUserMsg) return;
  els.createUserMsg.hidden = true;
  els.createUserMsg.textContent = "";
  els.createUserMsg.className = "cred-msg";
}

/** Cached last-minted invite (ADR 0003) — kept so locale toggle can re-label expires/copy UI. */
let lastInviteMinted = null;

function clearInviteResult() {
  lastInviteMinted = null;
  if (els.inviteResult) els.inviteResult.hidden = true;
  if (els.inviteUrl) els.inviteUrl.value = "";
  if (els.inviteExpires) {
    els.inviteExpires.hidden = true;
    els.inviteExpires.textContent = "";
  }
  if (els.inviteCopyBtn) els.inviteCopyBtn.textContent = t("adminInviteCopy");
  if (els.inviteMintMsg) {
    els.inviteMintMsg.hidden = true;
    els.inviteMintMsg.textContent = "";
    els.inviteMintMsg.className = "cred-msg";
  }
}

function syncAdminInviteSection() {
  const show = isAdminActor();
  if (els.adminCreateUserSection) els.adminCreateUserSection.hidden = !show;
  if (els.adminUsersListSection) els.adminUsersListSection.hidden = !show;
  if (els.adminInviteSection) els.adminInviteSection.hidden = !show;
  if (els.adminInvitesListSection) els.adminInvitesListSection.hidden = !show;
  if (!show) {
    clearInviteResult();
    clearCreateUserForm();
    clearInvitesList();
    clearUsersList();
    return;
  }
  loadUsersList();
  loadInvitesList();
}

function setCreateUserMsg(text, kind) {
  if (!els.createUserMsg) return;
  if (!text) {
    els.createUserMsg.hidden = true;
    els.createUserMsg.textContent = "";
    els.createUserMsg.className = "cred-msg";
    return;
  }
  els.createUserMsg.textContent = text;
  els.createUserMsg.className = kind ? `cred-msg ${kind}` : "cred-msg";
  els.createUserMsg.hidden = false;
}

/** Reset create-user form fields and message (admin section hide / after success). */
function clearCreateUserForm({ keepMsg = false } = {}) {
  if (els.adminCreateUserForm) els.adminCreateUserForm.reset();
  if (els.createUserRole) els.createUserRole.value = "read";
  if (!keepMsg) setCreateUserMsg("");
}

async function createUserFromForm() {
  if (!isAdminActor()) return;

  const username = els.createUserUsername?.value?.trim() || "";
  const password = els.createUserPass?.value || "";
  const confirm = els.createUserPassConfirm?.value || "";
  const role = els.createUserRole?.value || "read";

  setCreateUserMsg("");

  if (password.length < 8) {
    setCreateUserMsg(t("adminCreateUserPasswordTooShort"), "cred-err");
    return;
  }
  if (password !== confirm) {
    setCreateUserMsg(t("adminCreateUserPasswordMismatch"), "cred-err");
    return;
  }

  const btn = els.createUserBtn;
  if (btn) {
    btn.disabled = true;
    btn.textContent = t("adminCreateUserCreating");
  }

  try {
    await api("POST", "/api/admin/users", { username, password, role });
    clearCreateUserForm({ keepMsg: true });
    setCreateUserMsg(t("adminCreateUserCreated"), "cred-ok");
    await loadUsersList();
  } catch (err) {
    const key = adminCreateUserErrorI18nKey(err.message);
    // Prefer mapped i18n when we recognize the Worker message; otherwise show raw.
    const mapped = t(key);
    const text =
      key !== "adminCreateUserFailed" || !err.message
        ? mapped
        : err.message;
    setCreateUserMsg(text, "cred-err");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = t("adminCreateUserSubmit");
    }
  }
}

/** Reset users list state/DOM (called when the admin section is hidden). */
function clearUsersList() {
  usersListState = [];
  if (els.usersList) els.usersList.innerHTML = "";
  if (els.usersListEmpty) els.usersListEmpty.hidden = true;
  setUsersListMsg("");
}

function setUsersListMsg(text, kind) {
  if (!els.usersListMsg) return;
  if (!text) {
    els.usersListMsg.hidden = true;
    els.usersListMsg.textContent = "";
    els.usersListMsg.className = "cred-msg";
    return;
  }
  els.usersListMsg.textContent = text;
  els.usersListMsg.className = kind ? `cred-msg ${kind}` : "cred-msg";
  els.usersListMsg.hidden = false;
}

function formatUserListDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(getLocale());
  } catch {
    return iso;
  }
}

/** Render `usersListState` — username, role, created, last login; disable + role change. */
function renderUsersList() {
  if (!els.usersList) return;
  els.usersList.innerHTML = "";
  const hasUsers = usersListState.length > 0;
  if (els.usersListEmpty) els.usersListEmpty.hidden = hasUsers;

  for (const user of usersListState) {
    const row = document.createElement("div");
    row.className = user.disabledAt ? "user-row is-disabled" : "user-row";
    row.dataset.userId = user.id;

    const info = document.createElement("div");
    info.className = "user-row-info";

    const topLine = document.createElement("div");
    topLine.className = "user-row-top";

    const name = document.createElement("span");
    name.className = "user-row-name";
    name.textContent = user.username || user.id;
    topLine.appendChild(name);

    const statusBadge = document.createElement("span");
    const disabled = Boolean(user.disabledAt);
    statusBadge.className = `user-status-badge ${disabled ? "user-status-disabled" : "user-status-active"}`;
    statusBadge.textContent = t(disabled ? "userStatusDisabled" : "userStatusActive");
    topLine.appendChild(statusBadge);

    info.appendChild(topLine);

    const metaLine = document.createElement("div");
    metaLine.className = "user-row-meta";
    const metaParts = [];
    if (user.createdAt) metaParts.push(t("userCreatedAt", { when: formatUserListDate(user.createdAt) }));
    if (user.lastLoginAt) {
      metaParts.push(t("userLastLoginAt", { when: formatUserListDate(user.lastLoginAt) }));
    } else {
      metaParts.push(t("userNeverLoggedIn"));
    }
    metaLine.textContent = metaParts.join(" · ");
    info.appendChild(metaLine);

    row.appendChild(info);

    const actions = document.createElement("div");
    actions.className = "user-row-actions";

    const roleSelect = document.createElement("select");
    roleSelect.className = "user-role-select";
    roleSelect.setAttribute("aria-label", t("userRoleAria", { username: user.username || user.id }));
    for (const role of ["read", "admin"]) {
      const opt = document.createElement("option");
      opt.value = role;
      opt.textContent = t(role === "admin" ? "roleAdmin" : "roleRead");
      if (user.role === role) opt.selected = true;
      roleSelect.appendChild(opt);
    }
    const lastAdmin = !canChangeUserRole(usersListState, user.id, "read");
    if (lastAdmin && user.role === "admin" && !disabled) {
      // Keep select usable for display, but block demotion to read.
      const readOpt = roleSelect.querySelector('option[value="read"]');
      if (readOpt) {
        readOpt.disabled = true;
        readOpt.title = t("userLastAdminDemote");
      }
    }
    roleSelect.addEventListener("change", () => changeUserRoleRow(user.id, roleSelect));
    actions.appendChild(roleSelect);

    if (disabled) {
      const enableBtn = document.createElement("button");
      enableBtn.type = "button";
      enableBtn.className = "user-action-btn user-enable-btn";
      enableBtn.textContent = t("userEnable");
      enableBtn.addEventListener("click", () => enableUserRow(user.id, enableBtn));
      actions.appendChild(enableBtn);
    } else {
      const disableBtn = document.createElement("button");
      disableBtn.type = "button";
      disableBtn.className = "user-action-btn user-disable-btn";
      disableBtn.textContent = t("userDisable");
      const canDisable = canDisableUser(usersListState, user.id);
      if (!canDisable) {
        disableBtn.disabled = true;
        disableBtn.title = t("userLastAdminDisable");
      } else {
        disableBtn.addEventListener("click", () => disableUserRow(user.id, user.username, disableBtn));
      }
      actions.appendChild(disableBtn);
    }

    row.appendChild(actions);
    els.usersList.appendChild(row);
  }
}

async function loadUsersList() {
  if (!els.usersList) return;
  setUsersListMsg("");
  try {
    usersListState = await api("GET", "/api/admin/users");
    if (!Array.isArray(usersListState)) usersListState = [];
  } catch (err) {
    usersListState = [];
    setUsersListMsg(err.message || t("adminUsersLoadFailed"), "cred-err");
  }
  renderUsersList();
}

async function changeUserRoleRow(id, selectEl) {
  const nextRole = selectEl?.value;
  if (!nextRole) return;
  if (!canChangeUserRole(usersListState, id, nextRole)) {
    setUsersListMsg(t("userLastAdminDemote"), "cred-err");
    renderUsersList();
    return;
  }
  if (selectEl) selectEl.disabled = true;
  try {
    await api("PATCH", `/api/admin/users/${id}`, { role: nextRole });
    await loadUsersList();
  } catch (err) {
    setUsersListMsg(err.message || t("userRoleChangeFailed"), "cred-err");
    renderUsersList();
  }
}

async function disableUserRow(id, username, btn) {
  if (!canDisableUser(usersListState, id)) {
    setUsersListMsg(t("userLastAdminDisable"), "cred-err");
    renderUsersList();
    return;
  }
  if (!confirm(t("userDisableConfirm", { username: username || id }))) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = t("userDisabling");
  }
  try {
    await api("DELETE", `/api/admin/users/${id}`);
    await loadUsersList();
  } catch (err) {
    setUsersListMsg(err.message || t("userDisableFailed"), "cred-err");
    if (btn) {
      btn.disabled = false;
      btn.textContent = t("userDisable");
    }
  }
}

async function enableUserRow(id, btn) {
  if (btn) {
    btn.disabled = true;
    btn.textContent = t("userEnabling");
  }
  try {
    await api("PATCH", `/api/admin/users/${id}`, { disabled: false });
    await loadUsersList();
  } catch (err) {
    setUsersListMsg(err.message || t("userEnableFailed"), "cred-err");
    if (btn) {
      btn.disabled = false;
      btn.textContent = t("userEnable");
    }
  }
}

/** Reset invites list state/DOM (called when the admin section is hidden). */
function clearInvitesList() {
  invitesListState = [];
  if (els.invitesList) els.invitesList.innerHTML = "";
  if (els.invitesListEmpty) els.invitesListEmpty.hidden = true;
  setInvitesListMsg("");
}

function setInvitesListMsg(text, kind) {
  if (!els.invitesListMsg) return;
  if (!text) {
    els.invitesListMsg.hidden = true;
    els.invitesListMsg.textContent = "";
    els.invitesListMsg.className = "cred-msg";
    return;
  }
  els.invitesListMsg.textContent = text;
  els.invitesListMsg.className = kind ? `cred-msg ${kind}` : "cred-msg";
  els.invitesListMsg.hidden = false;
}

/** Render `invitesListState` — emitted vs converted vs revoked/expired (ADR 0003). */
function renderInvitesList() {
  if (!els.invitesList) return;
  els.invitesList.innerHTML = "";
  const hasInvites = invitesListState.length > 0;
  if (els.invitesListEmpty) els.invitesListEmpty.hidden = hasInvites;
  if (els.invitesPurgeBtn) els.invitesPurgeBtn.disabled = !hasPurgeableInvites(invitesListState);

  for (const invite of invitesListState) {
    const row = document.createElement("div");
    row.className = "invite-row";

    const info = document.createElement("div");
    info.className = "invite-row-info";

    const topLine = document.createElement("div");
    topLine.className = "invite-row-top";

    const label = document.createElement("span");
    label.className = "invite-row-label";
    label.textContent = invite.label || t("inviteNoLabel");
    topLine.appendChild(label);

    const roleBadge = document.createElement("span");
    roleBadge.className = "invite-role-badge";
    roleBadge.textContent = t(invite.role === "admin" ? "roleAdmin" : "roleRead");
    topLine.appendChild(roleBadge);

    const statusBadge = document.createElement("span");
    statusBadge.className = `invite-status-badge ${inviteStatusBadgeClass(invite.status)}`;
    statusBadge.textContent = t(inviteStatusI18nKey(invite.status));
    topLine.appendChild(statusBadge);

    info.appendChild(topLine);

    const metaLine = document.createElement("div");
    metaLine.className = "invite-row-meta";
    const metaParts = [t("inviteCreatedAt", { when: formatInviteListDate(invite.createdAt) })];
    if (invite.status === "converted" && invite.convertedAt) {
      metaParts.push(t("inviteConvertedAt", { when: formatInviteListDate(invite.convertedAt) }));
    } else if (invite.expiresAt) {
      metaParts.push(t("inviteExpiresAt", { when: formatInviteListDate(invite.expiresAt) }));
    }
    metaLine.textContent = metaParts.join(" · ");
    info.appendChild(metaLine);

    row.appendChild(info);

    if (isInviteRevocable(invite.status)) {
      const revokeBtn = document.createElement("button");
      revokeBtn.type = "button";
      revokeBtn.className = "invite-revoke-btn";
      revokeBtn.textContent = t("inviteRevoke");
      revokeBtn.addEventListener("click", () => revokeInviteRow(invite.id, revokeBtn));
      row.appendChild(revokeBtn);
    }

    els.invitesList.appendChild(row);
  }
}

function formatInviteListDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(getLocale());
  } catch {
    return iso;
  }
}

async function loadInvitesList() {
  if (!els.invitesList) return;
  setInvitesListMsg("");
  try {
    invitesListState = await api("GET", "/api/admin/invites");
  } catch (err) {
    invitesListState = [];
    setInvitesListMsg(err.message || t("adminInvitesLoadFailed"), "cred-err");
  }
  renderInvitesList();
}

async function revokeInviteRow(id, btn) {
  if (!confirm(t("inviteRevokeConfirm"))) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = t("inviteRevoking");
  }
  try {
    await api("DELETE", `/api/admin/invites/${id}`);
    await loadInvitesList();
  } catch (err) {
    setInvitesListMsg(err.message || t("inviteRevokeFailed"), "cred-err");
    if (btn) {
      btn.disabled = false;
      btn.textContent = t("inviteRevoke");
    }
  }
}

async function purgeStaleInvites() {
  if (!hasPurgeableInvites(invitesListState)) {
    setInvitesListMsg(t("adminInvitesNonePurgeable"));
    return;
  }
  if (!confirm(t("adminInvitesPurgeConfirm"))) return;
  const btn = els.invitesPurgeBtn;
  if (btn) {
    btn.disabled = true;
    btn.textContent = t("adminInvitesPurging");
  }
  try {
    const result = await api("POST", "/api/admin/invites/purge");
    await loadInvitesList();
    setInvitesListMsg(t("adminInvitesPurged", { count: result?.purged ?? 0 }), "cred-ok");
  } catch (err) {
    setInvitesListMsg(err.message || t("adminInvitesPurgeFailed"), "cred-err");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = t("adminInvitesPurgeBtn");
    }
  }
}

function showInviteMinted(minted) {
  if (!els.inviteResult || !els.inviteUrl) return;
  lastInviteMinted = minted;
  els.inviteUrl.value = minted.url || "";
  els.inviteResult.hidden = false;
  if (els.inviteCopyBtn) els.inviteCopyBtn.textContent = t("adminInviteCopy");
  if (els.inviteExpires) {
    if (minted.expiresAt) {
      let when = minted.expiresAt;
      try {
        when = new Date(minted.expiresAt).toLocaleString(getLocale());
      } catch {
        /* keep ISO */
      }
      els.inviteExpires.textContent = t("adminInviteExpires", { when });
      els.inviteExpires.hidden = false;
    } else {
      els.inviteExpires.hidden = true;
      els.inviteExpires.textContent = "";
    }
  }
  if (els.inviteMintMsg) {
    els.inviteMintMsg.textContent = t("adminInviteCreated");
    els.inviteMintMsg.className = "cred-msg cred-ok";
    els.inviteMintMsg.hidden = false;
  }
}

async function copyInviteUrl() {
  const url = els.inviteUrl?.value;
  if (!url) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
    } else {
      els.inviteUrl.focus();
      els.inviteUrl.select();
      if (!document.execCommand("copy")) throw new Error("copy failed");
    }
    if (els.inviteCopyBtn) els.inviteCopyBtn.textContent = t("adminInviteCopied");
  } catch {
    els.inviteUrl?.focus();
    els.inviteUrl?.select();
    if (els.inviteMintMsg) {
      els.inviteMintMsg.textContent = t("adminInviteCopyFailed");
      els.inviteMintMsg.className = "cred-msg cred-err";
      els.inviteMintMsg.hidden = false;
    }
  }
}

async function openManageModal() {
  manageModal.hidden = false;
  syncPollIntervalSelect();
  syncSocWarnThresholdInput();
  updateThemeUi(getCurrentTheme());
  manageList.innerHTML = "";
  try {
    await refreshCurrentActor();
  } catch (err) {
    if (isUnauthorizedError(err)) return;
  }
  syncAdminInviteSection();

  if (!systems.length) {
    manageList.innerHTML = `<p class="manage-empty">${t("noSystems")}</p>`;
    return;
  }

  for (const sys of systems) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "manage-row";

    const info = document.createElement("div");
    info.className = "manage-info";
    const alertBadge = sys.alerts?.enabled
      ? `<span class="alert-badge">${escapeAttr(t("alertsOnBadge"))}</span>`
      : "";
    info.innerHTML = `<strong>${sys.name}</strong><span class="manage-service">${sys.service}${alertBadge}</span>`;

    const chevron = document.createElement("span");
    chevron.className = "manage-chevron";
    chevron.textContent = "›";
    chevron.setAttribute("aria-hidden", "true");

    row.appendChild(info);
    row.appendChild(chevron);
    row.addEventListener("click", () => openSystemDetail(sys.id));
    manageList.appendChild(row);
  }
}

let openDetailSysId = null;

function openSystemDetail(sysId) {
  const sys = systems.find((s) => s.id === sysId);
  if (!sys) return;

  openDetailSysId = sysId;
  manageModal.hidden = true;
  detailModal.hidden = false;
  detailTitle.textContent = sys.name;
  detailBody.innerHTML = "";
  detailBody.appendChild(renderCredentialForm(sys));
  detailBody.appendChild(renderGridInputLabelForm(sys));
  detailBody.appendChild(renderGridDetectForm(sys));
  detailBody.appendChild(renderAlertForm(sys));

  detailRemove.onclick = async () => {
    if (!confirm(t("removeConfirm", { name: sys.name }))) return;
    await api("DELETE", `/api/systems/${sys.id}`);
    clearGeneratorRuntimeState(sys.id);
    await loadSystems();
    openDetailSysId = null;
    detailModal.hidden = true;
    openManageModal();
    if (activeSystemId === sys.id && systems.length) {
      activeSystemId = systems[0].id;
      renderSystemTabs();
      startPolling();
    }
  };
}

function closeSystemDetail() {
  openDetailSysId = null;
  detailModal.hidden = true;
  openManageModal();
}

els.manageBtn.addEventListener("click", openManageModal);
$("manage-close").addEventListener("click", () => {
  manageModal.hidden = true;
  clearInviteResult();
});

if (els.invitesPurgeBtn) {
  els.invitesPurgeBtn.addEventListener("click", () => purgeStaleInvites());
}
$("manage-add").addEventListener("click", openAddModal);
detailBack.addEventListener("click", closeSystemDetail);

if (els.adminCreateUserForm) {
  els.adminCreateUserForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await createUserFromForm();
  });
}

if (els.adminInviteForm) {
  els.adminInviteForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isAdminActor()) return;

    clearInviteResult();
    const btn = els.inviteMintBtn;
    if (btn) {
      btn.disabled = true;
      btn.textContent = t("adminInviteCreating");
    }

    const body = {
      role: els.inviteRole?.value || "read",
      frontendUrl: inviteFrontendUrl(),
    };
    const label = els.inviteLabel?.value?.trim();
    if (label) body.label = label;
    const ttlRaw = els.inviteTtl?.value;
    if (ttlRaw) {
      const ttlMs = Number(ttlRaw);
      if (Number.isFinite(ttlMs) && ttlMs > 0) body.ttlMs = ttlMs;
    }

    try {
      const minted = await api("POST", "/api/admin/invites", body);
      showInviteMinted(minted);
      if (els.inviteLabel) els.inviteLabel.value = "";
      if (els.inviteTtl) els.inviteTtl.value = "";
      if (els.inviteRole) els.inviteRole.value = "read";
      await loadInvitesList();
    } catch (err) {
      if (els.inviteMintMsg) {
        els.inviteMintMsg.textContent = err.message || t("adminInviteFailed");
        els.inviteMintMsg.className = "cred-msg cred-err";
        els.inviteMintMsg.hidden = false;
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = t("adminInviteCreate");
      }
    }
  });
}

if (els.inviteCopyBtn) {
  els.inviteCopyBtn.addEventListener("click", () => copyInviteUrl());
}

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
  applyGridInputLabels(activeSystemId);
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
  if (!detailModal.hidden && openDetailSysId) openSystemDetail(openDetailSysId);
  else if (!manageModal.hidden) {
    // Re-render admin users/invites copy from cached state before reopening
    // (openManageModal refreshes systems list + reloads admin panels).
    if (lastInviteMinted) showInviteMinted(lastInviteMinted);
    else if (els.inviteCopyBtn) els.inviteCopyBtn.textContent = t("adminInviteCopy");
    renderUsersList();
    renderInvitesList();
    openManageModal();
  } else {
    if (els.inviteCopyBtn) els.inviteCopyBtn.textContent = t("adminInviteCopy");
  }
  if (els.inviteMintBtn && !els.inviteMintBtn.disabled) {
    els.inviteMintBtn.textContent = t("adminInviteCreate");
  }
  if (els.createUserBtn && !els.createUserBtn.disabled) {
    els.createUserBtn.textContent = t("adminCreateUserSubmit");
  }
  if (els.invitesPurgeBtn && !els.invitesPurgeBtn.disabled) {
    els.invitesPurgeBtn.textContent = t("adminInvitesPurgeBtn");
  }
  if (els.inviteAcceptBtn && !els.inviteAcceptBtn.disabled) {
    els.inviteAcceptBtn.textContent = t("inviteAccept");
  }
  if (els.setupBtn && !els.setupBtn.disabled) {
    els.setupBtn.textContent = t(setupMode === "token" ? "connect" : "signIn");
  }
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

const socWarnInput = $("soc-warn-threshold");

function syncSocWarnThresholdInput() {
  if (socWarnInput) socWarnInput.value = getSocWarnThreshold();
}

if (socWarnInput) {
  syncSocWarnThresholdInput();
  socWarnInput.addEventListener("change", () => {
    saveSocWarnThreshold(socWarnInput.value);
    syncSocWarnThresholdInput();
    if (lastRenderData) renderData(lastRenderData);
  });
}

if (els.themeBtn) els.themeBtn.addEventListener("click", cycleTheme);
if (els.setupThemeBtn) els.setupThemeBtn.addEventListener("click", cycleTheme);
if (els.inviteThemeBtn) els.inviteThemeBtn.addEventListener("click", cycleTheme);
if (els.themeSelect) {
  els.themeSelect.addEventListener("change", () => applyTheme(els.themeSelect.value));
}

/* ── Setup: password login (preferred human path) or legacy access token ── */

/** "password" (default, preferred) or "token" (legacy — HA, bookmarks, migration). */
let setupMode = "password";

function setSetupMode(mode) {
  setupMode = mode === "token" ? "token" : "password";
  const isToken = setupMode === "token";

  if (els.setupModePassword) els.setupModePassword.classList.toggle("active", !isToken);
  if (els.setupModePassword) els.setupModePassword.setAttribute("aria-pressed", String(!isToken));
  if (els.setupModeToken) els.setupModeToken.classList.toggle("active", isToken);
  if (els.setupModeToken) els.setupModeToken.setAttribute("aria-pressed", String(isToken));

  if (els.setupPasswordFields) els.setupPasswordFields.hidden = isToken;
  if (els.setupTokenFields) els.setupTokenFields.hidden = !isToken;
  if (els.setupModeHint) els.setupModeHint.hidden = !isToken;

  if (els.setupUser) els.setupUser.required = !isToken;
  if (els.setupPass) els.setupPass.required = !isToken;
  if (els.setupToken) els.setupToken.required = isToken;

  if (els.setupBtn) els.setupBtn.textContent = t(isToken ? "connect" : "signIn");
  if (els.setupError) {
    els.setupError.hidden = true;
    els.setupError.textContent = "";
  }
}

if (els.setupModePassword) {
  els.setupModePassword.addEventListener("click", () => setSetupMode("password"));
}
if (els.setupModeToken) {
  els.setupModeToken.addEventListener("click", () => setSetupMode("token"));
}

async function finishLogin(url, token) {
  saveConn({ url, token });
  if (els.setupPass) els.setupPass.value = "";
  if (els.setupToken) els.setupToken.value = "";
  await refreshCurrentActor();
  await loadSystems();
  showDash();
  setView(localStorage.getItem(VIEW_KEY) || "cards");

  if (!systems.length) {
    openAddModal();
  } else {
    startPolling();
  }
}

async function loginWithPassword(url) {
  const username = els.setupUser.value.trim();
  const password = els.setupPass.value;

  let resp;
  try {
    resp = await fetch(`${url}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new Error(t("loginFailed"));
  }

  let json = null;
  try {
    json = await resp.json();
  } catch {
    /* non-JSON body */
  }

  if (!resp.ok) {
    if (resp.status === 401) throw new Error(t("loginInvalidCredentials"));
    if (resp.status === 429) throw new Error(t("loginRateLimited"));
    throw new Error((json && json.error) || t("loginFailed"));
  }

  const token = json && json.token;
  if (!token) throw new Error(t("loginFailed"));

  currentActor = {
    role: json.role || null,
    username: json.username || null,
    userId: json.userId || null,
    tokenId: json.tokenId || null,
    actorId: json.userId || json.tokenId || null,
  };
  await finishLogin(url, token);
}

/** Legacy path: paste a bearer token directly (HA, bookmarks, pre-ADR-0003 migration). */
async function loginWithToken(url) {
  const token = els.setupToken.value.trim();

  let resp;
  try {
    resp = await fetch(`${url}/api/systems`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
  } catch {
    throw new Error(t("invalidTokenOrUrl"));
  }
  if (!resp.ok) throw new Error(t("invalidTokenOrUrl"));
  await resp.json();

  currentActor = null;
  await finishLogin(url, token);
}

els.setupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.setupError.hidden = true;
  els.setupBtn.disabled = true;
  els.setupBtn.textContent = t(setupMode === "token" ? "connecting" : "signingIn");

  const url = els.setupUrl.value.trim().replace(/\/+$/, "");

  try {
    if (setupMode === "token") {
      await loginWithToken(url);
    } else {
      await loginWithPassword(url);
    }
  } catch (err) {
    els.setupError.textContent = err.message;
    els.setupError.hidden = false;
  } finally {
    els.setupBtn.disabled = false;
    els.setupBtn.textContent = t(setupMode === "token" ? "connect" : "signIn");
  }
});

/* ── Accept invite (ADR 0003): ?proxy=…&invite=<secret> → create user + session ── */

async function acceptInvite(url) {
  const username = els.inviteUser?.value?.trim() || "";
  const password = els.invitePass?.value || "";
  const confirm = els.invitePassConfirm?.value || "";
  const invite = pendingInviteSecret;

  if (!invite) throw new Error(t("inviteAcceptInvalid"));
  if (password.length < 8) throw new Error(t("inviteAcceptPasswordTooShort"));
  if (password !== confirm) throw new Error(t("inviteAcceptPasswordMismatch"));

  let resp;
  try {
    resp = await fetch(`${url}/api/auth/invite/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invite, username, password }),
    });
  } catch {
    throw new Error(t("inviteAcceptFailed"));
  }

  let json = null;
  try {
    json = await resp.json();
  } catch {
    /* non-JSON body */
  }

  if (!resp.ok) {
    const key = inviteAcceptErrorI18nKey(resp.status, json && json.error);
    throw new Error(t(key));
  }

  const token = json && json.token;
  if (!token) throw new Error(t("inviteAcceptFailed"));

  pendingInviteSecret = null;
  if (els.invitePass) els.invitePass.value = "";
  if (els.invitePassConfirm) els.invitePassConfirm.value = "";
  clearInviteFromUrl();

  currentActor = {
    role: json.role || null,
    username: json.username || null,
    userId: json.userId || null,
    tokenId: json.tokenId || null,
    actorId: json.userId || json.tokenId || null,
  };
  await finishLogin(url, token);
}

if (els.inviteForm) {
  els.inviteForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (els.inviteAcceptError) {
      els.inviteAcceptError.hidden = true;
      els.inviteAcceptError.textContent = "";
    }
    if (els.inviteAcceptBtn) {
      els.inviteAcceptBtn.disabled = true;
      els.inviteAcceptBtn.textContent = t("inviteAccepting");
    }

    const url = (els.inviteProxyUrl?.value || "").trim().replace(/\/+$/, "");

    try {
      await acceptInvite(url);
    } catch (err) {
      if (els.inviteAcceptError) {
        els.inviteAcceptError.textContent = err.message;
        els.inviteAcceptError.hidden = false;
      }
    } finally {
      if (els.inviteAcceptBtn) {
        els.inviteAcceptBtn.disabled = false;
        els.inviteAcceptBtn.textContent = t("inviteAccept");
      }
    }
  });
}

if (els.inviteBackBtn) {
  els.inviteBackBtn.addEventListener("click", () => {
    pendingInviteSecret = null;
    clearInviteFromUrl();
    if (els.inviteProxyUrl?.value && els.setupUrl) {
      els.setupUrl.value = els.inviteProxyUrl.value.trim().replace(/\/+$/, "");
    }
    setSetupMode("password");
    showSetup();
  });
}

els.disconnectBtn.addEventListener("click", () => {
  logout();
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
setSetupMode("password");
// Systems aren't loaded yet, so a stored "compare" view would be wrongly
// downgraded here; paint optimistically without persisting that downgrade.
setView(localStorage.getItem(VIEW_KEY) || "cards", { persist: false });

(async function boot() {
  const params = new URLSearchParams(location.search);
  const urlProxy = params.get("proxy");
  const urlToken = params.get("token");
  const urlInvite = params.get("invite")?.trim();

  // Magic-link invite takes precedence over stored sessions / ?token= (onboarding).
  if (urlInvite) {
    showInvite({
      proxy: urlProxy || null,
      invite: urlInvite,
    });
    return;
  }

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
    await refreshCurrentActor();
    await loadSystems();
    showDash();
    setView(localStorage.getItem(VIEW_KEY) || "cards");
    if (systems.length) {
      startPolling();
    } else {
      openAddModal();
    }
  } catch (err) {
    setView("cards");
    // 401 already triggered forceReLogin() inside api() with a re-login prompt.
    if (isUnauthorizedError(err)) return;
    showSetup();
  }
})();
