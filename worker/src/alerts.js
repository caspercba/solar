import { loadSystemConfig, saveSystemConfig } from "./credentials.js";
import { logAdapterError } from "./logger.js";
import { withAdapterContext } from "./services/growatt.js";

export const DEFAULT_ALERTS = {
  enabled: false,
  webhookUrl: "",
  lowSocThreshold: 20,
  notifyLowSoc: true,
  notifyGenerator: true,
  cooldownMinutes: 60,
};

const DEFAULT_ALERT_STATE = {
  lowSoc: { breached: false, lastAlertAt: null },
  generator: { active: false, lastAlertAt: null },
};

export function normalizeAlerts(alerts = {}) {
  const merged = { ...DEFAULT_ALERTS, ...alerts };
  merged.lowSocThreshold = clampNumber(merged.lowSocThreshold, 0, 100, DEFAULT_ALERTS.lowSocThreshold);
  merged.cooldownMinutes = clampNumber(merged.cooldownMinutes, 5, 1440, DEFAULT_ALERTS.cooldownMinutes);
  merged.webhookUrl = String(merged.webhookUrl || "").trim();
  return merged;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function alertStateKey(systemId) {
  return `alert-state:${systemId}`;
}

export async function loadAlertState(env, systemId) {
  const stored = await env.SYSTEMS.get(alertStateKey(systemId), "json");
  if (!stored) return structuredClone(DEFAULT_ALERT_STATE);
  return {
    lowSoc: { ...DEFAULT_ALERT_STATE.lowSoc, ...stored.lowSoc },
    generator: { ...DEFAULT_ALERT_STATE.generator, ...stored.generator },
  };
}

export async function saveAlertState(env, systemId, state) {
  await env.SYSTEMS.put(alertStateKey(systemId), JSON.stringify(state));
}

export async function deleteAlertState(env, systemId) {
  await env.SYSTEMS.delete(alertStateKey(systemId));
}

function cooldownExpired(lastAlertAt, cooldownMinutes, nowMs) {
  if (!lastAlertAt) return true;
  const elapsed = nowMs - Date.parse(lastAlertAt);
  return elapsed >= cooldownMinutes * 60_000;
}

function buildMessage(alertType, systemName, data) {
  const ts = data.timestamp || new Date().toISOString();
  if (alertType === "low_soc") {
    const soc = data.battery?.soc ?? "?";
    const volts = data.battery?.voltage ?? "?";
    return `[Solar Dashboard] Low battery: ${systemName} — SOC ${soc}% (${volts} V) at ${ts}`;
  }
  const watts = Math.abs(Math.round(data.grid?.power ?? 0));
  const volts = data.grid?.voltage ?? "?";
  return `[Solar Dashboard] Generator active: ${systemName} — ${watts} W, ${volts} V at ${ts}`;
}

export async function sendWebhook(webhookUrl, payload) {
  const resp = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Webhook failed (${resp.status})${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
}

export function evaluateAlerts(alerts, state, data, nowMs = Date.now()) {
  const actions = [];
  const next = structuredClone(state);
  const soc = data.battery?.soc;
  const threshold = alerts.lowSocThreshold;
  const genActive = Boolean(data.grid?.active);

  if (alerts.enabled && alerts.notifyLowSoc && alerts.webhookUrl && Number.isFinite(soc)) {
    if (soc >= threshold) {
      next.lowSoc.breached = false;
    } else {
      const shouldAlert =
        !next.lowSoc.breached ||
        cooldownExpired(next.lowSoc.lastAlertAt, alerts.cooldownMinutes, nowMs);
      if (shouldAlert) {
        actions.push({
          type: "low_soc",
          message: buildMessage("low_soc", data.name, data),
        });
        next.lowSoc.breached = true;
        next.lowSoc.lastAlertAt = new Date(nowMs).toISOString();
      }
    }
  } else if (Number.isFinite(soc) && soc >= threshold) {
    next.lowSoc.breached = false;
  }

  if (alerts.enabled && alerts.notifyGenerator && alerts.webhookUrl) {
    if (!genActive) {
      next.generator.active = false;
    } else if (!next.generator.active) {
      if (cooldownExpired(next.generator.lastAlertAt, alerts.cooldownMinutes, nowMs)) {
        actions.push({
          type: "generator",
          message: buildMessage("generator", data.name, data),
        });
        next.generator.lastAlertAt = new Date(nowMs).toISOString();
      }
      next.generator.active = true;
    }
  } else if (!genActive) {
    next.generator.active = false;
  }

  return { actions, state: next };
}

export async function processSystemAlerts(env, systemConfig, fetchData, nowMs = Date.now()) {
  const alerts = normalizeAlerts(systemConfig.alerts);
  if (!alerts.enabled || !alerts.webhookUrl) {
    return { sent: 0, skipped: true };
  }

  let data;
  try {
    data = await fetchData(systemConfig);
  } catch (err) {
    logAdapterError(env, "alert_fetch_failed", {
      systemId: systemConfig.id,
      service: systemConfig.service,
      route: "scheduled/alerts",
      error: err,
    });
    return { sent: 0, error: err.message };
  }

  if (data?.error) {
    return { sent: 0, error: data.error };
  }

  const state = await loadAlertState(env, systemConfig.id);
  const { actions, state: nextState } = evaluateAlerts(alerts, state, data, nowMs);
  let sent = 0;

  for (const action of actions) {
    try {
      await sendWebhook(alerts.webhookUrl, {
        text: action.message,
        content: action.message,
        alertType: action.type,
        system: {
          id: systemConfig.id,
          name: data.name || systemConfig.name,
          service: systemConfig.service,
        },
        battery: data.battery,
        grid: data.grid,
        timestamp: data.timestamp,
      });
      sent++;
    } catch (err) {
      logAdapterError(env, "alert_webhook_failed", {
        systemId: systemConfig.id,
        service: systemConfig.service,
        route: "scheduled/alerts",
        alertType: action.type,
        error: err,
      });
    }
  }

  await saveAlertState(env, systemConfig.id, nextState);
  return { sent, actions: actions.length };
}

export async function runScheduledAlerts(env, adapters) {
  const index = await env.SYSTEMS.get("_index", "json");
  if (!index?.length) return { checked: 0, sent: 0 };

  const results = await Promise.allSettled(
    index.map(async (entry) => {
      const raw = await loadSystemConfig(env, entry.id);
      if (!raw) return { systemId: entry.id, sent: 0, error: "Not found" };
      const adapter = adapters[raw.service];
      if (!adapter) return { systemId: entry.id, sent: 0, error: "No adapter" };
      return processSystemAlerts(env, raw, (cfg) => {
        const ctx = cfg.service === "growatt" ? withAdapterContext(cfg, env) : cfg;
        return adapter.fetchData(ctx);
      });
    }),
  );

  let sent = 0;
  for (const r of results) {
    if (r.status === "fulfilled") sent += r.value.sent || 0;
  }

  return { checked: index.length, sent };
}

export async function updateSystemAlerts(env, systemId, body) {
  const raw = await loadSystemConfig(env, systemId);
  if (!raw) return null;

  const current = normalizeAlerts(raw.alerts);
  const updated = normalizeAlerts({
    ...current,
    ...body,
    webhookUrl: body.webhookUrl != null ? body.webhookUrl : current.webhookUrl,
  });

  raw.alerts = updated;
  await saveSystemConfig(env, raw);
  return updated;
}

export function publicAlerts(alerts) {
  const normalized = normalizeAlerts(alerts);
  return {
    enabled: normalized.enabled,
    webhookUrl: normalized.webhookUrl,
    lowSocThreshold: normalized.lowSocThreshold,
    notifyLowSoc: normalized.notifyLowSoc,
    notifyGenerator: normalized.notifyGenerator,
    cooldownMinutes: normalized.cooldownMinutes,
    webhookConfigured: Boolean(normalized.webhookUrl),
  };
}
