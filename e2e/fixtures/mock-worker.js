#!/usr/bin/env node
/**
 * Lightweight mock Cloudflare Worker for E2E and integration tests.
 * Serves static JSON for dashboard API routes — no real inverter credentials.
 *
 * Usage:
 *   node e2e/fixtures/mock-worker.js
 *   MOCK_WORKER_PORT=8790 MOCK_WORKER_TOKEN=e2e-test-token node e2e/fixtures/mock-worker.js
 */

import http from "node:http";
import { pathToFileURL } from "node:url";
import {
  MOCK_SYSTEM_ID,
  MOCK_TOKEN,
  MOCK_USER,
  MOCK_PASSWORD,
  MOCK_INVITE_EXPIRED,
  MOCK_INVITE_REVOKED,
  MOCK_INVITE_USED,
  MOCK_INVITE_PENDING_PREFIX,
  EMPTY_HISTORY_DATE,
  defaultAlerts,
  health,
  systems,
  realtimeData,
  historyData,
  historySummary,
  resetSystems,
} from "./payloads.js";

export {
  EMPTY_HISTORY_DATE,
  MOCK_USER,
  MOCK_PASSWORD,
  MOCK_INVITE_EXPIRED,
  MOCK_INVITE_REVOKED,
  MOCK_INVITE_USED,
  MOCK_INVITE_PENDING_PREFIX,
};

export const MOCK_PORT = Number(process.env.MOCK_WORKER_PORT) || 8790;
export const MOCK_HOST = process.env.MOCK_WORKER_HOST || "127.0.0.1";

const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(body, status = 200, origin = "*") {
  const headers = {
    "Content-Type": "application/json",
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
  };
  return new Response(JSON.stringify(body), { status, headers });
}

function error(message, status = 400, origin = "*") {
  return json({ error: message }, status, origin);
}

let mockSystemCounter = 0;
/** When true, the next checkAuth fails once (simulates revoked/disabled session). */
let mockSessionExpired = false;
/** Plaintext invite secrets already converted via POST /api/auth/invite/accept. */
const consumedInvites = new Set();

/** Actor role for GET /api/me and admin route gates (mutable via __mock__/set-actor). */
let mockActorRole = process.env.MOCK_WORKER_ROLE === "admin" ? "admin" : "read";

let mockUserCounter = 0;
let mockInviteCounter = 0;
/** @type {Array<{id:string,username:string,role:string,createdAt:string,createdBy:string|null,disabledAt:string|null,lastLoginAt:string|null}>} */
let mockUsers = [];
/**
 * Admin-minted invites. `secret` is plaintext (mock-only); list endpoints omit it.
 * @type {Array<{id:string,secret:string,label:string|null,role:string,status:string,createdAt:string,expiresAt:string,convertedAt:string|null,convertedUserId:string|null}>}
 */
let mockInvites = [];

function defaultAdminUser() {
  const username = (process.env.MOCK_WORKER_USER || MOCK_USER).toLowerCase();
  return {
    id: "e2e-admin-1",
    username,
    role: "admin",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: null,
    disabledAt: null,
    lastLoginAt: "2026-07-01T12:00:00.000Z",
  };
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt,
    createdBy: user.createdBy || null,
    disabledAt: user.disabledAt || null,
    lastLoginAt: user.lastLoginAt || null,
  };
}

function publicInvite(invite) {
  return {
    id: invite.id,
    label: invite.label || null,
    role: invite.role,
    status: invite.status,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    convertedAt: invite.convertedAt || null,
    convertedUserId: invite.convertedUserId || null,
  };
}

function countActiveAdmins() {
  return mockUsers.filter((u) => u.role === "admin" && !u.disabledAt).length;
}

function findUserByUsername(username) {
  const norm = String(username || "").trim().toLowerCase();
  return mockUsers.find((u) => u.username === norm) || null;
}

function buildInviteUrl(frontendUrl, proxyUrl, secret) {
  const params = new URLSearchParams();
  if (proxyUrl) params.set("proxy", String(proxyUrl).replace(/\/$/, ""));
  params.set("invite", secret);
  if (frontendUrl) {
    try {
      const base = new URL(frontendUrl);
      for (const [k, v] of params.entries()) base.searchParams.set(k, v);
      return base.toString();
    } catch {
      const trimmed = String(frontendUrl).replace(/\/$/, "");
      return `${trimmed}/?${params.toString()}`;
    }
  }
  return `?${params.toString()}`;
}

