import { loadSystemConfig, saveSystemConfig } from "./credentials.js";

export const DEFAULT_GRID_INPUT_LABEL = "generator";
export const GRID_INPUT_LABELS = ["generator", "grid"];

export function normalizeGridInputLabel(label) {
  const value = String(label ?? DEFAULT_GRID_INPUT_LABEL).toLowerCase();
  return GRID_INPUT_LABELS.includes(value) ? value : DEFAULT_GRID_INPUT_LABEL;
}

export function publicGridInputLabel(label) {
  return normalizeGridInputLabel(label);
}

export async function updateSystemGridInputLabel(env, systemId, body) {
  const raw = await loadSystemConfig(env, systemId);
  if (!raw) return null;

  const updated = normalizeGridInputLabel(
    body?.gridInputLabel ?? raw.gridInputLabel,
  );

  raw.gridInputLabel = updated;
  await saveSystemConfig(env, raw);
  return updated;
}
