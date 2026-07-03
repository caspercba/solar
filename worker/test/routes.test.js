import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker from "../src/index.js";
import * as growatt from "../src/services/growatt.js";
import * as shinemonitor from "../src/services/shinemonitor.js";
import { createMockKV, expectHistorySummaryShape } from "./helpers.js";
import smAuth from "./fixtures/shinemonitor/auth-success.json";
import smDay0703 from "./fixtures/shinemonitor/device-day-2026-07-03.json";
import growattEnergy0703 from "./fixtures/growatt/energy-day-2026-07-03.json";
import growattLineChart from "./fixtures/growatt/line-chart.json";
import growattBatChart0703 from "./fixtures/growatt/bat-chart-2026-07-03.json";

const AUTH = { Authorization: "Bearer test-token" };

function request(path, { method = "GET", headers = {}, body } = {}) {
  const init = { method, headers: { ...headers } };
  if (body != null) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return new Request(`https://proxy.example${path}`, init);
}

function env(overrides = {}) {
  return {
    SYSTEMS: createMockKV(),
    API_TOKEN: "test-token",
    ...overrides,
  };
}

async function call(request, envOverrides = {}) {
  return worker.fetch(request, env(envOverrides));
}

describe("worker routes", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("GET /api/health does not require auth", async () => {
    const res = await call(request("/api/health"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, version: "1.1.0" });
  });

  it("returns 401 when auth token is missing on protected routes", async () => {
    const res = await call(request("/api/systems"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("GET /api/systems lists configured systems without credentials", async () => {
    const systems = env();
    await systems.SYSTEMS.put("_index", JSON.stringify([
      { id: "a", name: "Alpha", service: "shinemonitor" },
    ]));

    const res = await call(request("/api/systems", { headers: AUTH }), systems);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        id: "a",
        name: "Alpha",
        service: "shinemonitor",
        alerts: {
          enabled: false,
          webhookUrl: "",
          lowSocThreshold: 20,
          notifyLowSoc: true,
          notifyGenerator: true,
          cooldownMinutes: 60,
          webhookConfigured: false,
        },
      },
    ]);
  });

  it("POST /api/systems discovers and stores a new system", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("action=auth")) {
        return Response.json({ err: 0, dat: { secret: "s", token: "t" } });
      }
      if (u.includes("queryPlantsInfo")) {
        return Response.json({ err: 0, dat: { info: [{ pid: 1, pname: "Solar Farm" }] } });
      }
      if (u.includes("queryPlantInfo")) {
        return Response.json({
          err: 0,
          dat: { name: "Solar Farm", nominalPower: "5", address: { timezone: 0 } },
        });
      }
      if (u.includes("queryPlantDeviceStatus")) {
        return Response.json({
          err: 0,
          dat: { collector: [{ pn: "P1", device: [{ devcode: 2, sn: "SN", devaddr: 3 }] }] },
        });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    const systems = env();
    const res = await call(
      request("/api/systems", {
        method: "POST",
        headers: AUTH,
        body: {
          service: "shinemonitor",
          name: "My Plant",
          user: "user@test.com",
          password: "password",
        },
      }),
      systems,
    );

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.name).toBe("My Plant");
    expect(json.service).toBe("shinemonitor");
    expect(json.id).toBeTruthy();

    const index = await systems.SYSTEMS.get("_index", "json");
    expect(index).toHaveLength(1);
    expect(index[0].id).toBe(json.id);

    const stored = await systems.SYSTEMS.get(`system:${json.id}`, "json");
    expect(stored.credentials.user).toBe("user@test.com");
    expect(stored.credentials.password).toBeUndefined();
    expect(stored.credentials.pwdSha1).toMatch(/^[a-f0-9]{40}$/);
  });

  it("PUT /api/systems/:id/alerts updates alert settings", async () => {
    const systems = env();
    await systems.SYSTEMS.put("_index", JSON.stringify([
      { id: "s1", name: "Site", service: "growatt" },
    ]));
    await systems.SYSTEMS.put("system:s1", JSON.stringify({
      id: "s1",
      name: "Site",
      service: "growatt",
      credentials: { user: "u", password: "p" },
    }));

    const res = await call(
      request("/api/systems/s1/alerts", {
        method: "PUT",
        headers: AUTH,
        body: {
          enabled: true,
          webhookUrl: "https://hooks.example/alert",
          lowSocThreshold: 15,
        },
      }),
      systems,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.enabled).toBe(true);
    expect(json.lowSocThreshold).toBe(15);
    expect(json.webhookConfigured).toBe(true);

    const stored = await systems.SYSTEMS.get("system:s1", "json");
    expect(stored.alerts.webhookUrl).toBe("https://hooks.example/alert");
  });

  it("DELETE /api/systems/:id removes the system from the index", async () => {
    const systems = env();
    await systems.SYSTEMS.put("_index", JSON.stringify([
      { id: "del-me", name: "Gone", service: "growatt" },
      { id: "keep", name: "Stay", service: "growatt" },
    ]));
    await systems.SYSTEMS.put("system:del-me", JSON.stringify({ id: "del-me" }));

    const res = await call(
      request("/api/systems/del-me", { method: "DELETE", headers: AUTH }),
      systems,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await systems.SYSTEMS.get("system:del-me")).toBeNull();
    const index = await systems.SYSTEMS.get("_index", "json");
    expect(index).toEqual([{ id: "keep", name: "Stay", service: "growatt" }]);
  });

  it("GET /api/systems/:id/history/summary calls adapter.fetchHistorySummary directly", async () => {
    const summarySpy = vi.spyOn(shinemonitor, "fetchHistorySummary");
    summarySpy.mockResolvedValue({
      systemId: "sm1",
      name: "Cabin",
      service: "shinemonitor",
      days: 7,
      endDate: "2026-07-03",
      series: [
        {
          date: "2026-07-03",
          solarKwh: 18.2,
          loadKwh: 14.1,
          peakSolarW: 3000,
          minSoc: 45,
          maxSoc: 98,
          source: "vendor",
        },
      ],
    });

    const systems = env();
    await systems.SYSTEMS.put("_index", JSON.stringify([{ id: "sm1", name: "Cabin", service: "shinemonitor" }]));
    await systems.SYSTEMS.put(
      "system:sm1",
      JSON.stringify({
        id: "sm1",
        name: "Cabin",
        service: "shinemonitor",
        credentials: { user: "u", pwdSha1: "abc", plantId: "100" },
      }),
    );

    const res = await call(
      request("/api/systems/sm1/history/summary?days=7&end=2026-07-03", { headers: AUTH }),
      systems,
    );

    expect(res.status).toBe(200);
    expect(summarySpy).toHaveBeenCalledOnce();
    expect(summarySpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sm1", service: "shinemonitor" }),
      7,
      "2026-07-03",
    );
    const json = await res.json();
    expectHistorySummaryShape(json);
    expect(json.systemId).toBe("sm1");
    expect(json.series[0].source).toBe("vendor");
  });

  it("GET /api/systems/:id/history/summary uses ShineMonitor fetchHistorySummary", async () => {
    const systems = env();
    await systems.SYSTEMS.put("_index", JSON.stringify([{ id: "sm1", name: "Cabin", service: "shinemonitor" }]));
    await systems.SYSTEMS.put(
      "system:sm1",
      JSON.stringify({
        id: "sm1",
        name: "Cabin",
        service: "shinemonitor",
        credentials: {
          user: "user@example.com",
          pwdSha1: "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8",
          plantId: "100",
          device: { pn: "PN1", devcode: "1", sn: "SN1", devaddr: "1" },
          timezone: 0,
        },
      }),
    );

    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("action=auth")) {
        return Response.json(smAuth);
      }
      if (u.includes("queryDeviceDataOneDayPaging")) {
        return Response.json({
          err: 0,
          dat: {
            title: [
              { title: "Timestamp" },
              { title: "Battery Voltage" },
              { title: "Batt Current" },
              { title: "Charger Power" },
              { title: "PLoad" },
            ],
            total: 1,
            row: [{
              field: ["2026-07-03 10:00:00", "50.0", "0", "2400", "500"],
            }],
          },
        });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    const res = await call(
      request("/api/systems/sm1/history/summary?days=1&end=2026-07-03", { headers: AUTH }),
      systems,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.systemId).toBe("sm1");
    expect(json.series).toHaveLength(1);
    expect(json.series[0]).toMatchObject({
      date: "2026-07-03",
      solarKwh: 0.2,
      loadKwh: 0,
      peakSolarW: 2400,
      source: "vendor",
    });
  });

  it("GET /api/systems/:id/history/summary uses Growatt fetchHistorySummary", async () => {
    const systems = env();
    await systems.SYSTEMS.put("_index", JSON.stringify([{ id: "gw1", name: "Home", service: "growatt" }]));
    await systems.SYSTEMS.put(
      "system:gw1",
      JSON.stringify({
        id: "gw1",
        name: "Home",
        service: "growatt",
        credentials: {
          user: "u",
          password: "p",
          plantId: "42",
          storageSn: "SN1",
        },
      }),
    );

    globalThis.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      if (u.endsWith("/login") && init?.method === "POST") {
        return new Response(JSON.stringify({ result: 1 }), {
          headers: { "set-cookie": "JSESSIONID=abc123; Path=/" },
        });
      }
      if (u.includes("getStorageEnergyDayChart")) {
        return Response.json(growattEnergy0703);
      }
      if (u.includes("getStorageLineChartData")) {
        return Response.json(growattLineChart);
      }
      if (u.includes("getStorageBatChart")) {
        return Response.json(growattBatChart0703);
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    const res = await call(
      request("/api/systems/gw1/history/summary?days=1&end=2026-07-03", { headers: AUTH }),
      systems,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expectHistorySummaryShape(json);
    expect(json.systemId).toBe("gw1");
    expect(json.series).toHaveLength(1);
    expect(json.series[0]).toMatchObject({
      date: "2026-07-03",
      solarKwh: 0.5,
      loadKwh: 0.1,
      peakSolarW: 3000,
      source: "vendor",
    });
  });

  it("GET /api/systems/:id/history/summary rejects invalid days param", async () => {
    const systems = env();
    await systems.SYSTEMS.put("_index", JSON.stringify([{ id: "sm1", name: "Cabin", service: "shinemonitor" }]));
    await systems.SYSTEMS.put(
      "system:sm1",
      JSON.stringify({ id: "sm1", name: "Cabin", service: "shinemonitor", credentials: {} }),
    );

    for (const query of ["days=0", "days=91", "days=abc"]) {
      const res = await call(
        request(`/api/systems/sm1/history/summary?${query}`, { headers: AUTH }),
        systems,
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid days (expected 1–90)" });
    }
  });

  it("GET /api/systems/:id/history/summary accepts days at clamp boundaries", async () => {
    const systems = env();
    await systems.SYSTEMS.put("_index", JSON.stringify([{ id: "sm1", name: "Cabin", service: "shinemonitor" }]));
    await systems.SYSTEMS.put(
      "system:sm1",
      JSON.stringify({
        id: "sm1",
        name: "Cabin",
        service: "shinemonitor",
        credentials: {
          user: "user@example.com",
          pwdSha1: "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8",
          plantId: "100",
          device: { pn: "PN1", devcode: "1", sn: "SN1", devaddr: "1" },
          timezone: 0,
        },
      }),
    );

    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("action=auth")) {
        return Response.json(smAuth);
      }
      if (u.includes("queryDeviceDataOneDayPaging")) {
        return Response.json(smDay0703);
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    const res = await call(
      request("/api/systems/sm1/history/summary?days=90&end=2026-07-03", { headers: AUTH }),
      systems,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.days).toBe(90);
    expect(json.series).toHaveLength(90);
  });

  it("returns 404 for unknown routes", async () => {
    const res = await call(request("/api/unknown", { headers: AUTH }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("GET /api/systems/:id/history calls adapter.fetchHistory directly", async () => {
    const fetchHistorySpy = vi.spyOn(growatt, "fetchHistory");
    fetchHistorySpy.mockResolvedValue({
      systemId: "s1",
      name: "Home",
      service: "growatt",
      date: "2026-07-03",
      timezoneOffset: -6,
      intervalMinutes: 5,
      points: [{ time: "00:00", solar: 1200, load: 850, battery: -723, soc: 72 }],
    });

    const systems = env();
    await systems.SYSTEMS.put("_index", JSON.stringify([{ id: "s1", name: "Home", service: "growatt" }]));
    await systems.SYSTEMS.put("system:s1", JSON.stringify({
      id: "s1",
      name: "Home",
      service: "growatt",
      credentials: {
        user: "u",
        password: "p",
        plantId: "42",
        storageSn: "SN1",
      },
    }));

    const res = await call(
      request("/api/systems/s1/history?date=2026-07-03", { headers: AUTH }),
      systems,
    );

    expect(res.status).toBe(200);
    expect(fetchHistorySpy).toHaveBeenCalledOnce();
    expect(fetchHistorySpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1", service: "growatt" }),
      "2026-07-03",
    );
    const json = await res.json();
    expect(json.systemId).toBe("s1");
    expect(json.date).toBe("2026-07-03");
    expect(json.points[0]).toMatchObject({ time: "00:00", solar: 1200, load: 850, battery: -723, soc: 72 });
    expect(json.source).toBeUndefined();
  });

  it("GET /api/systems/:id/history returns vendor intraday data via Growatt adapter", async () => {
    globalThis.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      if (u.endsWith("/login") && init?.method === "POST") {
        return new Response(JSON.stringify({ result: 1 }), {
          headers: { "set-cookie": "JSESSIONID=abc123; Path=/" },
        });
      }
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

    const systems = env();
    await systems.SYSTEMS.put("_index", JSON.stringify([{ id: "s1", name: "Home", service: "growatt" }]));
    await systems.SYSTEMS.put("system:s1", JSON.stringify({
      id: "s1",
      name: "Home",
      service: "growatt",
      credentials: {
        user: "u",
        password: "p",
        plantId: "42",
        storageSn: "SN1",
      },
    }));

    const res = await call(
      request("/api/systems/s1/history?date=2026-07-03", { headers: AUTH }),
      systems,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.systemId).toBe("s1");
    expect(json.date).toBe("2026-07-03");
    expect(json.points[0]).toMatchObject({ time: "00:00", solar: 1200, load: 850, battery: -723, soc: 72 });
    expect(json.source).toBeUndefined();
  });

  it("GET /api/systems/:id/history rejects invalid date", async () => {
    const systems = env();
    await systems.SYSTEMS.put("_index", JSON.stringify([{ id: "s1", name: "Home", service: "growatt" }]));
    await systems.SYSTEMS.put("system:s1", JSON.stringify({ id: "s1", service: "growatt", credentials: {} }));

    const res = await call(
      request("/api/systems/s1/history?date=not-a-date", { headers: AUTH }),
      systems,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid date (expected YYYY-MM-DD)" });
  });

  it("GET /api/systems/:id/history returns 404 for unknown system", async () => {
    const res = await call(
      request("/api/systems/missing/history", { headers: AUTH }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "System not found" });
  });
});
