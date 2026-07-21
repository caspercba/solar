/**
 * Password-backed user registry in KV (ADR 0003).
 *
 * KV layout:
 *   user:<id>       -> { id, username, passwordHash, role, createdAt, createdBy?, disabledAt?, lastLoginAt? }
 *   _index_users    -> [{ id, username, role, createdAt, disabledAt? }, ...]
 *
 * Passwords are hashed with PBKDF2-SHA-256 via Web Crypto — never stored in plaintext.
 * Usernames are unique after case-normalization (trim + lowercase).
 */

import { ROLES } from "./tokens.js";

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(str) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Normalize a username for uniqueness checks (trim + lowercase). */
export function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

/**
 * Hash a password with PBKDF2-SHA-256.
 * Stored format: `pbkdf2$sha256$<iterations>$<salt_b64>$<hash_b64>`
 */
export async function hashPassword(password, saltBytes = null) {
  const salt = saltBytes || crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    HASH_BITS,
  );
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(new Uint8Array(derived))}`;
}

/** Verify a plaintext password against a stored PBKDF2 hash. */
export async function verifyPassword(password, storedHash) {
  if (!password || !storedHash || typeof storedHash !== "string") return false;
  const parts = storedHash.split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") return false;
  const iterations = Number(parts[2]);
  if (!Number.isFinite(iterations) || iterations < 1) return false;

  let salt;
  try {
    salt = fromBase64(parts[3]);
  } catch {
    return false;
  }

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    HASH_BITS,
  );
  const candidate = toBase64(new Uint8Array(derived));
  return timingSafeEqual(candidate, parts[4]);
}

/** Constant-time string compare for equal-length base64 digests. */
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function listUsers(env) {
  const index = await env.SYSTEMS.get("_index_users", "json");
  return index || [];
}

async function saveUserIndex(env, index) {
  await env.SYSTEMS.put("_index_users", JSON.stringify(index));
}

function publicUser(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    username: entry.username,
    role: entry.role,
    createdAt: entry.createdAt,
    createdBy: entry.createdBy || null,
    disabledAt: entry.disabledAt || null,
    lastLoginAt: entry.lastLoginAt || null,
  };
}

export async function getUser(env, id) {
  if (!env?.SYSTEMS || !id) return null;
  return env.SYSTEMS.get(`user:${id}`, "json");
}

export async function findUserByUsername(env, username) {
  const normalized = normalizeUsername(username);
  if (!normalized) return null;
  const index = await listUsers(env);
  const hit = index.find((u) => normalizeUsername(u.username) === normalized);
  if (!hit) return null;
  return getUser(env, hit.id);
}

/** Count non-disabled admin users. */
export async function countActiveAdmins(env) {
  const index = await listUsers(env);
  return index.filter((u) => u.role === "admin" && !u.disabledAt).length;
}

/**
 * Create a password user.
 * @param {object} env
 * @param {{ username: string, password: string, role: "read"|"admin", createdBy?: string|null }} opts
 */
export async function createUser(env, { username, password, role, createdBy = null } = {}) {
  const normalized = normalizeUsername(username);
  if (!normalized) throw new Error("Username is required");
  if (normalized.length > 64) throw new Error("Username must be at most 64 characters");
  if (!/^[a-z0-9._-]+$/i.test(normalized)) {
    throw new Error("Username may only contain letters, numbers, dots, underscores, and hyphens");
  }
  if (!password || String(password).length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  if (!ROLES.includes(role)) {
    throw new Error(`Invalid role: ${role}. Expected one of: ${ROLES.join(", ")}`);
  }

  const existing = await findUserByUsername(env, normalized);
  if (existing) throw new Error("Username already taken");

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const passwordHash = await hashPassword(password);
  const entry = {
    id,
    username: normalized,
    passwordHash,
    role,
    createdAt,
    createdBy: createdBy || null,
    disabledAt: null,
    lastLoginAt: null,
  };

  await env.SYSTEMS.put(`user:${id}`, JSON.stringify(entry));

  const index = await listUsers(env);
  index.push({ id, username: normalized, role, createdAt, disabledAt: null });
  await saveUserIndex(env, index);

  return publicUser(entry);
}

/**
 * Soft-disable a user. Refuses if this would remove the last active admin.
 * @returns {Promise<{ ok: true, user: object } | { ok: false, error: string, status: number }>}
 */
export async function disableUser(env, id) {
  const user = await getUser(env, id);
  if (!user) return { ok: false, error: "User not found", status: 404 };

  if (!user.disabledAt && user.role === "admin") {
    const admins = await countActiveAdmins(env);
    if (admins <= 1) {
      return { ok: false, error: "Cannot disable the last admin", status: 400 };
    }
  }

  const disabledAt = user.disabledAt || new Date().toISOString();
  const updated = { ...user, disabledAt };
  await env.SYSTEMS.put(`user:${id}`, JSON.stringify(updated));

  const index = await listUsers(env);
  await saveUserIndex(
    env,
    index.map((u) => (u.id === id ? { ...u, disabledAt } : u)),
  );

  return { ok: true, user: publicUser(updated) };
}

/**
 * Hard-delete a user record. Refuses if this would remove the last active admin.
 */
export async function deleteUser(env, id) {
  const user = await getUser(env, id);
  if (!user) return { ok: false, error: "User not found", status: 404 };

  if (!user.disabledAt && user.role === "admin") {
    const admins = await countActiveAdmins(env);
    if (admins <= 1) {
      return { ok: false, error: "Cannot delete the last admin", status: 400 };
    }
  }

  await env.SYSTEMS.delete(`user:${id}`);
  const index = await listUsers(env);
  await saveUserIndex(env, index.filter((u) => u.id !== id));
  return { ok: true, user: publicUser(user) };
}

/**
 * Patch role and/or re-enable a user.
 * @param {object} env
 * @param {string} id
 * @param {{ role?: "read"|"admin", disabled?: boolean }} patch
 */
export async function updateUser(env, id, patch = {}) {
  const user = await getUser(env, id);
  if (!user) return { ok: false, error: "User not found", status: 404 };

  const next = { ...user };
  let roleChangingToRead = false;

  if (patch.role != null) {
    if (!ROLES.includes(patch.role)) {
      return { ok: false, error: `Invalid role: ${patch.role}. Expected one of: ${ROLES.join(", ")}`, status: 400 };
    }
    if (user.role === "admin" && patch.role !== "admin" && !user.disabledAt) {
      roleChangingToRead = true;
    }
    next.role = patch.role;
  }

  if (patch.disabled === false) {
    next.disabledAt = null;
  } else if (patch.disabled === true) {
    if (!user.disabledAt && user.role === "admin") {
      const admins = await countActiveAdmins(env);
      if (admins <= 1) {
        return { ok: false, error: "Cannot disable the last admin", status: 400 };
      }
    }
    next.disabledAt = user.disabledAt || new Date().toISOString();
  }

  if (roleChangingToRead) {
    const admins = await countActiveAdmins(env);
    // Current user still counts as admin until we save; ensure at least one other.
    if (admins <= 1) {
      return { ok: false, error: "Cannot demote the last admin", status: 400 };
    }
  }

  await env.SYSTEMS.put(`user:${id}`, JSON.stringify(next));

  const index = await listUsers(env);
  await saveUserIndex(
    env,
    index.map((u) =>
      u.id === id
        ? { id: next.id, username: next.username, role: next.role, createdAt: next.createdAt, disabledAt: next.disabledAt || null }
        : u,
    ),
  );

  return { ok: true, user: publicUser(next) };
}

/** Record a successful login timestamp. */
export async function touchLastLogin(env, id) {
  const user = await getUser(env, id);
  if (!user) return null;
  const lastLoginAt = new Date().toISOString();
  const updated = { ...user, lastLoginAt };
  await env.SYSTEMS.put(`user:${id}`, JSON.stringify(updated));
  return publicUser(updated);
}

/** Public list for admin API (no password hashes). */
export async function listUsersPublic(env) {
  const index = await listUsers(env);
  const out = [];
  for (const entry of index) {
    const full = await getUser(env, entry.id);
    out.push(publicUser(full || entry));
  }
  return out;
}

export { publicUser };
