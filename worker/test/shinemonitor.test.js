import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sha1Hex,
  encodeAction,
  signAuth,
  signPublic,
  resolveBatterySoc,
  isAuthFailure,
  fetchData,
  fetchHistory,
  discover,
  parseCollectorDevices,
  deviceKey,
  getActiveDevices,
  aggregateDeviceSnapshots,
  mergeHistoryByTime,
  _clearSessionCacheForTests,
} from "../src/services/shinemonitor.js";
import { expectNormalizedShape } from "./helpers.js";
import multiDeviceStatus from "./fixtures/shinemonitor/multi-device-status.json";

const SYSTEM_CONFIG = {
  id: "sys-1",
  name: "Home",
  credentials: {
    user: "user@example.com",
    pwdSha1: "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8",
    plantId: "100",
    device: { pn: "PN1", devcode: "1", sn: "SN1", devaddr: "1" },
    nominalPower: 5000,
    timezone: 0,
  },
};

function deviceDayResponse() {
  return {
    err: 0,
    dat: {
      title: [
        { title: "Battery Voltage" },
        { title: "Batt Current" },
        { title: "Charger Power" },
        { title: "PV Voltage" },
        { title: "PLoad" },
        { title: "PGrid" },
        { title: "Grid Voltage" },
        { title: "rated power" },
        { title: "work state" },
        { title: "Timestamp" },
      ],
      row: [{
        field: ["48.0", "2.5", "1200", "380", "800", "2", "240", "5000", "Normal", "2026-07-03 12:00:00"],
      }],
    },
  };
}

function plantCurrentResponse() {
  return {
    err: 0,
    dat: [
      { key: "CURRENT_POWER", val: "1.2" },
      { key: "BATTERY_SOC", val: 65 },
      { key: "ENERGY_TODAY", val: "12.5" },
    ],
  };
}

