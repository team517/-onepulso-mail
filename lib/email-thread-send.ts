/**
 * Envía un email de respuesta dentro de un thread existente, preservando
 * In-Reply-To + References + el prefijo "Re:" en el subject.
 *
 * También intenta hacer APPEND a la carpeta "Sent" del IMAP para que la respuesta
 * aparezca correctamente en el cliente de correo del usuario.
 */
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { EmailAccount } from "./email-accounts";

export type SendThreadInput = {
  account: EmailAccount;
  to: string;
  subject: string;       // sin "Re:" — la función se encarga
  body: string;          // texto plano o HTML simple
  in_reply_to: string;   // <message-id> del mensaje original
  references: string[];  // cadena de References (la nueva append al original)
};

function cleanPass(p: string) { return (p || "").replace(/\s+/g, ""); }

function ensureRe(s: string): string {
  if (!s) return "Re:";
  if (/^re:\s*/i.test(s)) return s;
  return `Re: ${s}`;
}

function normalizeMsgId(id: string): string {
  if (!id) return "";
  return id.trim().startsWith("<") ? id.trim() : `<${id.trim()}>`;
}

/** Intenta APPENDear el MIME a la carpeta "Sent" — best-effort. */
async function appendToSent(account: EmailAccount, mime: string): Promise<{ ok: boolean; folder?: string; error?: string }> {
  const client = new ImapFlow({
    host: account.imap_host,
    port: account.imap_port,
    secure: account.imap_secure,
    auth: { user: account.imap_user || account.email, pass: cleanPass(account.imap_password) },
    logger: false,
    tls: { rejectUnauthorized: false },
  });
  try {
    await Promise.race([
      client.connect(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("IMAP connect timeout 12s")), 12000)),
    ]);
    const list = (await client.list()) as any[];
    // Detecta Sent folder (mismo heurístico que imap-test legacy)
    let sent: string | null = null;
    for (const m of list) {
      if (m.specialUse === "\\Sent") { sent = m.path; break; }
    }
    if (!sent) {
      for (const m of list) {
        if (/\b(Sent\s?Mail|Sent|Enviados|Gesendet|Verzonden|Inviata|Envoy[ée]s)\b/i.test(m.path)) { sent = m.path; break; }
      }
    }
    if (!sent && list.some((m: any) => m.path.startsWith("[Gmail]"))) sent = "[Gmail]/Sent Mail";
    if (!sent) {
      try { await client.logout(); } catch {}
      return { ok: false, error: "Sent folder no detectada" };
    }
    try {
      await client.append(sent, mime, ["\\Seen"]);
      try { await client.logout(); } catch {}
      return { ok: true, folder: sent };
    } catch (e: any) {
      try { await client.logout(); } catch {}
      return { ok: false, folder: sent, error: e.message };
    }
  } catch (e: any) {
    try { client.close(); } catch {}
    return { ok: false, error: e.message };
  }
}

export async function sendThreadReply(input: SendThreadInput): Promise<{
  ok: boolean;
  ms: number;
  message_id?: string;
  error?: string;
  sent_appended?: boolean;
  sent_folder?: string;
}> {
  const t0 = Date.now();
  const { account, to, subject, body, in_reply_to, references } = input;

  const inReplyTo = normalizeMsgId(in_reply_to);
  const refs = references.map(normalizeMsgId).filter(Boolean);
  if (inReplyTo && !refs.includes(inReplyTo)) refs.push(inReplyTo);

  const transporter = nodemailer.createTransport({
    host: account.smtp_host,
    port: account.smtp_port,
    secure: account.smtp_secure,
    auth: { user: account.smtp_user, pass: cleanPass(account.smtp_password) },
    connectionTimeout: 10000, greetingTimeout: 8000, socketTimeout: 15000,
    family: 4, tls: { rejectUnauthorized: false },
    name: "onepulso.online",
  });

  const fromName = account.display_name
    || [account.first_name, account.last_name].filter(Boolean).join(" ")
    || account.email.split("@")[0];

  // Generamos un Message-ID propio para que podamos hacer append a Sent con el mismo
  const newMessageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${account.email.split("@")[1] || "onepulso.local"}>`;

  try {
    const info = await transporter.sendMail({
      from: `"${fromName}" <${account.email}>`,
      to,
      subject: ensureRe(subject),
      text: body.replace(/<[^>]+>/g, ""),
      html: `<div style="font-family:-apple-system,sans-serif;font-size:14px;line-height:1.55;color:#0a0d14;white-space:pre-wrap">${body.replace(/\n/g, "<br>")}</div>`,
      inReplyTo,
      references: refs.join(" "),
      messageId: newMessageId,
      headers: { "X-OnePulso-Reply": "1" },
    });

    // Build MIME manually for IMAP append (best-effort)
    const mime = [
      `From: "${fromName}" <${account.email}>`,
      `To: ${to}`,
      `Subject: ${ensureRe(subject)}`,
      `Message-ID: ${newMessageId}`,
      `In-Reply-To: ${inReplyTo}`,
      `References: ${refs.join(" ")}`,
      `Date: ${new Date().toUTCString()}`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      body.replace(/<[^>]+>/g, ""),
      ``,
    ].join("\r\n");
    const appendResult = await appendToSent(account, mime);

    return {
      ok: true,
      ms: Date.now() - t0,
      message_id: info.messageId || newMessageId,
      sent_appended: appendResult.ok,
      sent_folder: appendResult.folder,
    };
  } catch (e: any) {
    return {
      ok: false,
      ms: Date.now() - t0,
      error: `${e.code ? e.code + ": " : ""}${e.message}`,
    };
  } finally {
    try { transporter.close(); } catch {}
  }
}
