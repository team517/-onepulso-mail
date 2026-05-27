/**
 * POST /api/email-inbox/[id]/reply
 *   Body: { body: string, subject?: string }
 *
 * Envía una respuesta al mensaje [id] desde la cuenta que LO RECIBIÓ
 * (account_id del mensaje), preservando headers In-Reply-To / References.
 * Si el subject no se pasa, se usa el del mensaje original con prefijo "Re:".
 */
import { NextRequest, NextResponse } from "next/server";
import { getEmailAccount, listEmailAccounts } from "@/lib/email-accounts";
import { listMessagesForAccount } from "@/lib/email-inbox-store";
import { sendThreadReply } from "@/lib/email-thread-send";
import { logSentMessage } from "@/lib/email-sent-log";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const replyBody = String(body.body || "").trim();
  if (!replyBody) return NextResponse.json({ error: "Cuerpo vacío" }, { status: 400 });

  // Localiza el mensaje + cuenta
  const accounts = await listEmailAccounts();
  let foundMsg: any = null;
  for (const a of accounts) {
    const msgs = await listMessagesForAccount(a.id);
    const m = msgs.find((x) => x.id === id);
    if (m) { foundMsg = { account: a, message: m }; break; }
  }
  if (!foundMsg) return NextResponse.json({ error: "Mensaje no encontrado" }, { status: 404 });

  const account = foundMsg.account;
  const message = foundMsg.message;
  if (!account.smtp_ok) {
    return NextResponse.json({
      error: "La cuenta tiene SMTP en error — no se puede responder desde ella",
      detail: account.last_smtp_error,
    }, { status: 400 });
  }

  const subject = String(body.subject || message.subject || "");
  const toAddress = message.from_address;
  if (!toAddress) return NextResponse.json({ error: "Mensaje original sin remitente — no sé a quién responder" }, { status: 400 });

  // References = (refs originales) + message_id del mensaje al que respondemos
  const refs: string[] = Array.isArray(message.references) ? message.references.slice() : [];
  if (message.message_id && !refs.includes(message.message_id)) refs.push(message.message_id);

  const result = await sendThreadReply({
    account,
    to: toAddress,
    subject,
    body: replyBody,
    in_reply_to: message.message_id || "",
    references: refs,
  });

  // Log SIEMPRE — éxito y fallo — para que el usuario vea su historial
  await logSentMessage({
    type: "reply",
    account_id: account.id,
    account_email: account.email,
    to_address: toAddress,
    to_name: message.from_name,
    subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
    body: replyBody,
    message_id: result.message_id,
    in_reply_to: message.message_id,
    references: refs,
    thread_id: message.thread_id,
    source_inbox_message_id: message.id,
    ok: result.ok,
    error: result.error || null,
    appended_to_sent: result.sent_appended,
    sent_folder: result.sent_folder,
    ms: result.ms,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error, ms: result.ms }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    ms: result.ms,
    from: account.email,
    to: toAddress,
    message_id: result.message_id,
    sent_appended: result.sent_appended,
    sent_folder: result.sent_folder,
    in_reply_to: message.message_id,
  });
}