describe("shinemonitor signing helpers", () => {
  it("computes SHA-1 hex digest", async () => {
    expect(await sha1Hex("test")).toBe("a94a8fe5ccb19ba61c4c0873d391e987982fbbd3");
    expect(await sha1Hex("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
  });

  it("encodes action strings for signing", () => {
    expect(encodeAction("a#b' c")).toBe("a%23b%27%20c");
    expect(encodeAction("&action=auth")).toBe("&action=auth");
  });

  it("signs auth requests as SHA1(salt + pwdSha1 + action)", async () => {
    const salt = 1234567890;
    const pwdSha1 = "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8";
    const action = "&action=auth&usr=test&company-key=key";
    const expected = await sha1Hex(String(salt) + pwdSha1 + action);
    expect(await signAuth(salt, pwdSha1, action)).toBe(expected);
  });

  it("signs public API requests with encoded action", async () => {
    const salt = 9876543210;
    const secret = "sec";
    const token = "tok";
    const action = "&action=queryPlantsInfo&i18n=en_US&lang=en_US";
    const expected = await sha1Hex(String(salt) + secret + token + encodeAction(action));
    expect(await signPublic(salt, secret, token, action)).toBe(expected);
  });
});

describe("resolveBatterySoc", () => {
  it("uses API BATTERY_SOC when present and valid", () => {
    const plantCurrent = [
      { key: "CURRENT_POWER", val: "0.1370" },
      { key: "BATTERY_SOC", val: 72 },
    ];
    expect(resolveBatterySoc(plantCurrent, 48.0)).toEqual({ soc: 72, socSource: "api" });
  });

  it("falls back to voltage estimate when BATTERY_SOC is missing", () => {
    const plantCurrent = [{ key: "CURRENT_POWER", val: "0.5" }];
    expect(resolveBatterySoc(plantCurrent, 53.5)).toEqual({ soc: 100, socSource: "estimated" });
  });
});

describe("isAuthFailure", () => {
  it("detects HTTP 401/403", () => {
    expect(isAuthFailure({ err: 0 }, 401)).toBe(true);
    expect(isAuthFailure({ err: 0 }, 403)).toBe(true);
  });

  it("detects token/sign/auth messages in desc", () => {
    expect(isAuthFailure({ err: 1, desc: "ERR_TOKEN_EXPIRED" })).toBe(true);
    expect(isAuthFailure({ err: 2, desc: "ERR_SIGN_FAIL" })).toBe(true);
    expect(isAuthFailure({ err: 3, desc: "Please login again" })).toBe(true);
  });

  it("ignores non-auth vendor errors", () => {
    expect(isAuthFailure({ err: 0, desc: "ERR_NONE" })).toBe(false);
    expect(isAuthFailure({ err: 99, desc: "ERR_DEVICE_OFFLINE" })).toBe(false);
  });
});

describe("shinemonitor fetchData normalization", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    _clearSessionCacheForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns normalized output shape from mocked API responses", async () => {
    const systemConfig = { ...SYSTEM_CONFIG };

    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("action=auth")) {
        return Response.json({ err: 0, dat: { secret: "s1", token: "t1" } });
      }
      if (u.includes("queryPlantCurrentData")) {
        return Response.json(plantCurrentResponse());
      }
      if (u.includes("queryDeviceDataOneDayPaging")) {
        return Response.json(deviceDayResponse());
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    const data = await fetchData(systemConfig);
    expectNormalizedShape(data);
    expect(data.service).toBe("shinemonitor");
    expect(data.battery.soc).toBe(65);
    expect(data.battery.socSource).toBe("api");
    expect(data.solar.power).toBe(1200);
    expect(data.energyToday).toBe(12.5);
    expect(data.grid.active).toBe(false);
  });

  it("honors per-system gridDetect thresholds for generator detection", async () => {
    function deviceDayWithGrid(gridW, gridV) {
      return {
        err: 0,
        dat: {
          title: [
            { title: "Battery Voltage" },
            { title: "Batt Current" },
            { title: "Charger Power" },
            { title: "PV Voltage" },
            { title: "PLoad" },
            { title: "PGrid" },
            { title: "Grid Voltage" },
            { title: "rated power" },
            { title: "work state" },
            { title: "Timestamp" },
          ],
          row: [{
            field: ["48.0", "2.5", "1200", "380", "800", String(gridW), String(gridV), "5000", "Normal", "2026-07-03 12:00:00"],
          }],
        },
      };
    }

    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("action=auth")) {
        return Response.json({ err: 0, dat: { secret: "s1", token: "t1" } });
      }
      if (u.includes("queryPlantCurrentData")) {
        return Response.json(plantCurrentResponse());
      }
      if (u.includes("queryDeviceDataOneDayPaging")) {
        return Response.json(deviceDayWithGrid(3, 35));
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    const defaultConfig = { ...SYSTEM_CONFIG, id: "sys-grid-default" };
    const defaultData = await fetchData(defaultConfig);
    expect(defaultData.grid.active).toBe(false);

    _clearSessionCacheForTests();
    const customConfig = {
      ...SYSTEM_CONFIG,
      id: "sys-grid-custom",
      gridDetect: { voltageMin: 30, powerMin: 2 },
    };
    const customData = await fetchData(customConfig);
    expect(customData.grid.active).toBe(true);
  });

  it("re-authenticates once when token expires and retries successfully", async () => {
    const systemConfig = { ...SYSTEM_CONFIG, id: "sys-reauth-data" };
    let authCalls = 0;
    let deviceCalls = 0;

    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("action=auth")) {
        authCalls++;
        const token = authCalls === 1 ? "expired-token" : "fresh-token";
        return Response.json({ err: 0, dat: { secret: `s${authCalls}`, token } });
      }
      if (u.includes("queryPlantCurrentData")) {
        if (u.includes("expired-token")) {
          return Response.json({ err: 1, desc: "ERR_TOKEN_EXPIRED" }, { status: 401 });
        }
        return Response.json(plantCurrentResponse());
      }
      if (u.includes("queryDeviceDataOneDayPaging")) {
        deviceCalls++;
        if (u.includes("expired-token")) {
          return Response.json({ err: 1, desc: "ERR_TOKEN_EXPIRED" }, { status: 401 });
        }
        return Response.json(deviceDayResponse());
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    const data = await fetchData(systemConfig);
    expectNormalizedShape(data);
    expect(authCalls).toBe(2);
    expect(deviceCalls).toBe(2);
    expect(data.battery.soc).toBe(65);
  });

  it("surfaces persistent auth failure without infinite retries", async () => {
    const systemConfig = { ...SYSTEM_CONFIG, id: "sys-reauth-fail" };
    let authCalls = 0;

    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("action=auth")) {
        authCalls++;
        return Response.json({ err: 0, dat: { secret: `s${authCalls}`, token: `t${authCalls}` } });
      }
      return Response.json({ err: 1, desc: "ERR_TOKEN_EXPIRED" }, { status: 401 });
    });

    await expect(fetchData(systemConfig)).rejects.toThrow(/ShineMonitor authentication failed: ERR_TOKEN_EXPIRED/);
    expect(authCalls).toBe(2);
  });
});

