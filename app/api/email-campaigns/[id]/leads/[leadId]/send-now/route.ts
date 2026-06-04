/**
 * POST /api/email-campaigns/[id]/leads/[leadId]/send-now
 *
 * Envía MANUALMENTE el step actual del lead, bypaseando el delay y el schedule.
 *
 * Sí respeta:
 *   - Rate limit de la cuenta (6-9 min gap) — si la cuenta está rate-limited
 *     devuelve error, NO la bypasa (sería quemar la cuenta).
 *   - Daily limit — si la cuenta está al máximo, error.
 *   - Status del lead: solo envía si status ∈ {new, active}.
 *
 * Si el lead tiene sticky_account_id → usa esa cuenta.
 * Si no → la primera cuenta asignada que esté ready.
 *
 * Threading se preserva igual que el worker (step 2+ va como "Re: ...").
 */
import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import {
  getCampaign, listLeads, writeLeads, pickVariant, renderTemplate,
  type Lead, type Variant, type Campaign,
} from "@/lib/email-campaigns";
import { listEmailAccounts, upsertEmailAccount, getEmailAccount, getEffectiveDailyLimit, type EmailAccount } from "@/lib/email-accounts";
import { logSentMessage } from "@/lib/email-sent-log";

export const runtime = "nodejs";
export const maxDuration = 60;

function cleanPass(p: string) { return (p || "").replace(/\s+/g, ""); }

function normalizeMsgId(id: string): string {
  if (!id) return "";
  return id.trim().startsWith("<") ? id.trim() : `<${id.trim()}>`;
}

function ensureRe(s: string): string {
  if (!s) return "Re:";
  if (/^re:\s*/i.test(s)) return s;
  return `Re: ${s}`;
}

/** Detecta path del Sent folder. */
async function findSentFolder(client: ImapFlow): Promise<string | null> {
  try {
    const list = (await client.list()) as any[];
    for (const m of list) if (m.specialUse === "\\Sent") return m.path;
    for (const m of list) {
      if (/\b(Sent\s?Mail|Sent|Enviados|Gesendet|Verzonden|Inviata|Envoy[ée]s)\b/i.test(m.path)) return m.path;
    }
    if (list.some((m) => m.path?.startsWith("[Gmail]"))) return "[Gmail]/Sent Mail";
    return null;
  } catch {
    return null;
  }
}

