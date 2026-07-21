/**
 * Admin-issued magic-link invite registry in KV (ADR 0003).
 *
 * KV layout:
 *   invite:<sha256(secret)>  -> { id, role, label?, status, createdAt, createdBy,
 *                                  expiresAt, convertedAt?, convertedUserId?, consumedAt? }
 *   invite-id:<id>           -> sha256(secret)  (lookup for revoke/purge by id)
 *   _index_invites           -> [{ id, label?, role, status, createdAt, expiresAt, convertedUserId? }, ...]
 *
 * Only the SHA-256 hash of the invite secret is persisted; the plaintext is
 * returned once at creation time (embedded in the copyable magic-link URL).
 */

import { ROLES, generateOpaqueToken, hashToken } from "./tokens.js";

export const INVITE_STATUSES = ["pending", "converted", "revoked", "expired"];

/** Default invite TTL: 7 days. */
export const DEFAULT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function listInvites(env) {
  const index = await env.SYSTEMS.get("_index_invites", "json");
  return index || [];
}

async function saveInviteIndex(env, index) {
  await env.SYSTEMS.put("_index_invites", JSON.stringify(index));
}

function indexEntryFrom(invite) {
  return {
    id: invite.id,
    label: invite.label || null,
    role: invite.role,
    status: invite.status,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    convertedUserId: invite.convertedUserId || null,
  };
}

/**
 * Resolve effective status, marking pending invites past expiresAt as expired
 * (lazy — does not rewrite KV unless the caller persists).
 */
export function effectiveInviteStatus(invite, now = Date.now()) {
  if (!invite) return null;
  if (invite.status === "pending" && invite.expiresAt && now >= Date.parse(invite.expiresAt)) {
    return "expired";
  }
  return invite.status;
}

/**
 * Mint a new invite. Returns the plaintext secret once.
 * @param {object} env
 * @param {{ role: "read"|"admin", label?: string, createdBy: string, expiresAt?: string|null, ttlMs?: number, frontendUrl?: string|null, proxyUrl?: string|null }} opts
 */
export async function createInvite(env, {
  role,
  label = "",
  createdBy,
  expiresAt = null,
  ttlMs = DEFAULT_INVITE_TTL_MS,
  frontendUrl = null,
  proxyUrl = null,
} = {}) {
  if (!ROLES.includes(role)) {
    throw new Error(`Invalid role: ${role}. Expected one of: ${ROLES.join(", ")}`);
  }

  let expires;
  if (expiresAt) {
    if (Number.isNaN(Date.parse(expiresAt))) {
      throw new Error(`Invalid expiresAt: ${expiresAt}`);
    }
    expires = new Date(expiresAt).toISOString();
  } else {
    expires = new Date(Date.now() + (Number.isFinite(ttlMs) ? ttlMs : DEFAULT_INVITE_TTL_MS)).toISOString();
  }

  const id = crypto.randomUUID();
  const secret = generateOpaqueToken();
  const hash = await hashToken(secret);
  const createdAt = new Date().toISOString();
  const entry = {
    id,
    role,
    label: label || null,
    status: "pending",
    createdAt,
    createdBy: createdBy || null,
    expiresAt: expires,
    convertedAt: null,
    convertedUserId: null,
    consumedAt: null,
  };

  await env.SYSTEMS.put(`invite:${hash}`, JSON.stringify(entry));
  await env.SYSTEMS.put(`invite-id:${id}`, hash);

  const index = await listInvites(env);
  index.push(indexEntryFrom(entry));
  await saveInviteIndex(env, index);

  const url = buildInviteUrl(frontendUrl, proxyUrl, secret);

  return {
    id,
    invite: secret,
    url,
    role,
    label: entry.label,
    createdAt,
    expiresAt: expires,
  };
}

/** Build a copyable magic-link URL; falls back to a relative query string. */
export function buildInviteUrl(frontendUrl, proxyUrl, secret) {
  const params = new URLSearchParams();
  if (proxyUrl) params.set("proxy", String(proxyUrl).replace(/\/$/, ""));
  params.set("invite", secret);
  const qs = params.toString();

  if (frontendUrl) {
    try {
      const base = new URL(frontendUrl);
      for (const [k, v] of params.entries()) base.searchParams.set(k, v);
      return base.toString();
    } catch {
      const trimmed = String(frontendUrl).replace(/\/$/, "");
      return `${trimmed}/?${qs}`;
    }
  }
  return `?${qs}`;
}

