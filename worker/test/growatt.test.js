import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchData, fetchSocChart, fetchSocDailySummary } from "../src/services/growatt.js";
import { expectNormalizedShape } from "./helpers.js";

describe("growatt fetchData normalization", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns normalized output shape from mocked Growatt API responses", async () => {
    const systemConfig = {
      id: "growatt-1",
      name: "Growatt Home",
      credentials: {
        user: "growatt-user",
        password: "secret",
        plantId: "42",
        storageSn: "STORAGE-SN",
        nominalPower: 3500,
        nominalPV: 4000,
      },
    };

    globalThis.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      if (u.endsWith("/login") && init?.method === "POST") {
        return new Response(JSON.stringify({ result: 1 }), {
          headers: { "set-cookie": "JSESSIONID=abc123; Path=/" },
        });
      }
      if (u.includes("getStorageStatusData")) {
        return Response.json({
          result: 1,
          obj: {
            panelPower: "1500",
            vPv1: "360",
            vBat: "51.2",
            capacity: "80",
            batPower: "200",
            loadPower: "900",
            loadPrecent: "25",
            gridPower: "100",
            vAcInput: "230",
            status: "5",
          },
        });
      }
      if (u.includes("getStorageTotalData")) {
        return Response.json({ result: 1, obj: { epvToday: "8.3" } });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    const data = await fetchData(systemConfig);
    expectNormalizedShape(data);
    expect(data.service).toBe("growatt");
    expect(data.battery.soc).toBe(80);
    expect(data.solar.power).toBe(1500);
    expect(data.energyToday).toBe(8.3);
    expect(data.status).toBe("PV Charging");
  });
});

describe("growatt SOC history supplement", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const systemConfig = {
    id: "growatt-1",
    name: "Growatt Home",
    credentials: {
      user: "growatt-user",
      password: "secret",
      plantId: "42",
      storageSn: "STORAGE-SN",
    },
  };

  function mockLoginFetch(extraHandler) {
    globalThis.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      if (u.endsWith("/login") && init?.method === "POST") {
        return new Response(JSON.stringify({ result: 1 }), {
          headers: { "set-cookie": "JSESSIONID=abc123; Path=/" },
        });
      }
      return extraHandler(u, init);
    });
  }

  it("fetchSocChart returns intraday SOC for matching date", async () => {
    mockLoginFetch(async (u) => {
      if (u.includes("getStorageBatChart")) {
        return Response.json({
          result: 1,
          obj: {
            date: "2026-07-03",
            socChart: { capacity: ["80", "78", "75"] },
          },
        });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    const points = await fetchSocChart(systemConfig, "2026-07-03");
    expect(points).toEqual([
      { time: "00:00", soc: 80 },
      { time: "00:05", soc: 78 },
      { time: "00:10", soc: 75 },
    ]);
  });

  it("fetchSocChart returns empty when chart date differs", async () => {
    mockLoginFetch(async (u) => {
      if (u.includes("getStorageBatChart")) {
        return Response.json({
          result: 1,
          obj: { date: "2026-07-03", socChart: { capacity: ["80"] } },
        });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    expect(await fetchSocChart(systemConfig, "2026-07-02")).toEqual([]);
  });

  it("fetchSocDailySummary returns min/max for chart day", async () => {
    mockLoginFetch(async (u) => {
      if (u.includes("getStorageBatChart")) {
        return Response.json({
          result: 1,
          obj: {
            date: "2026-07-03",
            socChart: { capacity: ["90", "85", "80"] },
          },
        });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    const summary = await fetchSocDailySummary(systemConfig, "2026-07-03", 7);
    expect(summary).toEqual({
      "2026-07-03": { minSoc: 80, maxSoc: 90 },
    });
  });
});
