/**
 * POST /api/email-campaigns/[id]/send-test
 *
 * Body: {
 *   step_id: string,
 *   variant_id?: string,       // si no se pasa, picks por hash determinista del lead/seed
 *   from_account_id: string,   // ID de cuenta conectada (email-accounts store)
 *   to_email: string,          // destinatario del test
 *   lead_id?: string,          // si se pasa, usa sus variables; si no, dummy
 * }
 *
 * Envía un email real vía SMTP usando las credenciales de la cuenta seleccionada,
 * con el subject + body de la variante renderizados (variables + spintax aplicados).
 * El subject lleva prefijo "[TEST]" para distinguirlo.
 */
import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { getCampaign, listLeads, pickVariant, renderTemplate, type Variant } from "@/lib/email-campaigns";
import { getEmailAccount } from "@/lib/email-accounts";
import { logSentMessage } from "@/lib/email-sent-log";

export const runtime = "nodejs";
export const maxDuration = 30;

function cleanPass(p: string) {
  return (p || "").replace(/\s+/g, "");
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCampaign(id);
  if (!c) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const stepId = String(body.step_id || "");
  const variantId = body.variant_id ? String(body.variant_id) : "";
  const fromAccountId = String(body.from_account_id || "");
  const toEmail = String(body.to_email || "").trim().toLowerCase();
  const leadId = body.lead_id ? String(body.lead_id) : "";

  // Validación
  if (!toEmail || !toEmail.includes("@") || !/\.[a-z]{2,}$/i.test(toEmail)) {
    return NextResponse.json({ error: "Email destinatario inválido" }, { status: 400 });
  }
  if (!fromAccountId) {
    return NextResponse.json({ error: "Falta from_account_id" }, { status: 400 });
  }
  if (!stepId) {
    return NextResponse.json({ error: "Falta step_id" }, { status: 400 });
  }

  // Localiza step + variant
  const step = c.steps.find((s) => s.id === stepId);
  if (!step) return NextResponse.json({ error: "Step no encontrado" }, { status: 404 });

  // Cuenta de envío
  const account = await getEmailAccount(fromAccountId);
  if (!account) return NextResponse.json({ error: "Cuenta de envío no encontrada" }, { status: 404 });
  if (!account.smtp_ok) {
    return NextResponse.json({
      error: "La cuenta seleccionada tiene SMTP en error",
      detail: account.last_smtp_error,
    }, { status: 400 });
  }

  // Lead → variables (o dummy)
  const leads = await listLeads(id);
  const lead = leadId ? leads.find((l) => l.id === leadId) : (leads[0] || null);

  const dummyVars: Record<string, string> = {
    first_name: "Ana", last_name: "García", email: toEmail,
    company_name: "Acme Corp", company: "Acme Corp", website: "https://acme.com",
    job_title: "Head of Sales", industry: "SaaS", city: "Madrid", country: "España",
  };
  const variables = lead?.variables ? { ...dummyVars, ...lead.variables } : dummyVars;

  // Variante: la explícita o la que tocaría a este lead (determinista)
  let variant: Variant | undefined;
  if (variantId) variant = step.variants.find((v) => v.id === variantId);
  if (!variant) {
    const seed = lead?.id || "test-preview";
    variant = pickVariant(step, seed);
  }
  if (!variant) return NextResponse.json({ error: "Sin variantes en este step" }, { status: 400 });

  const seed = lead?.id || variant.id;
  const subject = renderTemplate(variant.subject || "(sin asunto)", variables, { seed });
  const html    = renderTemplate(variant.body || "(sin contenido)", variables, { seed });

  // SMTP transporter usando las credenciales de la cuenta
  const t = nodemailer.createTransport({
    host: account.smtp_host,
    port: account.smtp_port,
    secure: account.smtp_secure,
    auth: { user: account.smtp_user, pass: cleanPass(account.smtp_password) },
    connectionTimeout: 10000,
    greetingTimeout: 8000,
    socketTimeout: 15000,
    family: 4,
    tls: { rejectUnauthorized: false },
    name: "onepulso.online",
  });

  const fromName = account.display_name
    || [account.first_name, account.last_name].filter(Boolean).join(" ")
    || account.email.split("@")[0];

  const t0 = Date.now();
  try {
    const info = await t.sendMail({
      from: `"${fromName}" <${account.email}>`,
      to: toEmail,
      subject: `[TEST · ${c.name}] ${subject}`,
      // Mandamos como text + simple HTML wrapping (sin tracking) — es un test.
      text: html.replace(/<[^>]+>/g, ""),
      html: `<div style="font-family:-apple-system,sans-serif;font-size:14px;line-height:1.55;color:#0a0d14;white-space:pre-wrap">${html.replace(/\n/g, "<br>")}</div>`,
      headers: {
        "X-OnePulso-Test": "1",
        "X-OnePulso-Campaign": c.id,
        "X-OnePulso-Step": step.id,
        "X-OnePulso-Variant": variant.id,
      },
    });
    const ms = Date.now() - t0;
    await logSentMessage({
      type: "test",
      account_id: account.id,
      account_email: account.email,
      to_address: toEmail,
      subject: `[TEST · ${c.name}] ${subject}`,
      body: html.replace(/<[^>]+>/g, ""),
      body_html: html,
      message_id: info.messageId,
      campaign_id: c.id,
      campaign_variant: variant.label,
      lead_id: lead?.id,
      lead_email: lead?.email,
      ok: true,
      ms,
    });
    return NextResponse.json({
      ok: true,
      ms,
      message_id: info.messageId,
      from: account.email,
      to: toEmail,
      subject: `[TEST · ${c.name}] ${subject}`,
      variant: { id: variant.id, label: variant.label },
      lead: lead ? { id: lead.id, email: lead.email } : null,
      used_dummy: !lead,
    });
  } catch (e: any) {
    const ms = Date.now() - t0;
    const err = `${e.code ? e.code + ": " : ""}${e.message}`;
    await logSentMessage({
      type: "test",
      account_id: account.id,
      account_email: account.email,
      to_address: toEmail,
      subject: `[TEST · ${c.name}] ${subject}`,
      body: html.replace(/<[^>]+>/g, ""),
      campaign_id: c.id,
      campaign_variant: variant.label,
      lead_id: lead?.id,
      lead_email: lead?.email,
      ok: false, error: err, ms,
    });
    return NextResponse.json({ ok: false, error: err, ms }, { status: 500 });
  } finally {
    try { t.close(); } catch {}
  }
}