/**
 * Look up an invite by plaintext secret. Returns null if unknown.
 * Does not reject expired/revoked — callers check status.
 */
export async function lookupInvite(env, secret) {
  if (!env?.SYSTEMS || !secret) return null;
  const hash = await hashToken(secret);
  const entry = await env.SYSTEMS.get(`invite:${hash}`, "json");
  return entry || null;
}

export async function getInviteById(env, id) {
  if (!env?.SYSTEMS || !id) return null;
  const hash = await env.SYSTEMS.get(`invite-id:${id}`);
  if (!hash) return null;
  return env.SYSTEMS.get(`invite:${hash}`, "json");
}

async function persistInvite(env, invite) {
  const hash = await env.SYSTEMS.get(`invite-id:${invite.id}`);
  if (!hash) return false;
  await env.SYSTEMS.put(`invite:${hash}`, JSON.stringify(invite));

  const index = await listInvites(env);
  const updated = index.map((e) => (e.id === invite.id ? indexEntryFrom(invite) : e));
  await saveInviteIndex(env, updated);
  return true;
}

/**
 * Validate a pending invite for acceptance. Fail-closed for revoked/expired/converted.
 * @returns {{ ok: true, invite: object } | { ok: false, error: string, status: number }}
 */
export async function assertInviteAcceptable(env, secret, now = Date.now()) {
  const invite = await lookupInvite(env, secret);
  if (!invite) return { ok: false, error: "Invalid invite", status: 404 };

  const status = effectiveInviteStatus(invite, now);
  if (status === "revoked") return { ok: false, error: "Invite has been revoked", status: 410 };
  if (status === "expired") return { ok: false, error: "Invite has expired", status: 410 };
  if (status === "converted") return { ok: false, error: "Invite has already been used", status: 410 };
  if (status !== "pending") return { ok: false, error: "Invite is not available", status: 410 };

  return { ok: true, invite };
}

/**
 * Mark an invite as converted after a user was created from it.
 */
export async function markInviteConverted(env, inviteId, userId, now = new Date()) {
  const invite = await getInviteById(env, inviteId);
  if (!invite) return false;
  const iso = now.toISOString();
  const updated = {
    ...invite,
    status: "converted",
    convertedAt: iso,
    consumedAt: iso,
    convertedUserId: userId,
  };
  return persistInvite(env, updated);
}

/**
 * Revoke a pending invite. Already-terminal invites are left unchanged (idempotent ok).
 * @returns {{ ok: true, invite: object } | { ok: false, error: string, status: number }}
 */
export async function revokeInvite(env, id) {
  const invite = await getInviteById(env, id);
  if (!invite) return { ok: false, error: "Invite not found", status: 404 };

  const status = effectiveInviteStatus(invite);
  if (status !== "pending") {
    return { ok: false, error: `Cannot revoke invite with status: ${status}`, status: 400 };
  }

  const updated = { ...invite, status: "revoked" };
  await persistInvite(env, updated);
  return { ok: true, invite: indexEntryFrom(updated) };
}

/**
 * Drop non-pending invites from the index (and delete their KV records).
 * Pending invites are never purged.
 * @returns {Promise<{ purged: number }>}
 */
export async function purgeInvites(env, now = Date.now()) {
  const index = await listInvites(env);
  let purged = 0;
  const keep = [];

  for (const entry of index) {
    const full = await getInviteById(env, entry.id);
    const status = full ? effectiveInviteStatus(full, now) : entry.status;
    if (status === "pending") {
      keep.push(entry);
      continue;
    }

    const hash = await env.SYSTEMS.get(`invite-id:${entry.id}`);
    if (hash) await env.SYSTEMS.delete(`invite:${hash}`);
    await env.SYSTEMS.delete(`invite-id:${entry.id}`);
    purged += 1;
  }

  await saveInviteIndex(env, keep);
  return { purged };
}

/** Public list for admin API (no secrets / hashes). */
export async function listInvitesPublic(env, now = Date.now()) {
  const index = await listInvites(env);
  const out = [];
  for (const entry of index) {
    const full = await getInviteById(env, entry.id);
    if (!full) {
      out.push({ ...entry, status: entry.status });
      continue;
    }
    out.push({
      ...indexEntryFrom(full),
      status: effectiveInviteStatus(full, now),
      createdBy: full.createdBy || null,
      convertedAt: full.convertedAt || null,
    });
  }
  return out;
}
