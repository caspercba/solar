import { describe, it, expect } from "vitest";
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
