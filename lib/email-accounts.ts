/**
 * Almacén multi-cuenta de bandejas conectadas (SMTP + IMAP).
 * Distinto del `email-config` legacy (que es 1 cuenta global).
 *
 * Permite que un usuario logueado conecte N cuentas vía bulk connect.
 *
 * Key en kv_store:
 *   email-accounts → EmailAccount[]
 */
import crypto from "crypto";
import { readJson, writeJson } from "./storage";

const KEY = "email-accounts";

export type EmailAccount = {
  id: string;
  email: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;

  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_password: string;

  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  imap_user: string;
  imap_password: string;

  provider: "gmail" | "outlook" | "ionos" | "custom";
  smtp_ok: boolean;
  imap_ok: boolean;
  last_smtp_error?: string | null;
  last_imap_error?: string | null;
  connected_at: string;
  last_verified_at: string;

  // Sending caps / warmup (del CSV de Evadan)
  daily_limit?: number;
  warmup_enabled?: boolean;
  warmup_limit?: number;
  warmup_increment?: number;
  sent_today?: number;

  // ── SLOW RAMP (estilo Instantly) ──────────────────────────────────────
  // Si está activo, la cuenta empieza enviando `slow_ramp_start_limit` por día
  // y sube `slow_ramp_increment` cada `slow_ramp_increment_days` días hasta
  // alcanzar `slow_ramp_target_limit`. Protege la reputación de cuentas nuevas.
  slow_ramp_enabled?: boolean;
  slow_ramp_start_limit?: number;       // default 5
  slow_ramp_target_limit?: number;      // default 30
  slow_ramp_increment?: number;         // default 2 emails añadidos
  slow_ramp_increment_days?: number;    // default 1 día entre incrementos
  slow_ramp_started_at?: string;        // ISO — cuándo se activó

  // Tags para filtrar
  tags?: string[];
};

/** Defaults seguros — basados en recomendaciones de Instantly. */
export const SLOW_RAMP_DEFAULTS = {
  start_limit: 5,
  target_limit: 30,
  increment: 2,
  increment_days: 1,
};

/**
 * Calcula el daily limit EFECTIVO de una cuenta en este momento.
 * Si slow ramp NO está activo: devuelve `account.daily_limit` (o 30 por defecto).
 * Si SÍ está activo: empieza en start_limit, sube increment cada increment_days días
 * desde slow_ramp_started_at, capped en target_limit.
 */
export function getEffectiveDailyLimit(account: EmailAccount): number {
  const defaultLimit = account.daily_limit ?? 30;
  if (!account.slow_ramp_enabled || !account.slow_ramp_started_at) {
    return defaultLimit;
  }
  const start = account.slow_ramp_start_limit ?? SLOW_RAMP_DEFAULTS.start_limit;
  const target = account.slow_ramp_target_limit ?? defaultLimit;
  const inc = Math.max(1, account.slow_ramp_increment ?? SLOW_RAMP_DEFAULTS.increment);
  const incDays = Math.max(1, account.slow_ramp_increment_days ?? SLOW_RAMP_DEFAULTS.increment_days);
  const ms = Date.now() - new Date(account.slow_ramp_started_at).getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const increments = Math.floor(days / incDays);
  const current = start + increments * inc;
  return Math.min(Math.max(start, current), target);
}

/** Estado de rampa: progreso, siguiente incremento, días hasta target. */
export function getSlowRampStatus(account: EmailAccount): {
  enabled: boolean;
  current_limit: number;
  target_limit: number;
  start_limit: number;
  increment: number;
  increment_days: number;
  days_running: number;
  days_to_target: number;
  next_increment_at: string | null;
  progress_pct: number;
} {
  const defaultLimit = account.daily_limit ?? 30;
  const enabled = !!account.slow_ramp_enabled;
  const start = account.slow_ramp_start_limit ?? SLOW_RAMP_DEFAULTS.start_limit;
  const target = account.slow_ramp_target_limit ?? defaultLimit;
  const inc = Math.max(1, account.slow_ramp_increment ?? SLOW_RAMP_DEFAULTS.increment);
  const incDays = Math.max(1, account.slow_ramp_increment_days ?? SLOW_RAMP_DEFAULTS.increment_days);

  if (!enabled || !account.slow_ramp_started_at) {
    return {
      enabled, current_limit: defaultLimit, target_limit: target, start_limit: start,
      increment: inc, increment_days: incDays,
      days_running: 0, days_to_target: 0,
      next_increment_at: null,
      progress_pct: enabled ? 0 : 100,
    };
  }

  const startedAt = new Date(account.slow_ramp_started_at).getTime();
  const ms = Date.now() - startedAt;
  const daysRunning = Math.floor(ms / (24 * 60 * 60 * 1000));
  const current = getEffectiveDailyLimit(account);
  const incrementsToTarget = Math.ceil(Math.max(0, target - current) / inc);
  const daysToTarget = incrementsToTarget * incDays;
  const nextIncrementDay = Math.ceil((daysRunning + 1) / incDays) * incDays;
  const nextIncrementAt = current >= target
    ? null
    : new Date(startedAt + nextIncrementDay * 24 * 60 * 60 * 1000).toISOString();
  const progress = target === start ? 100 : ((current - start) / (target - start)) * 100;

  return {
    enabled, current_limit: current, target_limit: target, start_limit: start,
    increment: inc, increment_days: incDays,
    days_running: daysRunning, days_to_target: daysToTarget,
    next_increment_at: nextIncrementAt,
    progress_pct: Math.max(0, Math.min(100, progress)),
  };
}

