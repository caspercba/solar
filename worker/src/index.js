import { checkAuth, corsHeaders, jsonResponse, errorResponse, resolveCors } from "./auth.js";
import { saveSystemConfig, loadSystemConfig } from "./credentials.js";
import {
  runScheduledAlerts,
  updateSystemAlerts,
  publicAlerts,
  deleteAlertState,
  DEFAULT_ALERTS,
} from "./alerts.js";
import { deleteHistory, getHistorySummary, resolveIntradayHistory, runScheduledSnapshots, supplementSummarySoc } from "./history.js";
import * as shinemonitor from "./services/shinemonitor.js";
import * as growatt from "./services/growatt.js";

const ADAPTERS = { shinemonitor, growatt };

function generateId() {
  return crypto.randomUUID();
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

    if (!checkAuth(request, env)) {
      return errorResponse("Unauthorized", 401, origin);
    }

    // GET /api/services — list supported service types
    if (path === "/api/services" && request.method === "GET") {
      return jsonResponse([
        { id: "shinemonitor", name: "ShineMonitor", fields: ["user", "password"] },
        { id: "growatt", name: "Growatt", fields: ["user", "password"] },
      ], 200, origin);
    }

    // GET /api/systems — list all configured systems (without credentials)
    if (path === "/api/systems" && request.method === "GET") {
      const index = await listSystems(env);
      const safe = await Promise.all(index.map(async (s) => {
        const raw = await env.SYSTEMS.get(`system:${s.id}`, "json");
        return {
          id: s.id,
          name: s.name,
          service: s.service,
          alerts: publicAlerts(raw?.alerts || DEFAULT_ALERTS),
        };
      }));
      return jsonResponse(safe, 200, origin);
    }

    // POST /api/systems — add a new system
    if (path === "/api/systems" && request.method === "POST") {
      const body = await request.json();
      const { service, name, user, password, plantId } = body;

      if (!service || !user || !password) {
        return errorResponse("Missing required fields: service, user, password", 400, origin);
      }

      const adapter = ADAPTERS[service];
      if (!adapter) {
        return errorResponse(`Unsupported service: ${service}. Supported: ${Object.keys(ADAPTERS).join(", ")}`, 400, origin);
      }

      let discovered;
      try {
        discovered = await adapter.discover({ user, password }, plantId || null);
      } catch (err) {
        return errorResponse(`Discovery failed: ${err.message}`, 502, origin);
      }

      if (discovered.requiresPlantSelection) {
        return jsonResponse({
          requiresPlantSelection: true,
          plants: discovered.plants,
        }, 200, origin);
      }

      const id = generateId();
      const systemName = name || discovered.plantName || `${service} system`;

      const systemConfig = {
        id,
        name: systemName,
        service,
        credentials: { user, ...buildCredentials(service, password, discovered) },
        createdAt: new Date().toISOString(),
      };

      await saveSystemConfig(env, systemConfig);

      const index = await listSystems(env);
      index.push({ id, name: systemName, service });
      await saveIndex(env, index);

      return jsonResponse({ id, name: systemName, service, discovered }, 201, origin);
    }

    // PUT /api/systems/:id/alerts — update alert thresholds and webhook
    const alertsMatch = path.match(/^\/api\/systems\/([^/]+)\/alerts$/);
    if (alertsMatch && request.method === "PUT") {
      const id = alertsMatch[1];
      const body = await request.json();
      const updated = await updateSystemAlerts(env, id, body);
      if (!updated) return errorResponse("System not found", 404, origin);
      return jsonResponse(publicAlerts(updated), 200, origin);
    }

    // GET /api/systems/:id/alerts — read alert settings
    if (alertsMatch && request.method === "GET") {
      const id = alertsMatch[1];
      const raw = await env.SYSTEMS.get(`system:${id}`, "json");
      if (!raw) return errorResponse("System not found", 404, origin);
      return jsonResponse(publicAlerts(raw.alerts || DEFAULT_ALERTS), 200, origin);
    }

    // DELETE /api/systems/:id
    const deleteMatch = path.match(/^\/api\/systems\/([^/]+)$/);
    if (deleteMatch && request.method === "DELETE") {
      const id = deleteMatch[1];
      await env.SYSTEMS.delete(`system:${id}`);
      await deleteAlertState(env, id);
      await deleteHistory(env, id);
      const index = await listSystems(env);
      const updated = index.filter(s => s.id !== id);
      await saveIndex(env, updated);
      return jsonResponse({ ok: true }, 200, origin);
    }

    // GET /api/systems/all/data — fetch data for all systems (must be before :id/data)
    if (path === "/api/systems/all/data" && request.method === "GET") {
      const index = await listSystems(env);
      const results = await Promise.allSettled(
        index.map(async (entry) => {
          const raw = await loadSystemConfig(env, entry.id);
          if (!raw) return { systemId: entry.id, error: "Not found" };
          const adapter = ADAPTERS[raw.service];
          if (!adapter) return { systemId: entry.id, error: "No adapter" };
          return adapter.fetchData(raw);
        })
      );

      const data = results.map((r, i) => {
        if (r.status === "fulfilled") return r.value;
        return { systemId: index[i].id, name: index[i].name, service: index[i].service, error: r.reason?.message || "Unknown error" };
      });

      return jsonResponse(data, 200, origin);
    }

    // GET /api/systems/:id/data — fetch real-time data for one system
    const dataMatch = path.match(/^\/api\/systems\/([^/]+)\/data$/);
    if (dataMatch && request.method === "GET") {
      const id = dataMatch[1];
      const raw = await loadSystemConfig(env, id);
      if (!raw) return errorResponse("System not found", 404, origin);

      const adapter = ADAPTERS[raw.service];
      if (!adapter) return errorResponse(`No adapter for service: ${raw.service}`, 500, origin);

      try {
        const data = await adapter.fetchData(raw);
        return jsonResponse(data, 200, origin);
      } catch (err) {
        return errorResponse(`Fetch failed: ${err.message}`, 502, origin);
      }
    }

    // GET /api/systems/:id/history/summary?days=7 — daily energy totals (vendor or stored snapshots)
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
      let summary;
      if (adapter?.fetchHistorySummary) {
        try {
          summary = await adapter.fetchHistorySummary(raw, days, endDate || null);
        } catch (err) {
          return errorResponse(`History summary failed: ${err.message}`, 502, origin);
        }
      } else {
        summary = await getHistorySummary(env, id, days, endDate || null);
        if (adapter?.fetchSocDailySummary) {
          try {
            const socByDate = await adapter.fetchSocDailySummary(raw, endDate || null, days);
            summary.series = supplementSummarySoc(summary.series, socByDate);
          } catch {
            /* optional supplement */
          }
        }
      }
      return jsonResponse(summary, 200, origin);
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
        const data = await resolveIntradayHistory(env, raw, adapter, dateParam || null);
        return jsonResponse(data, 200, origin);
      } catch (err) {
        return errorResponse(`History fetch failed: ${err.message}`, 502, origin);
      }
    }

    return errorResponse("Not found", 404, origin);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(Promise.all([
      runScheduledAlerts(env, ADAPTERS),
      runScheduledSnapshots(env, ADAPTERS),
    ]));
  },
};

function buildCredentials(service, password, discovered) {
  if (service === "shinemonitor") {
    return {
      pwdSha1: discovered.pwdSha1,
      plantId: discovered.plantId,
      device: discovered.device,
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
    };
  }
  return { password };
}