function resetAdminState() {
  consumedInvites.clear();
  mockUsers = [defaultAdminUser()];
  mockInvites = [];
  mockUserCounter = 0;
  mockInviteCounter = 0;
  mockActorRole = process.env.MOCK_WORKER_ROLE === "admin" ? "admin" : "read";
}

function resetInvites() {
  resetAdminState();
}

resetAdminState();

/**
 * Mirror Worker assertInviteAcceptable + createUser for E2E (no real KV).
 * @returns {{ ok: true, username: string, role: string, userId?: string } | { ok: false, error: string, status: number }}
 */
function evaluateInviteAccept({ invite, username, password }) {
  if (!invite || !username || !password) {
    return { ok: false, error: "Missing required fields: invite, username, password", status: 400 };
  }
  if (String(password).length < 8) {
    return { ok: false, error: "Password must be at least 8 characters", status: 400 };
  }

  const secret = String(invite);
  if (secret === MOCK_INVITE_EXPIRED) {
    return { ok: false, error: "Invite has expired", status: 410 };
  }
  if (secret === MOCK_INVITE_REVOKED) {
    return { ok: false, error: "Invite has been revoked", status: 410 };
  }
  if (secret === MOCK_INVITE_USED || consumedInvites.has(secret)) {
    return { ok: false, error: "Invite has already been used", status: 410 };
  }

  const minted = mockInvites.find((inv) => inv.secret === secret);
  if (minted) {
    if (minted.status === "revoked") {
      return { ok: false, error: "Invite has been revoked", status: 410 };
    }
    if (minted.status === "converted") {
      return { ok: false, error: "Invite has already been used", status: 410 };
    }
    if (minted.status === "expired" || (minted.expiresAt && Date.now() >= Date.parse(minted.expiresAt))) {
      minted.status = "expired";
      return { ok: false, error: "Invite has expired", status: 410 };
    }
    if (minted.status !== "pending") {
      return { ok: false, error: "Invite is not available", status: 410 };
    }
  } else if (!secret.startsWith(MOCK_INVITE_PENDING_PREFIX)) {
    return { ok: false, error: "Invalid invite", status: 404 };
  }

  const userNorm = String(username).trim().toLowerCase();
  if (findUserByUsername(userNorm)) {
    return { ok: false, error: "Username already taken", status: 400 };
  }

  const role = minted?.role || "read";
  mockUserCounter += 1;
  const userId = `e2e-user-${mockUserCounter}`;
  const now = new Date().toISOString();
  mockUsers.push({
    id: userId,
    username: userNorm,
    role,
    createdAt: now,
    createdBy: "invite",
    disabledAt: null,
    lastLoginAt: now,
  });

  if (minted) {
    minted.status = "converted";
    minted.convertedAt = now;
    minted.convertedUserId = userId;
  }

  consumedInvites.add(secret);
  return { ok: true, username: userNorm, role, userId };
}

function forbidReadOnly(origin) {
  return error("Forbidden: read-only token cannot perform this action", 403, origin);
}

function checkAuth(request) {
  if (mockSessionExpired) {
    mockSessionExpired = false;
    return false;
  }
  const token = process.env.MOCK_WORKER_TOKEN || MOCK_TOKEN;
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return match[1] === token;
}

