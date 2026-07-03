import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker from "../src/index.js";
import { createMockKV } from "./helpers.js";

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

    const titles = [
      { title: "Timestamp" },
      { title: "Battery Voltage" },
      { title: "Batt Current" },
      { title: "Charger Power" },
      { title: "PLoad" },
    ];

    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("action=auth")) {
        return Response.json({ err: 0, dat: { secret: "s1", token: "t1" } });
      }
      if (u.includes("queryDeviceDataOneDayPaging")) {
        return Response.json({
          err: 0,
          dat: {
            title: titles,
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

  it("returns 404 for unknown routes", async () => {
    const res = await call(request("/api/unknown", { headers: AUTH }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });
});
