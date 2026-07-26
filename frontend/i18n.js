/** Simple en/es string map — no build step; import as ESM. */

export const LANG_KEY = "solar_lang";
export const DEFAULT_LOCALE = "en";
export const SUPPORTED_LOCALES = ["en", "es"];

const messages = {
  en: {
    appTitle: "Solar Dashboard",
    setupSubtitle: "Sign in to your proxy",
    proxyUrl: "Proxy URL",
    accessToken: "Access Token",
    connect: "Connect",
    connecting: "Connecting…",
    signIn: "Sign in",
    signingIn: "Signing in…",
    signInWith: "Sign in with",
    setupModeHintToken: "Legacy path for Home Assistant and bookmarked links. Password login is recommended.",
    invalidTokenOrUrl: "Invalid token or proxy URL",
    loginInvalidCredentials: "Invalid username or password",
    loginRateLimited: "Too many login attempts. Try again later.",
    loginFailed: "Could not sign in. Check the proxy URL and try again.",
    inviteSubtitle: "Create your account",
    inviteHint: "Choose a username and password to join this dashboard. No email is sent.",
    invitePassword: "Password (min 8 characters)",
    invitePasswordConfirm: "Confirm password",
    inviteAccept: "Create account",
    inviteAccepting: "Creating account…",
    inviteBackToSignIn: "Already have an account? Sign in",
    inviteAcceptInvalid: "This invite link is invalid.",
    inviteAcceptRevoked: "This invite has been revoked.",
    inviteAcceptExpired: "This invite has expired.",
    inviteAcceptConsumed: "This invite has already been used.",
    inviteAcceptUsernameTaken: "That username is already taken.",
    inviteAcceptUsernameInvalid: "Username may only contain letters, numbers, dots, underscores, and hyphens.",
    inviteAcceptPasswordTooShort: "Password must be at least 8 characters.",
    inviteAcceptPasswordMismatch: "Passwords do not match.",
    inviteAcceptRateLimited: "Too many attempts. Try again later.",
    inviteAcceptFailed: "Could not accept invite. Check the proxy URL and try again.",
    language: "Language",
    langEn: "English",
    langEs: "Español",

    statusConnected: "Connected",
    statusDisconnected: "Disconnected",
    disconnect: "Log out",
    logout: "Log out",
    sessionExpired: "Your session ended or was revoked. Please sign in again.",

    tabCards: "Cards",
    tabFlow: "Flow",
    tabChart: "Chart",
    tabCompare: "Compare",

    cardBattery: "Battery",
    cardSolar: "Solar",
    cardLoad: "Load",
    cardGenerator: "Generator",
    cardGrid: "Grid",

    compareLowestSoc: "Lowest SOC",
    compareGeneratorOn: "Generator ON",
    compareGridOn: "Grid ON",
    compareUnavailable: "Unavailable",
    compareLoadError: "Could not load comparison data.",

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
    flowGrid: "GRID",
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
    productionTitle: "Daily Production",
    productionEmpty: "No production data for this date",
    productionTotal: "Total",
    legendSolarKwhHourly: "Solar kWh",
    todayProductionTitle: "Today’s production",
    todayProductionEmpty: "No production data for today",
    consumptionTitle: "Daily Consumption",
    consumptionEmpty: "No consumption data for this date",
    consumptionTotal: "Total",

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

    settingsTitle: "Settings",
    preferences: "Preferences",
    back: "Back",
    removeSystem: "Remove system",
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

    socWarnThreshold: "Low battery warning",
    socWarnThresholdAria: "Low battery warning threshold percent",
    socLowWarning: "Low",
    socLowWarningTitle: "Battery is below the low-battery warning threshold ({threshold}%)",

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

    gridDetectTitle: "Generator detection",
    gridDetectVoltage: "Min voltage (V)",
    gridDetectPower: "Min power (W)",
    gridDetectHint: "Grid/generator is active when voltage and power exceed these values.",
    gridDetectSave: "Save detection",
    gridDetectSaving: "Saving…",
    gridDetectSaved: "Detection settings saved",

    gridInputLabelTitle: "Grid input label",
    gridInputLabelHint: "Choose how the grid/generator source appears on cards and the flow diagram.",
    gridInputLabelGenerator: "Generator",
    gridInputLabelGrid: "Grid",
    gridInputLabelSave: "Save label",
    gridInputLabelSaving: "Saving…",
    gridInputLabelSaved: "Label saved",

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

    genRuntimeLabel: "Runtime",
    genRuntimeLessThanMinute: "<1m",
    genRuntimeMinutes: "{m}m",
    genRuntimeHours: "{h}h",
    genRuntimeHoursMinutes: "{h}h {m}m",
    genRuntimeSessionNote: "This session only, not synced across devices",

    adminUsersListTitle: "Users",
    adminUsersHint: "Manage password accounts. The last active admin cannot be disabled or demoted.",
    adminUsersEmpty: "No users yet.",
    adminUsersLoadFailed: "Could not load users",
    adminCreateUserTitle: "Create user",
    adminCreateUserHint: "Add a password account immediately (no invite). Share the credentials out-of-band.",
    adminCreateUserUsername: "Username",
    adminCreateUserPassword: "Password",
    adminCreateUserRole: "Role",
    adminCreateUserPasswordConfirm: "Confirm password",
    adminCreateUserSubmit: "Create user",
    adminCreateUserCreate: "Create user",
    adminCreateUserCreating: "Creating…",
    adminCreateUserCreated: "User created",
    adminCreateUserFailed: "Could not create user",
    adminCreateUserUsernameTaken: "Username already taken",
    adminCreateUserUsernameInvalid: "Username may only contain letters, numbers, dots, underscores, and hyphens",
    adminCreateUserPasswordTooShort: "Password must be at least 8 characters",
    adminCreateUserPasswordMismatch: "Passwords do not match",
    adminCreateUserInvalidRole: "Invalid role",
    userCreatedAt: "Created {when}",
    userLastLoginAt: "Last login {when}",
    userNeverLoggedIn: "Never logged in",
    userStatusActive: "Active",
    userStatusDisabled: "Disabled",
    userDisable: "Disable",
    userDisabling: "Disabling…",
    userDisableConfirm: "Disable {username}? They will no longer be able to sign in.",
    userDisableFailed: "Could not disable user",
    userEnable: "Enable",
    userEnabling: "Enabling…",
    userEnableFailed: "Could not enable user",
    userRoleChangeFailed: "Could not change role",
    userLastAdminDisable: "Cannot disable the last admin",
    userLastAdminDemote: "Cannot demote the last admin",
    userRoleAria: "Role for {username}",

    adminInviteTitle: "Invite user",
    adminInviteHint: "Create a magic link to send out-of-band. The app does not send email.",
    adminInviteRole: "Role",
    roleRead: "Read",
    roleAdmin: "Admin",
    adminInviteLabel: "Label (optional)",
    adminInviteLabelPlaceholder: "e.g. neighbor Ana",
    adminInviteTtl: "Expires in",
    adminInviteTtlDefault: "7 days (default)",
    adminInviteTtl1d: "1 day",
    adminInviteTtl3d: "3 days",
    adminInviteTtl7d: "7 days",
    adminInviteTtl14d: "14 days",
    adminInviteTtl30d: "30 days",
    adminInviteCreate: "Create magic link",
    adminInviteCreating: "Creating…",
    adminInviteOnceNote: "Copy now — this link is shown only once.",
    adminInviteCopy: "Copy",
    adminInviteCopied: "Copied",
    adminInviteCopyFailed: "Could not copy — select and copy manually",
    adminInviteUrlAria: "Magic link URL",
    adminInviteExpires: "Expires {when}",
    adminInviteCreated: "Magic link created",
    adminInviteFailed: "Could not create invite",

    adminInvitesListTitle: "Invites",
    adminInvitesPurgeBtn: "Purge stale",
    adminInvitesPurging: "Purging…",
    adminInvitesLoading: "Loading invites…",
    adminInvitesEmpty: "No invites yet.",
    adminInvitesLoadFailed: "Could not load invites",
    adminInvitesPurged: "Purged {count} stale invite(s)",
    adminInvitesPurgeFailed: "Could not purge invites",
    adminInvitesPurgeConfirm: "Remove all converted, revoked, and expired invites from the list?",
    adminInvitesNonePurgeable: "Nothing to purge — every invite is pending.",
    inviteStatusPending: "Pending",
    inviteStatusConverted: "Converted",
    inviteStatusRevoked: "Revoked",
    inviteStatusExpired: "Expired",
    inviteRevoke: "Revoke",
    inviteRevoking: "Revoking…",
    inviteRevokeConfirm: "Revoke this invite? The link will stop working.",
    inviteRevokeFailed: "Could not revoke invite",
    inviteCreatedAt: "Created {when}",
    inviteExpiresAt: "Expires {when}",
    inviteConvertedAt: "Accepted {when}",
    inviteNoLabel: "(no label)",
  },
  es: {
    appTitle: "Panel Solar",
    setupSubtitle: "Inicia sesión en tu proxy",
    proxyUrl: "URL del proxy",
    accessToken: "Token de acceso",
    connect: "Conectar",
    connecting: "Conectando…",
    signIn: "Iniciar sesión",
    signingIn: "Iniciando sesión…",
    signInWith: "Iniciar sesión con",
    setupModeHintToken: "Ruta heredada para Home Assistant y enlaces guardados. Se recomienda iniciar sesión con contraseña.",
    invalidTokenOrUrl: "Token o URL del proxy no válidos",
    loginInvalidCredentials: "Usuario o contraseña no válidos",
    loginRateLimited: "Demasiados intentos de inicio de sesión. Inténtalo más tarde.",
    loginFailed: "No se pudo iniciar sesión. Comprueba la URL del proxy e inténtalo de nuevo.",
    inviteSubtitle: "Crea tu cuenta",
    inviteHint: "Elige un usuario y una contraseña para unirte a este panel. No se envía correo.",
    invitePassword: "Contraseña (mín. 8 caracteres)",
    invitePasswordConfirm: "Confirmar contraseña",
    inviteAccept: "Crear cuenta",
    inviteAccepting: "Creando cuenta…",
    inviteBackToSignIn: "¿Ya tienes cuenta? Iniciar sesión",
    inviteAcceptInvalid: "Este enlace de invitación no es válido.",
    inviteAcceptRevoked: "Esta invitación ha sido revocada.",
    inviteAcceptExpired: "Esta invitación ha caducado.",
    inviteAcceptConsumed: "Esta invitación ya ha sido utilizada.",
    inviteAcceptUsernameTaken: "Ese nombre de usuario ya está en uso.",
    inviteAcceptUsernameInvalid: "El usuario solo puede contener letras, números, puntos, guiones bajos y guiones.",
    inviteAcceptPasswordTooShort: "La contraseña debe tener al menos 8 caracteres.",
    inviteAcceptPasswordMismatch: "Las contraseñas no coinciden.",
    inviteAcceptRateLimited: "Demasiados intentos. Inténtalo más tarde.",
    inviteAcceptFailed: "No se pudo aceptar la invitación. Comprueba la URL del proxy e inténtalo de nuevo.",
    language: "Idioma",
    langEn: "English",
    langEs: "Español",

    statusConnected: "Conectado",
    statusDisconnected: "Desconectado",
    disconnect: "Cerrar sesión",
    logout: "Cerrar sesión",
    sessionExpired: "Tu sesión terminó o fue revocada. Vuelve a iniciar sesión.",

    tabCards: "Tarjetas",
    tabFlow: "Flujo",
    tabChart: "Gráfico",
    tabCompare: "Comparar",

    cardBattery: "Batería",
    cardSolar: "Solar",
    cardLoad: "Carga",
    cardGenerator: "Generador",
    cardGrid: "Red",

    compareLowestSoc: "SOC más bajo",
    compareGeneratorOn: "Generador ENCENDIDO",
    compareGridOn: "Red ENCENDIDA",
    compareUnavailable: "No disponible",
    compareLoadError: "No se pudieron cargar los datos de comparación.",

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
    flowGrid: "RED",
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
    productionTitle: "Producción Diaria",
    productionEmpty: "Sin datos de producción para esta fecha",
    productionTotal: "Total",
    legendSolarKwhHourly: "Solar kWh",
    todayProductionTitle: "Producción de hoy",
    todayProductionEmpty: "Sin datos de producción para hoy",
    consumptionTitle: "Consumo Diario",
    consumptionEmpty: "Sin datos de consumo para esta fecha",
    consumptionTotal: "Total",

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

    settingsTitle: "Configuración",
    preferences: "Preferencias",
    back: "Atrás",
    removeSystem: "Eliminar sistema",
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

    socWarnThreshold: "Aviso de batería baja",
    socWarnThresholdAria: "Umbral de aviso de batería baja en porcentaje",
    socLowWarning: "Baja",
    socLowWarningTitle: "La batería está por debajo del umbral de aviso de batería baja ({threshold}%)",

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

    gridDetectTitle: "Detección de generador",
    gridDetectVoltage: "Voltaje mín. (V)",
    gridDetectPower: "Potencia mín. (W)",
    gridDetectHint: "Red/generador activo cuando voltaje y potencia superan estos valores.",
    gridDetectSave: "Guardar detección",
    gridDetectSaving: "Guardando…",
    gridDetectSaved: "Detección guardada",

    gridInputLabelTitle: "Etiqueta de entrada de red",
    gridInputLabelHint: "Elige cómo se muestra la fuente red/generador en tarjetas y el diagrama de flujo.",
    gridInputLabelGenerator: "Generador",
    gridInputLabelGrid: "Red",
    gridInputLabelSave: "Guardar etiqueta",
    gridInputLabelSaving: "Guardando…",
    gridInputLabelSaved: "Etiqueta guardada",

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

    genRuntimeLabel: "Tiempo de uso",
    genRuntimeLessThanMinute: "<1 min",
    genRuntimeMinutes: "{m} min",
    genRuntimeHours: "{h} h",
    genRuntimeHoursMinutes: "{h} h {m} min",
    genRuntimeSessionNote: "Solo esta sesión, no se sincroniza entre dispositivos",

    adminUsersListTitle: "Usuarios",
    adminUsersHint: "Gestiona cuentas con contraseña. El último admin activo no se puede desactivar ni degradar.",
    adminUsersEmpty: "Aún no hay usuarios.",
    adminUsersLoadFailed: "No se pudieron cargar los usuarios",
    adminCreateUserTitle: "Crear usuario",
    adminCreateUserHint: "Añade una cuenta con contraseña de inmediato (sin invitación). Comparte las credenciales por otro canal.",
    adminCreateUserUsername: "Usuario",
    adminCreateUserPassword: "Contraseña",
    adminCreateUserRole: "Rol",
    adminCreateUserPasswordConfirm: "Confirmar contraseña",
    adminCreateUserSubmit: "Crear usuario",
    adminCreateUserCreate: "Crear usuario",
    adminCreateUserCreating: "Creando…",
    adminCreateUserCreated: "Usuario creado",
    adminCreateUserFailed: "No se pudo crear el usuario",
    adminCreateUserUsernameTaken: "El nombre de usuario ya está en uso",
    adminCreateUserUsernameInvalid: "El usuario solo puede contener letras, números, puntos, guiones bajos y guiones",
    adminCreateUserPasswordTooShort: "La contraseña debe tener al menos 8 caracteres",
    adminCreateUserPasswordMismatch: "Las contraseñas no coinciden",
    adminCreateUserInvalidRole: "Rol no válido",
    userCreatedAt: "Creado {when}",
    userLastLoginAt: "Último acceso {when}",
    userNeverLoggedIn: "Nunca inició sesión",
    userStatusActive: "Activo",
    userStatusDisabled: "Desactivado",
    userDisable: "Desactivar",
    userDisabling: "Desactivando…",
    userDisableConfirm: "¿Desactivar a {username}? Ya no podrá iniciar sesión.",
    userDisableFailed: "No se pudo desactivar el usuario",
    userEnable: "Activar",
    userEnabling: "Activando…",
    userEnableFailed: "No se pudo activar el usuario",
    userRoleChangeFailed: "No se pudo cambiar el rol",
    userLastAdminDisable: "No se puede desactivar al último admin",
    userLastAdminDemote: "No se puede degradar al último admin",
    userRoleAria: "Rol de {username}",

    adminInviteTitle: "Invitar usuario",
    adminInviteHint: "Crea un enlace mágico para enviar por otro canal. La app no envía correo.",
    adminInviteRole: "Rol",
    roleRead: "Lectura",
    roleAdmin: "Admin",
    adminInviteLabel: "Etiqueta (opcional)",
    adminInviteLabelPlaceholder: "p. ej. vecina Ana",
    adminInviteTtl: "Caduca en",
    adminInviteTtlDefault: "7 días (predeterminado)",
    adminInviteTtl1d: "1 día",
    adminInviteTtl3d: "3 días",
    adminInviteTtl7d: "7 días",
    adminInviteTtl14d: "14 días",
    adminInviteTtl30d: "30 días",
    adminInviteCreate: "Crear enlace mágico",
    adminInviteCreating: "Creando…",
    adminInviteOnceNote: "Copia ahora — este enlace se muestra solo una vez.",
    adminInviteCopy: "Copiar",
    adminInviteCopied: "Copiado",
    adminInviteCopyFailed: "No se pudo copiar — selecciónalo y cópialo manualmente",
    adminInviteUrlAria: "URL del enlace mágico",
    adminInviteExpires: "Caduca {when}",
    adminInviteCreated: "Enlace mágico creado",
    adminInviteFailed: "No se pudo crear la invitación",

    adminInvitesListTitle: "Invitaciones",
    adminInvitesPurgeBtn: "Purgar caducadas",
    adminInvitesPurging: "Purgando…",
    adminInvitesLoading: "Cargando invitaciones…",
    adminInvitesEmpty: "Aún no hay invitaciones.",
    adminInvitesLoadFailed: "No se pudieron cargar las invitaciones",
    adminInvitesPurged: "Se purgaron {count} invitación(es)",
    adminInvitesPurgeFailed: "No se pudieron purgar las invitaciones",
    adminInvitesPurgeConfirm: "¿Eliminar de la lista todas las invitaciones convertidas, revocadas y caducadas?",
    adminInvitesNonePurgeable: "Nada que purgar — todas las invitaciones están pendientes.",
    inviteStatusPending: "Pendiente",
    inviteStatusConverted: "Convertida",
    inviteStatusRevoked: "Revocada",
    inviteStatusExpired: "Caducada",
    inviteRevoke: "Revocar",
    inviteRevoking: "Revocando…",
    inviteRevokeConfirm: "¿Revocar esta invitación? El enlace dejará de funcionar.",
    inviteRevokeFailed: "No se pudo revocar la invitación",
    inviteCreatedAt: "Creada {when}",
    inviteExpiresAt: "Caduca {when}",
    inviteConvertedAt: "Aceptada {when}",
    inviteNoLabel: "(sin etiqueta)",
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
