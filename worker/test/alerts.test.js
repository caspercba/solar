import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_ALERTS,
  evaluateAlerts,
  normalizeAlerts,
  processSystemAlerts,
  runScheduledAlerts,
  updateSystemAlerts,
} from "../src/alerts.js";
import { createMockKV } from "./helpers.js";

const BASE_DATA = {
  name: "Cabin",
  timestamp: "2026-07-03 14:00:00",
  battery: { soc: 50, voltage: 48, current: 0, power: 0 },
  grid: { active: false, power: 0, voltage: 0 },
};

describe("normalizeAlerts", () => {
  it("applies defaults and clamps values", () => {
    expect(normalizeAlerts({ lowSocThreshold: 999, cooldownMinutes: 1 })).toMatchObject({
      enabled: false,
      lowSocThreshold: 100,
      cooldownMinutes: 5,
    });
  });
});

describe("evaluateAlerts", () => {
  const alerts = normalizeAlerts({
    enabled: true,
    webhookUrl: "https://hooks.example/alert",
    lowSocThreshold: 20,
    notifyLowSoc: true,
    notifyGenerator: true,
    cooldownMinutes: 60,
  });

  it("fires low SOC on first breach", () => {
    const state = { lowSoc: { breached: false, lastAlertAt: null }, generator: { active: false, lastAlertAt: null } };
    const { actions, state: next } = evaluateAlerts(
      alerts,
      state,
      { ...BASE_DATA, battery: { ...BASE_DATA.battery, soc: 15 } },
      Date.parse("2026-07-03T14:00:00Z"),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("low_soc");
    expect(next.lowSoc.breached).toBe(true);
  });

  it("does not repeat low SOC alerts within cooldown", () => {
    const state = {
      lowSoc: { breached: true, lastAlertAt: "2026-07-03T14:00:00.000Z" },
      generator: { active: false, lastAlertAt: null },
    };
    const { actions } = evaluateAlerts(
      alerts,
      state,
      { ...BASE_DATA, battery: { ...BASE_DATA.battery, soc: 10 } },
      Date.parse("2026-07-03T14:30:00Z"),
    );
    expect(actions).toHaveLength(0);
  });

  it("re-alerts low SOC after cooldown while still breached", () => {
    const state = {
      lowSoc: { breached: true, lastAlertAt: "2026-07-03T13:00:00.000Z" },
      generator: { active: false, lastAlertAt: null },
    };
    const { actions } = evaluateAlerts(
      alerts,
      state,
      { ...BASE_DATA, battery: { ...BASE_DATA.battery, soc: 10 } },
      Date.parse("2026-07-03T14:05:00Z"),
    );
    expect(actions).toHaveLength(1);
  });

  it("clears low SOC breach when SOC recovers", () => {
    const state = {
      lowSoc: { breached: true, lastAlertAt: "2026-07-03T13:00:00.000Z" },
      generator: { active: false, lastAlertAt: null },
    };
    const { actions, state: next } = evaluateAlerts(
      alerts,
      state,
      { ...BASE_DATA, battery: { ...BASE_DATA.battery, soc: 25 } },
      Date.now(),
    );
    expect(actions).toHaveLength(0);
    expect(next.lowSoc.breached).toBe(false);
  });

  it("fires generator alert on rising edge", () => {
    const state = { lowSoc: { breached: false, lastAlertAt: null }, generator: { active: false, lastAlertAt: null } };
    const { actions, state: next } = evaluateAlerts(
      alerts,
      state,
      { ...BASE_DATA, grid: { active: true, power: 1200, voltage: 120 } },
      Date.parse("2026-07-03T14:00:00Z"),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("generator");
    expect(next.generator.active).toBe(true);
  });

  it("suppresses generator flicker within cooldown", () => {
    const state = {
      lowSoc: { breached: false, lastAlertAt: null },
      generator: { active: false, lastAlertAt: "2026-07-03T14:00:00.000Z" },
    };
    const { actions } = evaluateAlerts(
      alerts,
      state,
      { ...BASE_DATA, grid: { active: true, power: 800, voltage: 118 } },
      Date.parse("2026-07-03T14:10:00Z"),
    );
    expect(actions).toHaveLength(0);
  });
});

describe("processSystemAlerts", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("posts webhook when threshold breached", async () => {
    globalThis.fetch = vi.fn(async () => new Response("ok", { status: 200 }));

    const env = { SYSTEMS: createMockKV() };
    const system = {
      id: "sys-1",
      name: "Home",
      service: "growatt",
      alerts: {
        ...DEFAULT_ALERTS,
        enabled: true,
        webhookUrl: "https://hooks.example/alert",
        lowSocThreshold: 30,
      },
    };

    const result = await processSystemAlerts(
      env,
      system,
      async () => ({ ...BASE_DATA, battery: { ...BASE_DATA.battery, soc: 18 } }),
      Date.parse("2026-07-03T14:00:00Z"),
    );

    expect(result.sent).toBe(1);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [, opts] = globalThis.fetch.mock.calls[0];
    const payload = JSON.parse(opts.body);
    expect(payload.alertType).toBe("low_soc");
    expect(payload.text).toContain("Low battery");
  });
});

describe("updateSystemAlerts", () => {
  it("persists alert settings on system config", async () => {
    const env = { SYSTEMS: createMockKV() };
    await env.SYSTEMS.put("system:abc", JSON.stringify({
      id: "abc",
      name: "Test",
      service: "growatt",
      credentials: { user: "u", password: "p" },
    }));

    const updated = await updateSystemAlerts(env, "abc", {
      enabled: true,
      webhookUrl: "https://discord.com/api/webhooks/x",
      lowSocThreshold: 15,
    });

    expect(updated.enabled).toBe(true);
    expect(updated.lowSocThreshold).toBe(15);

    const stored = await env.SYSTEMS.get("system:abc", "json");
    expect(stored.alerts.webhookUrl).toBe("https://discord.com/api/webhooks/x");
  });
});

describe("runScheduledAlerts", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("checks all systems with alerts enabled", async () => {
    globalThis.fetch = vi.fn(async () => new Response("ok", { status: 200 }));

    const env = { SYSTEMS: createMockKV() };
    await env.SYSTEMS.put("_index", JSON.stringify([{ id: "a", name: "A", service: "growatt" }]));
    await env.SYSTEMS.put("system:a", JSON.stringify({
      id: "a",
      name: "A",
      service: "growatt",
      credentials: {},
      alerts: {
        ...DEFAULT_ALERTS,
        enabled: true,
        webhookUrl: "https://hooks.example/alert",
      },
    }));

    const adapters = {
      growatt: {
        fetchData: vi.fn(async () => ({
          ...BASE_DATA,
          battery: { ...BASE_DATA.battery, soc: 10 },
        })),
      },
    };

    const result = await runScheduledAlerts(env, adapters);
    expect(result.checked).toBe(1);
    expect(result.sent).toBe(1);
    expect(adapters.growatt.fetchData).toHaveBeenCalledOnce();
  });
});
