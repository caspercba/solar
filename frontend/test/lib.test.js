import { describe, it, expect, beforeEach } from "vitest";
import { t, setLocale, DEFAULT_LOCALE } from "../i18n.js";
import {
  fmtW,
  fmtChartDate,
  sanitizeExportName,
  csvCell,
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
  formatPollIntervalLabel,
  POLL_INTERVAL_OPTIONS_SEC,
  isEditableElement,
  matchesDashboardRefreshShortcut,
  DEFAULT_POLL_INTERVAL_SEC,
  impliedBatteryCapacityWh,
  formatTimeToEmpty,
  estimateBatteryTimeToEmpty,
  DEFAULT_BATTERY_AH,
  BAT_LOW_V,
  BAT_HIGH_V,
  formatWeatherStrip,
  findLowestSocIds,
  normalizeTheme,
  resolveInitialTheme,
  getNextTheme,
  VALID_THEMES,
  normalizeSocWarnThreshold,
  isSocBelowWarnThreshold,
  DEFAULT_SOC_WARN_THRESHOLD,
  MIN_SOC_WARN_THRESHOLD,
  MAX_SOC_WARN_THRESHOLD,
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
  INVITE_STATUSES,
  inviteStatusI18nKey,
  inviteStatusBadgeClass,
  isInviteRevocable,
  hasPurgeableInvites,
  countActiveAdmins,
  isLastActiveAdmin,
  canDisableUser,
  canChangeUserRole,
} from "../lib.js";

describe("fmtW", () => {
  it("formats sub-kilowatt values as rounded watts", () => {
    expect(fmtW(0)).toBe("0 W");
    expect(fmtW(999)).toBe("999 W");
    expect(fmtW(-450)).toBe("-450 W");
  });

  it("formats 1–9.999 kW with one decimal place", () => {
    expect(fmtW(1000)).toBe("1.0 kW");
    expect(fmtW(1500)).toBe("1.5 kW");
    expect(fmtW(9999)).toBe("10.0 kW");
    expect(fmtW(-2500)).toBe("-2.5 kW");
  });

  it("formats 10 kW and above as whole kilowatts", () => {
    expect(fmtW(10000)).toBe("10 kW");
    expect(fmtW(12345)).toBe("12 kW");
    expect(fmtW(-10500)).toBe("-11 kW");
  });
});

describe("fmtChartDate", () => {
  it("returns locale month/day for valid ISO date strings", () => {
    const label = fmtChartDate("2026-07-03");
    expect(label).toMatch(/7/);
    expect(label).toMatch(/3/);
  });

  it("falls back to substring from index 5 when date is invalid", () => {
    expect(fmtChartDate("not-a-date")).toBe("-date");
  });
});

describe("sanitizeExportName", () => {
  it("defaults empty or whitespace-only names to system", () => {
    expect(sanitizeExportName("")).toBe("system");
    expect(sanitizeExportName("   ")).toBe("system");
    expect(sanitizeExportName(null)).toBe("system");
  });

  it("replaces spaces with hyphens and strips unsafe characters", () => {
    expect(sanitizeExportName("My Home Solar!")).toBe("My-Home-Solar");
    expect(sanitizeExportName("  cabin #2  ")).toBe("cabin-2");
  });

  it("caps export names at 64 characters", () => {
    const long = "a".repeat(80);
    expect(sanitizeExportName(long)).toHaveLength(64);
  });

  it("returns system when stripping removes all characters", () => {
    expect(sanitizeExportName("!!!")).toBe("system");
  });
});

describe("csvCell", () => {
  it("returns empty string for null, undefined, or empty values", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell("")).toBe("");
  });

  it("returns plain text when no special characters are present", () => {
    expect(csvCell(1200)).toBe("1200");
    expect(csvCell("06:00")).toBe("06:00");
  });

  it("RFC-style quotes values containing comma, quote, or newline", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
  });
});

