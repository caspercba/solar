import { checkAuth, isAuthMisconfigured, corsHeaders, jsonResponse, errorResponse, resolveCors } from "./auth.js";
import { toHaPayload } from "./ha.js";
import { logAdapterError, auditLog } from "./logger.js";
import { checkDataRateLimit, getRateLimitKey, rateLimitResponse } from "./rateLimit.js";
import { saveSystemConfig, loadSystemConfig } from "./credentials.js";
import { createToken, listTokens, revokeToken } from "./tokens.js";
import {
  runScheduledAlerts,
  updateSystemAlerts,
  publicAlerts,
  deleteAlertState,
  DEFAULT_ALERTS,
} from "./alerts.js";
import {
  updateSystemGridDetect,
  publicGridDetect,
  DEFAULT_GRID_DETECT,
} from "./gridDetect.js";
import {
  updateSystemGridInputLabel,
  publicGridInputLabel,
  normalizeGridInputLabel,
} from "./gridInputLabel.js";
import * as shinemonitor from "./services/shinemonitor.js";
import * as growatt from "./services/growatt.js";

const ADAPTERS = { shinemonitor, growatt };

/** Pass KV env to adapters that persist session state (Growatt). */
function forAdapter(raw, env) {
  if (raw.service === "growatt") return growatt.withAdapterContext(raw, env);
  return raw;
}

function generateId() {
  return crypto.randomUUID();
}

/** Build the shared context for an audit-log entry (ADR 0002 Phase 1 + 2). */
function auditContext(request, action, resource, actorId) {
  return {
    actorId,
    action,
    resource: resource ?? null,
    method: request.method,
    path: new URL(request.url).pathname,
    clientIp: request.headers.get("CF-Connecting-IP") || null,
    requestId: crypto.randomUUID(),
  };
}

/** Emit the audit entry for a mutating route and pass the response through. */
function auditedResponse(env, ctx, response) {
  auditLog(env, {
    ...ctx,
    outcome: response.status < 400 ? "success" : "error",
    status: response.status,
  });
  return response;
}

/** Reject a mutation attempted with a read-role token (ADR 0002 Phase 2). */
function forbiddenReadOnly(env, auditCtx, origin) {
  return auditedResponse(env, auditCtx, errorResponse("Forbidden: read-only token cannot perform this action", 403, origin));
}

function enforceDataRateLimit(request, env, origin, auth) {
  const key = getRateLimitKey(request, env, auth);
  const result = checkDataRateLimit(key);
  if (!result.allowed) {
    return rateLimitResponse(result.retryAfter, origin);
  }
  return null;
}

async function listSystems(env) {
  const list = await env.SYSTEMS.get("_index", "json");
  if (!list) return [];
  return list;
}

async function saveIndex(env, index) {
  await env.SYSTEMS.put("_index", JSON.stringify(index));
}

