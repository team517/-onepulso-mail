/**
 * POST /api/email-inbox/[id]/followup
 *   Body: { body, subject?, scheduled_for (ISO o days_from_now), only_if_no_reply }
 *
 * Programa un follow-up para enviar más tarde desde la cuenta que recibió este mensaje.
 * Si only_if_no_reply=true, el worker comprueba que no haya respuesta nueva
 * en el thread antes de enviarlo.
 */
import { NextRequest, NextResponse } from "next/server";
import { listEmailAccounts } from "@/lib/email-accounts";
import { listMessagesForAccount } from "@/lib/email-inbox-store";
import { createFollowUp } from "@/lib/email-followups";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const replyBody = String(body.body || "").trim();
  if (!replyBody) return NextResponse.json({ error: "Cuerpo vacío" }, { status: 400 });

  // Resolver scheduled_for: o ISO explícito, o days_from_now (número)
  let scheduledFor: string;
  if (body.scheduled_for) {
    const d = new Date(String(body.scheduled_for));
    if (isNaN(d.getTime())) return NextResponse.json({ error: "scheduled_for inválido" }, { status: 400 });
    scheduledFor = d.toISOString();
  } else if (typeof body.days_from_now === "number") {
    const d = new Date(Date.now() + Math.max(0, body.days_from_now) * 24 * 60 * 60 * 1000);
    scheduledFor = d.toISOString();
  } else {
    return NextResponse.json({ error: "Falta scheduled_for o days_from_now" }, { status: 400 });
  }
  const onlyIfNoReply = body.only_if_no_reply !== false; // default true

  // Localiza el mensaje
  const accounts = await listEmailAccounts();
  let foundMsg: any = null;
  for (const a of accounts) {
    const msgs = await listMessagesForAccount(a.id);
    const m = msgs.find((x) => x.id === id);
    if (m) { foundMsg = { account: a, message: m }; break; }
  }
  if (!foundMsg) return NextResponse.json({ error: "Mensaje no encontrado" }, { status: 404 });

  const { account, message } = foundMsg;
  if (!account.smtp_ok) {
    return NextResponse.json({ error: "Cuenta con SMTP en error" }, { status: 400 });
  }

  const refs: string[] = Array.isArray(message.references) ? message.references.slice() : [];
  if (message.message_id && !refs.includes(message.message_id)) refs.push(message.message_id);

  const fu = await createFollowUp({
    account_id: account.id,
    account_email: account.email,
    thread_id: message.thread_id,
    source_message_id: message.id,
    in_reply_to: message.message_id || "",
    references: refs,
    to_address: message.from_address,
    subject: String(body.subject || message.subject || ""),
    body: replyBody,
    scheduled_for: scheduledFor,
    only_if_no_reply: onlyIfNoReply,
  });

  return NextResponse.json({ ok: true, followup: fu });
}
