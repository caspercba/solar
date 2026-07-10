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
  EMPTY_HISTORY_DATE,
  defaultAlerts,
  health,
  systems,
  realtimeData,
  historyData,
  historySummary,
  resetSystems,
} from "./payloads.js";

export { EMPTY_HISTORY_DATE };

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

function checkAuth(request) {
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

  // Test-only: restore the default mock systems list. Not part of the real
  // Worker API — used by E2E specs that add/remove systems to avoid leaking
  // state into other spec files sharing this mock Worker process.
  if (path === "/__mock__/reset-systems" && request.method === "POST") {
    resetSystems();
    return json({ ok: true }, 200, origin);
  }

  if (!checkAuth(request)) {
    return error("Unauthorized", 401, origin);
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
    const displayHost = MOCK_HOST === "0.0.0.0" ? "localhost" : MOCK_HOST;
    console.log(`[mock-worker] listening on http://${displayHost}:${port}`);
    console.log(`[mock-worker] Bearer token: ${token}`);
    console.log(`[mock-worker] mock system id: ${MOCK_SYSTEM_ID}`);
  });

  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  startMockWorker(MOCK_PORT);
}
