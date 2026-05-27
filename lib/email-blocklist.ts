/**
 * Lista global de emails/dominios bloqueados.
 *
 * Cuando el usuario "bloquea" un remitente desde el Unibox:
 *   1. Se añade a esta lista (futuras campañas auto-saltan)
 *   2. Se marcan como `unsubscribed` los leads existentes con ese email o
 *      dominio en TODAS las campañas (el worker dejará de enviarles).
 *
 * Storage key: email-blocklist → BlockEntry[]
 */
import crypto from "crypto";
import { readJson, writeJson } from "./storage";

const KEY = "email-blocklist";

export type BlockEntry = {
  id: string;
  /** "email" → coincidencia exacta. "domain" → todos los emails @dominio. */
  type: "email" | "domain";
  value: string;          // siempre en lowercase
  reason?: string;
  blocked_at: string;
  /** Cuántos leads se afectaron al bloquear. */
  affected_leads?: number;
};

export async function listBlocklist(): Promise<BlockEntry[]> {
  const arr = await readJson<BlockEntry[]>(KEY);
  return Array.isArray(arr) ? arr : [];
}

export async function addToBlocklist(e: Omit<BlockEntry, "id" | "blocked_at">): Promise<BlockEntry> {
  const all = await listBlocklist();
  const value = e.value.toLowerCase().trim();
  // Dedup por (type+value)
  const existing = all.find((x) => x.type === e.type && x.value === value);
  if (existing) {
    // Refresh affected_leads y reason si vienen nuevos
    if (typeof e.affected_leads === "number") existing.affected_leads = e.affected_leads;
    if (e.reason) existing.reason = e.reason;
    await writeJson(KEY, all);
    return existing;
  }
  const entry: BlockEntry = {
    id: crypto.randomUUID(),
    blocked_at: new Date().toISOString(),
    ...e,
    value,
  };
  all.unshift(entry);
  await writeJson(KEY, all);
  return entry;
}

export async function removeFromBlocklist(id: string): Promise<boolean> {
  const all = await listBlocklist();
  const next = all.filter((x) => x.id !== id);
  if (next.length === all.length) return false;
  await writeJson(KEY, next);
  return true;
}

export function isBlocked(email: string, blocklist: BlockEntry[]): boolean {
  const e = email.toLowerCase().trim();
  const domain = e.split("@")[1] || "";
  for (const b of blocklist) {
    if (b.type === "email" && b.value === e) return true;
    if (b.type === "domain" && b.value === domain) return true;
  }
  return false;
}
