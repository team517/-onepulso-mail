/**
 * Registro de mensajes enviados desde la plataforma.
 *
 * Cada vez que enviamos un email (reply desde el Unibox, follow-up programado,
 * test email, o paso de campaña del worker), llamamos a `logSentMessage` para
 * dejar constancia. El usuario los ve en /bandejas → toggle "Enviados".
 *
 * NO depende del APPEND a la carpeta Sent del IMAP — el log es nuestro, así
 * el usuario siempre ve lo que mandó incluso si IMAP append falla.
 *
 * Storage key: email-sent → SentMessage[]
 */
import crypto from "crypto";
import { readJson, writeJson } from "./storage";

const KEY = "email-sent";

export type SentType = "reply" | "followup" | "test" | "campaign";

export type SentMessage = {
  id: string;
  type: SentType;

  // Cuenta de envío
  account_id: string;
  account_email: string;

  // Destinatario
  to_address: string;
  to_name?: string;

  // Contenido
  subject: string;
  body: string;              // texto plano (recortado a 50KB)
  body_html?: string;        // HTML si se envió

  // Threading
  message_id?: string;       // Message-ID que generó nodemailer
  in_reply_to?: string;
  references?: string[];
  thread_id?: string;        // matches el thread_id del Unibox si es reply/followup

  // Referencias cruzadas (para abrir el contexto)
  source_inbox_message_id?: string;  // mensaje del Unibox al que responde
  followup_id?: string;
  campaign_id?: string;
  campaign_step?: number;
  campaign_variant?: string;
  lead_id?: string;
  lead_email?: string;

  // Resultado
  ok: boolean;
  error?: string | null;
  appended_to_sent?: boolean;
  sent_folder?: string;
  ms?: number;
  sent_at: string;           // ISO
};

export async function listSent(): Promise<SentMessage[]> {
  const arr = await readJson<SentMessage[]>(KEY);
  return Array.isArray(arr) ? arr : [];
}

export async function logSentMessage(data: Omit<SentMessage, "id" | "sent_at">): Promise<SentMessage> {
  const entry: SentMessage = {
    id: crypto.randomUUID(),
    sent_at: new Date().toISOString(),
    ...data,
  };
  const all = await listSent();
  all.push(entry);
  // Mantén máximo 5000 entradas (los más recientes)
  all.sort((a, b) => (b.sent_at || "").localeCompare(a.sent_at || ""));
  await writeJson(KEY, all.slice(0, 5000));
  return entry;
}

export async function getSentById(id: string): Promise<SentMessage | null> {
  const all = await listSent();
  return all.find((s) => s.id === id) || null;
}

export async function deleteSent(id: string): Promise<boolean> {
  const all = await listSent();
  const next = all.filter((s) => s.id !== id);
  if (next.length === all.length) return false;
  await writeJson(KEY, next);
  return true;
}
