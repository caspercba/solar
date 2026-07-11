/**
 * Per-user opaque API key registry in KV (ADR 0002 Phase 2).
 *
 * KV layout:
 *   token:<sha256(token)>  -> { id, label, role, createdAt, expiresAt, revokedAt }
 *   token-id:<id>          -> sha256(token)   (lookup for revoke by id; not exposed via API)
 *   _index_tokens          -> [{ id, label, role, prefix, createdAt, expiresAt, revokedAt }, ...]
 *
 * Tokens are opaque random values (32 bytes, base64url) — never JWTs. Only the
 * SHA-256 hash is ever persisted; the plaintext token is returned once at
 * creation time and cannot be recovered afterwards.
 */

export const ROLES = ["read", "admin"];

function toBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Generate a new opaque bearer token (32 bytes, base64url — ~43 chars). */
export function generateOpaqueToken() {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** SHA-256 hash of a token, hex-encoded, used as the KV lookup key. */
export async function hashToken(token) {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

export async function listTokens(env) {
  const index = await env.SYSTEMS.get("_index_tokens", "json");
  return index || [];
}

async function saveTokenIndex(env, index) {
  await env.SYSTEMS.put("_index_tokens", JSON.stringify(index));
}

/**
 * Mint a new per-user API key.
 * @param {object} env
 * @param {{ label?: string, role: "read"|"admin", expiresAt?: string|null }} opts
 * @returns {Promise<{ id: string, token: string, label: string, role: string, createdAt: string, expiresAt: string|null }>}
 */
export async function createToken(env, { label = "", role, expiresAt = null } = {}) {
  if (!ROLES.includes(role)) {
    throw new Error(`Invalid role: ${role}. Expected one of: ${ROLES.join(", ")}`);
  }
  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
    throw new Error(`Invalid expiresAt: ${expiresAt}`);
  }

  const id = crypto.randomUUID();
  const token = generateOpaqueToken();
  const hash = await hashToken(token);
  const createdAt = new Date().toISOString();
  const entry = { id, label, role, createdAt, expiresAt: expiresAt || null, revokedAt: null };

  await env.SYSTEMS.put(`token:${hash}`, JSON.stringify(entry));
  await env.SYSTEMS.put(`token-id:${id}`, hash);

  const index = await listTokens(env);
  index.push({ id, label, role, prefix: token.slice(0, 8), createdAt, expiresAt: entry.expiresAt, revokedAt: null });
  await saveTokenIndex(env, index);

  return { id, token, label, role, createdAt, expiresAt: entry.expiresAt };
}

/**
 * Validate a presented bearer token against the KV registry.
 * Returns null for unknown, revoked, or expired tokens.
 * @returns {Promise<{ id: string, label: string, role: string }|null>}
 */
export async function lookupToken(env, token) {
  if (!env?.SYSTEMS || !token) return null;

  const hash = await hashToken(token);
  const entry = await env.SYSTEMS.get(`token:${hash}`, "json");
  if (!entry) return null;
  if (entry.revokedAt) return null;
  if (entry.expiresAt && Date.now() >= Date.parse(entry.expiresAt)) return null;

  return { id: entry.id, label: entry.label, role: entry.role };
}

/** Revoke a token by id. Returns false when the id is unknown. */
export async function revokeToken(env, id) {
  const hash = await env.SYSTEMS.get(`token-id:${id}`);
  if (!hash) return false;

  const entry = await env.SYSTEMS.get(`token:${hash}`, "json");
  if (!entry) return false;

  const revokedAt = new Date().toISOString();
  await env.SYSTEMS.put(`token:${hash}`, JSON.stringify({ ...entry, revokedAt }));

  const index = await listTokens(env);
  const updated = index.map((t) => (t.id === id ? { ...t, revokedAt } : t));
  await saveTokenIndex(env, updated);

  return true;
}
