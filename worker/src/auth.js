import { lookupToken } from "./tokens.js";

/**
 * Auth for the proxy — a legacy shared token (ADR 0002 Phase 0) plus an
 * optional per-user opaque key registry in KV (ADR 0002 Phase 2).
 *
 * The legacy `API_TOKEN` secret, when set, is checked first as a fast path
 * with no KV read and always resolves to the "shared"/admin identity — this
 * means existing single-token deployments keep working unchanged; there is
 * no migration step to import it into the KV registry.
 *
 * Per-user tokens are opaque random values minted via `tokens.js` and looked
 * up by SHA-256 hash. They carry a `read` or `admin` role; callers enforce
 * role requirements on mutating routes (see `worker/src/index.js`).
 *
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<{ ok: true, actorId: string, role: "read"|"admin", openMode: boolean } | { ok: false }>}
 */
export async function checkAuth(request, env) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const presented = match ? match[1] : null;

  const legacyToken = env.API_TOKEN;

  if (legacyToken) {
    if (presented === legacyToken) {
      return { ok: true, actorId: "shared", role: "admin", openMode: false };
    }
    const entry = presented ? await lookupToken(env, presented) : null;
    if (entry) return { ok: true, actorId: entry.id, role: entry.role, openMode: false };
    return { ok: false };
  }

  // No legacy secret configured — a KV per-user token still authenticates.
  const entry = presented ? await lookupToken(env, presented) : null;
  if (entry) return { ok: true, actorId: entry.id, role: entry.role, openMode: false };

  if (isProductionGuardEnabled(env)) return { ok: false };

  // Dev convenience: no token configured at all = open, unauthenticated access.
  return { ok: true, actorId: "dev", role: "admin", openMode: true };
}

/**
 * The PRODUCTION secret (`wrangler secret put PRODUCTION`, value "true") marks a
 * real deployment (production or staging). It's never present for local
 * `wrangler dev` or unit tests, so those keep the open-mode convenience when
 * API_TOKEN is unset.
 */
export function isProductionGuardEnabled(env) {
  return String(env.PRODUCTION || "").toLowerCase() === "true";
}

/** True when a deployed environment is missing its required API_TOKEN secret. */
export function isAuthMisconfigured(env) {
  return isProductionGuardEnabled(env) && !env.API_TOKEN;
}

function parseAllowedOrigins(env) {
  const raw = env.ALLOWED_ORIGINS;
  if (!raw || !String(raw).trim()) return null;
  return String(raw)
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Resolve CORS for a request.
 * When ALLOWED_ORIGINS is unset/empty (dev), reflect the request origin or "*".
 * When set (production), only listed origins are allowed; others are rejected.
 * Requests without an Origin header are always allowed (non-browser clients).
 */
export function resolveCors(request, env) {
  const requestOrigin = request.headers.get("Origin");
  const allowedOrigins = parseAllowedOrigins(env);

  if (!allowedOrigins) {
    return { allowed: true, origin: requestOrigin || "*" };
  }

  if (!requestOrigin) {
    return { allowed: true, origin: null };
  }

  if (allowedOrigins.includes(requestOrigin)) {
    return { allowed: true, origin: requestOrigin };
  }

  return { allowed: false, origin: null };
}

export function corsHeaders(origin) {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function jsonResponse(data, status = 200, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

export function errorResponse(message, status = 400, origin) {
  return jsonResponse({ error: message }, status, origin);
}
