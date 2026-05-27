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

  // Tags para filtrar (ej: "fintech", "es", "warmup-on")
  tags?: string[];
};

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
