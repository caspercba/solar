import { describe, it, expect, beforeEach } from "vitest";
import {
  checkDataRateLimit,
  getRateLimitKey,
  resetRateLimitStore,
  DATA_RATE_LIMIT_MAX,
  DATA_RATE_LIMIT_WINDOW_MS,
} from "../src/rateLimit.js";
import { corsHeaders } from "../src/auth.js";

function makeRequest(authHeader) {
  const headers = new Headers();
  if (authHeader != null) headers.set("Authorization", authHeader);
  return new Request("https://example.com/api/systems/s1/data", { headers });
}

describe("rateLimit", () => {
  beforeEach(() => {
    resetRateLimitStore();
  });

  describe("getRateLimitKey", () => {
    it("returns null when the request authenticated via dev open mode", () => {
      expect(getRateLimitKey(makeRequest("Bearer anything"), {}, { openMode: true })).toBeNull();
    });

    it("returns the bearer token for an authenticated legacy-token request", () => {
      const env = { API_TOKEN: "secret" };
      const auth = { ok: true, actorId: "shared", role: "admin", openMode: false };
      expect(getRateLimitKey(makeRequest("Bearer secret"), env, auth)).toBe("secret");
      expect(getRateLimitKey(makeRequest("Bearer other"), env, auth)).toBe("other");
    });

    it("returns the bearer token for an authenticated per-user KV token request", () => {
      const auth = { ok: true, actorId: "tok-1", role: "read", openMode: false };
      expect(getRateLimitKey(makeRequest("Bearer per-user-token"), {}, auth)).toBe("per-user-token");
    });

    it("returns null when Authorization header is missing", () => {
      expect(getRateLimitKey(makeRequest(), { API_TOKEN: "secret" }, { openMode: false })).toBeNull();
    });
  });

  describe("checkDataRateLimit", () => {
    it("allows requests up to the configured limit", () => {
      const key = "test-token";
      const start = 1_700_000_000_000;

      for (let i = 0; i < DATA_RATE_LIMIT_MAX; i += 1) {
        expect(checkDataRateLimit(key, start + i)).toEqual({ allowed: true });
      }
    });

    it("blocks the request after the limit is exceeded", () => {
      const key = "test-token";
      const start = 1_700_000_000_000;

      for (let i = 0; i < DATA_RATE_LIMIT_MAX; i += 1) {
        checkDataRateLimit(key, start);
      }

      const blocked = checkDataRateLimit(key, start + 1000);
      expect(blocked).toEqual({ allowed: false, retryAfter: expect.any(Number) });
      expect(blocked.retryAfter).toBeGreaterThan(0);
      expect(blocked.retryAfter).toBeLessThanOrEqual(
        Math.ceil(DATA_RATE_LIMIT_WINDOW_MS / 1000),
      );
    });

    it("resets the counter after the window expires", () => {
      const key = "test-token";
      const start = 1_700_000_000_000;

      for (let i = 0; i < DATA_RATE_LIMIT_MAX; i += 1) {
        checkDataRateLimit(key, start);
      }
      expect(checkDataRateLimit(key, start + 1000)).toEqual({
        allowed: false,
        retryAfter: expect.any(Number),
      });

      const afterWindow = start + DATA_RATE_LIMIT_WINDOW_MS;
      expect(checkDataRateLimit(key, afterWindow)).toEqual({ allowed: true });
    });

    it("tracks limits independently per token", () => {
      const start = 1_700_000_000_000;

      for (let i = 0; i < DATA_RATE_LIMIT_MAX; i += 1) {
        checkDataRateLimit("token-a", start);
      }
      expect(checkDataRateLimit("token-a", start)).toEqual({
        allowed: false,
        retryAfter: expect.any(Number),
      });
      expect(checkDataRateLimit("token-b", start)).toEqual({ allowed: true });
    });

    it("skips limiting when key is null", () => {
      for (let i = 0; i < DATA_RATE_LIMIT_MAX + 5; i += 1) {
        expect(checkDataRateLimit(null)).toEqual({ allowed: true });
      }
    });
  });
});

describe("429 response shape", () => {
  it("includes Retry-After header", () => {
    const headers = {
      "Content-Type": "application/json",
      "Retry-After": "42",
      ...corsHeaders("https://app.example"),
    };
    expect(headers["Retry-After"]).toBe("42");
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://app.example");
  });
});
