/**
 * Simple shared-token auth for the proxy.
 * The token is set as a Cloudflare Worker secret (API_TOKEN).
 * Clients send it via `Authorization: Bearer <token>` header.
 */
export function checkAuth(request, env) {
  const token = env.API_TOKEN;
  if (!token) return !isProductionGuardEnabled(env); // no token = open, unless deployed

  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return match[1] === token;
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
