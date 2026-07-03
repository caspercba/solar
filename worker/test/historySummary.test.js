import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchHistorySummary as shinemonitorSummary } from "../src/services/shinemonitor.js";
import { fetchHistorySummary as growattSummary } from "../src/services/growatt.js";
import { expectHistorySummaryShape } from "./helpers.js";

import smAuth from "./fixtures/shinemonitor/auth-success.json";
import smDay0702 from "./fixtures/shinemonitor/device-day-2026-07-02.json";
import smDay0703 from "./fixtures/shinemonitor/device-day-2026-07-03.json";
import smDayEmpty from "./fixtures/shinemonitor/device-day-empty.json";

import growattEnergy0702 from "./fixtures/growatt/energy-day-2026-07-02.json";
import growattEnergy0703 from "./fixtures/growatt/energy-day-2026-07-03.json";
import growattEnergyEmpty from "./fixtures/growatt/energy-day-empty.json";
import growattLineChart from "./fixtures/growatt/line-chart.json";
import growattLineChartEmpty from "./fixtures/growatt/line-chart-empty.json";
import growattBatChart0702 from "./fixtures/growatt/bat-chart-2026-07-02.json";
import growattBatChart0703 from "./fixtures/growatt/bat-chart-2026-07-03.json";

const SHINEMONITOR_CONFIG = {
  id: "sys-sm",
  name: "Cabin",
  credentials: {
    user: "user@example.com",
    pwdSha1: "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8",
    plantId: "100",
    device: { pn: "PN1", devcode: "1", sn: "SN1", devaddr: "1" },
    nominalPower: 5000,
    timezone: 0,
  },
};

const GROWATT_CONFIG = {
  id: "sys-gw",
  name: "Growatt Home",
  credentials: {
    user: "growatt-user",
    password: "secret",
    plantId: "42",
    storageSn: "STORAGE-SN",
  },
};

function mockShinemonitorFetch(dayFixtures) {
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes("action=auth")) {
      return Response.json(smAuth);
    }
    if (u.includes("queryDeviceDataOneDayPaging")) {
      const dateMatch = u.match(/date=(\d{4}-\d{2}-\d{2})/);
      const date = dateMatch?.[1] || "2026-07-03";
      const fixture = dayFixtures[date] ?? smDayEmpty;
      return Response.json(fixture);
    }
    throw new Error(`Unexpected fetch: ${u}`);
  });
}

function mockGrowattFetch({
  energyByDate = {},
  batByDate = {},
  energyDefault = growattEnergyEmpty,
  lineDefault = growattLineChart,
} = {}) {
  let lastEnergyDate = "2026-07-03";
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url);
    if (u.endsWith("/login") && init?.method === "POST") {
      return new Response(JSON.stringify({ result: 1 }), {
        headers: { "set-cookie": "JSESSIONID=abc123; Path=/" },
      });
    }
    if (u.includes("getStorageEnergyDayChart")) {
      const body = init?.body ? Object.fromEntries(new URLSearchParams(init.body)) : {};
      lastEnergyDate = body.date || "2026-07-03";
      return Response.json(energyByDate[lastEnergyDate] ?? energyDefault);
    }
    if (u.includes("getStorageLineChartData")) {
      return Response.json(lineDefault);
    }
    if (u.includes("getStorageBatChart")) {
      return Response.json(batByDate[lastEnergyDate] ?? growattBatChart0703);
    }
    throw new Error(`Unexpected fetch: ${u}`);
  });
}

describe("fetchHistorySummary adapters", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("shinemonitor", () => {
    it("aggregates multi-day solar/load totals from vendor day paging fixtures", async () => {
      mockShinemonitorFetch({
        "2026-07-02": smDay0702,
        "2026-07-03": smDay0703,
      });

      const summary = await shinemonitorSummary(SHINEMONITOR_CONFIG, 2, "2026-07-03");

      expectHistorySummaryShape(summary);
      expect(summary.systemId).toBe("sys-sm");
      expect(summary.days).toBe(2);
      expect(summary.endDate).toBe("2026-07-03");
      expect(summary.series).toHaveLength(2);
      expect(summary.series[0]).toMatchObject({
        date: "2026-07-02",
        solarKwh: 0.3,
        loadKwh: 0.1,
        peakSolarW: 2000,
        minSoc: 88,
        maxSoc: 90,
        source: "vendor",
      });
      expect(summary.series[1]).toMatchObject({
        date: "2026-07-03",
        solarKwh: 0.5,
        loadKwh: 0.1,
        peakSolarW: 3000,
        minSoc: 84,
        maxSoc: 85,
        source: "vendor",
      });
    });

    it("returns null totals for days with empty vendor rows", async () => {
      mockShinemonitorFetch({});

      const summary = await shinemonitorSummary(SHINEMONITOR_CONFIG, 1, "2026-07-01");

      expectHistorySummaryShape(summary);
      expect(summary.series).toEqual([
        {
          date: "2026-07-01",
          solarKwh: null,
          loadKwh: null,
          peakSolarW: null,
          minSoc: null,
          maxSoc: null,
          source: null,
        },
      ]);
    });
  });

  describe("growatt", () => {
    it("aggregates daily energy totals from vendor chart fixtures", async () => {
      mockGrowattFetch({
        energyByDate: {
          "2026-07-02": growattEnergy0702,
          "2026-07-03": growattEnergy0703,
        },
        batByDate: {
          "2026-07-02": growattBatChart0702,
          "2026-07-03": growattBatChart0703,
        },
      });

      const summary = await growattSummary(GROWATT_CONFIG, 2, "2026-07-03");

      expectHistorySummaryShape(summary);
      expect(summary.systemId).toBe("sys-gw");
      expect(summary.days).toBe(2);
      expect(summary.endDate).toBe("2026-07-03");
      expect(summary.series).toHaveLength(2);
      expect(summary.series[0]).toMatchObject({
        date: "2026-07-02",
        solarKwh: 0.3,
        loadKwh: 0.1,
        peakSolarW: 2000,
        source: "vendor",
      });
      expect(summary.series[1]).toMatchObject({
        date: "2026-07-03",
        solarKwh: 0.5,
        loadKwh: 0.1,
        peakSolarW: 3000,
        source: "vendor",
      });
    });

    it("includes min/max SOC when bat chart date matches requested day", async () => {
      mockGrowattFetch({
        energyByDate: { "2026-07-03": growattEnergy0703 },
        batByDate: { "2026-07-03": growattBatChart0703 },
      });

      const summary = await growattSummary(GROWATT_CONFIG, 1, "2026-07-03");

      expect(summary.series[0]).toMatchObject({
        date: "2026-07-03",
        minSoc: 84,
        maxSoc: 85,
      });
    });

    it("returns null totals when vendor energy chart is empty", async () => {
      mockGrowattFetch({
        energyDefault: growattEnergyEmpty,
        lineDefault: growattLineChartEmpty,
      });

      const summary = await growattSummary(GROWATT_CONFIG, 1, "2026-07-01");

      expectHistorySummaryShape(summary);
      expect(summary.series).toEqual([
        {
          date: "2026-07-01",
          solarKwh: null,
          loadKwh: null,
          peakSolarW: null,
          minSoc: null,
          maxSoc: null,
          source: null,
        },
      ]);
    });
  });
});
