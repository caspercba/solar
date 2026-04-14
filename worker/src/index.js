import { checkAuth, corsHeaders, jsonResponse, errorResponse } from "./auth.js";
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
    const origin = request.headers.get("Origin") || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (!checkAuth(request, env)) {
      return errorResponse("Unauthorized", 401, origin);
    }

    const url = new URL(request.url);
    const path = url.pathname;

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
      const safe = index.map(s => ({ id: s.id, name: s.name, service: s.service }));
      return jsonResponse(safe, 200, origin);
    }

    // POST /api/systems — add a new system
    if (path === "/api/systems" && request.method === "POST") {
      const body = await request.json();
      const { service, name, user, password } = body;

      if (!service || !user || !password) {
        return errorResponse("Missing required fields: service, user, password", 400, origin);
      }

      const adapter = ADAPTERS[service];
      if (!adapter) {
        return errorResponse(`Unsupported service: ${service}. Supported: ${Object.keys(ADAPTERS).join(", ")}`, 400, origin);
      }

      let discovered;
      try {
        discovered = await adapter.discover({ user, password });
      } catch (err) {
        return errorResponse(`Discovery failed: ${err.message}`, 502, origin);
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

      await env.SYSTEMS.put(`system:${id}`, JSON.stringify(systemConfig));

      const index = await listSystems(env);
      index.push({ id, name: systemName, service });
      await saveIndex(env, index);

      return jsonResponse({ id, name: systemName, service, discovered }, 201, origin);
    }

    // DELETE /api/systems/:id
    const deleteMatch = path.match(/^\/api\/systems\/([^/]+)$/);
    if (deleteMatch && request.method === "DELETE") {
      const id = deleteMatch[1];
      await env.SYSTEMS.delete(`system:${id}`);
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
          const raw = await env.SYSTEMS.get(`system:${entry.id}`, "json");
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
      const raw = await env.SYSTEMS.get(`system:${id}`, "json");
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

    return errorResponse("Not found", 404, origin);
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
