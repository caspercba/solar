/**
 * Simple shared-token auth for the proxy.
 * The token is set as a Cloudflare Worker secret (API_TOKEN).
 * Clients send it via `Authorization: Bearer <token>` header.
 */
export function checkAuth(request, env) {
  const token = env.API_TOKEN;
  if (!token) return true; // no token configured = open (dev mode)

  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match && match[1] === token;
}

export function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
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
