import { describe, it, expect } from "vitest";
import {
  computeSocExtrema,
  mergeSocIntoPoints,
  socMapFromPoints,
} from "../src/history.js";
import { parseHistoryRows, localDate } from "../src/services/shinemonitor.js";

describe("mergeSocIntoPoints", () => {
  it("fills missing SOC from supplement points by time", () => {
    const vendor = [
      { time: "10:00", solar: 100, load: 50, battery: 0 },
      { time: "10:05", solar: 200, load: 60, battery: -100 },
    ];
    const supplement = [
      { time: "10:00", soc: 80 },
      { time: "10:05", soc: 78 },
    ];
    const merged = mergeSocIntoPoints(vendor, socMapFromPoints(supplement));
    expect(merged[0].soc).toBe(80);
    expect(merged[1].soc).toBe(78);
  });

  it("does not overwrite existing vendor SOC", () => {
    const vendor = [{ time: "10:00", solar: 100, load: 50, battery: 0, soc: 90 }];
    const supplement = [{ time: "10:00", soc: 80 }];
    const merged = mergeSocIntoPoints(vendor, socMapFromPoints(supplement));
    expect(merged[0].soc).toBe(90);
  });
});

describe("computeSocExtrema", () => {
  it("returns min and max from valid samples", () => {
    expect(computeSocExtrema([90, 85, 80, -1, NaN])).toEqual({ minSoc: 80, maxSoc: 90 });
  });

  it("returns nulls for empty input", () => {
    expect(computeSocExtrema([])).toEqual({ minSoc: null, maxSoc: null });
  });
});

describe("parseHistoryRows", () => {
  const titles = [
    { title: "Timestamp" },
    { title: "Battery Voltage" },
    { title: "Batt Current" },
    { title: "Charger Power" },
    { title: "PLoad" },
  ];

  it("maps ShineMonitor fields to normalized points", () => {
    const rows = [
      { field: ["2026-04-04 18:19:48", "51.6", "-62", "110", "283"] },
      { field: ["2026-04-04 06:00:00", "50.0", "10", "0", "120"] },
    ];
    expect(parseHistoryRows(titles, rows)).toEqual([
      { time: "18:19", solar: 110, load: 283, battery: -3199 },
      { time: "06:00", solar: 0, load: 120, battery: 500 },
    ]);
  });

  it("includes BATTERY_SOC when present in titles", () => {
    const socTitles = [
      { title: "Timestamp" },
      { title: "Battery Voltage" },
      { title: "Batt Current" },
      { title: "Charger Power" },
      { title: "PLoad" },
      { title: "BATTERY_SOC" },
    ];
    const rows = [
      { field: ["2026-04-04 12:00:00", "51.0", "-10", "500", "200", "72"] },
    ];
    expect(parseHistoryRows(socTitles, rows)).toEqual([
      { time: "12:00", solar: 500, load: 200, battery: -510, soc: 72 },
    ]);
  });

  it("returns empty array for no rows", () => {
    expect(parseHistoryRows(titles, [])).toEqual([]);
  });
});

describe("localDate", () => {
  it("formats plant-local calendar date from offset seconds", () => {
    const utcMidnight = Date.UTC(2026, 3, 4, 2, 0, 0);
    const originalNow = Date.now;
    Date.now = () => utcMidnight;
    try {
      expect(localDate(-10800)).toBe("2026-04-03");
      expect(localDate(0)).toBe("2026-04-04");
    } finally {
      Date.now = originalNow;
    }
  });
});
