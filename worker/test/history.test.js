import { describe, it, expect, vi } from "vitest";
import {
  appendPoint,
  appendSnapshot,
  computeDailySummary,
  computeSocExtrema,
  dateRange,
  deleteHistory,
  getDay,
  getHistorySummary,
  listDates,
  mergeSocIntoPoints,
  parseDataTimestamp,
  pointFromData,
  pruneOld,
  resolveIntradayHistory,
  runScheduledSnapshots,
  selectDatesToPrune,
  socMapFromPoints,
  supplementSummarySoc,
  upsertDateIndex,
} from "../src/history.js";
import { parseHistoryRows, localDate } from "../src/services/shinemonitor.js";
import { createMockKV } from "./helpers.js";

const SAMPLE_DATA = {
  systemId: "sys-1",
  name: "Cabin",
  service: "growatt",
  timestamp: "2026-07-03 14:32:00",
  credentials: { user: "secret", password: "hidden" },
  battery: { voltage: 48.2, soc: 72, current: -15, power: -723 },
  solar: { power: 1200, voltage: 95 },
  load: { power: 850, percent: 24 },
  grid: { power: 0, voltage: 0, active: false },
  inverter: { ratedPower: 3500, nominalPV: 5000 },
  status: "PV Charging",
  energyToday: 12.4,
};

describe("parseDataTimestamp", () => {
  it("floors minutes to 5-minute bucket", () => {
    expect(parseDataTimestamp("2026-07-03 14:32:00")).toEqual({
      date: "2026-07-03",
      bucketTime: "14:30",
    });
    expect(parseDataTimestamp("2026-07-03 14:37:59").bucketTime).toBe("14:35");
  });
});

describe("pointFromData", () => {
  it("extracts only history fields without credentials", () => {
    const point = pointFromData(SAMPLE_DATA, "14:30");
    expect(point).toEqual({
      time: "14:30",
      solar: 1200,
      load: 850,
      battery: -723,
      soc: 72,
      energyToday: 12.4,
    });
    expect(point).not.toHaveProperty("credentials");
    expect(point).not.toHaveProperty("password");
  });
});

describe("appendPoint", () => {
  it("appends points in chronological order", () => {
    const points = appendPoint([], { time: "12:00", solar: 100, load: 50, battery: 0, soc: 80, energyToday: 5 });
    const next = appendPoint(points, { time: "10:00", solar: 0, load: 40, battery: -100, soc: 75, energyToday: 2 });
    expect(next.map((p) => p.time)).toEqual(["10:00", "12:00"]);
  });

  it("deduplicates by replacing the same 5-minute bucket", () => {
    const first = { time: "14:30", solar: 1000, load: 500, battery: -200, soc: 70, energyToday: 10 };
    const updated = { time: "14:30", solar: 1200, load: 850, battery: -723, soc: 72, energyToday: 12.4 };
    const points = appendPoint([first], updated);
    expect(points).toHaveLength(1);
    expect(points[0].solar).toBe(1200);
    expect(points[0].soc).toBe(72);
  });
});

