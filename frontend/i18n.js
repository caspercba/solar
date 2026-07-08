/** Simple en/es string map — no build step; import as ESM. */

export const LANG_KEY = "solar_lang";
export const DEFAULT_LOCALE = "en";
export const SUPPORTED_LOCALES = ["en", "es"];

const messages = {
  en: {
    appTitle: "Solar Dashboard",
    setupSubtitle: "Connect to your proxy",
    proxyUrl: "Proxy URL",
    accessToken: "Access Token",
    connect: "Connect",
    connecting: "Connecting…",
    invalidTokenOrUrl: "Invalid token or proxy URL",
    language: "Language",
    langEn: "English",
    langEs: "Español",

    statusConnected: "Connected",
    statusDisconnected: "Disconnected",
    manageSystems: "Manage systems",
    disconnect: "Disconnect",

    tabCards: "Cards",
    tabFlow: "Flow",
    tabChart: "Chart",
    tabCompare: "Compare",

    cardBattery: "Battery",
    cardSolar: "Solar",
    cardLoad: "Load",
    cardGenerator: "Generator",

    batIdle: "Idle",
    batCharging: "Charging",
    batDischarging: "Discharging",
    batRateSlow: "Slow",
    batRateMid: "Mid",
    batRateFast: "Fast",
    genOn: "ON",
    genOff: "OFF",

    lastUpdate: "Last update: {time}",
    energyToday: "Today: {kwh} kWh",

    flowSolar: "SOLAR",
    flowGen: "GEN",
    flowHouse: "HOUSE",
    flowBattery: "BATTERY",

    chartPrevDay: "Previous day",
    chartNextDay: "Next day",
    chartSelectDay: "Select day",
    chartDate: "Date",
    chartExportCsv: "Export CSV",
    chartEmpty: "No power data for this date",
    chartEmptyDetail: "No power data for this date. The inverter may not have reported readings yet.",
    chartLoadError: "Could not load power history.",
    chartLoading: "Loading chart…",
    legendSolarW: "Solar (W)",
    legendLoadW: "Load (W)",
    legendBatteryW: "Battery (W)",
    legendSocPct: "SOC (%)",
    socEstimated: "Estimated",
    socEstimatedTitle: "SOC estimated from battery voltage",
    energySummaryTitle: "7-Day Energy",
    energyEmpty: "No energy data for the last 7 days",
    energyEmptyDetail: "No energy data for the last 7 days from the inverter.",
    energyLoadError: "Could not load energy summary.",
    energyLoading: "Loading summary…",
    legendSolarKwh: "Solar kWh",
    legendLoadKwh: "Load kWh",
    legendSocRange: "SOC min–max",

    retry: "Retry",
    retrying: "Retrying…",
    pollLoadError: "Could not load system data.",

    addSystem: "Add System",
    addService: "Service",
    selectService: "Select service…",
    addNameOptional: "Name (optional)",
    addNamePlaceholder: "e.g. My Home Solar",
    username: "Username",
    password: "Password",
    plant: "Plant",
    cancel: "Cancel",
    adding: "Adding…",

    systems: "Systems",
    refreshInterval: "Refresh interval",
    refreshIntervalAria: "Data refresh interval",
    theme: "Theme",
    themeAria: "Color theme",
    themeDark: "Dark",
    themeLight: "Light",
    themeHighContrast: "High contrast",
    noSystems: "No systems configured.",
    remove: "Remove",
    removeConfirm: 'Remove "{name}"?',
    addSystemBtn: "+ Add System",
    close: "Close",

    alertsEnable: "Enable alerts",
    alertsWebhook: "Webhook URL",
    alertsWebhookPlaceholder: "https://discord.com/api/webhooks/…",
    alertsLowSoc: "Low SOC %",
    alertsCooldown: "Cooldown (min)",
    alertsLowBattery: "Low battery",
    alertsGeneratorOn: "Generator on",
    alertsSave: "Save alerts",
    alertsSaving: "Saving…",
    alertsSaved: "Alerts saved",
    alertsOnBadge: "Alerts on",

    credPortalTitle: "Portal credentials",
    credNewPasswordPlaceholder: "New password",
    credSave: "Save credentials",
    credSaving: "Saving…",
    credRequired: "Username and password are required",
    credSelectPlant: "Select a plant and save again",
    credUpdated: "Credentials updated",

    pollIntervalSeconds: "{sec} seconds",
    pollIntervalMinutes: "{mins} minutes",

    notConnected: "Not connected",

    timeToEmptyLessThanMinute: "<1m",
    timeToEmptyMinutes: "{m}m",
    timeToEmptyHours: "{h}h",
    timeToEmptyHoursMinutes: "{h}h {m}m",
    timeToEmptyLabel: "~{duration} left",
  },
  es: {
    appTitle: "Panel Solar",
    setupSubtitle: "Conéctate a tu proxy",
    proxyUrl: "URL del proxy",
    accessToken: "Token de acceso",
    connect: "Conectar",
    connecting: "Conectando…",
    invalidTokenOrUrl: "Token o URL del proxy no válidos",
    language: "Idioma",
    langEn: "English",
    langEs: "Español",

    statusConnected: "Conectado",
    statusDisconnected: "Desconectado",
    manageSystems: "Administrar sistemas",
    disconnect: "Desconectar",

    tabCards: "Tarjetas",
    tabFlow: "Flujo",
    tabChart: "Gráfico",
    tabCompare: "Comparar",

    cardBattery: "Batería",
    cardSolar: "Solar",
    cardLoad: "Carga",
    cardGenerator: "Generador",

    batIdle: "Inactiva",
    batCharging: "Cargando",
    batDischarging: "Descargando",
    batRateSlow: "Lenta",
    batRateMid: "Media",
    batRateFast: "Rápida",
    genOn: "ON",
    genOff: "OFF",

    lastUpdate: "Última actualización: {time}",
    energyToday: "Hoy: {kwh} kWh",

    flowSolar: "SOLAR",
    flowGen: "GEN",
    flowHouse: "CASA",
    flowBattery: "BATERÍA",

    chartPrevDay: "Día anterior",
    chartNextDay: "Día siguiente",
    chartSelectDay: "Seleccionar día",
    chartDate: "Fecha",
    chartExportCsv: "Exportar CSV",
    chartEmpty: "Sin datos de potencia para esta fecha",
    chartEmptyDetail: "Sin datos de potencia para esta fecha. Es posible que el inversor aún no haya reportado lecturas.",
    chartLoadError: "No se pudo cargar el historial de potencia.",
    chartLoading: "Cargando gráfico…",
    legendSolarW: "Solar (W)",
    legendLoadW: "Carga (W)",
    legendBatteryW: "Batería (W)",
    legendSocPct: "SOC (%)",
    socEstimated: "Estimado",
    socEstimatedTitle: "SOC estimado a partir del voltaje de la batería",
    energySummaryTitle: "Energía 7 días",
    energyEmpty: "Sin datos de energía de los últimos 7 días",
    energyEmptyDetail: "Sin datos de energía de los últimos 7 días del inversor.",
    energyLoadError: "No se pudo cargar el resumen de energía.",
    energyLoading: "Cargando resumen…",
    legendSolarKwh: "Solar kWh",
    legendLoadKwh: "Carga kWh",
    legendSocRange: "SOC mín–máx",

    retry: "Reintentar",
    retrying: "Reintentando…",
    pollLoadError: "No se pudieron cargar los datos del sistema.",

    addSystem: "Agregar sistema",
    addService: "Servicio",
    selectService: "Seleccionar servicio…",
    addNameOptional: "Nombre (opcional)",
    addNamePlaceholder: "p. ej. Mi casa solar",
    username: "Usuario",
    password: "Contraseña",
    plant: "Planta",
    cancel: "Cancelar",
    adding: "Agregando…",

    systems: "Sistemas",
    refreshInterval: "Intervalo de actualización",
    refreshIntervalAria: "Intervalo de actualización de datos",
    theme: "Tema",
    themeAria: "Tema de color",
    themeDark: "Oscuro",
    themeLight: "Claro",
    themeHighContrast: "Alto contraste",
    noSystems: "No hay sistemas configurados.",
    remove: "Eliminar",
    removeConfirm: '¿Eliminar "{name}"?',
    addSystemBtn: "+ Agregar sistema",
    close: "Cerrar",

    alertsEnable: "Activar alertas",
    alertsWebhook: "URL del webhook",
    alertsWebhookPlaceholder: "https://discord.com/api/webhooks/…",
    alertsLowSoc: "SOC bajo %",
    alertsCooldown: "Enfriamiento (min)",
    alertsLowBattery: "Batería baja",
    alertsGeneratorOn: "Generador encendido",
    alertsSave: "Guardar alertas",
    alertsSaving: "Guardando…",
    alertsSaved: "Alertas guardadas",
    alertsOnBadge: "Alertas activas",

    credPortalTitle: "Credenciales del portal",
    credNewPasswordPlaceholder: "Nueva contraseña",
    credSave: "Guardar credenciales",
    credSaving: "Guardando…",
    credRequired: "El usuario y la contraseña son obligatorios",
    credSelectPlant: "Selecciona una planta y guarda de nuevo",
    credUpdated: "Credenciales actualizadas",

    pollIntervalSeconds: "{sec} segundos",
    pollIntervalMinutes: "{mins} minutos",

    notConnected: "Sin conexión",

    timeToEmptyLessThanMinute: "<1 min",
    timeToEmptyMinutes: "{m} min",
    timeToEmptyHours: "{h} h",
    timeToEmptyHoursMinutes: "{h} h {m} min",
    timeToEmptyLabel: "~{duration} restante",
  },
};

