import { loadSystemConfig, saveSystemConfig } from "./credentials.js";

export const DEFAULT_GRID_DETECT = {
  voltageMin: 30,
  powerMin: 5,
};

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeGridDetect(gridDetect = {}) {
  const merged = { ...DEFAULT_GRID_DETECT, ...gridDetect };
  merged.voltageMin = clampNumber(merged.voltageMin, 0, 500, DEFAULT_GRID_DETECT.voltageMin);
  merged.powerMin = clampNumber(merged.powerMin, 0, 50_000, DEFAULT_GRID_DETECT.powerMin);
  return merged;
}

/**
 * @param {number} gridV
 * @param {number} gridW
 * @param {object} [gridDetect]
 * @param {{ useAbsPower?: boolean }} [options]
 */
export function isGridActive(gridV, gridW, gridDetect, { useAbsPower = false } = {}) {
  const { voltageMin, powerMin } = normalizeGridDetect(gridDetect);
  const power = useAbsPower ? Math.abs(gridW) : gridW;
  return gridV > voltageMin && power > powerMin;
}

export function publicGridDetect(gridDetect) {
  return normalizeGridDetect(gridDetect);
}

export async function updateSystemGridDetect(env, systemId, body) {
  const raw = await loadSystemConfig(env, systemId);
  if (!raw) return null;

  const updated = normalizeGridDetect({
    ...normalizeGridDetect(raw.gridDetect),
    ...body,
  });

  raw.gridDetect = updated;
  await saveSystemConfig(env, raw);
  return updated;
}
