const REDACTED = "[redacted]";

/** Keys whose values must never appear in logs (case-insensitive). */
const SENSITIVE_KEY_RE =
  /^(password|pwd|pwdsha1|token|secret|authorization|bearer|api[_-]?token|credentials[_-]?key|jsessionid|cookie|webhookurl|webhook[_-]?url)$/i;

/** Bearer tokens embedded in free-text messages. */
const BEARER_RE = /Bearer\s+\S+/gi;

/** Common webhook URL paths that embed secrets (Discord, Slack, etc.). */
const WEBHOOK_URL_RE = /https?:\/\/[^\s"'<>]+(?:webhook|hooks)[^\s"'<>]*/gi;

/**
 * Redact sensitive substrings in a string value.
 * @param {string} str
 * @returns {string}
 */
export function redactString(str) {
  if (typeof str !== "string") return str;
  return str
    .replace(BEARER_RE, "Bearer [redacted]")
    .replace(WEBHOOK_URL_RE, "[redacted webhook url]");
}

/**
 * Deep-clone a value while redacting sensitive keys and string patterns.
 * @param {unknown} value
 * @param {WeakSet<object>} [seen]
 * @returns {unknown}
 */
export function redactSecrets(value, seen = new WeakSet()) {
  if (value == null || typeof value !== "object") {
    return typeof value === "string" ? redactString(value) : value;
  }

  if (seen.has(value)) return REDACTED;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, seen));
  }

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      out[key] = REDACTED;
    } else if (typeof val === "string") {
      out[key] = redactString(val);
    } else {
      out[key] = redactSecrets(val, seen);
    }
  }
  return out;
}

/**
 * Normalize an Error (or unknown throw value) for structured logs.
 * @param {unknown} err
 * @returns {{ name?: string, message: string, code?: string }}
 */
export function sanitizeError(err) {
  if (err instanceof Error) {
    const entry = {
      name: err.name,
      message: redactString(err.message),
    };
    if (err.code) entry.code = String(err.code);
    return entry;
  }
  return { message: redactString(String(err)) };
}

/**
 * Build a redacted structured log entry.
 * @param {"error"|"warn"|"info"} level
 * @param {string} event
 * @param {Record<string, unknown>} [fields]
 * @returns {Record<string, unknown>}
 */
export function buildLogEntry(level, event, fields = {}) {
  return redactSecrets({
    level,
    event,
    timestamp: new Date().toISOString(),
    ...fields,
  });
}

/**
 * Emit a structured JSON log line to Workers console output.
 * @param {"error"|"warn"|"info"} level
 * @param {string} event
 * @param {Record<string, unknown>} [fields]
 * @returns {Record<string, unknown>}
 */
export function logEvent(level, event, fields = {}) {
  const entry = buildLogEntry(level, event, fields);
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  return entry;
}

export function logError(event, fields) {
  return logEvent("error", event, fields);
}

export function logWarn(event, fields) {
  return logEvent("warn", event, fields);
}

/**
 * Emit a structured audit-log entry for a mutating admin API call (ADR 0002 Phase 1).
 * Only call this for state-changing routes — never for polling/read routes.
 * Redaction rules are the same as `logEvent`; never pass raw tokens or passwords in `fields`.
 * @param {object} env
 * @param {object} fields
 * @param {string} fields.actorId - Stable identity of the caller (e.g. "shared" for the legacy single token).
 * @param {string} fields.action - e.g. "system.create", "system.delete", "credentials.rotate", "alerts.update"
 * @param {string|null} [fields.resource] - System UUID when applicable
 * @param {string} fields.method
 * @param {string} fields.path
 * @param {string|null} [fields.clientIp]
 * @param {"success"|"error"} fields.outcome
 * @param {number} [fields.status]
 * @param {string} [fields.requestId]
 * @returns {Record<string, unknown>}
 */
export function auditLog(env, fields = {}) {
  const entry = logEvent("info", "audit", fields);
  recordObservability(env, entry);
  return entry;
}

/**
 * Optional production sinks: Workers Analytics Engine (env.ANALYTICS binding).
 * Never throws — observability must not break request handling.
 * @param {object} env
 * @param {Record<string, unknown>} entry
 */
export function recordObservability(env, entry) {
  if (!env?.ANALYTICS?.writeDataPoint) return;

  try {
    env.ANALYTICS.writeDataPoint({
      blobs: [
        String(entry.event || ""),
        String(entry.service || ""),
        String(entry.systemId || ""),
        String(entry.route || ""),
        String(entry.message || entry.error?.message || ""),
      ],
      doubles: [entry.level === "error" ? 1 : 0],
      indexes: [String(entry.systemId || entry.event || "unknown")],
    });
  } catch {
    // Ignore analytics write failures
  }
}

/**
 * Log an adapter or alert failure with systemId/service context and optional Analytics write.
 * @param {object} [env]
 * @param {string} event
 * @param {object} ctx
 * @param {string} [ctx.systemId]
 * @param {string} [ctx.service]
 * @param {string} [ctx.route]
 * @param {string} [ctx.message]
 * @param {unknown} [ctx.error]
 * @returns {Record<string, unknown>}
 */
export function logAdapterError(env, event, ctx = {}) {
  const { error, message, ...rest } = ctx;
  const entry = logError(event, {
    ...rest,
    message: message || (error instanceof Error ? error.message : undefined),
    error: error != null ? sanitizeError(error) : undefined,
  });
  recordObservability(env, entry);
  return entry;
}
