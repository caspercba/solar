import { describe, it, expect } from "vitest";
import {
  createInvite,
  assertInviteAcceptable,
  markInviteConverted,
  revokeInvite,
  purgeInvites,
  listInvitesPublic,
  lookupInvite,
  effectiveInviteStatus,
} from "../src/invites.js";
import { hashToken } from "../src/tokens.js";
import { createMockKV } from "./helpers.js";

function env() {
  return { SYSTEMS: createMockKV() };
}

describe("invites registry", () => {
  it("stores only the SHA-256 hash of the invite secret", async () => {
    const e = env();
    const minted = await createInvite(e, {
      role: "read",
      label: "neighbor",
      createdBy: "shared",
      frontendUrl: "https://dash.example",
      proxyUrl: "https://proxy.example",
    });

    expect(minted.invite).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(minted.url).toContain("invite=");
    expect(minted.url).toMatch(/proxy=https(%3A%2F%2F|:)\/?\/?proxy\.example/);
    expect(minted.url.startsWith("https://dash.example/")).toBe(true);

    const hash = await hashToken(minted.invite);
    const stored = await e.SYSTEMS.get(`invite:${hash}`, "json");
    expect(stored).toMatchObject({
      id: minted.id,
      role: "read",
      label: "neighbor",
      status: "pending",
    });
    expect(JSON.stringify(stored)).not.toContain(minted.invite);
  });

  it("accepts a pending invite and marks it converted", async () => {
    const e = env();
    const minted = await createInvite(e, { role: "admin", createdBy: "shared" });

    const check = await assertInviteAcceptable(e, minted.invite);
    expect(check.ok).toBe(true);

    await markInviteConverted(e, minted.id, "user-1");
    const after = await lookupInvite(e, minted.invite);
    expect(after.status).toBe("converted");
    expect(after.convertedUserId).toBe("user-1");
    expect(after.consumedAt).toBeTruthy();

    const reused = await assertInviteAcceptable(e, minted.invite);
    expect(reused).toEqual({ ok: false, error: "Invite has already been used", status: 410 });
  });

  it("fails closed for revoked and expired invites", async () => {
    const e = env();
    const pending = await createInvite(e, { role: "read", createdBy: "shared" });
    await revokeInvite(e, pending.id);

    expect(await assertInviteAcceptable(e, pending.invite)).toEqual({
      ok: false,
      error: "Invite has been revoked",
      status: 410,
    });

    const expired = await createInvite(e, {
      role: "read",
      createdBy: "shared",
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
    expect(await assertInviteAcceptable(e, expired.invite)).toEqual({
      ok: false,
      error: "Invite has expired",
      status: 410,
    });
    expect(effectiveInviteStatus(await lookupInvite(e, expired.invite))).toBe("expired");
  });

  it("purge removes non-pending invites from the index", async () => {
    const e = env();
    const keep = await createInvite(e, { role: "read", createdBy: "shared", label: "keep" });
    const gone = await createInvite(e, { role: "read", createdBy: "shared", label: "gone" });
    await revokeInvite(e, gone.id);

    const result = await purgeInvites(e);
    expect(result.purged).toBe(1);

    const list = await listInvitesPublic(e);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(keep.id);
    expect(await e.SYSTEMS.get(`invite-id:${gone.id}`)).toBeNull();
  });

  it("rejects unknown invite secrets", async () => {
    const e = env();
    expect(await assertInviteAcceptable(e, "not-a-real-invite")).toEqual({
      ok: false,
      error: "Invalid invite",
      status: 404,
    });
  });
});
