import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchData,
  fetchHistory,
  fetchSocChart,
  fetchSocDailySummary,
  withAdapterContext,
} from "../src/services/growatt.js";
import { createMockKV, expectNormalizedShape } from "./helpers.js";

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

  it("fetchHistory merges SOC from getStorageBatChart", async () => {
    mockLoginFetch(async (u) => {
      if (u.includes("getStorageEnergyDayChart")) {
        return Response.json({
          result: 1,
          obj: { ppv: ["1200"], userLoad: ["850"] },
        });
      }
      if (u.includes("getStorageLineChartData")) {
        return Response.json({
          result: 1,
          obj: { batPower: ["-723"] },
        });
      }
      if (u.includes("getStorageBatChart")) {
        return Response.json({
          result: 1,
          obj: { date: "2026-07-03", socChart: { capacity: ["72"] } },
        });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    const data = await fetchHistory(systemConfig, "2026-07-03");
    expect(data.points[0]).toMatchObject({
      time: "00:00",
      solar: 1200,
      load: 850,
      battery: -723,
      soc: 72,
    });
    expect(data.source).toBeUndefined();
  });

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

describe("growatt session credentials", () => {
  let originalFetch;

  const baseCredentials = {
    user: "growatt-user",
    plantId: "42",
    storageSn: "STORAGE-SN",
    nominalPower: 3500,
    nominalPV: 4000,
  };

  const statusPayload = {
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
  };

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("reuses stored sessionCookies without calling /login", async () => {
    const systemConfig = {
      id: "growatt-1",
      name: "Growatt Home",
      credentials: {
        ...baseCredentials,
        sessionCookies: { JSESSIONID: "stored-session" },
      },
    };

    globalThis.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      if (u.endsWith("/login")) {
        throw new Error("login should not be called when sessionCookies are stored");
      }
      if (u.includes("getStorageStatusData")) return Response.json(statusPayload);
      if (u.includes("getStorageTotalData")) {
        return Response.json({ result: 1, obj: { epvToday: "8.3" } });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    await fetchData(systemConfig);
    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/login"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("re-logins with password on session expiry and retries the request", async () => {
    let statusCalls = 0;
    const systemConfig = {
      id: "growatt-1",
      name: "Growatt Home",
      credentials: {
        ...baseCredentials,
        password: "secret",
        sessionCookies: { JSESSIONID: "expired-session" },
      },
    };

    globalThis.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      if (u.endsWith("/login") && init?.method === "POST") {
        return new Response(JSON.stringify({ result: 1 }), {
          headers: { "set-cookie": "JSESSIONID=fresh456; Path=/" },
        });
      }
      if (u.includes("getStorageStatusData")) {
        statusCalls += 1;
        if (statusCalls === 1) {
          return new Response(JSON.stringify({ result: -1, msg: "please login" }), { status: 200 });
        }
        return Response.json(statusPayload);
      }
      if (u.includes("getStorageTotalData")) {
        return Response.json({ result: 1, obj: { epvToday: "8.3" } });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    const data = await fetchData(systemConfig);
    expect(data.battery.soc).toBe(80);
    expect(statusCalls).toBe(2);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/login"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("migrates legacy password credentials to sessionCookies in KV on login", async () => {
    const systems = createMockKV({
      "system:growatt-migrate": JSON.stringify({
        id: "growatt-migrate",
        name: "Growatt Home",
        service: "growatt",
        credentials: {
          user: "growatt-user",
          password: "secret",
          plantId: "42",
          storageSn: "STORAGE-SN",
          nominalPower: 3500,
          nominalPV: 4000,
        },
      }),
    });

    const systemConfig = withAdapterContext(
      {
        id: "growatt-migrate",
        name: "Growatt Home",
        service: "growatt",
        credentials: {
          user: "growatt-user",
          password: "secret",
          plantId: "42",
          storageSn: "STORAGE-SN",
          nominalPower: 3500,
          nominalPV: 4000,
        },
      },
      { SYSTEMS: systems },
    );

    globalThis.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      if (u.endsWith("/login") && init?.method === "POST") {
        return new Response(JSON.stringify({ result: 1 }), {
          headers: { "set-cookie": "JSESSIONID=migrated789; Path=/" },
        });
      }
      if (u.includes("getStorageStatusData")) return Response.json(statusPayload);
      if (u.includes("getStorageTotalData")) {
        return Response.json({ result: 1, obj: { epvToday: "8.3" } });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    await fetchData(systemConfig);

    const stored = await systems.get("system:growatt-migrate", "json");
    expect(stored.credentials.sessionCookies).toEqual({ JSESSIONID: "migrated789" });
    expect(stored.credentials.password).toBeUndefined();
    expect(systemConfig.credentials.password).toBeUndefined();
    expect(systemConfig.credentials.sessionCookies).toEqual({ JSESSIONID: "migrated789" });
  });
});