/** Lo que el usuario manda (mínimo: email + password) */
export type EmailAccountInput = {
  email: string;
  password: string;          // Si no hay smtp/imap_password explícito, se usa para ambos
  smtp_password?: string;
  imap_password?: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: boolean;
  smtp_user?: string;
  imap_host?: string;
  imap_port?: number;
  imap_secure?: boolean;
  imap_user?: string;
  provider?: "gmail" | "outlook" | "ionos" | "custom";
  daily_limit?: number;
  warmup_enabled?: boolean;
  warmup_limit?: number;
  warmup_increment?: number;
  tags?: string[];
};

type Defaults = {
  provider: EmailAccount["provider"];
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
};

/** Presets explícitos por proveedor (usados por "Bulk IONOS", "Bulk Gmail", etc.) */
export const PROVIDER_PRESETS: Record<"ionos" | "gmail" | "outlook", Defaults> = {
  ionos: {
    provider: "ionos",
    smtp_host: "smtp.ionos.es",
    smtp_port: 465,
    smtp_secure: true,
    imap_host: "imap.ionos.es",
    imap_port: 993,
    imap_secure: true,
  },
  gmail: {
    provider: "gmail",
    smtp_host: "smtp.gmail.com",
    smtp_port: 465,
    smtp_secure: true,
    imap_host: "imap.gmail.com",
    imap_port: 993,
    imap_secure: true,
  },
  outlook: {
    provider: "outlook",
    smtp_host: "smtp.office365.com",
    smtp_port: 587,
    smtp_secure: false,
    imap_host: "outlook.office365.com",
    imap_port: 993,
    imap_secure: true,
  },
};

/** Detecta defaults SMTP/IMAP por dominio del email. */
export function detectDefaults(email: string): Defaults {
  const domain = (email.split("@")[1] || "").toLowerCase();

  if (/(^|\.)gmail\.com$|(^|\.)googlemail\.com$/.test(domain)) {
    return PROVIDER_PRESETS.gmail;
  }
  if (/(^|\.)outlook\.com$|(^|\.)hotmail\.com$|(^|\.)live\.com$|(^|\.)office365\.com$|(^|\.)microsoft\.com$/.test(domain)) {
    return PROVIDER_PRESETS.outlook;
  }
  // Default custom: asumimos puertos estándar
  return {
    provider: "custom",
    smtp_host: `smtp.${domain || "example.com"}`,
    smtp_port: 587,
    smtp_secure: false,
    imap_host: `imap.${domain || "example.com"}`,
    imap_port: 993,
    imap_secure: true,
  };
}

export async function listEmailAccounts(): Promise<EmailAccount[]> {
  const arr = await readJson<EmailAccount[]>(KEY);
  return Array.isArray(arr) ? arr : [];
}

export async function getEmailAccount(id: string): Promise<EmailAccount | null> {
  const all = await listEmailAccounts();
  return all.find((a) => a.id === id) || null;
}

export async function upsertEmailAccount(acc: EmailAccount): Promise<EmailAccount> {
  const all = await listEmailAccounts();
  const idx = all.findIndex((a) => a.email.toLowerCase() === acc.email.toLowerCase());
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...acc, id: all[idx].id };
  } else {
    all.push(acc);
  }
  await writeJson(KEY, all);
  return idx >= 0 ? all[idx] : acc;
}

export async function deleteEmailAccount(id: string): Promise<boolean> {
  const all = await listEmailAccounts();
  const next = all.filter((a) => a.id !== id);
  if (next.length === all.length) return false;
  await writeJson(KEY, next);
  return true;
}

export function newAccountId() {
  return crypto.randomUUID();
}

/** Quita los passwords de un account antes de exponerlo a la UI. */
export function safe(a: EmailAccount) {
  const { smtp_password, imap_password, ...rest } = a;
  return {
    ...rest,
    smtp_password_set: !!smtp_password,
    imap_password_set: !!imap_password,
  };
}