describe("shinemonitor fetchHistory re-auth", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    _clearSessionCacheForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("re-authenticates once when history fetch hits expired token", async () => {
    const systemConfig = { ...SYSTEM_CONFIG, id: "sys-reauth-history" };
    let authCalls = 0;
    let historyCalls = 0;

    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("action=auth")) {
        authCalls++;
        const token = authCalls === 1 ? "expired-token" : "fresh-token";
        return Response.json({ err: 0, dat: { secret: `s${authCalls}`, token } });
      }
      if (u.includes("queryDeviceDataOneDayPaging")) {
        historyCalls++;
        if (u.includes("expired-token")) {
          return Response.json({ err: 1, desc: "ERR_TOKEN_EXPIRED" }, { status: 401 });
        }
        return Response.json({
          err: 0,
          dat: {
            title: [{ title: "Timestamp" }, { title: "Charger Power" }, { title: "PLoad" }, { title: "Battery Voltage" }, { title: "Batt Current" }],
            total: 1,
            row: [{ field: ["2026-07-03 08:00:00", "500", "300", "48.0", "2.0"] }],
          },
        });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    const history = await fetchHistory(systemConfig, "2026-07-03");
    expect(authCalls).toBe(2);
    expect(historyCalls).toBe(2);
    expect(history.points).toHaveLength(1);
    expect(history.points[0].solar).toBe(500);
  });
});

describe("multi-device discovery", () => {
  const collectors = multiDeviceStatus.dat.collector;

  it("parseCollectorDevices flattens all collectors and devices", () => {
    const devices = parseCollectorDevices(collectors);
    expect(devices).toHaveLength(3);
    expect(devices[0]).toMatchObject({
      key: "B1419120275203|INV001|4",
      label: "Main RTU — INV001",
      device: { pn: "B1419120275203", devcode: "697", sn: "INV001", devaddr: "4" },
    });
    expect(devices[2].label).toBe("Garage RTU — INV003");
  });

  it("deviceKey is stable for pn, sn, devaddr", () => {
    expect(deviceKey({ pn: "P1", sn: "S1", devaddr: "2" })).toBe("P1|S1|2");
  });

  it("getActiveDevices returns all devices in aggregate mode", () => {
    const creds = {
      device: { pn: "P1", sn: "S1", devaddr: "1" },
      devices: [
        { pn: "P1", sn: "S1", devaddr: "1" },
        { pn: "P1", sn: "S2", devaddr: "2" },
      ],
      deviceMode: "aggregate",
    };
    expect(getActiveDevices(creds)).toHaveLength(2);
    expect(getActiveDevices({ ...creds, deviceMode: "primary" })).toHaveLength(1);
  });

  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockDiscoveryFetch() {
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("action=auth")) {
        return Response.json({ err: 0, dat: { secret: "s", token: "t" } });
      }
      if (u.includes("queryPlantsInfo")) {
        return Response.json({ err: 0, dat: { info: [{ pid: 42, pname: "Multi Inverter Plant" }] } });
      }
      if (u.includes("queryPlantInfo")) {
        return Response.json({
          err: 0,
          dat: { name: "Multi Inverter Plant", nominalPower: "10", address: { timezone: -21600 } },
        });
      }
      if (u.includes("queryPlantDeviceStatus")) {
        return Response.json(multiDeviceStatus);
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });
  }

  it("discover returns requiresDeviceSelection for multi-device plants", async () => {
    mockDiscoveryFetch();
    const result = await discover({ user: "u@test.com", password: "pass" }, "42");
    expect(result.requiresDeviceSelection).toBe(true);
    expect(result.deviceOptions).toHaveLength(3);
    expect(result.devices).toHaveLength(3);
    expect(result.plantId).toBe("42");
  });

  it("discover selects a primary device by deviceKey", async () => {
    mockDiscoveryFetch();
    const result = await discover(
      { user: "u@test.com", password: "pass" },
      "42",
      { deviceKey: "B1419120275204|INV003|6" },
    );
    expect(result.deviceMode).toBe("primary");
    expect(result.device).toEqual({
      pn: "B1419120275204",
      devcode: "698",
      sn: "INV003",
      devaddr: "6",
    });
    expect(result.requiresDeviceSelection).toBeUndefined();
  });

  it("discover stores all devices for aggregate mode", async () => {
    mockDiscoveryFetch();
    const result = await discover(
      { user: "u@test.com", password: "pass" },
      "42",
      { deviceMode: "aggregate" },
    );
    expect(result.deviceMode).toBe("aggregate");
    expect(result.devices).toHaveLength(3);
    expect(result.device.sn).toBe("INV001");
  });
});