function resolveOrigin(request) {
  return request.headers.get("Origin") || "*";
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Mirror worker/src/alerts.js normalization for E2E PUT /alerts. */
function normalizeAlerts(alerts = {}) {
  const merged = { ...defaultAlerts, ...alerts };
  merged.lowSocThreshold = clampNumber(
    merged.lowSocThreshold,
    0,
    100,
    defaultAlerts.lowSocThreshold,
  );
  merged.cooldownMinutes = clampNumber(
    merged.cooldownMinutes,
    5,
    1440,
    defaultAlerts.cooldownMinutes,
  );
  merged.webhookUrl = String(merged.webhookUrl || "").trim();
  return merged;
}

function publicAlerts(alerts) {
  const normalized = normalizeAlerts(alerts);
  return {
    enabled: normalized.enabled,
    webhookUrl: normalized.webhookUrl,
    lowSocThreshold: normalized.lowSocThreshold,
    notifyLowSoc: normalized.notifyLowSoc,
    notifyGenerator: normalized.notifyGenerator,
    cooldownMinutes: normalized.cooldownMinutes,
    webhookConfigured: Boolean(normalized.webhookUrl),
  };
}

/**
 * Fetch-style handler mirroring worker route paths used by the dashboard.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function handleMockWorkerRequest(request) {
  const origin = resolveOrigin(request);
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...CORS_HEADERS, "Access-Control-Allow-Origin": origin },
    });
  }

  if (path === "/api/health" && request.method === "GET") {
    return json(health, 200, origin);
  }

  // POST /api/auth/login — username + password → session bearer (ADR 0003)
  if (path === "/api/auth/login" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return error("Invalid JSON body", 400, origin);
    }
    const { username, password } = body || {};
    if (!username || !password) {
      return error("Missing required fields: username, password", 400, origin);
    }

    const expectedUser = (process.env.MOCK_WORKER_USER || MOCK_USER).toLowerCase();
    const expectedPass = process.env.MOCK_WORKER_PASSWORD || MOCK_PASSWORD;
    const userNorm = String(username).trim().toLowerCase();

    // Mirror Worker: disabled accounts and bad passwords share one message.
    if (userNorm === "disabled" || userNorm !== expectedUser || password !== expectedPass) {
      return error("Invalid username or password", 401, origin);
    }

    mockActorRole = "admin";
    const token = process.env.MOCK_WORKER_TOKEN || MOCK_TOKEN;
    return json(
      {
        token,
        role: "admin",
        username: expectedUser,
        userId: "e2e-admin-1",
        tokenId: "e2e-mock-session",
      },
      200,
      origin,
    );
  }

  // POST /api/auth/invite/accept — create user from invite + session (no prior auth)
  if (path === "/api/auth/invite/accept" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return error("Invalid JSON body", 400, origin);
    }
    const result = evaluateInviteAccept(body || {});
    if (!result.ok) return error(result.error, result.status, origin);

    const token = process.env.MOCK_WORKER_TOKEN || MOCK_TOKEN;
    return json(
      {
        token,
        role: result.role,
        username: result.username,
        userId: result.userId || "e2e-invite-user",
        tokenId: "e2e-invite-session",
      },
      201,
      origin,
    );
  }

  // Test-only: restore the default mock systems list. Not part of the real
  // Worker API — used by E2E specs that add/remove systems to avoid leaking
  // state into other spec files sharing this mock Worker process.
  if (path === "/__mock__/reset-systems" && request.method === "POST") {
    resetSystems();
    return json({ ok: true }, 200, origin);
  }

  // Test-only: clear consumed invite secrets + admin users/invites between specs.
  if (path === "/__mock__/reset-invites" && request.method === "POST") {
    resetInvites();
    return json({ ok: true }, 200, origin);
  }

  // Test-only: reset admin users/invites + actor role (alias of reset-invites).
  if (path === "/__mock__/reset-admin" && request.method === "POST") {
    resetAdminState();
    return json({ ok: true }, 200, origin);
  }

  // Test-only: set GET /api/me role for admin vs read UI gating.
  if (path === "/__mock__/set-actor" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return error("Invalid JSON body", 400, origin);
    }
    const role = body?.role === "admin" ? "admin" : "read";
    mockActorRole = role;
    return json({ ok: true, role: mockActorRole }, 200, origin);
  }

  // Test-only: next authenticated request returns 401 (session revoked/disabled).
  if (path === "/__mock__/expire-session" && request.method === "POST") {
    mockSessionExpired = true;
    return json({ ok: true }, 200, origin);
  }

  if (!checkAuth(request)) {
    return error("Unauthorized", 401, origin);
  }

  // POST /api/auth/logout — revoke session (shared mock token stays valid for other tests)
  if (path === "/api/auth/logout" && request.method === "POST") {
    mockSessionExpired = false;
    return json({ ok: true }, 200, origin);
  }

  // GET /api/me — current actor (default read; __mock__/set-actor or MOCK_WORKER_ROLE=admin)
  if (path === "/api/me" && request.method === "GET") {
    const username = (process.env.MOCK_WORKER_USER || MOCK_USER).toLowerCase();
    return json(
      {
        userId: "e2e-admin-1",
        tokenId: "e2e-mock-session",
        username,
        role: mockActorRole,
        actorId: "e2e-admin-1",
      },
      200,
      origin,
    );
  }

  // --- Admin: password users (ADR 0003) ---

  if (path === "/api/admin/users" && request.method === "GET") {
    if (mockActorRole !== "admin") return forbidReadOnly(origin);
    return json(mockUsers.map(publicUser), 200, origin);
  }

  if (path === "/api/admin/users" && request.method === "POST") {
    if (mockActorRole !== "admin") return forbidReadOnly(origin);
    let body;
    try {
      body = await request.json();
    } catch {
      return error("Invalid JSON body", 400, origin);
    }
    const { username, password, role } = body || {};
    if (!username || !password) {
      return error("Missing required fields: username, password", 400, origin);
    }
    if (String(password).length < 8) {
      return error("Password must be at least 8 characters", 400, origin);
    }
    const nextRole = role === "admin" ? "admin" : "read";
    const userNorm = String(username).trim().toLowerCase();
    if (findUserByUsername(userNorm)) {
      return error("Username already taken", 400, origin);
    }
    mockUserCounter += 1;
    const user = {
      id: `e2e-user-${mockUserCounter}`,
      username: userNorm,
      role: nextRole,
      createdAt: new Date().toISOString(),
      createdBy: "e2e-admin-1",
      disabledAt: null,
      lastLoginAt: null,
    };
    mockUsers.push(user);
    return json(publicUser(user), 201, origin);
  }

  const adminUserMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (adminUserMatch && request.method === "PATCH") {
    if (mockActorRole !== "admin") return forbidReadOnly(origin);
    const id = adminUserMatch[1];
    const user = mockUsers.find((u) => u.id === id);
    if (!user) return error("User not found", 404, origin);

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Invalid JSON body", 400, origin);
    }

    if (body?.role != null) {
      if (body.role !== "read" && body.role !== "admin") {
        return error(`Invalid role: ${body.role}`, 400, origin);
      }
      if (user.role === "admin" && body.role === "read" && !user.disabledAt && countActiveAdmins() <= 1) {
        return error("Cannot demote the last admin", 400, origin);
      }
      user.role = body.role;
    }

    if (body?.disabled === true) {
      if (!user.disabledAt && user.role === "admin" && countActiveAdmins() <= 1) {
        return error("Cannot disable the last admin", 400, origin);
      }
      user.disabledAt = user.disabledAt || new Date().toISOString();
    } else if (body?.disabled === false) {
      user.disabledAt = null;
    }

    return json(publicUser(user), 200, origin);
  }

  if (adminUserMatch && request.method === "DELETE") {
    if (mockActorRole !== "admin") return forbidReadOnly(origin);
    const id = adminUserMatch[1];
    const user = mockUsers.find((u) => u.id === id);
    if (!user) return error("User not found", 404, origin);
    if (!user.disabledAt && user.role === "admin" && countActiveAdmins() <= 1) {
      return error("Cannot disable the last admin", 400, origin);
    }
    user.disabledAt = user.disabledAt || new Date().toISOString();
    return json({ ok: true, user: publicUser(user) }, 200, origin);
  }

  // --- Admin: invites (ADR 0003) ---

  if (path === "/api/admin/invites" && request.method === "GET") {
    if (mockActorRole !== "admin") return forbidReadOnly(origin);
    return json(mockInvites.map(publicInvite), 200, origin);
  }

  if (path === "/api/admin/invites" && request.method === "POST") {
    if (mockActorRole !== "admin") return forbidReadOnly(origin);
    let body;
    try {
      body = await request.json();
    } catch {
      return error("Invalid JSON body", 400, origin);
    }
    const { role, label, ttlMs, frontendUrl } = body || {};
    const nextRole = role === "admin" ? "admin" : "read";
    mockInviteCounter += 1;
    const id = `e2e-invite-${mockInviteCounter}`;
    const secret = `${MOCK_INVITE_PENDING_PREFIX}minted-${mockInviteCounter}-${Date.now().toString(36)}`;
    const ttl = Number.isFinite(Number(ttlMs)) && Number(ttlMs) > 0
      ? Number(ttlMs)
      : 7 * 24 * 60 * 60 * 1000;
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttl).toISOString();
    const entry = {
      id,
      secret,
      label: label ? String(label).trim() : null,
      role: nextRole,
      status: "pending",
      createdAt,
      expiresAt,
      convertedAt: null,
      convertedUserId: null,
    };
    mockInvites.push(entry);
    const proxyUrl = `${url.protocol}//${url.host}`;
    return json(
      {
        id,
        invite: secret,
        url: buildInviteUrl(frontendUrl || null, proxyUrl, secret),
        role: nextRole,
        label: entry.label,
        createdAt,
        expiresAt,
      },
      201,
      origin,
    );
  }

  if (path === "/api/admin/invites/purge" && request.method === "POST") {
    if (mockActorRole !== "admin") return forbidReadOnly(origin);
    const before = mockInvites.length;
    mockInvites = mockInvites.filter((inv) => inv.status === "pending");
    return json({ purged: before - mockInvites.length }, 200, origin);
  }

  const adminInviteMatch = path.match(/^\/api\/admin\/invites\/([^/]+)$/);
  if (adminInviteMatch && request.method === "DELETE") {
    if (mockActorRole !== "admin") return forbidReadOnly(origin);
    const id = adminInviteMatch[1];
    const invite = mockInvites.find((inv) => inv.id === id);
    if (!invite) return error("Invite not found", 404, origin);
    if (invite.status !== "pending") {
      return error("Only pending invites can be revoked", 400, origin);
    }
    invite.status = "revoked";
    return json({ ok: true, invite: publicInvite(invite) }, 200, origin);
  }

  if (path === "/api/systems" && request.method === "GET") {
    return json(systems, 200, origin);
  }

  if (path === "/api/systems" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return error("Invalid JSON body", 400, origin);
    }

    const { service, name, user, password } = body || {};
    if (!service || !user || !password) {
      return error("Missing required fields: service, user, password", 400, origin);
    }
    if (service !== "shinemonitor" && service !== "growatt") {
      return error(`Unsupported service: ${service}`, 400, origin);
    }
    if (password === "bad-password") {
      return error("Discovery failed: Invalid credentials", 502, origin);
    }

    mockSystemCounter += 1;
    const id = `e2e-added-${mockSystemCounter}`;
    const systemName = name || `Mock ${service} system`;
    const newSystem = { id, name: systemName, service, username: user, alerts: { ...defaultAlerts } };
    systems.push(newSystem);

    return json({ id, name: systemName, service, discovered: { plantName: systemName } }, 201, origin);
  }

  const systemIdMatch = path.match(/^\/api\/systems\/([^/]+)$/);
  if (systemIdMatch && request.method === "DELETE") {
    const id = systemIdMatch[1];
    const idx = systems.findIndex((s) => s.id === id);
    if (idx === -1) return error("System not found", 404, origin);
    systems.splice(idx, 1);
    return json({ ok: true }, 200, origin);
  }

  if (path === "/api/systems/all/data" && request.method === "GET") {
    return json(systems.map((s) => realtimeData(s.id)), 200, origin);
  }

  const alertsMatch = path.match(/^\/api\/systems\/([^/]+)\/alerts$/);
  if (alertsMatch && request.method === "PUT") {
    const id = alertsMatch[1];
    const sys = systems.find((s) => s.id === id);
    if (!sys) return error("System not found", 404, origin);

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Invalid JSON body", 400, origin);
    }

    const current = normalizeAlerts(sys.alerts);
    const updated = normalizeAlerts({
      ...current,
      ...body,
      webhookUrl: body.webhookUrl != null ? body.webhookUrl : current.webhookUrl,
    });
    sys.alerts = publicAlerts(updated);
    return json(sys.alerts, 200, origin);
  }

  const credentialsMatch = path.match(/^\/api\/systems\/([^/]+)\/credentials$/);
  if (credentialsMatch && request.method === "PUT") {
    const id = credentialsMatch[1];
    const sys = systems.find((s) => s.id === id);
    if (!sys) return error("System not found", 404, origin);

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Invalid JSON body", 400, origin);
    }

    const { user, password } = body || {};
    if (!user || !password) {
      return error("Missing required fields: user, password", 400, origin);
    }
    if (password === "bad-password") {
      return error("Discovery failed: Invalid credentials", 502, origin);
    }

    sys.username = user;
    return json({
      id: sys.id,
      name: sys.name,
      service: sys.service,
      username: user,
      discovered: { plantId: "mock-plant-1" },
    }, 200, origin);
  }

  const gridInputLabelMatch = path.match(/^\/api\/systems\/([^/]+)\/grid-input-label$/);
  if (gridInputLabelMatch && request.method === "PUT") {
    const id = gridInputLabelMatch[1];
    const sys = systems.find((s) => s.id === id);
    if (!sys) return error("System not found", 404, origin);

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Invalid JSON body", 400, origin);
    }

    const value = String(body?.gridInputLabel || "generator").toLowerCase();
    sys.gridInputLabel = value === "grid" ? "grid" : "generator";
    return json({ gridInputLabel: sys.gridInputLabel }, 200, origin);
  }

  if (gridInputLabelMatch && request.method === "GET") {
    const id = gridInputLabelMatch[1];
    const sys = systems.find((s) => s.id === id);
    if (!sys) return error("System not found", 404, origin);
    return json({ gridInputLabel: sys.gridInputLabel || "generator" }, 200, origin);
  }

  const dataMatch = path.match(/^\/api\/systems\/([^/]+)\/data$/);
  if (dataMatch && request.method === "GET") {
    const id = dataMatch[1];
    if (!systems.some((s) => s.id === id)) {
      return error("System not found", 404, origin);
    }
    return json(realtimeData(id), 200, origin);
  }

  const summaryMatch = path.match(/^\/api\/systems\/([^/]+)\/history\/summary$/);
  if (summaryMatch && request.method === "GET") {
    const id = summaryMatch[1];
    if (!systems.some((s) => s.id === id)) {
      return error("System not found", 404, origin);
    }
    const daysParam = url.searchParams.get("days");
    const days = daysParam ? Number(daysParam) : 7;
    if (!Number.isFinite(days) || days < 1 || days > 90) {
      return error("Invalid days (expected 1–90)", 400, origin);
    }
    const endDate = url.searchParams.get("end") || "2026-07-03";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return error("Invalid end date (expected YYYY-MM-DD)", 400, origin);
    }
    return json(historySummary(id, days, endDate), 200, origin);
  }

  const historyMatch = path.match(/^\/api\/systems\/([^/]+)\/history$/);
  if (historyMatch && request.method === "GET") {
    const id = historyMatch[1];
    if (!systems.some((s) => s.id === id)) {
      return error("System not found", 404, origin);
    }
    const dateParam = url.searchParams.get("date");
    if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return error("Invalid date (expected YYYY-MM-DD)", 400, origin);
    }
    return json(historyData(id, dateParam || null), 200, origin);
  }

  return error("Not found", 404, origin);
}

/**
 * Start HTTP server on a fixed port (default 8790).
 * @param {number} [port]
 * @returns {import("node:http").Server}
 */
export function startMockWorker(port = MOCK_PORT) {
  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || `127.0.0.1:${port}`;
      const url = `http://${host}${req.url}`;
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value != null) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }

      const init = { method: req.method, headers };
      if (req.method !== "GET" && req.method !== "HEAD") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        init.body = Buffer.concat(chunks);
      }

      const response = await handleMockWorkerRequest(new Request(url, init));
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (response.body) {
        const buf = Buffer.from(await response.arrayBuffer());
        res.end(buf);
      } else {
        res.end();
      }
    } catch (err) {
      console.error("[mock-worker] request error:", err);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });

  server.listen(port, MOCK_HOST, () => {
    const token = process.env.MOCK_WORKER_TOKEN || MOCK_TOKEN;
    const user = process.env.MOCK_WORKER_USER || MOCK_USER;
    const displayHost = MOCK_HOST === "0.0.0.0" ? "localhost" : MOCK_HOST;
    console.log(`[mock-worker] listening on http://${displayHost}:${port}`);
    console.log(`[mock-worker] login: ${user} / (MOCK_WORKER_PASSWORD)`);
    console.log(`[mock-worker] Bearer token: ${token}`);
    console.log(`[mock-worker] invite: ${MOCK_INVITE_PENDING_PREFIX}* (single-use) / expired|revoked|used fixtures`);
    console.log(`[mock-worker] admin: /api/admin/users + /api/admin/invites (role via MOCK_WORKER_ROLE or __mock__/set-actor)`);
    console.log(`[mock-worker] mock system id: ${MOCK_SYSTEM_ID}`);
  });

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startMockWorker(MOCK_PORT);
}
