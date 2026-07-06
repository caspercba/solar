import { corsHeaders } from "./auth.js";

/** Default: 60 requests per minute per bearer token (in-memory per isolate). */
export const DATA_RATE_LIMIT_MAX = 60;
export const DATA_RATE_LIMIT_WINDOW_MS = 60_000;

/** @type {Map<string, { count: number, resetAt: number }>} */
const buckets = new Map();

/**
 * Extract the bearer token used as the rate-limit key.
 * Returns null when API_TOKEN is unset (dev open mode — no rate limiting).
 */
export function getRateLimitKey(request, env) {
  if (!env.API_TOKEN) return null;

  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Check whether a data-route request is within the per-token limit.
 * @returns {{ allowed: true } | { allowed: false, retryAfter: number }}
 */
export function checkDataRateLimit(key, now = Date.now()) {
  if (key == null) return { allowed: true };

  let bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + DATA_RATE_LIMIT_WINDOW_MS };
    buckets.set(key, bucket);
  }

  bucket.count += 1;

  if (bucket.count > DATA_RATE_LIMIT_MAX) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}

/** Clear in-memory counters (for unit tests). */
export function resetRateLimitStore() {
  buckets.clear();
}

export function rateLimitResponse(retryAfter, origin) {
  return new Response(JSON.stringify({ error: "Too many requests" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfter),
      ...corsHeaders(origin),
    },
  });
}