describe("historyToCsv", () => {
  it("emits header and CRLF-separated rows with numeric defaults", () => {
    const csv = historyToCsv([
      { time: "06:00", solar: 100, load: 50, battery: -25 },
    ]);
    expect(csv).toBe(
      "time,solar_w,load_w,battery_w,soc\r\n06:00,100,50,-25,",
    );
  });

  it("leaves soc column empty when soc is not finite", () => {
    const csv = historyToCsv([
      { time: "12:00", solar: 0, load: 0, battery: 0, soc: NaN },
      { time: "13:00", solar: 0, load: 0, battery: 0 },
    ]);
    expect(csv).toContain("12:00,0,0,0,\r\n");
    expect(csv.endsWith("13:00,0,0,0,")).toBe(true);
  });

  it("includes finite soc values in the export", () => {
    const csv = historyToCsv([
      { time: "18:00", solar: 0, load: 100, battery: 40, soc: 72 },
    ]);
    expect(csv).toContain("18:00,0,100,40,72");
  });
});

describe("escapeAttr", () => {
  it("escapes ampersand, double quote, and less-than for HTML attributes", () => {
    expect(escapeAttr('a & b "c" <d>')).toBe("a &amp; b &quot;c&quot; &lt;d>");
  });

  it("coerces non-string values to strings", () => {
    expect(escapeAttr(42)).toBe("42");
  });
});

describe("clampPct", () => {
  it("clamps values below 0 to 0 and above 100 to 100", () => {
    expect(clampPct(-10)).toBe(0);
    expect(clampPct(150)).toBe(100);
  });

  it("passes through values within 0–100", () => {
    expect(clampPct(0)).toBe(0);
    expect(clampPct(72)).toBe(72);
    expect(clampPct(100)).toBe(100);
  });
});

describe("solarPctFromPower", () => {
  it("computes rounded solar bar percentage from power and nominal PV", () => {
    expect(solarPctFromPower(1200, 5000)).toBe(24);
    expect(solarPctFromPower(2500, 5000)).toBe(50);
  });

  it("treats null or undefined power as zero", () => {
    expect(solarPctFromPower(null, 5000)).toBe(0);
    expect(solarPctFromPower(undefined, 4000)).toBe(0);
  });

  it("uses default nominal PV of 5000 W when omitted", () => {
    expect(solarPctFromPower(1000)).toBe(20);
  });
});

describe("loadPercent", () => {
  it("prefers load.percent when provided by the adapter", () => {
    expect(loadPercent({ power: 999, percent: 24 }, 5000)).toBe(24);
  });

  it("derives percentage from load power and rated power when percent is absent", () => {
    expect(loadPercent({ power: 850 }, 5000)).toBe(17);
  });

  it("treats missing load as zero percent", () => {
    expect(loadPercent(null, 5000)).toBe(0);
    expect(loadPercent(undefined, 5000)).toBe(0);
  });
});