let currentLocale = DEFAULT_LOCALE;

/** Normalize stored locale to a supported code. */
export function normalizeLocale(value) {
  const code = String(value || "").toLowerCase().slice(0, 2);
  return SUPPORTED_LOCALES.includes(code) ? code : DEFAULT_LOCALE;
}

export function getLocale() {
  return currentLocale;
}

export function setLocale(locale) {
  currentLocale = normalizeLocale(locale);
  try {
    localStorage.setItem(LANG_KEY, currentLocale);
  } catch {
    /* ignore quota errors */
  }
  return currentLocale;
}

export function loadStoredLocale() {
  try {
    currentLocale = normalizeLocale(localStorage.getItem(LANG_KEY));
  } catch {
    currentLocale = DEFAULT_LOCALE;
  }
  return currentLocale;
}

/** Interpolate `{name}` placeholders in a template string. */
export function interpolate(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => {
    const val = vars[key];
    return val == null ? "" : String(val);
  });
}

/** Translate a key for the current locale; falls back to English then the key. */
export function t(key, vars) {
  const table = messages[currentLocale] || messages.en;
  const fallback = messages.en[key];
  const raw = table[key] ?? fallback ?? key;
  return vars ? interpolate(raw, vars) : raw;
}

/** Poll interval label localized via i18n keys. */
export function formatPollIntervalLabelI18n(sec) {
  const n = Number(sec);
  if (n < 60) return t("pollIntervalSeconds", { sec: n });
  if (n > 60 && n % 60 === 0) return t("pollIntervalMinutes", { mins: n / 60 });
  return t("pollIntervalSeconds", { sec: n });
}

/** Apply data-i18n* attributes under root (default: document). */
export function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  });
  document.documentElement.lang = currentLocale;
  document.title = t("appTitle");
}

/** Sync lang toggle buttons to the active locale. */
export function syncLangToggle(root = document) {
  root.querySelectorAll("[data-lang]").forEach((btn) => {
    const active = btn.dataset.lang === currentLocale;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
}
