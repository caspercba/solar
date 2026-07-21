import { corsHeaders } from "./auth.js";

/** Default: 60 requests per minute per bearer token (in-memory per isolate). */
export const DATA_RATE_LIMIT_MAX = 60;
export const DATA_RATE_LIMIT_WINDOW_MS = 60_000;

/** Auth endpoints (login / invite-accept): 10 attempts per 15 minutes per IP. */
export const AUTH_RATE_LIMIT_MAX = 10;
export const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60_000;

/** @type {Map<string, { count: number, resetAt: number }>} */
const buckets = new Map();

/**
 * Extract the bearer token used as the rate-limit key.
 * Returns null when the request authenticated via dev open mode (no token
 * configured at all — see `auth.js` `checkAuth`), so unlimited local/dev
 * traffic isn't throttled. Keying off the raw bearer string (rather than
 * `auth.actorId`) means the legacy shared token and every per-user KV token
 * (ADR 0002 Phase 2) are rate-limited independently.
 * @param {Request} request
 * @param {object} env
 * @param {{ openMode?: boolean }} [auth] - result of `checkAuth`
 */
export function getRateLimitKey(request, env, auth) {
  if (auth?.openMode) return null;

  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Client IP key for unauthenticated auth routes (login / invite-accept).
 * Falls back to a shared bucket when CF-Connecting-IP is absent (local tests).
 */
export function getAuthRateLimitKey(request, route) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  return `auth:${route}:${ip}`;
}

/**
 * Check whether a data-route request is within the per-token limit.
 * @returns {{ allowed: true } | { allowed: false, retryAfter: number }}
 */
export function checkDataRateLimit(key, now = Date.now()) {
  return checkBucket(key, DATA_RATE_LIMIT_MAX, DATA_RATE_LIMIT_WINDOW_MS, now);
}

/**
 * Check whether a login / invite-accept attempt is within the per-IP limit.
 * @returns {{ allowed: true } | { allowed: false, retryAfter: number }}
 */
export function checkAuthRateLimit(key, now = Date.now()) {
  return checkBucket(key, AUTH_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_WINDOW_MS, now);
}

function checkBucket(key, max, windowMs, now) {
  if (key == null) return { allowed: true };

  let bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }

  bucket.count += 1;

  if (bucket.count > max) {
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
