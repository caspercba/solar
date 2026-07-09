import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  redactString,
  redactSecrets,
  sanitizeError,
  buildLogEntry,
  logError,
  logAdapterError,
  recordObservability,
} from "../src/logger.js";

describe("redactString", () => {
  it("redacts Bearer tokens in messages", () => {
    expect(redactString("Auth failed: Bearer secret-token-123")).toBe(
      "Auth failed: Bearer [redacted]",
    );
  });

  it("redacts webhook URLs", () => {
    const msg = "POST https://discord.com/api/webhooks/123456/abcdef failed";
    expect(redactString(msg)).toBe("POST [redacted webhook url] failed");
  });
});

describe("redactSecrets", () => {
  it("redacts sensitive object keys", () => {
    expect(
      redactSecrets({
        systemId: "abc",
        service: "growatt",
        password: "secret",
        credentials: { token: "t", user: "u" },
        webhookUrl: "https://hooks.example/x",
      }),
    ).toEqual({
      systemId: "abc",
      service: "growatt",
      password: "[redacted]",
      credentials: { token: "[redacted]", user: "u" },
      webhookUrl: "[redacted]",
    });
  });

  it("redacts nested arrays without leaking secrets", () => {
    const input = [{ authorization: "Bearer xyz" }, { ok: true }];
    expect(redactSecrets(input)).toEqual([
      { authorization: "[redacted]" },
      { ok: true },
    ]);
  });
});

describe("sanitizeError", () => {
  it("redacts secrets embedded in error messages", () => {
    const err = new Error("Upstream rejected Bearer my-token");
    expect(sanitizeError(err)).toEqual({
      name: "Error",
      message: "Upstream rejected Bearer [redacted]",
    });
  });
});

describe("buildLogEntry", () => {
  it("produces structured JSON-safe entries", () => {
    const entry = buildLogEntry("error", "adapter_fetch_failed", {
      systemId: "sys-1",
      service: "shinemonitor",
      route: "GET /api/systems/:id/data",
      error: sanitizeError(new Error("timeout")),
    });
    expect(entry).toMatchObject({
      level: "error",
      event: "adapter_fetch_failed",
      systemId: "sys-1",
      service: "shinemonitor",
      route: "GET /api/systems/:id/data",
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });
});

describe("logError / logAdapterError", () => {
  let consoleError;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("emits JSON to console.error", () => {
    logError("test_event", { systemId: "x", service: "growatt" });
    expect(consoleError).toHaveBeenCalledOnce();
    const parsed = JSON.parse(consoleError.mock.calls[0][0]);
    expect(parsed).toMatchObject({
      level: "error",
      event: "test_event",
      systemId: "x",
      service: "growatt",
    });
  });

  it("logAdapterError includes systemId, service, and sanitized error", () => {
    logAdapterError(
      {},
      "adapter_fetch_failed",
      {
        systemId: "sys-99",
        service: "growatt",
        route: "GET /api/systems/:id/data",
        error: new Error("vendor timeout"),
      },
    );
    const parsed = JSON.parse(consoleError.mock.calls[0][0]);
    expect(parsed).toMatchObject({
      event: "adapter_fetch_failed",
      systemId: "sys-99",
      service: "growatt",
      route: "GET /api/systems/:id/data",
      message: "vendor timeout",
      error: { name: "Error", message: "vendor timeout" },
    });
  });

  it("never logs raw passwords when error context includes credentials", () => {
    logAdapterError(
      {},
      "adapter_discover_failed",
      {
        service: "growatt",
        error: new Error("login failed"),
        context: { password: "hunter2", token: "abc" },
      },
    );
    const line = consoleError.mock.calls[0][0];
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain('"abc"');
    expect(line).toContain("[redacted]");
  });

  it("writes Analytics Engine data point when env.ANALYTICS is bound", () => {
    const writeDataPoint = vi.fn();
    logAdapterError(
      { ANALYTICS: { writeDataPoint } },
      "alert_webhook_failed",
      {
        systemId: "sys-1",
        service: "growatt",
        route: "scheduled/alerts",
        alertType: "low_soc",
        error: new Error("Webhook failed (500)"),
      },
    );
    expect(writeDataPoint).toHaveBeenCalledOnce();
    expect(writeDataPoint.mock.calls[0][0]).toMatchObject({
      indexes: ["sys-1"],
      doubles: [1],
      blobs: expect.arrayContaining([
        "alert_webhook_failed",
        "growatt",
        "sys-1",
        "scheduled/alerts",
        "Webhook failed (500)",
      ]),
    });
  });

  it("skips Analytics write when binding is absent", () => {
    const writeDataPoint = vi.fn();
    logAdapterError({}, "adapter_fetch_failed", {
      systemId: "sys-1",
      service: "shinemonitor",
      error: new Error("timeout"),
    });
    expect(writeDataPoint).not.toHaveBeenCalled();
  });
});

describe("recordObservability", () => {
  it("writes to Analytics Engine when binding is present", () => {
    const writeDataPoint = vi.fn();
    const entry = buildLogEntry("error", "adapter_fetch_failed", {
      systemId: "sys-1",
      service: "growatt",
      route: "GET /api/systems/:id/data",
      message: "timeout",
    });

    recordObservability({ ANALYTICS: { writeDataPoint } }, entry);

    expect(writeDataPoint).toHaveBeenCalledOnce();
    expect(writeDataPoint.mock.calls[0][0]).toMatchObject({
      indexes: ["sys-1"],
      doubles: [1],
      blobs: expect.arrayContaining(["adapter_fetch_failed", "growatt", "sys-1"]),
    });
  });

  it("does not throw when analytics write fails", () => {
    const writeDataPoint = vi.fn(() => {
      throw new Error("analytics down");
    });
    expect(() =>
      recordObservability(
        { ANALYTICS: { writeDataPoint } },
        buildLogEntry("error", "alert_webhook_failed", { systemId: "a" }),
      ),
    ).not.toThrow();
  });
});