describe("chart date navigation helpers", () => {
  it("addIsoDays shifts calendar dates without UTC drift", () => {
    expect(addIsoDays("2026-07-03", -1)).toBe("2026-07-02");
    expect(addIsoDays("2026-07-03", 1)).toBe("2026-07-04");
    expect(addIsoDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("buildWeekStripDates returns consecutive days ending on selected date", () => {
    expect(buildWeekStripDates("2026-07-03", 7)).toEqual([
      "2026-06-27",
      "2026-06-28",
      "2026-06-29",
      "2026-06-30",
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
    ]);
  });

  it("clampIsoDateToToday prevents future dates", () => {
    expect(clampIsoDateToToday("2026-12-31", "2026-07-06")).toBe("2026-07-06");
    expect(clampIsoDateToToday("2026-07-01", "2026-07-06")).toBe("2026-07-01");
  });

  it("isIsoDateAfter compares ISO strings lexicographically", () => {
    expect(isIsoDateAfter("2026-07-07", "2026-07-06")).toBe(true);
    expect(isIsoDateAfter("2026-07-06", "2026-07-06")).toBe(false);
  });

  it("fmtWeekStripWeekday and fmtWeekStripDay format strip labels", () => {
    expect(fmtWeekStripWeekday("2026-07-03")).toMatch(/fri/i);
    expect(fmtWeekStripDay("2026-07-03")).toBe("3");
  });
});

describe("shouldShowEstimatedSocBadge", () => {
  it("shows badge for estimated or mixed SOC sources", () => {
    expect(shouldShowEstimatedSocBadge({ socSource: "estimated" })).toBe(true);
    expect(shouldShowEstimatedSocBadge({ socSource: "mixed" })).toBe(true);
  });

  it("hides badge for API-sourced or missing SOC metadata", () => {
    expect(shouldShowEstimatedSocBadge({ socSource: "api" })).toBe(false);
    expect(shouldShowEstimatedSocBadge({ socSource: null })).toBe(false);
    expect(shouldShowEstimatedSocBadge(null)).toBe(false);
    expect(shouldShowEstimatedSocBadge(undefined)).toBe(false);
  });
});

describe("poll interval helpers", () => {
  it("normalizes supported interval values", () => {
    for (const sec of POLL_INTERVAL_OPTIONS_SEC) {
      expect(normalizePollIntervalSec(sec)).toBe(sec);
      expect(normalizePollIntervalSec(String(sec))).toBe(sec);
    }
  });

  it("falls back to default for invalid stored values", () => {
    expect(normalizePollIntervalSec(null)).toBe(DEFAULT_POLL_INTERVAL_SEC);
    expect(normalizePollIntervalSec("45")).toBe(DEFAULT_POLL_INTERVAL_SEC);
    expect(normalizePollIntervalSec("")).toBe(DEFAULT_POLL_INTERVAL_SEC);
  });

  it("converts seconds to milliseconds", () => {
    expect(pollIntervalSecToMs(30)).toBe(30_000);
    expect(pollIntervalSecToMs(60)).toBe(60_000);
    expect(pollIntervalSecToMs(120)).toBe(120_000);
  });

  it("formats interval labels for the settings selector", () => {
    expect(formatPollIntervalLabel(30)).toBe("30 seconds");
    expect(formatPollIntervalLabel(60)).toBe("60 seconds");
    expect(formatPollIntervalLabel(120)).toBe("2 minutes");
  });
});

describe("impliedBatteryCapacityWh", () => {
  it("uses nominal Ah when provided", () => {
    const nominalV = (BAT_LOW_V + BAT_HIGH_V) / 2;
    expect(impliedBatteryCapacityWh(48.2, 100)).toBeCloseTo(100 * nominalV);
  });

  it("defaults by voltage tier when nominal Ah is absent", () => {
    const nominalV = (BAT_LOW_V + BAT_HIGH_V) / 2;
    expect(impliedBatteryCapacityWh(48.2)).toBeCloseTo(DEFAULT_BATTERY_AH * nominalV);
    expect(impliedBatteryCapacityWh(24)).toBeCloseTo((DEFAULT_BATTERY_AH / 2) * nominalV);
    expect(impliedBatteryCapacityWh(12)).toBeCloseTo((DEFAULT_BATTERY_AH / 4) * nominalV);
  });
});

describe("formatTimeToEmpty", () => {
  beforeEach(() => {
    localStorage.clear();
    setLocale(DEFAULT_LOCALE);
  });

  it("formats sub-hour and multi-hour durations in English by default", () => {
    expect(formatTimeToEmpty(0.5)).toBe("30m");
    expect(formatTimeToEmpty(4 + 5 / 60)).toBe("4h 5m");
    expect(formatTimeToEmpty(2)).toBe("2h");
    expect(formatTimeToEmpty(0.005)).toBe("<1m");
  });

  it("returns empty string for invalid values", () => {
    expect(formatTimeToEmpty(0)).toBe("");
    expect(formatTimeToEmpty(-1)).toBe("");
    expect(formatTimeToEmpty(NaN)).toBe("");
  });

  it("localizes duration via the app's translate callback", () => {
    setLocale("es");
    expect(formatTimeToEmpty(0.5, t)).toBe("30 min");
    expect(formatTimeToEmpty(4 + 5 / 60, t)).toBe("4 h 5 min");
    expect(formatTimeToEmpty(2, t)).toBe("2 h");
    expect(formatTimeToEmpty(0.005, t)).toBe("<1 min");
  });
});

describe("estimateBatteryTimeToEmpty", () => {
  const dischargingBattery = {
    soc: 45,
    voltage: 48.2,
    current: 22,
    power: 1056,
  };
  const activeLoad = { power: 850 };
  const idleGrid = { active: false, power: 0 };

  beforeEach(() => {
    localStorage.clear();
    setLocale(DEFAULT_LOCALE);
  });

  it("returns a label when discharging with finite load and no grid", () => {
    const result = estimateBatteryTimeToEmpty(dischargingBattery, idleGrid, { load: activeLoad });
    expect(result).not.toBeNull();
    expect(result.hours).toBeGreaterThan(0);
    expect(result.label).toMatch(/^~\d/);
    expect(result.label).toContain("left");
  });

  it("returns a Spanish label when passed the app's translate callback", () => {
    setLocale("es");
    const result = estimateBatteryTimeToEmpty(dischargingBattery, idleGrid, { load: activeLoad, translate: t });
    expect(result).not.toBeNull();
    expect(result.label).toMatch(/^~\d/);
    expect(result.label).toContain("restante");
    expect(result.label).not.toContain("left");
  });

  it("hides when charging", () => {
    expect(
      estimateBatteryTimeToEmpty(
        { soc: 72, voltage: 48.2, current: -15, power: -723 },
        idleGrid,
        { load: activeLoad },
      ),
    ).toBeNull();
  });

  it("hides when grid is active", () => {
    expect(
      estimateBatteryTimeToEmpty(dischargingBattery, { active: true, power: 500 }, { load: activeLoad }),
    ).toBeNull();
  });

  it("hides when SOC is unavailable or zero", () => {
    expect(estimateBatteryTimeToEmpty({ ...dischargingBattery, soc: null }, idleGrid, { load: activeLoad })).toBeNull();
    expect(estimateBatteryTimeToEmpty({ ...dischargingBattery, soc: 0 }, idleGrid, { load: activeLoad })).toBeNull();
  });

  it("hides when load is missing or non-positive", () => {
    expect(estimateBatteryTimeToEmpty(dischargingBattery, idleGrid, { load: { power: 0 } })).toBeNull();
    expect(estimateBatteryTimeToEmpty(dischargingBattery, idleGrid, {})).toBeNull();
  });

  it("hides when battery is idle", () => {
    expect(
      estimateBatteryTimeToEmpty(
        { soc: 60, voltage: 48, current: 0, power: 0 },
        idleGrid,
        { load: activeLoad },
      ),
    ).toBeNull();
  });
});

describe("formatWeatherStrip", () => {
  it("returns null when weather is missing or empty", () => {
    expect(formatWeatherStrip(null)).toBeNull();
    expect(formatWeatherStrip({})).toBeNull();
    expect(formatWeatherStrip({ city: "Test" })).toBeNull();
  });

  it("formats temperature, condition, and irradiance", () => {
    expect(
      formatWeatherStrip({
        temperature: 11.4,
        condition: "Shower Rain",
        irradiance: 450,
      }),
    ).toBe("11°C · Shower Rain · 450 W/m²");
  });

  it("omits missing optional fields", () => {
    expect(formatWeatherStrip({ temperature: 22, condition: "Clear" })).toBe("22°C · Clear");
  });
});

describe("findLowestSocIds", () => {
  const home = { systemId: "home", battery: { soc: 72 } };
  const cabin = { systemId: "cabin", battery: { soc: 45 } };

  it("returns the system id with the lowest SOC", () => {
    expect(findLowestSocIds([home, cabin])).toEqual(["cabin"]);
  });

  it("includes all tied lowest systems", () => {
    const a = { systemId: "a", battery: { soc: 40 } };
    const b = { systemId: "b", battery: { soc: 40 } };
    expect(findLowestSocIds([home, a, b])).toEqual(["a", "b"]);
  });

  it("skips error entries and invalid SOC", () => {
    const bad = { systemId: "bad", error: "offline" };
    const noSoc = { systemId: "empty", battery: {} };
    expect(findLowestSocIds([bad, noSoc, cabin, home])).toEqual(["cabin"]);
  });

  it("returns empty when no valid SOC values", () => {
    expect(findLowestSocIds([])).toEqual([]);
    expect(findLowestSocIds([{ systemId: "x", error: "fail" }])).toEqual([]);
  });
});

describe("normalizeSocWarnThreshold", () => {
  it("returns the default when unset or invalid", () => {
    expect(normalizeSocWarnThreshold(null)).toBe(DEFAULT_SOC_WARN_THRESHOLD);
    expect(normalizeSocWarnThreshold(undefined)).toBe(DEFAULT_SOC_WARN_THRESHOLD);
    expect(normalizeSocWarnThreshold("")).toBe(DEFAULT_SOC_WARN_THRESHOLD);
    expect(normalizeSocWarnThreshold("abc")).toBe(DEFAULT_SOC_WARN_THRESHOLD);
  });

  it("rejects out-of-range values", () => {
    expect(normalizeSocWarnThreshold(0)).toBe(DEFAULT_SOC_WARN_THRESHOLD);
    expect(normalizeSocWarnThreshold(MIN_SOC_WARN_THRESHOLD - 1)).toBe(DEFAULT_SOC_WARN_THRESHOLD);
    expect(normalizeSocWarnThreshold(MAX_SOC_WARN_THRESHOLD + 1)).toBe(DEFAULT_SOC_WARN_THRESHOLD);
  });

  it("accepts valid in-range values", () => {
    expect(normalizeSocWarnThreshold(MIN_SOC_WARN_THRESHOLD)).toBe(MIN_SOC_WARN_THRESHOLD);
    expect(normalizeSocWarnThreshold(MAX_SOC_WARN_THRESHOLD)).toBe(MAX_SOC_WARN_THRESHOLD);
    expect(normalizeSocWarnThreshold("35")).toBe(35);
    expect(normalizeSocWarnThreshold(15)).toBe(15);
  });

  it("supports a custom default", () => {
    expect(normalizeSocWarnThreshold("nope", 30)).toBe(30);
  });
});

describe("isSocBelowWarnThreshold", () => {
  it("is true when SOC is below the threshold", () => {
    expect(isSocBelowWarnThreshold(10, 20)).toBe(true);
    expect(isSocBelowWarnThreshold(19, 20)).toBe(true);
  });

  it("is false when SOC is at or above the threshold", () => {
    expect(isSocBelowWarnThreshold(20, 20)).toBe(false);
    expect(isSocBelowWarnThreshold(50, 20)).toBe(false);
  });

  it("is false for non-finite SOC", () => {
    expect(isSocBelowWarnThreshold(undefined, 20)).toBe(false);
    expect(isSocBelowWarnThreshold(NaN, 20)).toBe(false);
  });

  it("uses the default threshold when omitted", () => {
    expect(isSocBelowWarnThreshold(10)).toBe(true);
    expect(isSocBelowWarnThreshold(50)).toBe(false);
  });
});

describe("theme helpers", () => {
  it("normalizes valid theme names", () => {
    for (const theme of VALID_THEMES) {
      expect(normalizeTheme(theme)).toBe(theme);
    }
    expect(normalizeTheme("invalid")).toBeNull();
    expect(normalizeTheme(null)).toBeNull();
  });

  it("resolves initial theme from saved preference first", () => {
    expect(resolveInitialTheme("light", { prefersLight: false })).toBe("light");
    expect(resolveInitialTheme("high-contrast", { prefersLight: true })).toBe("high-contrast");
  });

  it("falls back to system preferences when nothing is saved", () => {
    expect(resolveInitialTheme(null, { prefersHighContrast: true })).toBe("high-contrast");
    expect(resolveInitialTheme("", { prefersLight: true })).toBe("light");
    expect(resolveInitialTheme(undefined, {})).toBe("dark");
  });

  it("cycles dark → light → high-contrast → dark", () => {
    expect(getNextTheme("dark")).toBe("light");
    expect(getNextTheme("light")).toBe("high-contrast");
    expect(getNextTheme("high-contrast")).toBe("dark");
    expect(getNextTheme("invalid")).toBe("light");
  });
});

describe("isEditableElement", () => {
  it("returns false for null and non-editable elements", () => {
    expect(isEditableElement(null)).toBe(false);
    expect(isEditableElement({ tagName: "DIV" })).toBe(false);
    expect(isEditableElement({ tagName: "BUTTON" })).toBe(false);
  });

  it("returns true for text inputs, textarea, and select", () => {
    expect(isEditableElement({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isEditableElement({ tagName: "INPUT", type: "password" })).toBe(true);
    expect(isEditableElement({ tagName: "INPUT", type: "date" })).toBe(true);
    expect(isEditableElement({ tagName: "TEXTAREA" })).toBe(true);
    expect(isEditableElement({ tagName: "SELECT" })).toBe(true);
  });

  it("returns false for non-text input types", () => {
    expect(isEditableElement({ tagName: "INPUT", type: "button" })).toBe(false);
    expect(isEditableElement({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isEditableElement({ tagName: "INPUT", type: "hidden" })).toBe(false);
  });

  it("returns true for contenteditable elements", () => {
    expect(isEditableElement({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });
});

describe("generatorRuntimeStorageKey", () => {
  it("namespaces the key by system id", () => {
    expect(generatorRuntimeStorageKey("abc-123")).toBe(`${GENERATOR_RUNTIME_STORAGE_PREFIX}abc-123`);
  });
});

describe("updateGeneratorRuntime / totalGeneratorRuntimeSec", () => {
  it("starts a run when active flips from false to true", () => {
    const t0 = 1_000_000;
    const state = updateGeneratorRuntime(createGeneratorRuntimeState(), true, t0);
    expect(state.activeSince).toBe(t0);
    expect(state.accumulatedSec).toBe(0);
    expect(totalGeneratorRuntimeSec(state, t0 + 5000)).toBe(5);
  });

  it("accumulates elapsed seconds when active flips back to false", () => {
    const t0 = 1_000_000;
    let state = updateGeneratorRuntime(createGeneratorRuntimeState(), true, t0);
    state = updateGeneratorRuntime(state, false, t0 + 10_000);
    expect(state.activeSince).toBeNull();
    expect(state.accumulatedSec).toBe(10);
    expect(totalGeneratorRuntimeSec(state, t0 + 60_000)).toBe(10);
  });

  it("is a no-op when state does not change (still inactive, or still active)", () => {
    const idle = createGeneratorRuntimeState();
    expect(updateGeneratorRuntime(idle, false, 1_000_000)).toBe(idle);

    const t0 = 1_000_000;
    const running = updateGeneratorRuntime(createGeneratorRuntimeState(), true, t0);
    expect(updateGeneratorRuntime(running, true, t0 + 30_000)).toBe(running);
  });

  it("accumulates across multiple runs", () => {
    let state = createGeneratorRuntimeState();
    state = updateGeneratorRuntime(state, true, 0);
    state = updateGeneratorRuntime(state, false, 5000);
    state = updateGeneratorRuntime(state, true, 10_000);
    state = updateGeneratorRuntime(state, false, 20_000);
    expect(state.accumulatedSec).toBe(15);
  });

  it("totalGeneratorRuntimeSec treats missing state as zero", () => {
    expect(totalGeneratorRuntimeSec(null, Date.now())).toBe(0);
  });
});

describe("formatGeneratorRuntime", () => {
  it("returns empty string for less than a second, zero, or invalid input", () => {
    expect(formatGeneratorRuntime(0)).toBe("");
    expect(formatGeneratorRuntime(-5)).toBe("");
    expect(formatGeneratorRuntime(NaN)).toBe("");
  });

  it("formats minutes, hours, and combined durations in English by default", () => {
    expect(formatGeneratorRuntime(45 * 60)).toBe("45m");
    expect(formatGeneratorRuntime(2 * 3600)).toBe("2h");
    expect(formatGeneratorRuntime(2 * 3600 + 15 * 60)).toBe("2h 15m");
    expect(formatGeneratorRuntime(20)).toBe("<1m");
  });

  it("localizes duration via the app's translate callback", () => {
    setLocale("es");
    expect(formatGeneratorRuntime(45 * 60, t)).toBe("45 min");
    expect(formatGeneratorRuntime(2 * 3600 + 15 * 60, t)).toBe("2 h 15 min");
    setLocale(DEFAULT_LOCALE);
  });
});

describe("grid input label helpers", () => {
  it("normalizeGridInputLabel defaults to generator", () => {
    expect(normalizeGridInputLabel()).toBe("generator");
    expect(normalizeGridInputLabel(null)).toBe("generator");
    expect(normalizeGridInputLabel("invalid")).toBe("generator");
  });

  it("normalizeGridInputLabel accepts grid", () => {
    expect(normalizeGridInputLabel("grid")).toBe("grid");
    expect(normalizeGridInputLabel("GRID")).toBe("grid");
  });

  it("maps label to i18n keys", () => {
    expect(gridInputCardKey("generator")).toBe("cardGenerator");
    expect(gridInputCardKey("grid")).toBe("cardGrid");
    expect(gridInputFlowKey("generator")).toBe("flowGen");
    expect(gridInputFlowKey("grid")).toBe("flowGrid");
    expect(gridInputCompareOnKey("generator")).toBe("compareGeneratorOn");
    expect(gridInputCompareOnKey("grid")).toBe("compareGridOn");
  });
});

describe("matchesDashboardRefreshShortcut", () => {
  it("matches F5", () => {
    expect(matchesDashboardRefreshShortcut({ key: "F5" })).toBe(true);
  });

  it("matches Ctrl+R and Cmd+R without modifiers", () => {
    expect(matchesDashboardRefreshShortcut({ key: "r", ctrlKey: true })).toBe(true);
    expect(matchesDashboardRefreshShortcut({ key: "R", metaKey: true })).toBe(true);
  });

  it("does not match plain R or modified variants", () => {
    expect(matchesDashboardRefreshShortcut({ key: "r" })).toBe(false);
    expect(matchesDashboardRefreshShortcut({ key: "r", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(matchesDashboardRefreshShortcut({ key: "r", ctrlKey: true, altKey: true })).toBe(false);
    expect(matchesDashboardRefreshShortcut({ key: "F6" })).toBe(false);
  });
});

describe("admin invites (ADR 0003) helpers", () => {
  it("maps every known status to its i18n key", () => {
    expect(INVITE_STATUSES).toEqual(["pending", "converted", "revoked", "expired"]);
    expect(inviteStatusI18nKey("pending")).toBe("inviteStatusPending");
    expect(inviteStatusI18nKey("converted")).toBe("inviteStatusConverted");
    expect(inviteStatusI18nKey("revoked")).toBe("inviteStatusRevoked");
    expect(inviteStatusI18nKey("expired")).toBe("inviteStatusExpired");
  });

  it("falls back to pending's i18n key for unknown/missing status", () => {
    expect(inviteStatusI18nKey("bogus")).toBe("inviteStatusPending");
    expect(inviteStatusI18nKey(undefined)).toBe("inviteStatusPending");
  });

  it("maps status to a badge CSS class", () => {
    expect(inviteStatusBadgeClass("converted")).toBe("invite-status-converted");
    expect(inviteStatusBadgeClass("bogus")).toBe("invite-status-pending");
  });

  it("only pending invites are revocable", () => {
    expect(isInviteRevocable("pending")).toBe(true);
    expect(isInviteRevocable("converted")).toBe(false);
    expect(isInviteRevocable("revoked")).toBe(false);
    expect(isInviteRevocable("expired")).toBe(false);
  });

  it("hasPurgeableInvites is true only when a non-pending entry exists", () => {
    expect(hasPurgeableInvites([])).toBe(false);
    expect(hasPurgeableInvites([{ status: "pending" }])).toBe(false);
    expect(hasPurgeableInvites([{ status: "pending" }, { status: "revoked" }])).toBe(true);
    expect(hasPurgeableInvites(undefined)).toBe(false);
  });
});

describe("admin users (ADR 0003) last-admin helpers", () => {
  const soloAdmin = { id: "a1", role: "admin", disabledAt: null };
  const secondAdmin = { id: "a2", role: "admin", disabledAt: null };
  const reader = { id: "r1", role: "read", disabledAt: null };
  const disabledAdmin = { id: "a3", role: "admin", disabledAt: "2026-01-01T00:00:00Z" };

  it("countActiveAdmins ignores disabled and non-admin users", () => {
    expect(countActiveAdmins([])).toBe(0);
    expect(countActiveAdmins(undefined)).toBe(0);
    expect(countActiveAdmins([soloAdmin, reader, disabledAdmin])).toBe(1);
    expect(countActiveAdmins([soloAdmin, secondAdmin])).toBe(2);
  });

  it("isLastActiveAdmin is true only for the sole active admin", () => {
    expect(isLastActiveAdmin([soloAdmin, reader], "a1")).toBe(true);
    expect(isLastActiveAdmin([soloAdmin, secondAdmin], "a1")).toBe(false);
    expect(isLastActiveAdmin([soloAdmin, reader], "r1")).toBe(false);
    expect(isLastActiveAdmin([disabledAdmin], "a3")).toBe(false);
    expect(isLastActiveAdmin([soloAdmin], "missing")).toBe(false);
  });

  it("canDisableUser blocks only the last active admin", () => {
    expect(canDisableUser([soloAdmin, reader], "a1")).toBe(false);
    expect(canDisableUser([soloAdmin, secondAdmin], "a1")).toBe(true);
    expect(canDisableUser([soloAdmin, reader], "r1")).toBe(true);
    expect(canDisableUser([], "")).toBe(false);
  });

  it("canChangeUserRole allows promote; blocks demoting the last admin", () => {
    expect(canChangeUserRole([soloAdmin, reader], "r1", "admin")).toBe(true);
    expect(canChangeUserRole([soloAdmin, reader], "a1", "read")).toBe(false);
    expect(canChangeUserRole([soloAdmin, secondAdmin], "a1", "read")).toBe(true);
    expect(canChangeUserRole([soloAdmin], "a1", "bogus")).toBe(false);
  });
});
