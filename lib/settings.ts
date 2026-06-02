/**
 * Settings globales de la plataforma. Persiste en kv_store key "settings".
 */
import { readJson, writeJson } from "./storage";

const KEY = "settings";

export type Settings = {
  /** Duración por defecto de la sesión al loguear (en días). */
  default_session_days: number;
  /** Máximo permitido por seguridad (cap del select del login). */
  max_session_days: number;
};

const DEFAULTS: Settings = {
  default_session_days: 7,
  max_session_days: 90,
};

export async function getSettings(): Promise<Settings> {
  const s = await readJson<Partial<Settings>>(KEY);
  return { ...DEFAULTS, ...(s || {}) };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  // Validación: días entre 1 y 365
  next.default_session_days = Math.max(1, Math.min(365, next.default_session_days || 7));
  next.max_session_days = Math.max(1, Math.min(365, next.max_session_days || 90));
  if (next.default_session_days > next.max_session_days) {
    next.default_session_days = next.max_session_days;
  }
  await writeJson(KEY, next);
  return next;
}
