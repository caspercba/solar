import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker from "../src/index.js";
import * as growatt from "../src/services/growatt.js";
import * as shinemonitor from "../src/services/shinemonitor.js";
import { createMockKV, expectHistorySummaryShape } from "./helpers.js";
import { resetRateLimitStore, DATA_RATE_LIMIT_MAX } from "../src/rateLimit.js";
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
    resetRateLimitStore();
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

  it("returns 503 on protected routes when PRODUCTION is enabled and API_TOKEN is unset", async () => {
    const res = await call(request("/api/systems", { headers: AUTH }), {
      API_TOKEN: undefined,
      PRODUCTION: "true",
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "Service misconfigured: API_TOKEN is required in this environment",
    });
  });

  it("GET /api/health still works when PRODUCTION is enabled and API_TOKEN is unset", async () => {
    const res = await call(request("/api/health"), { API_TOKEN: undefined, PRODUCTION: "true" });
    expect(res.status).toBe(200);
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
        username: "",
        alerts: {
          enabled: false,
          webhookUrl: "",
          lowSocThreshold: 20,
          notifyLowSoc: true,
          notifyGenerator: true,
          cooldownMinutes: 60,
          webhookConfigured: false,
        },
        gridDetect: {
          voltageMin: 30,
          powerMin: 5,
        },
        gridInputLabel: "generator",
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

  it("POST /api/systems returns requiresDeviceSelection for multi-inverter ShineMonitor plants", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("action=auth")) {
        return Response.json({ err: 0, dat: { secret: "s", token: "t" } });
      }
      if (u.includes("queryPlantsInfo")) {
        return Response.json({ err: 0, dat: { info: [{ pid: 9, pname: "Dual Inverter" }] } });
      }
      if (u.includes("queryPlantInfo")) {
        return Response.json({
          err: 0,
          dat: { name: "Dual Inverter", nominalPower: "8", address: { timezone: 0 } },
        });
      }
      if (u.includes("queryPlantDeviceStatus")) {
        return Response.json({
          err: 0,
          dat: {
            collector: [{
              pn: "P1",
              alias: "RTU",
              device: [
                { devcode: 1, sn: "SN-A", devaddr: 1 },
                { devcode: 1, sn: "SN-B", devaddr: 2 },
              ],
            }],
          },
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
          user: "user@test.com",
          password: "password",
          plantId: "9",
        },
      }),
      systems,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.requiresDeviceSelection).toBe(true);
    expect(json.devices).toHaveLength(2);
    expect(json.devices[0].key).toBe("P1|SN-A|1");
  });

  it("POST /api/systems stores aggregate multi-device ShineMonitor config", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("action=auth")) {
        return Response.json({ err: 0, dat: { secret: "s", token: "t" } });
      }
      if (u.includes("queryPlantsInfo")) {
        return Response.json({ err: 0, dat: { info: [{ pid: 9, pname: "Dual Inverter" }] } });
      }
      if (u.includes("queryPlantInfo")) {
        return Response.json({
          err: 0,
          dat: { name: "Dual Inverter", nominalPower: "8", address: { timezone: 0 } },
        });
      }
      if (u.includes("queryPlantDeviceStatus")) {
        return Response.json({
          err: 0,
          dat: {
            collector: [{
              pn: "P1",
              alias: "RTU",
              device: [
                { devcode: 1, sn: "SN-A", devaddr: 1 },
                { devcode: 1, sn: "SN-B", devaddr: 2 },
              ],
            }],
          },
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
          name: "Dual",
          user: "user@test.com",
          password: "password",
          plantId: "9",
          deviceMode: "aggregate",
        },
      }),
      systems,
    );

    expect(res.status).toBe(201);
    const json = await res.json();
    const stored = await systems.SYSTEMS.get(`system:${json.id}`, "json");
    expect(stored.credentials.deviceMode).toBe("aggregate");
    expect(stored.credentials.devices).toHaveLength(2);
  });

  it("POST /api/systems discovers Growatt and stores sessionCookies alongside password", async () => {
    globalThis.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      if (u.endsWith("/login") && init?.method === "POST") {
        return new Response(JSON.stringify({ result: 1 }), {
          headers: { "set-cookie": "JSESSIONID=growatt-sess; Path=/" },
        });
      }
      if (u.includes("getPlantListTitle")) {
        return Response.json([{ id: 42, plantName: "Growatt Farm" }]);
      }
      if (u.includes("getDevicesByPlantList")) {
        return Response.json({
          result: 1,
          obj: { datas: [{ sn: "SN1", nominalPower: "5000", deviceModel: "MOD" }] },
        });
      }
      if (u.includes("getPlantData")) {
        return Response.json({ result: 1, obj: { nominalPower: "6000" } });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    const systems = env();
    const res = await call(
      request("/api/systems", {
        method: "POST",
        headers: AUTH,
        body: {
          service: "growatt",
          name: "Growatt Site",
          user: "growatt@test.com",
          password: "password",
        },
      }),
      systems,
    );

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.service).toBe("growatt");
    expect(json.name).toBe("Growatt Site");

    const stored = await systems.SYSTEMS.get(`system:${json.id}`, "json");
    expect(stored.credentials.user).toBe("growatt@test.com");
    expect(stored.credentials.password).toBe("password");
    expect(stored.credentials.sessionCookies).toEqual({ JSESSIONID: "growatt-sess" });
    expect(stored.credentials.plantId).toBe("42");
    expect(stored.credentials.storageSn).toBe("SN1");
  });

  it("PUT /api/systems/:id/credentials updates credentials after re-discovery", async () => {
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
    await systems.SYSTEMS.put("_index", JSON.stringify([
      { id: "s1", name: "Cabin", service: "shinemonitor" },
    ]));
    await systems.SYSTEMS.put("system:s1", JSON.stringify({
      id: "s1",
      name: "Cabin",
      service: "shinemonitor",
      createdAt: "2026-01-01T00:00:00.000Z",
      credentials: {
        user: "old@test.com",
        pwdSha1: "oldhash",
        plantId: "1",
        device: { pn: "P0", devcode: "1", sn: "OLD", devaddr: "1" },
        timezone: 0,
      },
    }));

    const res = await call(
      request("/api/systems/s1/credentials", {
        method: "PUT",
        headers: AUTH,
        body: {
          user: "new@test.com",
          password: "new-password",
        },
      }),
      systems,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.username).toBe("new@test.com");
    expect(json.id).toBe("s1");
    expect(json.name).toBe("Cabin");

    const stored = await systems.SYSTEMS.get("system:s1", "json");
    expect(stored.credentials.user).toBe("new@test.com");
    expect(stored.credentials.pwdSha1).toMatch(/^[a-f0-9]{40}$/);
    expect(stored.credentials.pwdSha1).not.toBe("oldhash");
    expect(stored.credentials.plantId).toBe("1");
    expect(stored.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("PUT /api/systems/:id/credentials returns 502 and leaves system unchanged on auth failure", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("action=auth")) {
        return Response.json({ err: 1, desc: "Invalid credentials" });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    const systems = env();
    await systems.SYSTEMS.put("_index", JSON.stringify([
      { id: "s1", name: "Cabin", service: "shinemonitor" },
    ]));
    const original = {
      id: "s1",
      name: "Cabin",
      service: "shinemonitor",
      credentials: {
        user: "old@test.com",
        pwdSha1: "keep-me",
        plantId: "1",
      },
    };
    await systems.SYSTEMS.put("system:s1", JSON.stringify(original));

    const res = await call(
      request("/api/systems/s1/credentials", {
        method: "PUT",
        headers: AUTH,
        body: {
          user: "bad@test.com",
          password: "wrong",
        },
      }),
      systems,
    );

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: expect.stringContaining("Discovery failed") });

    const stored = await systems.SYSTEMS.get("system:s1", "json");
    expect(stored.credentials.user).toBe("old@test.com");
    expect(stored.credentials.pwdSha1).toBe("keep-me");
  });

  it("PUT /api/systems/:id/credentials returns plant picker without updating system", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("action=auth")) {
        return Response.json({ err: 0, dat: { secret: "s", token: "t" } });
      }
      if (u.includes("queryPlantsInfo")) {
        return Response.json({
          err: 0,
          dat: {
            info: [
              { pid: 1, pname: "Farm A" },
              { pid: 2, pname: "Farm B" },
            ],
          },
        });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    const systems = env();
    await systems.SYSTEMS.put("_index", JSON.stringify([
      { id: "s1", name: "Cabin", service: "shinemonitor" },
    ]));
    await systems.SYSTEMS.put("system:s1", JSON.stringify({
      id: "s1",
      name: "Cabin",
      service: "shinemonitor",
      credentials: { user: "old@test.com", pwdSha1: "keep-me" },
    }));

    const res = await call(
      request("/api/systems/s1/credentials", {
        method: "PUT",
        headers: AUTH,
        body: {
          user: "new@test.com",
          password: "new-password",
        },
      }),
      systems,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.requiresPlantSelection).toBe(true);
    expect(json.plants).toHaveLength(2);

    const stored = await systems.SYSTEMS.get("system:s1", "json");
    expect(stored.credentials.user).toBe("old@test.com");
    expect(stored.credentials.pwdSha1).toBe("keep-me");
  });

  it("PUT /api/systems/:id/credentials returns 404 for unknown system", async () => {
    const res = await call(
      request("/api/systems/missing/credentials", {
        method: "PUT",
        headers: AUTH,
        body: { user: "u", password: "p" },
      }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "System not found" });
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

  it("PUT /api/systems/:id/grid-detect updates generator detection thresholds", async () => {
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
      request("/api/systems/s1/grid-detect", {
        method: "PUT",
        headers: AUTH,
        body: { voltageMin: 25, powerMin: 10 },
      }),
      systems,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ voltageMin: 25, powerMin: 10 });

    const stored = await systems.SYSTEMS.get("system:s1", "json");
    expect(stored.gridDetect).toEqual({ voltageMin: 25, powerMin: 10 });
  });

  it("POST /api/systems stores gridInputLabel and defaults to generator", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("action=auth")) {
        return Response.json({ err: 0, dat: { secret: "s", token: "t" } });
      }
      if (u.includes("queryPlantsInfo")) {
        return Response.json({ err: 0, dat: { info: [{ pid: 1, pname: "Grid Tied" }] } });
      }
      if (u.includes("queryPlantInfo")) {
        return Response.json({
          err: 0,
          dat: { name: "Grid Tied", nominalPower: "5", address: { timezone: 0 } },
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
          name: "Grid Home",
          user: "user@test.com",
          password: "password",
          gridInputLabel: "grid",
        },
      }),
      systems,
    );

    expect(res.status).toBe(201);
    const json = await res.json();
    const stored = await systems.SYSTEMS.get(`system:${json.id}`, "json");
    expect(stored.gridInputLabel).toBe("grid");

    const listRes = await call(request("/api/systems", { headers: AUTH }), systems);
    const list = await listRes.json();
    expect(list[0].gridInputLabel).toBe("grid");
  });

  it("PUT /api/systems/:id/grid-input-label updates label and round-trips via GET /api/systems", async () => {
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

    const putRes = await call(
      request("/api/systems/s1/grid-input-label", {
        method: "PUT",
        headers: AUTH,
        body: { gridInputLabel: "grid" },
      }),
      systems,
    );

    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toEqual({ gridInputLabel: "grid" });

    const stored = await systems.SYSTEMS.get("system:s1", "json");
    expect(stored.gridInputLabel).toBe("grid");

    const getRes = await call(request("/api/systems/s1/grid-input-label", { headers: AUTH }), systems);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({ gridInputLabel: "grid" });

    const listRes = await call(request("/api/systems", { headers: AUTH }), systems);
    const list = await listRes.json();
    expect(list[0].gridInputLabel).toBe("grid");
  });

  it("GET /api/systems defaults gridInputLabel to generator for legacy systems", async () => {
    const systems = env();
    await systems.SYSTEMS.put("_index", JSON.stringify([
      { id: "legacy", name: "Legacy", service: "shinemonitor" },
    ]));
    await systems.SYSTEMS.put("system:legacy", JSON.stringify({
      id: "legacy",
      name: "Legacy",
      service: "shinemonitor",
      credentials: { user: "u", password: "p" },
    }));

    const res = await call(request("/api/systems", { headers: AUTH }), systems);
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list[0].gridInputLabel).toBe("generator");
  });

  it("GET /api/systems includes gridDetect settings", async () => {
    const systems = env();
    await systems.SYSTEMS.put("_index", JSON.stringify([
      { id: "s1", name: "Site", service: "shinemonitor" },
    ]));
    await systems.SYSTEMS.put("system:s1", JSON.stringify({
      id: "s1",
      name: "Site",
      service: "shinemonitor",
      credentials: { user: "u", password: "p" },
      gridDetect: { voltageMin: 22, powerMin: 8 },
    }));

    const res = await call(request("/api/systems", { headers: AUTH }), systems);
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list[0].gridDetect).toEqual({ voltageMin: 22, powerMin: 8 });
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

  it("GET /api/systems/:id/history returns 502 JSON when adapter.fetchHistory throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(growatt, "fetchHistory").mockRejectedValue(new Error("vendor timeout"));

    const systems = env();
    await systems.SYSTEMS.put("_index", JSON.stringify([{ id: "s1", name: "Home", service: "growatt" }]));
    await systems.SYSTEMS.put("system:s1", JSON.stringify({
      id: "s1",
      name: "Home",
      service: "growatt",
      credentials: { user: "u", password: "p", plantId: "42", storageSn: "SN1" },
    }));

    const res = await call(
      request("/api/systems/s1/history?date=2026-07-03", { headers: AUTH }),
      systems,
    );

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "History fetch failed: vendor timeout" });
    expect(consoleError).toHaveBeenCalled();
    const logLine = consoleError.mock.calls.find((c) => {
      try {
        const parsed = JSON.parse(c[0]);
        return parsed.event === "adapter_history_failed";
      } catch {
        return false;
      }
    });
    expect(logLine).toBeDefined();
    const parsed = JSON.parse(logLine[0]);
    expect(parsed).toMatchObject({
      level: "error",
      event: "adapter_history_failed",
      systemId: "s1",
      service: "growatt",
      route: "GET /api/systems/:id/history",
    });

    consoleError.mockRestore();
  });

  it("OPTIONS preflight reflects the request origin with CORS headers when ALLOWED_ORIGINS is unset", async () => {
    const res = await call(
      request("/api/systems", { method: "OPTIONS", headers: { Origin: "https://app.example" } }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example");
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, PUT, DELETE, OPTIONS");
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type, Authorization");
    expect(res.headers.get("Access-Control-Max-Age")).toBe("86400");
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("OPTIONS preflight returns matching CORS headers when the origin is in ALLOWED_ORIGINS", async () => {
    const res = await call(
      request("/api/systems", { method: "OPTIONS", headers: { Origin: "https://allowed.example" } }),
      { ALLOWED_ORIGINS: "https://allowed.example,https://other.example" },
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://allowed.example");
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("OPTIONS preflight is rejected with 403 and no CORS headers when the origin is not allowed", async () => {
    const res = await call(
      request("/api/systems", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }),
      { ALLOWED_ORIGINS: "https://allowed.example" },
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Methods")).toBeNull();
  });

  it("GET /api/systems/:id/ha returns flat JSON for Home Assistant", async () => {
    vi.spyOn(growatt, "fetchData").mockResolvedValue({
      systemId: "s1",
      name: "Home",
      service: "growatt",
      timestamp: "2026-07-03 12:00:00",
      battery: { voltage: 48, soc: 72, current: -10, power: -480 },
      solar: { power: 1200, voltage: 95 },
      load: { power: 850, percent: 24 },
      grid: { power: 0, voltage: 0, active: false },
      inverter: { ratedPower: 5000, nominalPV: 5000 },
      status: "PV Charging",
      energyToday: 12.4,
    });

    const systems = env();
    await systems.SYSTEMS.put("_index", JSON.stringify([{ id: "s1", name: "Home", service: "growatt" }]));
    await systems.SYSTEMS.put("system:s1", JSON.stringify({
      id: "s1",
      name: "Home",
      service: "growatt",
      credentials: { user: "u", password: "p", plantId: "42", storageSn: "SN1" },
    }));

    const res = await call(
      request("/api/systems/s1/ha", { headers: AUTH }),
      systems,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      schema_version: 1,
      system_id: "s1",
      name: "Home",
      service: "growatt",
      timestamp: "2026-07-03 12:00:00",
      battery_soc: 72,
      battery_voltage: 48,
      battery_current: -10,
      battery_power: -480,
      solar_power: 1200,
      solar_voltage: 95,
      load_power: 850,
      load_percent: 24,
      grid_power: 0,
      grid_voltage: 0,
      grid_active: false,
      inverter_rated_power: 5000,
      inverter_nominal_pv: 5000,
      status: "PV Charging",
      energy_today_kwh: 12.4,
    });
  });

  it("GET /api/systems/:id/ha returns 404 for unknown system", async () => {
    const res = await call(
      request("/api/systems/missing/ha", { headers: AUTH }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "System not found" });
  });

  it("GET /api/systems/:id/data logs structured error on adapter failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.spyOn(growatt, "fetchData").mockRejectedValue(new Error("vendor offline"));

    const systems = env();
    await systems.SYSTEMS.put("_index", JSON.stringify([{ id: "s1", name: "Home", service: "growatt" }]));
    await systems.SYSTEMS.put("system:s1", JSON.stringify({
      id: "s1",
      name: "Home",
      service: "growatt",
      credentials: { user: "u", password: "secret-password" },
    }));

    const res = await call(
      request("/api/systems/s1/data", { headers: AUTH }),
      systems,
    );

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Fetch failed: vendor offline" });
    expect(consoleError).toHaveBeenCalled();
    const logLine = consoleError.mock.calls.find((c) => {
      try {
        const parsed = JSON.parse(c[0]);
        return parsed.event === "adapter_fetch_failed";
      } catch {
        return false;
      }
    });
    expect(logLine).toBeDefined();
    const parsed = JSON.parse(logLine[0]);
    expect(parsed).toMatchObject({
      level: "error",
      event: "adapter_fetch_failed",
      systemId: "s1",
      service: "growatt",
      route: "GET /api/systems/:id/data",
    });
    expect(JSON.stringify(parsed)).not.toContain("secret-password");

    consoleError.mockRestore();
  });

  it("GET /api/systems/:id/data returns 429 when rate limit exceeded", async () => {
    const fetchDataSpy = vi.spyOn(growatt, "fetchData");
    fetchDataSpy.mockResolvedValue({
      systemId: "s1",
      name: "Home",
      service: "growatt",
      timestamp: "2026-07-03 12:00:00",
      battery: { voltage: 48, soc: 50, current: 0, power: 0 },
      solar: { power: 0, voltage: 0 },
      load: { power: 0, percent: 0 },
      grid: { power: 0, voltage: 0, active: false },
      inverter: { ratedPower: 5000, nominalPV: 5000 },
      status: "Idle",
    });

    const systems = env();
    await systems.SYSTEMS.put("_index", JSON.stringify([{ id: "s1", name: "Home", service: "growatt" }]));
    await systems.SYSTEMS.put("system:s1", JSON.stringify({
      id: "s1",
      name: "Home",
      service: "growatt",
      credentials: { user: "u", password: "p", plantId: "42", storageSn: "SN1" },
    }));

    for (let i = 0; i < DATA_RATE_LIMIT_MAX; i += 1) {
      const res = await call(
        request("/api/systems/s1/data", { headers: AUTH }),
        systems,
      );
      expect(res.status).toBe(200);
    }

    const blocked = await call(
      request("/api/systems/s1/data", { headers: AUTH }),
      systems,
    );
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "Too many requests" });
    expect(blocked.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(fetchDataSpy).toHaveBeenCalledTimes(DATA_RATE_LIMIT_MAX);
  });

  it("GET /api/systems/all/data shares the same per-token rate limit", async () => {
    const fetchDataSpy = vi.spyOn(growatt, "fetchData");
    fetchDataSpy.mockResolvedValue({
      systemId: "s1",
      name: "Home",
      service: "growatt",
      timestamp: "2026-07-03 12:00:00",
      battery: { voltage: 48, soc: 50, current: 0, power: 0 },
      solar: { power: 0, voltage: 0 },
      load: { power: 0, percent: 0 },
      grid: { power: 0, voltage: 0, active: false },
      inverter: { ratedPower: 5000, nominalPV: 5000 },
      status: "Idle",
    });

    const systems = env();
    await systems.SYSTEMS.put("_index", JSON.stringify([{ id: "s1", name: "Home", service: "growatt" }]));
    await systems.SYSTEMS.put("system:s1", JSON.stringify({
      id: "s1",
      name: "Home",
      service: "growatt",
      credentials: { user: "u", password: "p", plantId: "42", storageSn: "SN1" },
    }));

    for (let i = 0; i < DATA_RATE_LIMIT_MAX - 1; i += 1) {
      await call(request("/api/systems/s1/data", { headers: AUTH }), systems);
    }

    const allDataRes = await call(
      request("/api/systems/all/data", { headers: AUTH }),
      systems,
    );
    expect(allDataRes.status).toBe(200);

    const blocked = await call(
      request("/api/systems/s1/data", { headers: AUTH }),
      systems,
    );
    expect(blocked.status).toBe(429);
  });

  describe("audit log (ADR 0002 Phase 1)", () => {
    function auditEntries(consoleLogSpy) {
      return consoleLogSpy.mock.calls
        .map((c) => {
          try {
            return JSON.parse(c[0]);
          } catch {
            return null;
          }
        })
        .filter((entry) => entry?.event === "audit");
    }

    it("POST /api/systems emits an audit entry on success with actorId, action, resource, outcome, clientIp", async () => {
      const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

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
          headers: { ...AUTH, "CF-Connecting-IP": "203.0.113.7" },
          body: {
            service: "shinemonitor",
            name: "My Plant",
            user: "user@test.com",
            password: "super-secret-password",
          },
        }),
        systems,
      );
      expect(res.status).toBe(201);
      const json = await res.json();

      const entries = auditEntries(consoleLog);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorId: "shared",
        action: "system.create",
        resource: json.id,
        method: "POST",
        path: "/api/systems",
        clientIp: "203.0.113.7",
        outcome: "success",
        status: 201,
      });
      expect(entries[0].requestId).toBeTruthy();
      expect(JSON.stringify(entries[0])).not.toContain("super-secret-password");

      consoleLog.mockRestore();
    });

    it("POST /api/systems emits an audit entry with outcome error and null resource on validation failure", async () => {
      const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

      const res = await call(
        request("/api/systems", {
          method: "POST",
          headers: AUTH,
          body: { service: "growatt" },
        }),
        env(),
      );
      expect(res.status).toBe(400);

      const entries = auditEntries(consoleLog);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorId: "shared",
        action: "system.create",
        resource: null,
        outcome: "error",
        status: 400,
      });

      consoleLog.mockRestore();
    });

    it("PUT /api/systems/:id/credentials emits an audit entry and redacts the password", async () => {
      const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

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
      await systems.SYSTEMS.put("_index", JSON.stringify([
        { id: "sm1", name: "Solar Farm", service: "shinemonitor" },
      ]));
      await systems.SYSTEMS.put("system:sm1", JSON.stringify({
        id: "sm1",
        name: "Solar Farm",
        service: "shinemonitor",
        credentials: { user: "old@test.com", pwdSha1: "x", plantId: 1, device: { pn: "P1", sn: "SN", devcode: 2, devaddr: 3 } },
      }));

      const res = await call(
        request("/api/systems/sm1/credentials", {
          method: "PUT",
          headers: AUTH,
          body: { user: "new@test.com", password: "rotated-secret" },
        }),
        systems,
      );
      expect(res.status).toBe(200);

      const entries = auditEntries(consoleLog);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorId: "shared",
        action: "credentials.rotate",
        resource: "sm1",
        method: "PUT",
        path: "/api/systems/sm1/credentials",
        outcome: "success",
        status: 200,
      });
      expect(JSON.stringify(entries[0])).not.toContain("rotated-secret");

      consoleLog.mockRestore();
    });

    it("PUT /api/systems/:id/alerts emits an audit entry", async () => {
      const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

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
          body: { enabled: true, webhookUrl: "https://hooks.example/alert" },
        }),
        systems,
      );
      expect(res.status).toBe(200);

      const entries = auditEntries(consoleLog);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorId: "shared",
        action: "alerts.update",
        resource: "s1",
        method: "PUT",
        path: "/api/systems/s1/alerts",
        outcome: "success",
        status: 200,
      });
      expect(JSON.stringify(entries[0])).not.toContain("hooks.example/alert");

      consoleLog.mockRestore();
    });

    it("PUT /api/systems/:id/alerts emits an audit entry with outcome error for unknown system", async () => {
      const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

      const res = await call(
        request("/api/systems/missing/alerts", {
          method: "PUT",
          headers: AUTH,
          body: { enabled: true },
        }),
        env(),
      );
      expect(res.status).toBe(404);

      const entries = auditEntries(consoleLog);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        action: "alerts.update",
        resource: "missing",
        outcome: "error",
        status: 404,
      });

      consoleLog.mockRestore();
    });

    it("DELETE /api/systems/:id emits an audit entry", async () => {
      const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

      const systems = env();
      await systems.SYSTEMS.put("_index", JSON.stringify([
        { id: "del-me", name: "Gone", service: "growatt" },
      ]));
      await systems.SYSTEMS.put("system:del-me", JSON.stringify({ id: "del-me" }));

      const res = await call(
        request("/api/systems/del-me", { method: "DELETE", headers: AUTH }),
        systems,
      );
      expect(res.status).toBe(200);

      const entries = auditEntries(consoleLog);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorId: "shared",
        action: "system.delete",
        resource: "del-me",
        method: "DELETE",
        path: "/api/systems/del-me",
        outcome: "success",
        status: 200,
      });

      consoleLog.mockRestore();
    });

    it("does not emit an audit entry for read-only routes", async () => {
      const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

      const systems = env();
      await systems.SYSTEMS.put("_index", JSON.stringify([]));

      await call(request("/api/systems", { headers: AUTH }), systems);
      await call(request("/api/systems/all/data", { headers: AUTH }), systems);

      const entries = auditEntries(consoleLog);
      expect(entries).toHaveLength(0);

      consoleLog.mockRestore();
    });
  });

  describe("per-user API keys and roles (ADR 0002 Phase 2)", () => {
    async function mintToken(systems, role, label = "test-key") {
      const res = await call(
        request("/api/admin/tokens", { method: "POST", headers: AUTH, body: { label, role } }),
        systems,
      );
      expect(res.status).toBe(201);
      return res.json();
    }

    it("POST /api/admin/tokens mints a token (admin only)", async () => {
      const systems = env();
      const minted = await mintToken(systems, "read", "guest");
      expect(minted.token).toBeTruthy();
      expect(minted.role).toBe("read");
      expect(minted.id).toBeTruthy();
    });

    it("POST /api/admin/tokens is forbidden for a read-role caller", async () => {
      const systems = env();
      const guest = await mintToken(systems, "read", "guest");

      const res = await call(
        request("/api/admin/tokens", {
          method: "POST",
          headers: { Authorization: `Bearer ${guest.token}` },
          body: { label: "escalate", role: "admin" },
        }),
        systems,
      );
      expect(res.status).toBe(403);
    });

    it("a minted admin-role token can perform mutating routes", async () => {
      const systems = env();
      const admin = await mintToken(systems, "admin", "maintainer");
      await systems.SYSTEMS.put("_index", JSON.stringify([
        { id: "s1", name: "Cabin", service: "growatt" },
      ]));
      await systems.SYSTEMS.put("system:s1", JSON.stringify({ id: "s1", name: "Cabin", service: "growatt" }));

      const res = await call(
        request("/api/systems/s1", { method: "DELETE", headers: { Authorization: `Bearer ${admin.token}` } }),
        systems,
      );
      expect(res.status).toBe(200);
    });

    it("a minted read-role token is blocked from mutating routes: POST /api/systems", async () => {
      const systems = env();
      const guest = await mintToken(systems, "read", "guest");

      const res = await call(
        request("/api/systems", {
          method: "POST",
          headers: { Authorization: `Bearer ${guest.token}` },
          body: { service: "growatt", user: "u", password: "p" },
        }),
        systems,
      );
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Forbidden: read-only token cannot perform this action" });
    });

    it("a minted read-role token is blocked from mutating routes: DELETE /api/systems/:id", async () => {
      const systems = env();
      const guest = await mintToken(systems, "read", "guest");
      await systems.SYSTEMS.put("_index", JSON.stringify([
        { id: "s1", name: "Cabin", service: "growatt" },
      ]));
      await systems.SYSTEMS.put("system:s1", JSON.stringify({ id: "s1", name: "Cabin", service: "growatt" }));

      const res = await call(
        request("/api/systems/s1", { method: "DELETE", headers: { Authorization: `Bearer ${guest.token}` } }),
        systems,
      );
      expect(res.status).toBe(403);

      const stillThere = await systems.SYSTEMS.get("system:s1", "json");
      expect(stillThere).toBeTruthy();
    });

    it("a minted read-role token is blocked from mutating routes: PUT /api/systems/:id/alerts", async () => {
      const systems = env();
      const guest = await mintToken(systems, "read", "guest");
      await systems.SYSTEMS.put("system:s1", JSON.stringify({ id: "s1", name: "Cabin", service: "growatt" }));

      const res = await call(
        request("/api/systems/s1/alerts", {
          method: "PUT",
          headers: { Authorization: `Bearer ${guest.token}` },
          body: { enabled: true },
        }),
        systems,
      );
      expect(res.status).toBe(403);
    });

    it("a minted read-role token can still use read routes", async () => {
      const systems = env();
      const guest = await mintToken(systems, "read", "guest");
      await systems.SYSTEMS.put("_index", JSON.stringify([]));

      const res = await call(
        request("/api/systems", { headers: { Authorization: `Bearer ${guest.token}` } }),
        systems,
      );
      expect(res.status).toBe(200);
    });

    it("GET /api/admin/tokens lists minted keys without exposing plaintext", async () => {
      const systems = env();
      await mintToken(systems, "read", "guest");
      await mintToken(systems, "admin", "maintainer");

      const res = await call(request("/api/admin/tokens", { headers: AUTH }), systems);
      expect(res.status).toBe(200);
      const list = await res.json();
      expect(list).toHaveLength(2);
      for (const entry of list) {
        expect(entry).not.toHaveProperty("token");
      }
    });

    it("DELETE /api/admin/tokens/:id revokes one token independently of others", async () => {
      const systems = env();
      const guest = await mintToken(systems, "read", "guest");
      const maintainer = await mintToken(systems, "admin", "maintainer");

      const revokeRes = await call(
        request(`/api/admin/tokens/${guest.id}`, { method: "DELETE", headers: AUTH }),
        systems,
      );
      expect(revokeRes.status).toBe(200);

      const revokedAttempt = await call(
        request("/api/systems", { headers: { Authorization: `Bearer ${guest.token}` } }),
        systems,
      );
      expect(revokedAttempt.status).toBe(401);

      const stillValid = await call(
        request("/api/systems", { headers: { Authorization: `Bearer ${maintainer.token}` } }),
        systems,
      );
      expect(stillValid.status).toBe(200);
    });

    it("DELETE /api/admin/tokens/:id returns 404 for an unknown id", async () => {
      const systems = env();
      const res = await call(
        request("/api/admin/tokens/does-not-exist", { method: "DELETE", headers: AUTH }),
        systems,
      );
      expect(res.status).toBe(404);
    });
  });

  describe("password users and invites (ADR 0003)", () => {
    it("POST /api/admin/users bootstraps a password admin via API_TOKEN", async () => {
      const systems = env();
      const res = await call(
        request("/api/admin/users", {
          method: "POST",
          headers: AUTH,
          body: { username: "Owner", password: "password123", role: "admin" },
        }),
        systems,
      );
      expect(res.status).toBe(201);
      const user = await res.json();
      expect(user).toMatchObject({ username: "owner", role: "admin" });
      expect(user).not.toHaveProperty("passwordHash");

      const stored = await systems.SYSTEMS.get(`user:${user.id}`, "json");
      expect(stored.passwordHash).toMatch(/^pbkdf2\$/);
      expect(JSON.stringify(stored)).not.toContain("password123");
    });

    it("POST /api/auth/login returns a bearer session usable on protected routes", async () => {
      const systems = env();
      await call(
        request("/api/admin/users", {
          method: "POST",
          headers: AUTH,
          body: { username: "alice", password: "password123", role: "admin" },
        }),
        systems,
      );

      const login = await call(
        request("/api/auth/login", {
          method: "POST",
          body: { username: "alice", password: "password123" },
        }),
        systems,
      );
      expect(login.status).toBe(200);
      const session = await login.json();
      expect(session.token).toBeTruthy();
      expect(session).toMatchObject({ username: "alice", role: "admin" });

      const me = await call(
        request("/api/me", { headers: { Authorization: `Bearer ${session.token}` } }),
        systems,
      );
      expect(me.status).toBe(200);
      expect(await me.json()).toMatchObject({
        username: "alice",
        role: "admin",
        userId: session.userId,
        actorId: session.userId,
      });

      const systemsList = await call(
        request("/api/systems", { headers: { Authorization: `Bearer ${session.token}` } }),
        systems,
      );
      expect(systemsList.status).toBe(200);
    });

    it("POST /api/auth/logout revokes the session token", async () => {
      const systems = env();
      await call(
        request("/api/admin/users", {
          method: "POST",
          headers: AUTH,
          body: { username: "alice", password: "password123", role: "read" },
        }),
        systems,
      );
      const login = await call(
        request("/api/auth/login", {
          method: "POST",
          body: { username: "alice", password: "password123" },
        }),
        systems,
      );
      const { token } = await login.json();

      const logout = await call(
        request("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } }),
        systems,
      );
      expect(logout.status).toBe(200);

      const after = await call(
        request("/api/me", { headers: { Authorization: `Bearer ${token}` } }),
        systems,
      );
      expect(after.status).toBe(401);
    });

    it("invite accept creates user + session and rejects consumed invites", async () => {
      const systems = env();
      const mint = await call(
        request("/api/admin/invites", {
          method: "POST",
          headers: AUTH,
          body: { role: "read", label: "guest", frontendUrl: "https://dash.example" },
        }),
        systems,
      );
      expect(mint.status).toBe(201);
      const invite = await mint.json();
      expect(invite.invite).toBeTruthy();
      expect(invite.url).toContain("invite=");

      const accept = await call(
        request("/api/auth/invite/accept", {
          method: "POST",
          body: { invite: invite.invite, username: "guest1", password: "password123" },
        }),
        systems,
      );
      expect(accept.status).toBe(201);
      const session = await accept.json();
      expect(session).toMatchObject({ username: "guest1", role: "read" });

      const reuse = await call(
        request("/api/auth/invite/accept", {
          method: "POST",
          body: { invite: invite.invite, username: "guest2", password: "password123" },
        }),
        systems,
      );
      expect(reuse.status).toBe(410);

      const me = await call(
        request("/api/me", { headers: { Authorization: `Bearer ${session.token}` } }),
        systems,
      );
      expect(me.status).toBe(200);
      expect((await me.json()).role).toBe("read");
    });

    it("revoked invite cannot be accepted", async () => {
      const systems = env();
      const mint = await call(
        request("/api/admin/invites", {
          method: "POST",
          headers: AUTH,
          body: { role: "read" },
        }),
        systems,
      );
      const invite = await mint.json();

      const revoke = await call(
        request(`/api/admin/invites/${invite.id}`, { method: "DELETE", headers: AUTH }),
        systems,
      );
      expect(revoke.status).toBe(200);

      const accept = await call(
        request("/api/auth/invite/accept", {
          method: "POST",
          body: { invite: invite.invite, username: "x", password: "password123" },
        }),
        systems,
      );
      expect(accept.status).toBe(410);
    });

    it("refuses deleting the last admin via DELETE /api/admin/users/:id", async () => {
      const systems = env();
      const create = await call(
        request("/api/admin/users", {
          method: "POST",
          headers: AUTH,
          body: { username: "solo", password: "password123", role: "admin" },
        }),
        systems,
      );
      const user = await create.json();

      const del = await call(
        request(`/api/admin/users/${user.id}`, { method: "DELETE", headers: AUTH }),
        systems,
      );
      expect(del.status).toBe(400);
      expect(await del.json()).toEqual({ error: "Cannot disable the last admin" });
    });

    it("read-role session cannot hit admin routes", async () => {
      const systems = env();
      await call(
        request("/api/admin/users", {
          method: "POST",
          headers: AUTH,
          body: { username: "viewer", password: "password123", role: "read" },
        }),
        systems,
      );
      const login = await call(
        request("/api/auth/login", {
          method: "POST",
          body: { username: "viewer", password: "password123" },
        }),
        systems,
      );
      const { token } = await login.json();
      const headers = { Authorization: `Bearer ${token}` };

      expect((await call(request("/api/admin/users", { headers }), systems)).status).toBe(403);
      expect((await call(request("/api/admin/invites", { headers }), systems)).status).toBe(403);
      expect(
        (await call(
          request("/api/systems", {
            method: "POST",
            headers,
            body: { service: "growatt", user: "u", password: "p" },
          }),
          systems,
        )).status,
      ).toBe(403);
    });

    it("legacy API_TOKEN still authenticates alongside password users", async () => {
      const systems = env();
      await call(
        request("/api/admin/users", {
          method: "POST",
          headers: AUTH,
          body: { username: "alice", password: "password123", role: "admin" },
        }),
        systems,
      );

      const res = await call(request("/api/systems", { headers: AUTH }), systems);
      expect(res.status).toBe(200);

      const me = await call(request("/api/me", { headers: AUTH }), systems);
      expect(await me.json()).toMatchObject({
        actorId: "shared",
        role: "admin",
        userId: null,
      });
    });

    it("POST /api/admin/invites/purge drops non-pending invites", async () => {
      const systems = env();
      const a = await (
        await call(
          request("/api/admin/invites", { method: "POST", headers: AUTH, body: { role: "read" } }),
          systems,
        )
      ).json();
      const b = await (
        await call(
          request("/api/admin/invites", { method: "POST", headers: AUTH, body: { role: "read" } }),
          systems,
        )
      ).json();
      await call(request(`/api/admin/invites/${b.id}`, { method: "DELETE", headers: AUTH }), systems);

      const purge = await call(
        request("/api/admin/invites/purge", { method: "POST", headers: AUTH }),
        systems,
      );
      expect(purge.status).toBe(200);
      expect(await purge.json()).toEqual({ purged: 1 });

      const list = await call(request("/api/admin/invites", { headers: AUTH }), systems);
      const invites = await list.json();
      expect(invites).toHaveLength(1);
      expect(invites[0].id).toBe(a.id);
    });

    it("expired invite cannot be accepted via POST /api/auth/invite/accept", async () => {
      const systems = env();
      const mint = await call(
        request("/api/admin/invites", {
          method: "POST",
          headers: AUTH,
          body: { role: "read", expiresAt: "2020-01-01T00:00:00.000Z" },
        }),
        systems,
      );
      expect(mint.status).toBe(201);
      const invite = await mint.json();

      const accept = await call(
        request("/api/auth/invite/accept", {
          method: "POST",
          body: { invite: invite.invite, username: "late", password: "password123" },
        }),
        systems,
      );
      expect(accept.status).toBe(410);
      expect(await accept.json()).toEqual({ error: "Invite has expired" });
    });

    it("PATCH /api/admin/users/:id refuses demoting the last admin", async () => {
      const systems = env();
      const create = await call(
        request("/api/admin/users", {
          method: "POST",
          headers: AUTH,
          body: { username: "solo", password: "password123", role: "admin" },
        }),
        systems,
      );
      const user = await create.json();

      const patch = await call(
        request(`/api/admin/users/${user.id}`, {
          method: "PATCH",
          headers: AUTH,
          body: { role: "read" },
        }),
        systems,
      );
      expect(patch.status).toBe(400);
      expect(await patch.json()).toEqual({ error: "Cannot demote the last admin" });
    });

    describe("audit log for user/invite mutations (ADR 0003)", () => {
      function auditEntries(consoleLogSpy) {
        return consoleLogSpy.mock.calls
          .map((c) => {
            try {
              return JSON.parse(c[0]);
            } catch {
              return null;
            }
          })
          .filter((entry) => entry?.event === "audit");
      }

      it("POST /api/admin/users emits user.create audit without the password", async () => {
        const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
        const systems = env();

        const res = await call(
          request("/api/admin/users", {
            method: "POST",
            headers: { ...AUTH, "CF-Connecting-IP": "198.51.100.9" },
            body: { username: "audit-admin", password: "super-secret-password", role: "admin" },
          }),
          systems,
        );
        expect(res.status).toBe(201);
        const user = await res.json();

        const entries = auditEntries(consoleLog);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
          actorId: "shared",
          action: "user.create",
          resource: user.id,
          method: "POST",
          path: "/api/admin/users",
          clientIp: "198.51.100.9",
          outcome: "success",
          status: 201,
        });
        expect(JSON.stringify(entries[0])).not.toContain("super-secret-password");
      });

      it("DELETE /api/admin/users/:id emits user.disable and user.delete audit entries", async () => {
        const systems = env();
        const u1 = await (
          await call(
            request("/api/admin/users", {
              method: "POST",
              headers: AUTH,
              body: { username: "u1", password: "password123", role: "admin" },
            }),
            systems,
          )
        ).json();
        const u2 = await (
          await call(
            request("/api/admin/users", {
              method: "POST",
              headers: AUTH,
              body: { username: "u2", password: "password123", role: "admin" },
            }),
            systems,
          )
        ).json();
        await call(
          request("/api/admin/users", {
            method: "POST",
            headers: AUTH,
            body: { username: "u3", password: "password123", role: "admin" },
          }),
          systems,
        );

        const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

        const soft = await call(
          request(`/api/admin/users/${u1.id}`, { method: "DELETE", headers: AUTH }),
          systems,
        );
        expect(soft.status).toBe(200);

        const hard = await call(
          request(`/api/admin/users/${u2.id}?hard=1`, { method: "DELETE", headers: AUTH }),
          systems,
        );
        expect(hard.status).toBe(200);

        const entries = auditEntries(consoleLog);
        expect(entries.find((e) => e.action === "user.disable")).toMatchObject({
          resource: u1.id,
          outcome: "success",
          status: 200,
          actorId: "shared",
          method: "DELETE",
        });
        expect(entries.find((e) => e.action === "user.delete")).toMatchObject({
          resource: u2.id,
          outcome: "success",
          status: 200,
          actorId: "shared",
          method: "DELETE",
        });
      });

      it("PATCH /api/admin/users/:id emits user.update audit", async () => {
        const systems = env();
        await call(
          request("/api/admin/users", {
            method: "POST",
            headers: AUTH,
            body: { username: "admin1", password: "password123", role: "admin" },
          }),
          systems,
        );
        const viewer = await (
          await call(
            request("/api/admin/users", {
              method: "POST",
              headers: AUTH,
              body: { username: "viewer1", password: "password123", role: "read" },
            }),
            systems,
          )
        ).json();

        const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
        const res = await call(
          request(`/api/admin/users/${viewer.id}`, {
            method: "PATCH",
            headers: AUTH,
            body: { role: "admin" },
          }),
          systems,
        );
        expect(res.status).toBe(200);

        const entries = auditEntries(consoleLog);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
          action: "user.update",
          resource: viewer.id,
          outcome: "success",
          status: 200,
          actorId: "shared",
        });
      });

      it("invite create/revoke/purge and accept emit audit entries; secrets stay out of the log", async () => {
        const systems = env();
        const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

        const mint = await call(
          request("/api/admin/invites", {
            method: "POST",
            headers: AUTH,
            body: { role: "read", label: "neighbor" },
          }),
          systems,
        );
        expect(mint.status).toBe(201);
        const invite = await mint.json();

        const accept = await call(
          request("/api/auth/invite/accept", {
            method: "POST",
            body: { invite: invite.invite, username: "neighbor1", password: "password123" },
          }),
          systems,
        );
        expect(accept.status).toBe(201);
        const session = await accept.json();

        const mint2 = await call(
          request("/api/admin/invites", {
            method: "POST",
            headers: AUTH,
            body: { role: "read", label: "revoke-me" },
          }),
          systems,
        );
        const invite2 = await mint2.json();

        const revoke = await call(
          request(`/api/admin/invites/${invite2.id}`, { method: "DELETE", headers: AUTH }),
          systems,
        );
        expect(revoke.status).toBe(200);

        const purge = await call(
          request("/api/admin/invites/purge", { method: "POST", headers: AUTH }),
          systems,
        );
        expect(purge.status).toBe(200);

        const entries = auditEntries(consoleLog);
        const byAction = Object.fromEntries(
          ["invite.create", "invite.accept", "invite.revoke", "invite.purge"].map((action) => [
            action,
            entries.filter((e) => e.action === action),
          ]),
        );

        expect(byAction["invite.create"].length).toBeGreaterThanOrEqual(2);
        expect(byAction["invite.create"][0]).toMatchObject({
          resource: invite.id,
          outcome: "success",
          status: 201,
          actorId: "shared",
        });
        expect(byAction["invite.accept"]).toHaveLength(1);
        expect(byAction["invite.accept"][0]).toMatchObject({
          action: "invite.accept",
          resource: invite.id,
          actorId: session.userId,
          outcome: "success",
          status: 201,
        });
        expect(byAction["invite.revoke"]).toHaveLength(1);
        expect(byAction["invite.revoke"][0]).toMatchObject({
          resource: invite2.id,
          outcome: "success",
          status: 200,
        });
        expect(byAction["invite.purge"]).toHaveLength(1);
        expect(byAction["invite.purge"][0]).toMatchObject({
          outcome: "success",
          status: 200,
        });

        const blob = JSON.stringify(entries);
        expect(blob).not.toContain(invite.invite);
        expect(blob).not.toContain(invite2.invite);
        expect(blob).not.toContain("password123");
      });
    });
  });
});
