import { describe, it, expect, beforeEach } from "vitest";
import {
  t,
  setLocale,
  loadStoredLocale,
  normalizeLocale,
  interpolate,
  formatPollIntervalLabelI18n,
  DEFAULT_LOCALE,
} from "../i18n.js";

describe("i18n", () => {
  beforeEach(() => {
    localStorage.clear();
    setLocale(DEFAULT_LOCALE);
  });

  it("defaults to English", () => {
    expect(t("signIn")).toBe("Sign in");
    expect(t("cardBattery")).toBe("Battery");
  });

  it("switches to Spanish", () => {
    setLocale("es");
    expect(t("signIn")).toBe("Iniciar sesión");
    expect(t("cardBattery")).toBe("Batería");
    expect(t("tabCards")).toBe("Tarjetas");
  });

  it("persists locale in localStorage", () => {
    setLocale("es");
    loadStoredLocale();
    expect(t("addSystem")).toBe("Agregar sistema");
  });

  it("interpolates placeholders", () => {
    expect(t("lastUpdate", { time: "14:30" })).toBe("Last update: 14:30");
    setLocale("es");
    expect(t("removeConfirm", { name: "Casa" })).toBe('¿Eliminar "Casa"?');
  });

  it("normalizes unknown locales to English", () => {
    expect(normalizeLocale("fr")).toBe("en");
    expect(normalizeLocale("ES")).toBe("es");
  });

  it("localizes poll interval labels", () => {
    expect(formatPollIntervalLabelI18n(30)).toBe("30 seconds");
    setLocale("es");
    expect(formatPollIntervalLabelI18n(120)).toBe("2 minutos");
  });

  it("interpolate helper handles missing vars", () => {
    expect(interpolate("Hello {name}", {})).toBe("Hello ");
  });

  it("translates theme keys in English", () => {
    expect(t("theme")).toBe("Theme");
    expect(t("themeAria")).toBe("Color theme");
    expect(t("themeDark")).toBe("Dark");
    expect(t("themeLight")).toBe("Light");
    expect(t("themeHighContrast")).toBe("High contrast");
  });

  it("translates theme keys in Spanish", () => {
    setLocale("es");
    expect(t("theme")).toBe("Tema");
    expect(t("themeAria")).toBe("Tema de color");
    expect(t("themeDark")).toBe("Oscuro");
    expect(t("themeLight")).toBe("Claro");
    expect(t("themeHighContrast")).toBe("Alto contraste");
  });

  it("translates compare view keys in English", () => {
    expect(t("compareLowestSoc")).toBe("Lowest SOC");
    expect(t("compareGeneratorOn")).toBe("Generator ON");
    expect(t("compareGridOn")).toBe("Grid ON");
    expect(t("cardGrid")).toBe("Grid");
    expect(t("flowGrid")).toBe("GRID");
    expect(t("compareUnavailable")).toBe("Unavailable");
    expect(t("compareLoadError")).toBe("Could not load comparison data.");
  });

  it("translates compare view keys in Spanish", () => {
    setLocale("es");
    expect(t("compareLowestSoc")).toBe("SOC más bajo");
    expect(t("compareGeneratorOn")).toBe("Generador ENCENDIDO");
    expect(t("compareGridOn")).toBe("Red ENCENDIDA");
    expect(t("cardGrid")).toBe("Red");
    expect(t("flowGrid")).toBe("RED");
    expect(t("compareUnavailable")).toBe("No disponible");
    expect(t("compareLoadError")).toBe("No se pudieron cargar los datos de comparación.");
  });

  it("translates password-login keys in English", () => {
    expect(t("setupSubtitle")).toBe("Sign in to your proxy");
    expect(t("signIn")).toBe("Sign in");
    expect(t("signingIn")).toBe("Signing in…");
    expect(t("loginInvalidCredentials")).toBe("Invalid username or password");
    expect(t("loginRateLimited")).toMatch(/Too many login attempts/);
    expect(t("loginFailed")).toMatch(/Could not sign in/);
    expect(t("logout")).toBe("Log out");
    expect(t("sessionExpired")).toMatch(/sign in again/i);
  });

  it("translates accept-invite keys in English", () => {
    expect(t("inviteSubtitle")).toBe("Create your account");
    expect(t("inviteAccept")).toBe("Create account");
    expect(t("inviteHint")).toMatch(/No email is sent/);
    expect(t("inviteAcceptInvalid")).toMatch(/invalid/i);
    expect(t("inviteAcceptRevoked")).toMatch(/revoked/i);
    expect(t("inviteAcceptExpired")).toMatch(/expired/i);
    expect(t("inviteAcceptConsumed")).toMatch(/already been used/i);
    expect(t("inviteAcceptPasswordMismatch")).toMatch(/do not match/i);
  });

  it("translates password-login keys in Spanish", () => {
    setLocale("es");
    expect(t("setupSubtitle")).toBe("Inicia sesión en tu proxy");
    expect(t("signIn")).toBe("Iniciar sesión");
    expect(t("signingIn")).toBe("Iniciando sesión…");
    expect(t("loginInvalidCredentials")).toBe("Usuario o contraseña no válidos");
    expect(t("loginRateLimited")).toMatch(/Demasiados intentos/);
    expect(t("loginFailed")).toMatch(/No se pudo iniciar sesión/);
    expect(t("logout")).toBe("Cerrar sesión");
    expect(t("sessionExpired")).toMatch(/vuelve a iniciar sesión/i);
  });

  it("translates accept-invite keys in Spanish", () => {
    setLocale("es");
    expect(t("inviteSubtitle")).toBe("Crea tu cuenta");
    expect(t("inviteAccept")).toBe("Crear cuenta");
    expect(t("inviteHint")).toMatch(/no se envía correo/i);
    expect(t("inviteAcceptInvalid")).toMatch(/no es válido/i);
    expect(t("inviteAcceptRevoked")).toMatch(/revocada/i);
    expect(t("inviteAcceptExpired")).toMatch(/caducado/i);
    expect(t("inviteAcceptConsumed")).toMatch(/ya ha sido utilizada/i);
  });

  it("translates admin invite-mint keys in English", () => {
    expect(t("adminInviteTitle")).toBe("Invite user");
    expect(t("adminInviteHint")).toMatch(/does not send email/);
    expect(t("adminInviteCreate")).toBe("Create magic link");
    expect(t("adminInviteOnceNote")).toMatch(/only once/);
    expect(t("adminInviteCopy")).toBe("Copy");
    expect(t("adminInviteExpires", { when: "tomorrow" })).toBe("Expires tomorrow");
    expect(t("roleRead")).toBe("Read");
    expect(t("roleAdmin")).toBe("Admin");
  });

  it("translates admin users-list keys in English", () => {
    expect(t("adminUsersListTitle")).toBe("Users");
    expect(t("adminUsersHint")).toMatch(/last active admin/);
    expect(t("userDisable")).toBe("Disable");
    expect(t("userEnable")).toBe("Enable");
    expect(t("userLastAdminDisable")).toMatch(/last admin/);
    expect(t("userLastAdminDemote")).toMatch(/last admin/);
    expect(t("userDisableConfirm", { username: "alice" })).toMatch(/alice/);
  });

  it("translates admin invite-mint keys in Spanish", () => {
    setLocale("es");
    expect(t("adminInviteTitle")).toBe("Invitar usuario");
    expect(t("adminInviteHint")).toMatch(/no envía correo/);
    expect(t("adminInviteCreate")).toBe("Crear enlace mágico");
    expect(t("adminInviteOnceNote")).toMatch(/solo una vez/);
    expect(t("adminInviteCopy")).toBe("Copiar");
    expect(t("adminInviteExpires", { when: "mañana" })).toBe("Caduca mañana");
    expect(t("roleRead")).toBe("Lectura");
  });

  it("translates admin users-list keys in Spanish", () => {
    setLocale("es");
    expect(t("adminUsersListTitle")).toBe("Usuarios");
    expect(t("adminUsersHint")).toMatch(/último admin/);
    expect(t("userDisable")).toBe("Desactivar");
    expect(t("userEnable")).toBe("Activar");
    expect(t("userLastAdminDisable")).toMatch(/último admin/);
    expect(t("userDisableConfirm", { username: "alice" })).toMatch(/alice/);
  });
});
