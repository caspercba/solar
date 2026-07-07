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
  health,
  systems,
  realtimeData,
  historyData,
  historySummary,
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

  if (!checkAuth(request)) {
    return error("Unauthorized", 401, origin);
  }

  if (path === "/api/systems" && request.method === "GET") {
    return json(systems, 200, origin);
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
