/**
 * Follow-ups programados desde el Unibox.
 *
 * Cuando el usuario abre un mensaje recibido y dice "programar follow-up para
 * dentro de 3 días si no me responde", creamos uno de éstos. El worker los
 * revisa en cada tick:
 *   - Si `scheduled_for` pasó y `only_if_no_reply` es false → envía
 *   - Si `only_if_no_reply` es true → comprueba que NO haya mensajes nuevos
 *     en ese thread desde `created_at`. Si hay → cancela. Si no → envía.
 *
 * Storage:
 *   email-followups → FollowUp[]
 */
import crypto from "crypto";
import { readJson, writeJson } from "./storage";

const KEY = "email-followups";

export type FollowUpStatus = "pending" | "sent" | "cancelled" | "failed";

export type FollowUp = {
  id: string;
  account_id: string;            // cuenta que envía (la que recibió el email original)
  account_email: string;
  thread_id: string;             // thread del Unibox
  /** ID del mensaje del Unibox sobre el que se programa el follow-up */
  source_message_id: string;
  /** Message-ID RFC del último mensaje del thread (lo usamos para In-Reply-To) */
  in_reply_to: string;
  /** Cadena completa de References para preservar el thread */
  references: string[];
  to_address: string;
  subject: string;
  body: string;
  /** ISO timestamp cuándo enviarlo */
  scheduled_for: string;
  /** Si true, antes de enviar comprueba que no haya respuesta nueva. */
  only_if_no_reply: boolean;
  status: FollowUpStatus;
  created_at: string;
  sent_at?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  last_error?: string | null;
  message_id?: string | null;    // Message-ID generado tras enviar
};

export async function listFollowUps(): Promise<FollowUp[]> {
  const arr = await readJson<FollowUp[]>(KEY);
  return Array.isArray(arr) ? arr : [];
}

export async function getFollowUp(id: string): Promise<FollowUp | null> {
  const all = await listFollowUps();
  return all.find((f) => f.id === id) || null;
}

export async function createFollowUp(data: Omit<FollowUp, "id" | "status" | "created_at">): Promise<FollowUp> {
  const f: FollowUp = {
    id: crypto.randomUUID(),
    ...data,
    status: "pending",
    created_at: new Date().toISOString(),
  };
  const all = await listFollowUps();
  all.push(f);
  await writeJson(KEY, all);
  return f;
}

export async function updateFollowUp(id: string, patch: Partial<FollowUp>): Promise<FollowUp | null> {
  const all = await listFollowUps();
  const idx = all.findIndex((f) => f.id === id);
  if (idx < 0) return null;
  all[idx] = { ...all[idx], ...patch };
  await writeJson(KEY, all);
  return all[idx];
}

export async function cancelFollowUp(id: string, reason?: string): Promise<boolean> {
  const updated = await updateFollowUp(id, {
    status: "cancelled",
    cancelled_at: new Date().toISOString(),
    cancellation_reason: reason || "Cancelado por el usuario",
  });
  return !!updated;
}

export async function deleteFollowUp(id: string): Promise<boolean> {
  const all = await listFollowUps();
  const next = all.filter((f) => f.id !== id);
  if (next.length === all.length) return false;
  await writeJson(KEY, next);
  return true;
}
