import { describe, it, expect } from "vitest";
import { checkAuth, isProductionGuardEnabled, isAuthMisconfigured } from "../src/auth.js";
import { createToken } from "../src/tokens.js";
import { createMockKV } from "./helpers.js";

function makeRequest(authHeader) {
  const headers = new Headers();
  if (authHeader != null) headers.set("Authorization", authHeader);
  return new Request("https://example.com/api/systems", { headers });
}

function env(overrides = {}) {
  return { SYSTEMS: createMockKV(), ...overrides };
}

describe("checkAuth", () => {
  it("allows all requests when no token is configured (dev open mode)", async () => {
    const e = env();
    expect(await checkAuth(makeRequest(), e)).toEqual({
      ok: true,
      actorId: "dev",
      role: "admin",
      openMode: true,
      userId: null,
      tokenId: null,
      username: null,
    });
    expect(await checkAuth(makeRequest("Bearer wrong"), e)).toEqual({
      ok: true,
      actorId: "dev",
      role: "admin",
      openMode: true,
      userId: null,
      tokenId: null,
      username: null,
    });
  });

  it("allows requests with a valid legacy Bearer token", async () => {
    const e = env({ API_TOKEN: "secret-token" });
    expect(await checkAuth(makeRequest("Bearer secret-token"), e)).toEqual({
      ok: true,
      actorId: "shared",
      role: "admin",
      openMode: false,
      userId: null,
      tokenId: null,
      username: null,
    });
  });

  it("rejects requests with a missing Authorization header", async () => {
    const e = env({ API_TOKEN: "secret-token" });
    expect(await checkAuth(makeRequest(), e)).toEqual({ ok: false });
  });

  it("rejects requests with an invalid Bearer token", async () => {
    const e = env({ API_TOKEN: "secret-token" });
    expect(await checkAuth(makeRequest("Bearer wrong-token"), e)).toEqual({ ok: false });
    expect(await checkAuth(makeRequest("Basic secret-token"), e)).toEqual({ ok: false });
  });

  it("rejects all requests when PRODUCTION is enabled and API_TOKEN is unset", async () => {
    const e = env({ PRODUCTION: "true" });
    expect(await checkAuth(makeRequest(), e)).toEqual({ ok: false });
    expect(await checkAuth(makeRequest("Bearer anything"), e)).toEqual({ ok: false });
  });

  it("still enforces the token normally when PRODUCTION and API_TOKEN are both set", async () => {
    const e = env({ PRODUCTION: "true", API_TOKEN: "secret-token" });
    expect(await checkAuth(makeRequest("Bearer secret-token"), e)).toEqual({
      ok: true,
      actorId: "shared",
      role: "admin",
      openMode: false,
      userId: null,
      tokenId: null,
      username: null,
    });
    expect(await checkAuth(makeRequest("Bearer wrong-token"), e)).toEqual({ ok: false });
    expect(await checkAuth(makeRequest(), e)).toEqual({ ok: false });
  });

  describe("per-user KV tokens (ADR 0002 Phase 2)", () => {
    it("authenticates a valid admin-role token alongside the legacy shared token", async () => {
      const e = env({ API_TOKEN: "secret-token" });
      const minted = await createToken(e, { label: "ops", role: "admin" });

      expect(await checkAuth(makeRequest(`Bearer ${minted.token}`), e)).toEqual({
        ok: true,
        actorId: minted.id,
        role: "admin",
        openMode: false,
        userId: null,
        tokenId: minted.id,
        username: null,
      });
    });

    it("authenticates a valid read-role token", async () => {
      const e = env({ API_TOKEN: "secret-token" });
      const minted = await createToken(e, { label: "guest", role: "read" });

      expect(await checkAuth(makeRequest(`Bearer ${minted.token}`), e)).toEqual({
        ok: true,
        actorId: minted.id,
        role: "read",
        openMode: false,
        userId: null,
        tokenId: minted.id,
        username: null,
      });
    });

    it("authenticates a KV token even when no legacy API_TOKEN secret is set", async () => {
      const e = env();
      const minted = await createToken(e, { label: "solo", role: "read" });

      expect(await checkAuth(makeRequest(`Bearer ${minted.token}`), e)).toEqual({
        ok: true,
        actorId: minted.id,
        role: "read",
        openMode: false,
        userId: null,
        tokenId: minted.id,
        username: null,
      });
    });

    it("rejects a revoked token", async () => {
      const { revokeToken } = await import("../src/tokens.js");
      const e = env({ API_TOKEN: "secret-token" });
      const minted = await createToken(e, { label: "temp", role: "admin" });
      await revokeToken(e, minted.id);

      expect(await checkAuth(makeRequest(`Bearer ${minted.token}`), e)).toEqual({ ok: false });
    });

    it("rejects an expired token", async () => {
      const e = env({ API_TOKEN: "secret-token" });
      const minted = await createToken(e, {
        label: "temp",
        role: "admin",
        expiresAt: "2020-01-01T00:00:00.000Z",
      });

      expect(await checkAuth(makeRequest(`Bearer ${minted.token}`), e)).toEqual({ ok: false });
    });

    it("rejects an unknown token", async () => {
      const e = env({ API_TOKEN: "secret-token" });
      expect(await checkAuth(makeRequest("Bearer not-minted-anywhere"), e)).toEqual({ ok: false });
    });

    it("authenticates a password-user session and attributes actorId to the user", async () => {
      const { createUser } = await import("../src/users.js");
      const e = env({ API_TOKEN: "secret-token" });
      const user = await createUser(e, { username: "alice", password: "password123", role: "admin" });
      const minted = await createToken(e, { label: "session:alice", role: "admin", userId: user.id });

      expect(await checkAuth(makeRequest(`Bearer ${minted.token}`), e)).toEqual({
        ok: true,
        actorId: user.id,
        role: "admin",
        openMode: false,
        userId: user.id,
        tokenId: minted.id,
        username: "alice",
      });
    });

    it("rejects a session whose user has been disabled", async () => {
      const { createUser, disableUser } = await import("../src/users.js");
      const e = env({ API_TOKEN: "secret-token" });
      await createUser(e, { username: "keeper", password: "password123", role: "admin" });
      const user = await createUser(e, { username: "alice", password: "password123", role: "admin" });
      const minted = await createToken(e, { label: "session:alice", role: "admin", userId: user.id });
      await disableUser(e, user.id);

      expect(await checkAuth(makeRequest(`Bearer ${minted.token}`), e)).toEqual({ ok: false });
    });
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
