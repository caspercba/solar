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
    expect(t("connect")).toBe("Connect");
    expect(t("cardBattery")).toBe("Battery");
  });

  it("switches to Spanish", () => {
    setLocale("es");
    expect(t("connect")).toBe("Conectar");
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
});
