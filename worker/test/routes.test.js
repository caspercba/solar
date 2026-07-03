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

  it("returns 404 for unknown routes", async () => {
    const res = await call(request("/api/unknown", { headers: AUTH }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  describe("GET /api/systems/:id/history", () => {
    const SYSTEM_ID = "hist-1";
    const HISTORY_DATE = "2026-06-01";

    function growattSystem() {
      return {
        id: SYSTEM_ID,
        name: "Growatt Site",
        service: "growatt",
        credentials: {
          user: "u",
          password: "p",
          plantId: "123",
          storageSn: "SN1",
        },
      };
    }

    function buildStoredDay(pointCount) {
      const points = [];
      for (let i = 0; i < pointCount; i++) {
        const mins = i * 5;
        points.push({
          time: `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`,
          solar: 1000,
          load: 500,
          battery: -200,
        });
      }
      return {
        systemId: SYSTEM_ID,
        date: HISTORY_DATE,
        source: "snapshot",
        intervalMinutes: 5,
        points,
        dailySummary: { solarKwh: 24, loadKwh: 12, peakSolarW: 1000, minSoc: null, maxSoc: null },
        updatedAt: "2026-06-01T12:00:00Z",
      };
    }

    async function seedSystem(systems) {
      await systems.SYSTEMS.put("_index", JSON.stringify([
        { id: SYSTEM_ID, name: "Growatt Site", service: "growatt" },
      ]));
      await systems.SYSTEMS.put(`system:${SYSTEM_ID}`, JSON.stringify(growattSystem()));
    }

    function mockGrowattHistory(points) {
      globalThis.fetch = vi.fn(async (url, init) => {
        const u = String(url);
        if (u.includes("/login")) {
          return new Response(JSON.stringify({ result: 1 }), {
            headers: { "set-cookie": "JSESSIONID=abc" },
          });
        }
        if (u.includes("getStorageEnergyDayChart")) {
          const ppv = points.map((p) => p.solar);
          const userLoad = points.map((p) => p.load);
          return Response.json({ result: 1, obj: { ppv, userLoad } });
        }
        if (u.includes("getStorageLineChartData")) {
          const batPower = points.map((p) => p.battery ?? 0);
          return Response.json({ result: 1, obj: { batPower } });
        }
        throw new Error(`Unexpected fetch: ${u}`);
      });
    }

    it("returns source snapshot when stored KV data is complete", async () => {
      const systems = env();
      await seedSystem(systems);
      await systems.SYSTEMS.put(
        `history:day:${SYSTEM_ID}:${HISTORY_DATE}`,
        JSON.stringify(buildStoredDay(200)),
      );

      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy;

      const res = await call(
        request(`/api/systems/${SYSTEM_ID}/history?date=${HISTORY_DATE}`, { headers: AUTH }),
        systems,
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.source).toBe("snapshot");
      expect(json.points).toHaveLength(200);
      expect(json.dailySummary.solarKwh).toBe(24);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("falls back to vendor fetch when no stored data", async () => {
      const systems = env();
      await seedSystem(systems);
      mockGrowattHistory([
        { solar: 800, load: 400, battery: -100 },
        { solar: 1200, load: 600, battery: -200 },
      ]);

      const res = await call(
        request(`/api/systems/${SYSTEM_ID}/history?date=${HISTORY_DATE}`, { headers: AUTH }),
        systems,
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.source).toBe("vendor");
      expect(json.points).toHaveLength(2);
      expect(json.points[0]).toMatchObject({ time: "00:00", solar: 800, load: 400 });
      expect(json.dailySummary).toMatchObject({ solarKwh: expect.any(Number), loadKwh: expect.any(Number) });
    });

    it("merges sparse stored data with vendor backfill", async () => {
      const systems = env();
      await seedSystem(systems);
      await systems.SYSTEMS.put(
        `history:day:${SYSTEM_ID}:${HISTORY_DATE}`,
        JSON.stringify({
          ...buildStoredDay(2),
          points: [
            { time: "10:00", solar: 900, load: 450, battery: -150 },
            { time: "10:05", solar: 950, load: 460, battery: -160 },
          ],
        }),
      );

      mockGrowattHistory([
        { solar: 100, load: 50, battery: 0 },
        { solar: 800, load: 400, battery: -100 },
      ]);

      const res = await call(
        request(`/api/systems/${SYSTEM_ID}/history?date=${HISTORY_DATE}`, { headers: AUTH }),
        systems,
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.source).toBe("merged");
      expect(json.points).toHaveLength(4);
      expect(json.points.find((p) => p.time === "10:00").solar).toBe(900);
      expect(json.points.find((p) => p.time === "00:00").solar).toBe(100);
      expect(json.points.find((p) => p.time === "00:05").solar).toBe(800);
    });

    it("returns 400 for invalid date", async () => {
      const systems = env();
      await seedSystem(systems);

      const res = await call(
        request(`/api/systems/${SYSTEM_ID}/history?date=not-a-date`, { headers: AUTH }),
        systems,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid date (expected YYYY-MM-DD)" });
    });
  });

  describe("GET /api/systems/:id/history/summary", () => {
    const SYSTEM_ID = "sum-1";

    async function seedGrowatt(systems) {
      await systems.SYSTEMS.put("_index", JSON.stringify([
        { id: SYSTEM_ID, name: "Summary Site", service: "growatt" },
      ]));
      await systems.SYSTEMS.put(`system:${SYSTEM_ID}`, JSON.stringify({
        id: SYSTEM_ID,
        name: "Summary Site",
        service: "growatt",
        credentials: { user: "u", password: "p", plantId: "123", storageSn: "SN1" },
      }));
    }

    it("returns vendor daily totals with normalized series shape", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-03T12:00:00Z"));

      const systems = env();
      await seedGrowatt(systems);

      globalThis.fetch = vi.fn(async (url, init) => {
        const u = String(url);
        if (u.includes("/login")) {
          return new Response(JSON.stringify({ result: 1 }), {
            headers: { "set-cookie": "JSESSIONID=abc" },
          });
        }
        if (u.includes("getStorageEnergyDayChart")) {
          const date = init?.body ? new URLSearchParams(init.body).get("date") : null;
          if (date === "2026-07-03") {
            return Response.json({ result: 1, obj: { ppv: ["2000", "3000"], userLoad: ["500", "700"] } });
          }
          return Response.json({ result: 1, obj: { ppv: [], userLoad: [] } });
        }
        if (u.includes("getStorageLineChartData")) {
          return Response.json({ result: 1, obj: { batPower: [] } });
        }
        if (u.includes("getStorageBatChart")) {
          return Response.json({
            result: 1,
            obj: {
              date: "2026-07-03",
              socChart: { capacity: ["55", "60", "58"] },
            },
          });
        }
        throw new Error(`Unexpected fetch: ${u}`);
      });

      try {
        const res = await call(
          request(`/api/systems/${SYSTEM_ID}/history/summary?days=7&end=2026-07-03`, { headers: AUTH }),
          systems,
        );

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.systemId).toBe(SYSTEM_ID);
        expect(json.days).toBe(7);
        expect(json.endDate).toBe("2026-07-03");
        expect(json.series).toHaveLength(7);
        expect(json.series[0]).toMatchObject({
          date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          solarKwh: expect.any(Number),
          loadKwh: expect.any(Number),
        });

        const vendorDay = json.series.find((d) => d.date === "2026-07-03");
        expect(vendorDay.solarKwh).toBeGreaterThan(0);
        expect(vendorDay.loadKwh).toBeGreaterThan(0);
        expect(vendorDay.minSoc).toBe(55);
        expect(vendorDay.maxSoc).toBe(60);

        const emptyDay = json.series.find((d) => d.date === "2026-06-27");
        expect(emptyDay).toMatchObject({ solarKwh: null, loadKwh: null });
      } finally {
        vi.useRealTimers();
      }
    });

    it("uses ShineMonitor fetchHistorySummary from vendor APIs", async () => {
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
        { title: "BATTERY_SOC" },
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
                field: ["2026-07-03 10:00:00", "50.0", "0", "2400", "500", "72"],
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
        minSoc: 72,
        maxSoc: 72,
      });
    });
  });
});