describe("multi-device aggregation", () => {
  it("aggregateDeviceSnapshots sums power across inverters", () => {
    const merged = aggregateDeviceSnapshots([
      {
        batV: 48, batA: 2, solarW: 1000, pvV: 360, loadW: 500,
        gridW: 0, gridV: 0, ratedW: 3000, workState: "Normal", ts: "2026-07-03 10:00:00",
      },
      {
        batV: 48.1, batA: 1.5, solarW: 800, pvV: 370, loadW: 400,
        gridW: 10, gridV: 240, ratedW: 2500, workState: "Normal", ts: "2026-07-03 10:05:00",
      },
    ]);
    expect(merged.solarW).toBe(1800);
    expect(merged.loadW).toBe(900);
    expect(merged.gridW).toBe(10);
    expect(merged.ratedW).toBe(5500);
    expect(merged.batV).toBe(48);
    expect(merged.ts).toBe("2026-07-03 10:05:00");
  });

  it("mergeHistoryByTime sums power at matching timestamps", () => {
    const merged = mergeHistoryByTime([
      [{ time: "10:00", solar: 1000, load: 400, battery: -200 }],
      [{ time: "10:00", solar: 500, load: 200, battery: -100 }],
      [{ time: "10:05", solar: 600, load: 300, battery: 50 }],
    ]);
    expect(merged).toEqual([
      { time: "10:00", solar: 1500, load: 600, battery: -300 },
      { time: "10:05", solar: 600, load: 300, battery: 50 },
    ]);
  });

  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fetchData aggregates multiple inverters when deviceMode is aggregate", async () => {
    const systemConfig = {
      id: "sys-multi",
      name: "Farm",
      credentials: {
        user: "user@example.com",
        pwdSha1: "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8",
        plantId: "100",
        deviceMode: "aggregate",
        device: { pn: "PN1", devcode: "1", sn: "SN1", devaddr: "1" },
        devices: [
          { pn: "PN1", devcode: "1", sn: "SN1", devaddr: "1" },
          { pn: "PN1", devcode: "1", sn: "SN2", devaddr: "2" },
        ],
        nominalPower: 10000,
        timezone: 0,
      },
    };

    const deviceResponses = {
      SN1: ["48.0", "2.0", "1000", "380", "500", "0", "0", "3000", "Normal", "2026-07-03 12:00:00"],
      SN2: ["48.0", "1.0", "800", "370", "300", "0", "0", "2500", "Normal", "2026-07-03 12:00:00"],
    };

    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("action=auth")) {
        return Response.json({ err: 0, dat: { secret: "s1", token: "t1" } });
      }
      if (u.includes("queryPlantCurrentData")) {
        return Response.json({
          err: 0,
          dat: [{ key: "BATTERY_SOC", val: 70 }, { key: "ENERGY_TODAY", val: "20.0" }],
        });
      }
      if (u.includes("queryDeviceDataOneDayPaging")) {
        const sn = u.match(/sn=([^&]+)/)?.[1];
        return Response.json({
          err: 0,
          dat: {
            title: [
              { title: "Battery Voltage" }, { title: "Batt Current" }, { title: "Charger Power" },
              { title: "PV Voltage" }, { title: "PLoad" }, { title: "PGrid" },
              { title: "Grid Voltage" }, { title: "rated power" }, { title: "work state" },
              { title: "Timestamp" },
            ],
            row: [{ field: deviceResponses[sn] }],
          },
        });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    const data = await fetchData(systemConfig);
    expect(data.solar.power).toBe(1800);
    expect(data.load.power).toBe(800);
    expect(data.deviceMode).toBe("aggregate");
    expect(data.deviceCount).toBe(2);
  });
});