export default {
  async fetch(request, env) {
    const cors = resolveCors(request, env);

    if (request.method === "OPTIONS") {
      if (!cors.allowed) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 204, headers: corsHeaders(cors.origin) });
    }

    if (!cors.allowed) {
      return new Response(null, { status: 403 });
    }

    const origin = cors.origin;

    const url = new URL(request.url);
    const path = url.pathname;

    // GET /api/health — lightweight uptime check (no auth required)
    if (path === "/api/health" && request.method === "GET") {
      return jsonResponse({ ok: true, version: "1.1.0" }, 200, origin);
    }

    if (isAuthMisconfigured(env)) {
      return errorResponse("Service misconfigured: API_TOKEN is required in this environment", 503, origin);
    }

    const auth = await checkAuth(request, env);
    if (!auth.ok) {
      return errorResponse("Unauthorized", 401, origin);
    }

    // GET /api/services — list supported service types
    if (path === "/api/services" && request.method === "GET") {
      return jsonResponse([
        { id: "shinemonitor", name: "ShineMonitor", fields: ["user", "password"] },
        { id: "growatt", name: "Growatt", fields: ["user", "password"] },
      ], 200, origin);
    }

    // POST /api/admin/tokens — mint a per-user opaque API key (ADR 0002 Phase 2, admin only)
    if (path === "/api/admin/tokens" && request.method === "POST") {
      const auditCtx = auditContext(request, "token.create", null, auth.actorId);
      if (auth.role !== "admin") return forbiddenReadOnly(env, auditCtx, origin);

      const body = await request.json();
      const { label, role, expiresAt } = body || {};

      let minted;
      try {
        minted = await createToken(env, { label, role, expiresAt });
      } catch (err) {
        return auditedResponse(env, auditCtx, errorResponse(err.message, 400, origin));
      }

      return auditedResponse(env, { ...auditCtx, resource: minted.id }, jsonResponse(minted, 201, origin));
    }

    // GET /api/admin/tokens — list minted API keys (never returns the plaintext token)
    if (path === "/api/admin/tokens" && request.method === "GET") {
      if (auth.role !== "admin") {
        return errorResponse("Forbidden: read-only token cannot perform this action", 403, origin);
      }
      const tokens = await listTokens(env);
      return jsonResponse(tokens, 200, origin);
    }

    // DELETE /api/admin/tokens/:id — revoke a per-user API key
    const tokenMatch = path.match(/^\/api\/admin\/tokens\/([^/]+)$/);
    if (tokenMatch && request.method === "DELETE") {
      const id = tokenMatch[1];
      const auditCtx = auditContext(request, "token.revoke", id, auth.actorId);
      if (auth.role !== "admin") return forbiddenReadOnly(env, auditCtx, origin);

      const revoked = await revokeToken(env, id);
      if (!revoked) return auditedResponse(env, auditCtx, errorResponse("Token not found", 404, origin));
      return auditedResponse(env, auditCtx, jsonResponse({ ok: true }, 200, origin));
    }

    // GET /api/systems — list all configured systems (without credentials)
    if (path === "/api/systems" && request.method === "GET") {
      const index = await listSystems(env);
      const safe = await Promise.all(index.map(async (s) => {
        const raw = await loadSystemConfig(env, s.id);
        return {
          id: s.id,
          name: s.name,
          service: s.service,
          username: raw?.credentials?.user || "",
          alerts: publicAlerts(raw?.alerts || DEFAULT_ALERTS),
          gridDetect: publicGridDetect(raw?.gridDetect || DEFAULT_GRID_DETECT),
          gridInputLabel: publicGridInputLabel(raw?.gridInputLabel),
        };
      }));
      return jsonResponse(safe, 200, origin);
    }

    // POST /api/systems — add a new system
    if (path === "/api/systems" && request.method === "POST") {
      const body = await request.json();
      const { service, name, user, password, plantId, deviceKey, deviceMode, gridInputLabel } = body;
      const auditCtx = auditContext(request, "system.create", null, auth.actorId);

      if (auth.role !== "admin") return forbiddenReadOnly(env, auditCtx, origin);

      if (!service || !user || !password) {
        return auditedResponse(env, auditCtx, errorResponse("Missing required fields: service, user, password", 400, origin));
      }

      const adapter = ADAPTERS[service];
      if (!adapter) {
        return auditedResponse(env, auditCtx, errorResponse(`Unsupported service: ${service}. Supported: ${Object.keys(ADAPTERS).join(", ")}`, 400, origin));
      }

      let discovered;
      try {
        discovered = await adapter.discover(
          { user, password },
          plantId || null,
          service === "shinemonitor" ? { deviceKey: deviceKey || null, deviceMode: deviceMode || null } : undefined,
        );
      } catch (err) {
        logAdapterError(env, "adapter_discover_failed", {
          service,
          route: "POST /api/systems",
          error: err,
        });
        return auditedResponse(env, auditCtx, errorResponse(`Discovery failed: ${err.message}`, 502, origin));
      }

      if (discovered.requiresPlantSelection) {
        return auditedResponse(env, auditCtx, jsonResponse({
          requiresPlantSelection: true,
          plants: discovered.plants,
        }, 200, origin));
      }

      if (discovered.requiresDeviceSelection) {
        return auditedResponse(env, auditCtx, jsonResponse({
          requiresDeviceSelection: true,
          plantId: discovered.plantId,
          plantName: discovered.plantName,
          devices: discovered.deviceOptions,
        }, 200, origin));
      }

      const id = generateId();
      const systemName = name || discovered.plantName || `${service} system`;

      const systemConfig = {
        id,
        name: systemName,
        service,
        credentials: { user, ...buildCredentials(service, password, discovered) },
        gridInputLabel: normalizeGridInputLabel(gridInputLabel),
        createdAt: new Date().toISOString(),
      };

      await saveSystemConfig(env, systemConfig);

      const index = await listSystems(env);
      index.push({ id, name: systemName, service });
      await saveIndex(env, index);

      return auditedResponse(env, { ...auditCtx, resource: id }, jsonResponse({ id, name: systemName, service, discovered }, 201, origin));
    }

    // PUT /api/systems/:id/credentials — rotate portal username/password and re-discover
    const credentialsMatch = path.match(/^\/api\/systems\/([^/]+)\/credentials$/);
    if (credentialsMatch && request.method === "PUT") {
      const id = credentialsMatch[1];
      const auditCtx = auditContext(request, "credentials.rotate", id, auth.actorId);
      if (auth.role !== "admin") return forbiddenReadOnly(env, auditCtx, origin);

      const raw = await loadSystemConfig(env, id);
      if (!raw) return auditedResponse(env, auditCtx, errorResponse("System not found", 404, origin));

      const body = await request.json();
      const { user, password, plantId: bodyPlantId } = body;

      if (!user || !password) {
        return auditedResponse(env, auditCtx, errorResponse("Missing required fields: user, password", 400, origin));
      }

      const adapter = ADAPTERS[raw.service];
      if (!adapter) {
        return auditedResponse(env, auditCtx, errorResponse(`No adapter for service: ${raw.service}`, 500, origin));
      }

      const plantId = bodyPlantId || raw.credentials?.plantId || null;

      let discovered;
      try {
        discovered = await adapter.discover({ user, password }, plantId);
      } catch (err) {
        logAdapterError(env, "adapter_discover_failed", {
          service: raw.service,
          systemId: id,
          route: "PUT /api/systems/:id/credentials",
          error: err,
        });
        return auditedResponse(env, auditCtx, errorResponse(`Discovery failed: ${err.message}`, 502, origin));
      }

      if (discovered.requiresPlantSelection) {
        return auditedResponse(env, auditCtx, jsonResponse({
          requiresPlantSelection: true,
          plants: discovered.plants,
        }, 200, origin));
      }

      const updatedConfig = {
        ...raw,
        credentials: { user, ...buildCredentials(raw.service, password, discovered) },
      };

      await saveSystemConfig(env, updatedConfig);

      return auditedResponse(env, auditCtx, jsonResponse({
        id: raw.id,
        name: raw.name,
        service: raw.service,
        username: user,
        discovered,
      }, 200, origin));
    }

    // PUT /api/systems/:id/alerts — update alert thresholds and webhook
    const alertsMatch = path.match(/^\/api\/systems\/([^/]+)\/alerts$/);
    if (alertsMatch && request.method === "PUT") {
      const id = alertsMatch[1];
      const auditCtx = auditContext(request, "alerts.update", id, auth.actorId);
      if (auth.role !== "admin") return forbiddenReadOnly(env, auditCtx, origin);

      const body = await request.json();
      const updated = await updateSystemAlerts(env, id, body);
      if (!updated) return auditedResponse(env, auditCtx, errorResponse("System not found", 404, origin));
      return auditedResponse(env, auditCtx, jsonResponse(publicAlerts(updated), 200, origin));
    }

    // GET /api/systems/:id/alerts — read alert settings
    if (alertsMatch && request.method === "GET") {
      const id = alertsMatch[1];
      const raw = await env.SYSTEMS.get(`system:${id}`, "json");
      if (!raw) return errorResponse("System not found", 404, origin);
      return jsonResponse(publicAlerts(raw.alerts || DEFAULT_ALERTS), 200, origin);
    }

    // PUT /api/systems/:id/grid-detect — update generator detection thresholds
    const gridDetectMatch = path.match(/^\/api\/systems\/([^/]+)\/grid-detect$/);
    if (gridDetectMatch && request.method === "PUT") {
      const id = gridDetectMatch[1];
      if (auth.role !== "admin") return errorResponse("Forbidden: read-only token cannot perform this action", 403, origin);

      const body = await request.json();
      const updated = await updateSystemGridDetect(env, id, body);
      if (!updated) return errorResponse("System not found", 404, origin);
      return jsonResponse(publicGridDetect(updated), 200, origin);
    }

    // GET /api/systems/:id/grid-detect — read generator detection thresholds
    if (gridDetectMatch && request.method === "GET") {
      const id = gridDetectMatch[1];
      const raw = await env.SYSTEMS.get(`system:${id}`, "json");
      if (!raw) return errorResponse("System not found", 404, origin);
      return jsonResponse(publicGridDetect(raw.gridDetect || DEFAULT_GRID_DETECT), 200, origin);
    }

    // PUT /api/systems/:id/grid-input-label — update Generator vs Grid card label
    const gridInputLabelMatch = path.match(/^\/api\/systems\/([^/]+)\/grid-input-label$/);
    if (gridInputLabelMatch && request.method === "PUT") {
      const id = gridInputLabelMatch[1];
      if (auth.role !== "admin") return errorResponse("Forbidden: read-only token cannot perform this action", 403, origin);

      const body = await request.json();
      const updated = await updateSystemGridInputLabel(env, id, body);
      if (!updated) return errorResponse("System not found", 404, origin);
      return jsonResponse({ gridInputLabel: updated }, 200, origin);
    }

    // GET /api/systems/:id/grid-input-label — read Generator vs Grid card label
    if (gridInputLabelMatch && request.method === "GET") {
      const id = gridInputLabelMatch[1];
      const raw = await loadSystemConfig(env, id);
      if (!raw) return errorResponse("System not found", 404, origin);
      return jsonResponse({ gridInputLabel: publicGridInputLabel(raw.gridInputLabel) }, 200, origin);
    }

    // DELETE /api/systems/:id
    const deleteMatch = path.match(/^\/api\/systems\/([^/]+)$/);
    if (deleteMatch && request.method === "DELETE") {
      const id = deleteMatch[1];
      const auditCtx = auditContext(request, "system.delete", id, auth.actorId);
      if (auth.role !== "admin") return forbiddenReadOnly(env, auditCtx, origin);

      await env.SYSTEMS.delete(`system:${id}`);
      await deleteAlertState(env, id);
      const index = await listSystems(env);
      const updated = index.filter(s => s.id !== id);
      await saveIndex(env, updated);
      return auditedResponse(env, auditCtx, jsonResponse({ ok: true }, 200, origin));
    }

    // GET /api/systems/all/data — fetch data for all systems (must be before :id/data)
    if (path === "/api/systems/all/data" && request.method === "GET") {
      const limited = enforceDataRateLimit(request, env, origin, auth);
      if (limited) return limited;

      const index = await listSystems(env);
      const results = await Promise.allSettled(
        index.map(async (entry) => {
          const raw = await loadSystemConfig(env, entry.id);
          if (!raw) return { systemId: entry.id, error: "Not found" };
          const adapter = ADAPTERS[raw.service];
          if (!adapter) return { systemId: entry.id, error: "No adapter" };
          return adapter.fetchData(forAdapter(raw, env));
        })
      );

      const data = results.map((r, i) => {
        if (r.status === "fulfilled") return r.value;
        logAdapterError(env, "adapter_fetch_failed", {
          systemId: index[i].id,
          service: index[i].service,
          route: "GET /api/systems/all/data",
          error: r.reason,
        });
        return { systemId: index[i].id, name: index[i].name, service: index[i].service, error: r.reason?.message || "Unknown error" };
      });

      return jsonResponse(data, 200, origin);
    }

    // GET /api/systems/:id/ha — flat JSON for Home Assistant REST sensors
    const haMatch = path.match(/^\/api\/systems\/([^/]+)\/ha$/);
    if (haMatch && request.method === "GET") {
      const limited = enforceDataRateLimit(request, env, origin, auth);
      if (limited) return limited;

      const id = haMatch[1];
      const raw = await loadSystemConfig(env, id);
      if (!raw) return errorResponse("System not found", 404, origin);

      const adapter = ADAPTERS[raw.service];
      if (!adapter) return errorResponse(`No adapter for service: ${raw.service}`, 500, origin);

      try {
        const data = await adapter.fetchData(forAdapter(raw, env));
        return jsonResponse(toHaPayload(data), 200, origin);
      } catch (err) {
        logAdapterError(env, "adapter_fetch_failed", {
          systemId: id,
          service: raw.service,
          route: "GET /api/systems/:id/ha",
          error: err,
        });
        return errorResponse(`Fetch failed: ${err.message}`, 502, origin);
      }
    }

    // GET /api/systems/:id/data — fetch real-time data for one system
    const dataMatch = path.match(/^\/api\/systems\/([^/]+)\/data$/);
    if (dataMatch && request.method === "GET") {
      const limited = enforceDataRateLimit(request, env, origin, auth);
      if (limited) return limited;

      const id = dataMatch[1];
      const raw = await loadSystemConfig(env, id);
      if (!raw) return errorResponse("System not found", 404, origin);

      const adapter = ADAPTERS[raw.service];
      if (!adapter) return errorResponse(`No adapter for service: ${raw.service}`, 500, origin);

      try {
        const data = await adapter.fetchData(forAdapter(raw, env));
        return jsonResponse(data, 200, origin);
      } catch (err) {
        logAdapterError(env, "adapter_fetch_failed", {
          systemId: id,
          service: raw.service,
          route: "GET /api/systems/:id/data",
          error: err,
        });
        return errorResponse(`Fetch failed: ${err.message}`, 502, origin);
      }
    }

    // GET /api/systems/:id/history/summary?days=7 — daily energy totals from vendor APIs
    const summaryMatch = path.match(/^\/api\/systems\/([^/]+)\/history\/summary$/);
    if (summaryMatch && request.method === "GET") {
      const id = summaryMatch[1];
      const raw = await loadSystemConfig(env, id);
      if (!raw) return errorResponse("System not found", 404, origin);

      const daysParam = url.searchParams.get("days");
      const days = daysParam ? Number(daysParam) : 7;
      if (!Number.isFinite(days) || days < 1 || days > 90) {
        return errorResponse("Invalid days (expected 1–90)", 400, origin);
      }

      const endDate = url.searchParams.get("end");
      if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        return errorResponse("Invalid end date (expected YYYY-MM-DD)", 400, origin);
      }

      const adapter = ADAPTERS[raw.service];
      if (!adapter?.fetchHistorySummary) {
        return errorResponse(`History summary not supported for service: ${raw.service}`, 501, origin);
      }

      try {
        const summary = await adapter.fetchHistorySummary(forAdapter(raw, env), days, endDate || null);
        return jsonResponse(summary, 200, origin);
      } catch (err) {
        logAdapterError(env, "adapter_history_summary_failed", {
          systemId: id,
          service: raw.service,
          route: "GET /api/systems/:id/history/summary",
          error: err,
        });
        return errorResponse(`History summary failed: ${err.message}`, 502, origin);
      }
    }

    // GET /api/systems/:id/history?date=YYYY-MM-DD — intraday power series
    const historyMatch = path.match(/^\/api\/systems\/([^/]+)\/history$/);
    if (historyMatch && request.method === "GET") {
      const id = historyMatch[1];
      const dateParam = url.searchParams.get("date");
      if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
        return errorResponse("Invalid date (expected YYYY-MM-DD)", 400, origin);
      }

      const raw = await loadSystemConfig(env, id);
      if (!raw) return errorResponse("System not found", 404, origin);

      const adapter = ADAPTERS[raw.service];
      if (!adapter?.fetchHistory) {
        return errorResponse(`History not supported for service: ${raw.service}`, 501, origin);
      }

      try {
        const data = await adapter.fetchHistory(forAdapter(raw, env), dateParam || null);
        return jsonResponse(data, 200, origin);
      } catch (err) {
        logAdapterError(env, "adapter_history_failed", {
          systemId: id,
          service: raw.service,
          route: "GET /api/systems/:id/history",
          error: err,
        });
        return errorResponse(`History fetch failed: ${err.message}`, 502, origin);
      }
    }

    return errorResponse("Not found", 404, origin);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runScheduledAlerts(env, ADAPTERS));
  },
};

function buildCredentials(service, password, discovered) {
  if (service === "shinemonitor") {
    return {
      pwdSha1: discovered.pwdSha1,
      plantId: discovered.plantId,
      device: discovered.device,
      devices: discovered.devices,
      deviceMode: discovered.deviceMode || "primary",
      nominalPower: discovered.nominalPower,
      timezone: discovered.timezone,
    };
  }
  if (service === "growatt") {
    return {
      password,
      plantId: discovered.plantId,
      storageSn: discovered.storageSn,
      nominalPower: discovered.nominalPower,
      nominalPV: discovered.nominalPV,
      sessionCookies: discovered.sessionCookies,
    };
  }
  return { password };
}
