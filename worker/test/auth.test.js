import { describe, it, expect } from "vitest";
import { checkAuth, isProductionGuardEnabled, isAuthMisconfigured } from "../src/auth.js";

function makeRequest(authHeader) {
  const headers = new Headers();
  if (authHeader != null) headers.set("Authorization", authHeader);
  return new Request("https://example.com/api/systems", { headers });
}

describe("checkAuth", () => {
  it("allows all requests when API_TOKEN is not configured", () => {
    const env = {};
    expect(checkAuth(makeRequest(), env)).toBe(true);
    expect(checkAuth(makeRequest("Bearer wrong"), env)).toBe(true);
  });

  it("allows requests with a valid Bearer token", () => {
    const env = { API_TOKEN: "secret-token" };
    expect(checkAuth(makeRequest("Bearer secret-token"), env)).toBe(true);
  });

  it("rejects requests with a missing Authorization header", () => {
    const env = { API_TOKEN: "secret-token" };
    expect(checkAuth(makeRequest(), env)).toBe(false);
  });

  it("rejects requests with an invalid Bearer token", () => {
    const env = { API_TOKEN: "secret-token" };
    expect(checkAuth(makeRequest("Bearer wrong-token"), env)).toBe(false);
    expect(checkAuth(makeRequest("Basic secret-token"), env)).toBe(false);
  });

  it("rejects all requests when PRODUCTION is enabled and API_TOKEN is unset", () => {
    const env = { PRODUCTION: "true" };
    expect(checkAuth(makeRequest(), env)).toBe(false);
    expect(checkAuth(makeRequest("Bearer anything"), env)).toBe(false);
  });

  it("still enforces the token normally when PRODUCTION and API_TOKEN are both set", () => {
    const env = { PRODUCTION: "true", API_TOKEN: "secret-token" };
    expect(checkAuth(makeRequest("Bearer secret-token"), env)).toBe(true);
    expect(checkAuth(makeRequest("Bearer wrong-token"), env)).toBe(false);
    expect(checkAuth(makeRequest(), env)).toBe(false);
  });
});

describe("isProductionGuardEnabled", () => {
  it("is false when PRODUCTION is unset or falsy", () => {
    expect(isProductionGuardEnabled({})).toBe(false);
    expect(isProductionGuardEnabled({ PRODUCTION: "false" })).toBe(false);
    expect(isProductionGuardEnabled({ PRODUCTION: "" })).toBe(false);
  });

  it("is true when PRODUCTION is 'true' (case-insensitive)", () => {
    expect(isProductionGuardEnabled({ PRODUCTION: "true" })).toBe(true);
    expect(isProductionGuardEnabled({ PRODUCTION: "TRUE" })).toBe(true);
  });
});

describe("isAuthMisconfigured", () => {
  it("is false in dev mode regardless of API_TOKEN", () => {
    expect(isAuthMisconfigured({})).toBe(false);
    expect(isAuthMisconfigured({ API_TOKEN: "secret-token" })).toBe(false);
  });

  it("is true when PRODUCTION is enabled and API_TOKEN is missing", () => {
    expect(isAuthMisconfigured({ PRODUCTION: "true" })).toBe(true);
  });

  it("is false when PRODUCTION is enabled and API_TOKEN is set", () => {
    expect(isAuthMisconfigured({ PRODUCTION: "true", API_TOKEN: "secret-token" })).toBe(false);
  });
});
