/**
 * Bandeja unificada de la plataforma de email.
 *
 * Agrupa los mensajes de TODAS las cuentas conectadas (email-accounts store)
 * en una sola vista. Distinto del Unibox multi-tenant legacy de OnePulso.
 *
 * Storage keys:
 *   email-inbox/{accountId}/messages   → InboxMessage[]   (últimos N mensajes IMAP)
 *   email-inbox/{accountId}/meta       → { last_sync, last_error, ... }
 *
 * Los mensajes se descartan si son warmup (códigos en subject) o bounces.
 */
import crypto from "crypto";
import { readJson, writeJson } from "./storage";

export type InboxMessage = {
  id: string;                  // UUID estable
  uid: number;                 // UID IMAP en INBOX
  account_id: string;          // ID de la cuenta de email-accounts
  account_email: string;
  message_id: string;          // <message-id> normalizado con <>
  in_reply_to?: string;
  references?: string[];
  from_address: string;
  from_name?: string;
  to_address: string;
  subject: string;
  date: string;                // ISO
  preview: string;             // texto plano corto
  text?: string;               // texto completo (puede ser largo)
  html?: string;               // HTML completo
  flags: string[];             // IMAP flags (\\Seen, \\Answered, etc.)
  /** thread_id derivado de in_reply_to / references / message_id raíz */
  thread_id: string;
  /** detectados al sync */
  is_warmup: boolean;
  is_bounce: boolean;
  /** marcado por el usuario en la UI */
  starred?: boolean;
  /** marcado leído manualmente desde la UI (independiente del flag IMAP) */
  user_read?: boolean;
};

export type InboxMeta = {
  account_id: string;
  last_sync: string | null;
  last_error: string | null;
  last_uid: number | null;
  total_messages: number;
};

const MSG_KEY = (accountId: string) => `email-inbox/${accountId}/messages`;
const META_KEY = (accountId: string) => `email-inbox/${accountId}/meta`;

export async function listMessagesForAccount(accountId: string): Promise<InboxMessage[]> {
  const arr = await readJson<InboxMessage[]>(MSG_KEY(accountId));
  return Array.isArray(arr) ? arr : [];
}

export async function writeMessagesForAccount(accountId: string, msgs: InboxMessage[]) {
  // Mantener máximo 500 por cuenta (los más recientes)
  const sorted = msgs.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  await writeJson(MSG_KEY(accountId), sorted.slice(0, 500));
}

export async function getMeta(accountId: string): Promise<InboxMeta> {
  const m = await readJson<InboxMeta>(META_KEY(accountId));
  return m || { account_id: accountId, last_sync: null, last_error: null, last_uid: null, total_messages: 0 };
}

export async function writeMeta(accountId: string, meta: InboxMeta) {
  await writeJson(META_KEY(accountId), meta);
}

/** Genera un thread_id estable a partir de References, In-Reply-To y Message-Id. */
export function computeThreadId(in_reply_to: string | undefined, references: string[] | undefined, message_id: string | undefined): string {
  if (references && references.length > 0) return normalize(references[0]);
  if (in_reply_to) return normalize(in_reply_to);
  if (message_id) return normalize(message_id);
  return crypto.randomUUID();
}

function normalize(id: string): string {
  return id.trim().replace(/^</, "").replace(/>$/, "").toLowerCase();
}

export function newMessageId() {
  return crypto.randomUUID();
}

/** Lista TODAS las cuentas conectadas que tienen IMAP funcional. */
export async function readAllMessages(accountIds: string[]): Promise<InboxMessage[]> {
  const buckets = await Promise.all(accountIds.map((id) => listMessagesForAccount(id)));
  const all = buckets.flat();
  all.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return all;
}
