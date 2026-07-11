import { describe, it, expect } from "vitest";
import { createToken, listTokens, revokeToken, lookupToken, hashToken } from "../src/tokens.js";
import { createMockKV } from "./helpers.js";

function env() {
  return { SYSTEMS: createMockKV() };
}

describe("tokens", () => {
  it("mints an opaque token and stores only its hash", async () => {
    const e = env();
    const minted = await createToken(e, { label: "guest", role: "read" });

    expect(minted.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(minted.id).toBeTruthy();
    expect(minted.role).toBe("read");

    const hash = await hashToken(minted.token);
    const stored = await e.SYSTEMS.get(`token:${hash}`, "json");
    expect(stored).toMatchObject({ id: minted.id, label: "guest", role: "read", revokedAt: null });
    expect(JSON.stringify(stored)).not.toContain(minted.token);
  });

  it("rejects an invalid role", async () => {
    const e = env();
    await expect(createToken(e, { label: "x", role: "superuser" })).rejects.toThrow(/Invalid role/);
  });

  it("rejects an invalid expiresAt", async () => {
    const e = env();
    await expect(createToken(e, { label: "x", role: "admin", expiresAt: "not-a-date" })).rejects.toThrow(/Invalid expiresAt/);
  });

  it("lookupToken resolves a valid token to its id and role", async () => {
    const e = env();
    const minted = await createToken(e, { label: "guest", role: "read" });

    const entry = await lookupToken(e, minted.token);
    expect(entry).toEqual({ id: minted.id, label: "guest", role: "read" });
  });

  it("lookupToken returns null for an unknown token", async () => {
    const e = env();
    expect(await lookupToken(e, "does-not-exist")).toBeNull();
  });

  it("lookupToken returns null for a revoked token", async () => {
    const e = env();
    const minted = await createToken(e, { label: "guest", role: "admin" });
    await revokeToken(e, minted.id);

    expect(await lookupToken(e, minted.token)).toBeNull();
  });

  it("lookupToken returns null for an expired token", async () => {
    const e = env();
    const minted = await createToken(e, { label: "guest", role: "admin", expiresAt: "2020-01-01T00:00:00.000Z" });

    expect(await lookupToken(e, minted.token)).toBeNull();
  });

  it("revokeToken returns false for an unknown id", async () => {
    const e = env();
    expect(await revokeToken(e, "not-a-real-id")).toBe(false);
  });

  it("lists tokens without exposing the plaintext value or hash", async () => {
    const e = env();
    const a = await createToken(e, { label: "alice", role: "read" });
    const b = await createToken(e, { label: "bob", role: "admin" });

    const index = await listTokens(e);
    expect(index).toHaveLength(2);
    expect(index.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
    for (const entry of index) {
      expect(entry).not.toHaveProperty("token");
      expect(entry).not.toHaveProperty("hash");
    }
  });

  it("supports independent revocation — revoking one token leaves others valid", async () => {
    const e = env();
    const a = await createToken(e, { label: "alice", role: "read" });
    const b = await createToken(e, { label: "bob", role: "admin" });

    expect(await revokeToken(e, a.id)).toBe(true);

    expect(await lookupToken(e, a.token)).toBeNull();
    expect(await lookupToken(e, b.token)).toEqual({ id: b.id, label: "bob", role: "admin" });

    const index = await listTokens(e);
    const aEntry = index.find((t) => t.id === a.id);
    const bEntry = index.find((t) => t.id === b.id);
    expect(aEntry.revokedAt).toBeTruthy();
    expect(bEntry.revokedAt).toBeNull();
  });
});