/** APPEND best-effort al Sent folder del IMAP. */
async function appendToSent(account: EmailAccount, mime: string): Promise<{ ok: boolean; folder?: string }> {
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
      new Promise((_, rej) => setTimeout(() => rej(new Error("IMAP timeout")), 10000)),
    ]);
    const sent = await findSentFolder(client);
    if (!sent) {
      try { await client.logout(); } catch {}
      return { ok: false };
    }
    try {
      await client.append(sent, mime, ["\\Seen"]);
      try { await client.logout(); } catch {}
      return { ok: true, folder: sent };
    } catch {
      try { await client.logout(); } catch {}
      return { ok: false, folder: sent };
    }
  } catch {
    try { client.close(); } catch {}
    return { ok: false };
  }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; leadId: string }> }) {
  const { id, leadId } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });

  const leads = await listLeads(id);
  const lead = leads.find((l) => l.id === leadId);
  if (!lead) return NextResponse.json({ error: "Lead no encontrado" }, { status: 404 });

  if (!["new", "active"].includes(lead.status)) {
    return NextResponse.json({
      error: `Lead en status ${lead.status} — no se puede enviar`,
      hint: lead.status === "replied" ? "Ya respondió" : lead.status === "bounced" ? "Email rebotó" : "Estado no enviable",
    }, { status: 400 });
  }

  const stepIdx = lead.current_step;
  if (stepIdx >= campaign.steps.length) {
    return NextResponse.json({ error: "Lead ya completó toda la secuencia" }, { status: 400 });
  }
  const step = campaign.steps[stepIdx];
  const variant = pickVariant(step, lead.id);

  // Buscar cuenta — sticky o primera asignada lista
  const allAccounts = await listEmailAccounts();
  const tagSet = new Set(campaign.account_tags || []);
  const idSet = new Set(campaign.account_ids || []);
  const assigned = allAccounts.filter((a) => {
    if (!a.smtp_ok) return false;
    if (idSet.has(a.id)) return true;
    if (tagSet.size > 0 && (a.tags || []).some((t) => tagSet.has(t))) return true;
    return false;
  });
  if (assigned.length === 0) {
    return NextResponse.json({ error: "Campaña sin cuentas SMTP asignadas" }, { status: 400 });
  }

  // Si sticky → solo esa cuenta
  let account: EmailAccount | undefined;
  if (lead.sticky_account_id) {
    account = assigned.find((a) => a.id === lead.sticky_account_id);
    if (!account) {
      // Sticky borrado → primera asignada
      account = assigned[0];
    }
  } else {
    account = assigned[0];
  }
  if (!account) {
    return NextResponse.json({ error: "No hay cuenta disponible para enviar" }, { status: 400 });
  }

  // Check daily limit
  const campaignDailyLimit = campaign.options.daily_limit_per_account ?? 30;
  const dailyLimit = Math.min(getEffectiveDailyLimit(account), campaignDailyLimit);
  if ((account.sent_today ?? 0) >= dailyLimit) {
    return NextResponse.json({
      error: `Cuenta ${account.email} alcanzó su daily limit (${dailyLimit}/${dailyLimit})`,
    }, { status: 400 });
  }

  // Check rate limit (gap 6-9 min)
  if (account.next_eligible_at && new Date(account.next_eligible_at) > new Date()) {
    const waitMin = Math.ceil((new Date(account.next_eligible_at).getTime() - Date.now()) / 60_000);
    return NextResponse.json({
      error: `Cuenta ${account.email} está en rate limit — disponible en ${waitMin} min`,
    }, { status: 400 });
  }

  // ── Renderizar y enviar ──
  const subjectRaw = renderTemplate(variant.subject || "(sin asunto)", lead.variables, { seed: lead.id });
  const bodyHtml = renderTemplate(variant.body || "", lead.variables, { seed: lead.id });
  // Detección robusta de cuerpo vacío: strip HTML + entidades + whitespace.
  // Esto detecta cuerpos que son solo <br>, &nbsp; o variables sin valor.
  const bodyPlain = bodyHtml
    .replace(/<[^>]+>/g, "")     // tags HTML
    .replace(/&[a-z]+;/gi, "")   // entidades HTML &nbsp; &amp; etc.
    .replace(/\s+/g, "")         // todo whitespace
    .trim();
  if (!subjectRaw.trim()) {
    return NextResponse.json({
      error: `El step ${stepIdx + 1} variante ${variant.label} no tiene SUBJECT`,
      hint: "Edita la campaña → Sequences → Step " + (stepIdx + 1) + " y rellena el subject"
    }, { status: 400 });
  }
  if (!bodyPlain) {
    return NextResponse.json({
      error: `El step ${stepIdx + 1} variante ${variant.label} no tiene CUERPO de mensaje`,
      hint: `Edita la campaña → Sequences → Step ${stepIdx + 1} y rellena el body. Tu variante actual ${variant.body ? "solo contiene HTML vacío o variables sin valor" : "está completamente vacía"}.`,
      debug: {
        step: stepIdx + 1,
        variant: variant.label,
        variant_subject_length: (variant.subject || "").length,
        variant_body_length: (variant.body || "").length,
        rendered_body_length: bodyHtml.length,
        rendered_body_preview: bodyHtml.slice(0, 100),
      }
    }, { status: 400 });
  }

  const isFirstStep = stepIdx === 0 || !lead.last_message_id;
  const inReplyTo = isFirstStep ? "" : normalizeMsgId(lead.last_message_id || "");
  const referencesArr = isFirstStep
    ? []
    : (lead.thread_references || []).concat(inReplyTo ? [inReplyTo] : []).filter(Boolean);
  const subjectOut = isFirstStep ? subjectRaw : ensureRe(lead.thread_subject || subjectRaw);

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

  const newMessageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${account.email.split("@")[1] || "onepulso.local"}>`;

  const headers: Record<string, string> = {
    "X-OnePulso-Campaign": campaign.id,
    "X-OnePulso-Lead": lead.id,
    "X-OnePulso-Variant": variant.id,
    "X-OnePulso-Step": String(stepIdx + 1),
    "X-OnePulso-Manual": "1", // marca manual
  };
  if (campaign.options.insert_unsubscribe_header) {
    headers["List-Unsubscribe"] = `<mailto:${account.email}?subject=Unsubscribe>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  const textBody = bodyHtml.replace(/<[^>]+>/g, "");
  const useTextOnly = campaign.options.text_only_all || (campaign.options.text_only_first && isFirstStep);
  const htmlOut = useTextOnly
    ? undefined
    : `<div style="font-family:-apple-system,sans-serif;font-size:14px;line-height:1.55;color:#0a0d14;white-space:pre-wrap">${bodyHtml.replace(/\n/g, "<br>")}</div>`;

  const t0 = Date.now();
  try {
    const info = await transporter.sendMail({
      from: `"${fromName}" <${account.email}>`,
      to: lead.email,
      subject: subjectOut,
      text: textBody,
      html: htmlOut,
      cc: campaign.options.cc || undefined,
      bcc: campaign.options.bcc || undefined,
      headers,
      messageId: newMessageId,
      inReplyTo: inReplyTo || undefined,
      references: referencesArr.length > 0 ? referencesArr.join(" ") : undefined,
    });

    // APPEND a Sent (best-effort)
    let appendResult: { ok: boolean; folder?: string } = { ok: false };
    try {
      const mime = [
        `From: "${fromName}" <${account.email}>`,
        `To: ${lead.email}`,
        `Subject: ${subjectOut}`,
        `Message-ID: ${newMessageId}`,
        inReplyTo ? `In-Reply-To: ${inReplyTo}` : "",
        referencesArr.length > 0 ? `References: ${referencesArr.join(" ")}` : "",
        `Date: ${new Date().toUTCString()}`,
        `Content-Type: text/plain; charset=utf-8`,
        ``,
        textBody,
        ``,
      ].filter(Boolean).join("\r\n");
      appendResult = await appendToSent(account, mime);
    } catch {}

    const ms = Date.now() - t0;
    const nowIso = new Date().toISOString();

    // Actualizar lead
    const leadIdx = leads.findIndex((l) => l.id === leadId);
    if (leadIdx >= 0) {
      const isFinalStep = stepIdx + 1 >= campaign.steps.length;
      leads[leadIdx] = {
        ...lead,
        status: isFinalStep ? "completed" : "active",
        current_step: stepIdx + 1,
        last_contacted_at: nowIso,
        first_contacted_at: lead.first_contacted_at || (isFirstStep ? nowIso : null),
        last_event: `manual send step ${stepIdx + 1} variant ${variant.label}`,
        sticky_account_id: lead.sticky_account_id || account.id,
        finished_reason: isFinalStep ? "completed_sequence" : null,
        thread_subject: lead.thread_subject || subjectRaw,
        last_message_id: info.messageId || newMessageId,
        thread_references: [...(lead.thread_references || []), info.messageId || newMessageId],
      };
      await writeLeads(id, leads);
    }

    // Actualizar cuenta (rate limit + daily)
    const tz = campaign.schedule.timezone || "Europe/Madrid";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const gapMinutes = (campaign.options.min_gap_minutes ?? 6) + Math.random() * (campaign.options.random_gap_minutes ?? 3);
    const freshAcc = await getEmailAccount(account.id);
    if (freshAcc) {
      await upsertEmailAccount({
        ...freshAcc,
        sent_today: (freshAcc.sent_today ?? 0) + 1,
        sent_today_date: today,
        last_send_at: nowIso,
        next_eligible_at: new Date(Date.now() + gapMinutes * 60_000).toISOString(),
      });
    }

    // Log persistente
    await logSentMessage({
      type: "campaign",
      account_id: account.id,
      account_email: account.email,
      to_address: lead.email,
      subject: subjectOut,
      body: textBody,
      message_id: info.messageId || newMessageId,
      in_reply_to: inReplyTo || undefined,
      references: referencesArr,
      campaign_id: id,
      campaign_step: stepIdx + 1,
      campaign_variant: variant.label,
      lead_id: lead.id,
      lead_email: lead.email,
      ok: true,
      appended_to_sent: appendResult.ok,
      sent_folder: appendResult.folder,
      ms,
    });

    return NextResponse.json({
      ok: true,
      ms,
      step_sent: stepIdx + 1,
      next_step: stepIdx + 2 <= campaign.steps.length ? stepIdx + 2 : null,
      account: account.email,
      message_id: info.messageId || newMessageId,
      appended_to_sent: appendResult.ok,
      lead_status: leads[leads.findIndex((l) => l.id === leadId)]?.status,
    });
  } catch (e: any) {
    const ms = Date.now() - t0;
    // Log fallo
    await logSentMessage({
      type: "campaign",
      account_id: account.id,
      account_email: account.email,
      to_address: lead.email,
      subject: subjectOut,
      body: textBody,
      campaign_id: id,
      campaign_step: stepIdx + 1,
      campaign_variant: variant.label,
      lead_id: lead.id,
      lead_email: lead.email,
      ok: false,
      error: e.message,
      ms,
    });

    return NextResponse.json({
      ok: false,
      error: `${e.code ? e.code + ": " : ""}${e.message}`,
      ms,
    }, { status: 500 });
  } finally {
    try { transporter.close(); } catch {}
  }
}
