import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import worker from "../src/index.js";
import { DEFAULT_ALERTS } from "../src/alerts.js";
import * as growatt from "../src/services/growatt.js";
import { createMockKV } from "./helpers.js";

const WEBHOOK_URL = "https://hooks.example/secret-webhook-path";

const BASE_DATA = {
  name: "Cabin",
  timestamp: "2026-07-03 14:00:00",
  battery: { soc: 50, voltage: 48, current: 0, power: 0 },
  grid: { active: false, power: 0, voltage: 0 },
};

function buildEnv() {
  return { SYSTEMS: createMockKV() };
}

async function seedAlertSystem(env, { soc = 10, cooldownMinutes = 60 } = {}) {
  await env.SYSTEMS.put("_index", JSON.stringify([{ id: "sys-1", name: "Cabin", service: "growatt" }]));
  await env.SYSTEMS.put(
    "system:sys-1",
    JSON.stringify({
      id: "sys-1",
      name: "Cabin",
      service: "growatt",
      credentials: { user: "u", password: "p" },
      alerts: {
        ...DEFAULT_ALERTS,
        enabled: true,
        webhookUrl: WEBHOOK_URL,
        lowSocThreshold: 20,
        notifyLowSoc: true,
        cooldownMinutes,
      },
    }),
  );
}

async function runScheduled(env) {
  const ctx = createExecutionContext();
  const controller = createScheduledController();
  await worker.scheduled(controller, env, ctx);
  await waitOnExecutionContext(ctx);
}

function consoleOutput(...spies) {
  return spies.flatMap((spy) =>
    spy.mock.calls.flatMap((args) => args.map((arg) => String(arg))),
  );
}

describe("worker scheduled (alert cron)", () => {
  let originalFetch;
  let fetchDataSpy;
  let consoleSpies;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchDataSpy = vi.spyOn(growatt, "fetchData");
    consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
    ];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("invokes runScheduledAlerts and POSTs webhook on low SOC breach", async () => {
    fetchDataSpy.mockResolvedValue({
      ...BASE_DATA,
      battery: { ...BASE_DATA.battery, soc: 12 },
    });

    globalThis.fetch = vi.fn(async (url, opts) => {
      expect(String(url)).toBe(WEBHOOK_URL);
      expect(opts.method).toBe("POST");
      const payload = JSON.parse(opts.body);
      expect(payload.alertType).toBe("low_soc");
      expect(payload.text).toContain("Low battery");
      return new Response("ok", { status: 200 });
    });

    const env = buildEnv();
    await seedAlertSystem(env);
    await runScheduled(env);

    expect(fetchDataSpy).toHaveBeenCalledOnce();
    expect(globalThis.fetch).toHaveBeenCalledOnce();

    const stored = await env.SYSTEMS.get("alert-state:sys-1", "json");
    expect(stored.lowSoc.breached).toBe(true);
    expect(stored.lowSoc.lastAlertAt).toBeTruthy();

    for (const line of consoleOutput(...consoleSpies)) {
      expect(line).not.toContain(WEBHOOK_URL);
    }
  });

  it("suppresses duplicate low SOC webhooks within cooldown on repeat cron tick", async () => {
    fetchDataSpy.mockResolvedValue({
      ...BASE_DATA,
      battery: { ...BASE_DATA.battery, soc: 8 },
    });

    globalThis.fetch = vi.fn(async () => new Response("ok", { status: 200 }));

    const env = buildEnv();
    await seedAlertSystem(env, { cooldownMinutes: 60 });

    await runScheduled(env);
    await runScheduled(env);

    expect(fetchDataSpy).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).toHaveBeenCalledOnce();

    for (const line of consoleOutput(...consoleSpies)) {
      expect(line).not.toContain(WEBHOOK_URL);
    }
  });
});
