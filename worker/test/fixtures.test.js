import { describe, it, expect } from "vitest";
import { parseHistoryRows, localDate } from "../src/services/shinemonitor.js";
import {
  STATUS_MAP,
  statusLabel,
  formatIntervalTime,
  parseEnergyDayPoints,
  parseSocCapacityPoints,
  localDate as growattLocalDate,
} from "../src/services/growatt.js";
import { mergeSocIntoPoints, socMapFromPoints } from "../src/history.js";
import shinemonitorDeviceDayPaging from "./fixtures/shinemonitor-device-day-paging.json";
import growattEnergyDayChart from "./fixtures/growatt-energy-day-chart.json";
import growattLineChartData from "./fixtures/growatt-line-chart-data.json";
import growattBatChart from "./fixtures/growatt-bat-chart.json";

describe("fixture: shinemonitor device day paging", () => {
  const fixture = shinemonitorDeviceDayPaging;

  it("parseHistoryRows maps recorded vendor rows to normalized points", () => {
    const { points, socSource } = parseHistoryRows(fixture.title, fixture.row);

    expect(points).toEqual([
      { time: "06:00", solar: 0, load: 120, battery: 500, soc: 45 },
      { time: "12:00", solar: 500, load: 200, battery: -510, soc: 72 },
      { time: "18:19", solar: 110, load: 283, battery: -3199, soc: 83 },
      { time: "18:24", solar: 115, load: 290, battery: -3004, soc: 85 },
    ]);
    expect(socSource).toBe("mixed");
  });

  it("estimates SOC from voltage when BATTERY_SOC is -1 or empty", () => {
    const { points } = parseHistoryRows(fixture.title, fixture.row);
    expect(points[2].soc).toBe(83);
    expect(points[3].soc).toBe(85);
  });
});

describe("fixture: growatt energy day chart", () => {
  const energyFixture = growattEnergyDayChart;
  const lineFixture = growattLineChartData;

  it("parseEnergyDayPoints maps recorded chart arrays", () => {
    const { ppv, userLoad } = energyFixture.obj;
    const batPower = lineFixture.obj.batPower;

    expect(parseEnergyDayPoints(ppv, userLoad, batPower)).toEqual([
      { time: "00:00", solar: 0, load: 120, battery: 0 },
      { time: "00:05", solar: 150, load: 130, battery: -50 },
      { time: "00:10", solar: 1200, load: 850, battery: -723 },
      { time: "00:15", solar: 851, load: 900, battery: 200 },
    ]);
  });

  it("handles mismatched array lengths from vendor payloads", () => {
    expect(parseEnergyDayPoints(["100"], [], ["-50", "0"])).toEqual([
      { time: "00:00", solar: 100, load: 0, battery: -50 },
      { time: "00:05", solar: 0, load: 0, battery: 0 },
    ]);
  });
});

describe("fixture: growatt bat chart", () => {
  const batFixture = growattBatChart;

  it("parseSocCapacityPoints skips invalid SOC samples", () => {
    expect(parseSocCapacityPoints(batFixture.obj.socChart.capacity)).toEqual([
      { time: "00:00", soc: 80 },
      { time: "00:05", soc: 79 },
      { time: "00:15", soc: 75 },
    ]);
  });

  it("merges fixture SOC into energy points by time slot", () => {
    const powerPoints = parseEnergyDayPoints(
      growattEnergyDayChart.obj.ppv,
      growattEnergyDayChart.obj.userLoad,
      growattLineChartData.obj.batPower,
    );
    const socPoints = parseSocCapacityPoints(batFixture.obj.socChart.capacity);
    const merged = mergeSocIntoPoints(powerPoints, socMapFromPoints(socPoints));

    expect(merged[0]).toMatchObject({ time: "00:00", solar: 0, soc: 80 });
    expect(merged[2]).toMatchObject({ time: "00:10", solar: 1200, battery: -723 });
    expect(merged[2].soc).toBeUndefined();
  });
});

describe("growatt chart helpers", () => {
  it("formatIntervalTime maps 5-minute index to HH:MM", () => {
    expect(formatIntervalTime(0)).toBe("00:00");
    expect(formatIntervalTime(12)).toBe("01:00");
    expect(formatIntervalTime(287)).toBe("23:55");
  });
});

describe("growatt STATUS_MAP edge codes", () => {
  it("maps known vendor status codes from recorded enum", () => {
    expect(statusLabel("-1")).toBe("Offline");
    expect(statusLabel("5")).toBe("PV Charging");
    expect(statusLabel("15")).toBe("Gen Charging");
    expect(statusLabel("28")).toBe("Battery&PV Export to Grid+Loads Supporting");
  });

  it("returns Unknown label for unmapped codes", () => {
    expect(statusLabel("99")).toBe("Unknown (99)");
    expect(statusLabel("")).toBe("Unknown ()");
  });

  it("defaults missing status to Offline", () => {
    expect(statusLabel(undefined)).toBe("Offline");
    expect(statusLabel(null)).toBe("Offline");
  });

  it("covers every STATUS_MAP entry with a non-empty label", () => {
    for (const [code, label] of Object.entries(STATUS_MAP)) {
      expect(label.length).toBeGreaterThan(0);
      expect(statusLabel(code)).toBe(label);
    }
  });
});

describe("shinemonitor localDate", () => {
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

describe("growatt localDate", () => {
  it("formats plant-local calendar date from offset seconds", () => {
    const utcMidnight = Date.UTC(2026, 3, 4, 2, 0, 0);
    const originalNow = Date.now;
    Date.now = () => utcMidnight;
    try {
      expect(growattLocalDate(-10800)).toBe("2026-04-03");
      expect(growattLocalDate(0)).toBe("2026-04-04");
    } finally {
      Date.now = originalNow;
    }
  });
});