describe("mergeSocIntoPoints", () => {
  it("fills missing SOC from stored points by time", () => {
    const vendor = [
      { time: "10:00", solar: 100, load: 50, battery: 0 },
      { time: "10:05", solar: 200, load: 60, battery: -100 },
    ];
    const stored = [
      { time: "10:00", soc: 80 },
      { time: "10:05", soc: 78 },
    ];
    const merged = mergeSocIntoPoints(vendor, socMapFromPoints(stored));
    expect(merged[0].soc).toBe(80);
    expect(merged[1].soc).toBe(78);
  });

  it("does not overwrite existing vendor SOC", () => {
    const vendor = [{ time: "10:00", solar: 100, load: 50, battery: 0, soc: 90 }];
    const stored = [{ time: "10:00", soc: 80 }];
    const merged = mergeSocIntoPoints(vendor, socMapFromPoints(stored));
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

describe("supplementSummarySoc", () => {
  it("fills missing minSoc/maxSoc from vendor supplement", () => {
    const series = [
      { date: "2026-07-01", minSoc: null, maxSoc: null },
      { date: "2026-07-02", minSoc: 55, maxSoc: 98 },
    ];
    const result = supplementSummarySoc(series, {
      "2026-07-01": { minSoc: 40, maxSoc: 95 },
    });
    expect(result[0]).toMatchObject({ minSoc: 40, maxSoc: 95 });
    expect(result[1]).toMatchObject({ minSoc: 55, maxSoc: 98 });
  });
});

describe("resolveIntradayHistory", () => {
  it("merges stored SOC into vendor power series", async () => {
    const env = { SYSTEMS: createMockKV() };
    await appendSnapshot(env, "sys-1", SAMPLE_DATA, Date.parse("2026-07-03T14:32:00Z"));

    const adapter = {
      fetchHistory: vi.fn(async () => ({
        systemId: "sys-1",
        name: "Cabin",
        service: "growatt",
        date: "2026-07-03",
        timezoneOffset: 0,
        intervalMinutes: 5,
        points: [{ time: "14:30", solar: 1200, load: 850, battery: -723 }],
      })),
    };

    const data = await resolveIntradayHistory(
      env,
      { id: "sys-1", name: "Cabin", service: "growatt" },
      adapter,
      "2026-07-03",
    );
    expect(data.points[0].soc).toBe(72);
    expect(data.source).toBe("merged");
  });

  it("returns stored snapshot when vendor has no points", async () => {
    const env = { SYSTEMS: createMockKV() };
    await appendSnapshot(env, "sys-1", SAMPLE_DATA, Date.parse("2026-07-03T14:32:00Z"));

    const adapter = {
      fetchHistory: vi.fn(async () => ({
        systemId: "sys-1",
        date: "2026-07-03",
        points: [],
      })),
    };

    const data = await resolveIntradayHistory(
      env,
      { id: "sys-1", name: "Cabin", service: "growatt" },
      adapter,
      "2026-07-03",
    );
    expect(data.source).toBe("snapshot");
    expect(data.points[0].soc).toBe(72);
  });
});

describe("computeDailySummary", () => {
  it("integrates power over 5-minute intervals and tracks SOC extrema", () => {
    const points = [
      { time: "10:00", solar: 2000, load: 400, battery: 0, soc: 90, energyToday: 1 },
      { time: "10:05", solar: 3000, load: 600, battery: -500, soc: 85, energyToday: 2 },
      { time: "10:10", solar: 1000, load: 800, battery: 200, soc: 80, energyToday: 3 },
    ];
    expect(computeDailySummary(points)).toEqual({
      solarKwh: 0.5,
      loadKwh: 0.1,
      peakSolarW: 3000,
      minSoc: 80,
      maxSoc: 90,
    });
  });

  it("returns zeros for empty day", () => {
    expect(computeDailySummary([])).toEqual({
      solarKwh: 0,
      loadKwh: 0,
      peakSolarW: 0,
      minSoc: null,
      maxSoc: null,
    });
  });
});

describe("selectDatesToPrune", () => {
  it("selects dates older than retention window", () => {
    const dates = ["2026-07-01", "2026-06-01", "2026-04-01", "2026-03-01"];
    // 90 days before 2026-07-03 is 2026-04-04
    expect(selectDatesToPrune(dates, 90, "2026-07-03")).toEqual(["2026-04-01", "2026-03-01"]);
  });
});

describe("upsertDateIndex", () => {
  it("keeps newest dates first without duplicates", () => {
    expect(upsertDateIndex(["2026-07-02", "2026-07-01"], "2026-07-03")).toEqual([
      "2026-07-03",
      "2026-07-02",
      "2026-07-01",
    ]);
    expect(upsertDateIndex(["2026-07-03", "2026-07-01"], "2026-07-03")).toEqual([
      "2026-07-03",
      "2026-07-01",
    ]);
  });
});

describe("dateRange", () => {
  it("returns consecutive dates ending on the given day", () => {
    expect(dateRange("2026-07-03", 3)).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
    expect(dateRange("2026-07-03", 1)).toEqual(["2026-07-03"]);
  });
});

describe("getHistorySummary", () => {
  it("returns daily summaries from stored KV buckets", async () => {
    const env = { SYSTEMS: createMockKV() };
    await appendSnapshot(
      env,
      "sys-1",
      { ...SAMPLE_DATA, timestamp: "2026-07-01 14:32:00" },
      Date.parse("2026-07-01T14:32:00Z"),
    );
    await appendSnapshot(
      env,
      "sys-1",
      { ...SAMPLE_DATA, timestamp: "2026-07-03 10:00:00", energyToday: 8.2 },
      Date.parse("2026-07-03T10:00:00Z"),
    );

    const summary = await getHistorySummary(env, "sys-1", 3, "2026-07-03");
    expect(summary.systemId).toBe("sys-1");
    expect(summary.days).toBe(3);
    expect(summary.series).toHaveLength(3);
    expect(summary.series[0]).toMatchObject({ date: "2026-07-01", source: "snapshot" });
    expect(summary.series[0].solarKwh).toBeGreaterThan(0);
    expect(summary.series[1]).toMatchObject({ date: "2026-07-02", solarKwh: null, source: null });
    expect(summary.series[2].date).toBe("2026-07-03");
  });
});

describe("history KV storage", () => {
  it("appendSnapshot stores day bucket and updates index", async () => {
    const env = { SYSTEMS: createMockKV() };
    const doc = await appendSnapshot(env, "sys-1", SAMPLE_DATA, Date.parse("2026-07-03T14:32:00Z"));

    expect(doc.date).toBe("2026-07-03");
    expect(doc.points).toHaveLength(1);
    expect(doc.points[0].time).toBe("14:30");
    expect(doc.dailySummary.peakSolarW).toBe(1200);

    const stored = await getDay(env, "sys-1", "2026-07-03");
    expect(stored.points[0]).not.toHaveProperty("credentials");
    expect(await listDates(env, "sys-1")).toEqual(["2026-07-03"]);
  });

  it("appendSnapshot deduplicates within the same 5-minute bucket", async () => {
    const env = { SYSTEMS: createMockKV() };
    await appendSnapshot(env, "sys-1", SAMPLE_DATA, Date.parse("2026-07-03T14:32:00Z"));
    await appendSnapshot(
      env,
      "sys-1",
      { ...SAMPLE_DATA, timestamp: "2026-07-03 14:33:00", solar: { power: 1500, voltage: 96 }, battery: { ...SAMPLE_DATA.battery, soc: 75 } },
      Date.parse("2026-07-03T14:33:00Z"),
    );

    const day = await getDay(env, "sys-1", "2026-07-03");
    expect(day.points).toHaveLength(1);
    expect(day.points[0].solar).toBe(1500);
    expect(day.points[0].soc).toBe(75);
  });

  it("pruneOld removes expired day keys and index entries", async () => {
    const env = { SYSTEMS: createMockKV() };
    await env.SYSTEMS.put(
      "history:day:sys-1:2026-03-01",
      JSON.stringify({ systemId: "sys-1", date: "2026-03-01", points: [] }),
    );
    await env.SYSTEMS.put(
      "history:day:sys-1:2026-07-01",
      JSON.stringify({ systemId: "sys-1", date: "2026-07-01", points: [] }),
    );
    await env.SYSTEMS.put("history:index:sys-1", JSON.stringify(["2026-07-01", "2026-03-01"]));

    const result = await pruneOld(env, "sys-1", 90, Date.parse("2026-07-03T00:00:00Z"));
    expect(result.removed).toEqual(["2026-03-01"]);
    expect(result.kept).toBe(1);
    expect(await getDay(env, "sys-1", "2026-03-01")).toBeNull();
    expect(await getDay(env, "sys-1", "2026-07-01")).not.toBeNull();
    expect(await listDates(env, "sys-1")).toEqual(["2026-07-01"]);
  });
});

describe("deleteHistory", () => {
  it("removes all day keys and the date index for a system", async () => {
    const env = { SYSTEMS: createMockKV() };
    await appendSnapshot(env, "sys-1", SAMPLE_DATA, Date.parse("2026-07-03T14:32:00Z"));
    await appendSnapshot(
      env,
      "sys-1",
      { ...SAMPLE_DATA, timestamp: "2026-07-02 10:00:00" },
      Date.parse("2026-07-02T10:00:00Z"),
    );

    const result = await deleteHistory(env, "sys-1");
    expect(result.removed).toBe(2);
    expect(await listDates(env, "sys-1")).toEqual([]);
    expect(await getDay(env, "sys-1", "2026-07-03")).toBeNull();
    expect(await getDay(env, "sys-1", "2026-07-02")).toBeNull();
  });
});

describe("runScheduledSnapshots", () => {
  it("appends a snapshot for each configured system", async () => {
    const env = { SYSTEMS: createMockKV() };
    await env.SYSTEMS.put("_index", JSON.stringify([
      { id: "a", name: "Alpha", service: "growatt" },
      { id: "b", name: "Beta", service: "shinemonitor" },
    ]));
    await env.SYSTEMS.put("system:a", JSON.stringify({
      id: "a",
      name: "Alpha",
      service: "growatt",
      credentials: {},
    }));
    await env.SYSTEMS.put("system:b", JSON.stringify({
      id: "b",
      name: "Beta",
      service: "shinemonitor",
      credentials: {},
    }));

    const adapters = {
      growatt: {
        fetchData: vi.fn(async () => ({ ...SAMPLE_DATA, systemId: "a", timestamp: "2026-07-03 14:32:00" })),
      },
      shinemonitor: {
        fetchData: vi.fn(async () => ({ ...SAMPLE_DATA, systemId: "b", timestamp: "2026-07-03 14:33:00" })),
      },
    };

    const result = await runScheduledSnapshots(env, adapters, Date.parse("2026-07-03T14:32:00Z"));
    expect(result).toEqual({ checked: 2, appended: 2, failed: 0 });
    expect(adapters.growatt.fetchData).toHaveBeenCalledOnce();
    expect(adapters.shinemonitor.fetchData).toHaveBeenCalledOnce();
    expect(await listDates(env, "a")).toEqual(["2026-07-03"]);
    expect(await listDates(env, "b")).toEqual(["2026-07-03"]);
  });

  it("logs and counts failures without aborting other systems", async () => {
    const env = { SYSTEMS: createMockKV() };
    await env.SYSTEMS.put("_index", JSON.stringify([
      { id: "ok", name: "OK", service: "growatt" },
      { id: "bad", name: "Bad", service: "growatt" },
    ]));
    await env.SYSTEMS.put("system:ok", JSON.stringify({ id: "ok", service: "growatt", credentials: {} }));
    await env.SYSTEMS.put("system:bad", JSON.stringify({ id: "bad", service: "growatt", credentials: {} }));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const adapters = {
      growatt: {
        fetchData: vi.fn(async (cfg) => {
          if (cfg.id === "bad") throw new Error("upstream timeout");
          return { ...SAMPLE_DATA, systemId: cfg.id, timestamp: "2026-07-03 14:32:00" };
        }),
      },
    };

    const result = await runScheduledSnapshots(env, adapters, Date.parse("2026-07-03T14:32:00Z"));
    expect(result).toEqual({ checked: 2, appended: 1, failed: 1 });
    expect(await listDates(env, "ok")).toEqual(["2026-07-03"]);
    expect(await listDates(env, "bad")).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith("History snapshot failed for bad:", "upstream timeout");
    errorSpy.mockRestore();
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
