/**
 * POST /api/email-campaigns/[id]/leads/[leadId]/send-now
 *
 * Envía MANUALMENTE el step actual del lead.
 *   - Bypasea delay entre steps
 *   - Bypasea schedule
 *   - Bypasea rate limit (gap 6-9 min)
 *
 * Solo respeta:
 *   - status del lead (new/active)
 *   - daily limit por cuenta (no quemar la cuenta)
 *   - sticky_account_id (en step 2+ usa la misma cuenta para preservar threading)
 *
 * AUTOFALLBACK si la cuenta devuelve 450/421/451 (IONOS rate limit del servidor):
 *   - Solo en step 1 (sin sticky aún) prueba la siguiente cuenta asignada.
 *   - En step 2+ la cuenta sticky es obligatoria → si falla, devuelve error
 *     pidiendo esperar.
 *   - Cuenta que falló: cooldown 30 min en next_eligible_at.
 */
import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import {
  getCampaign, listLeads, writeLeads, pickVariant, renderTemplate,
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

async function findSentFolder(client: ImapFlow): Promise<string | null> {
  try {
    const list = (await client.list()) as any[];
    for (const m of list) if (m.specialUse === "\\Sent") return m.path;
    for (const m of list) {
      if (/\b(Sent\s?Mail|Sent|Enviados|Gesendet|Verzonden|Inviata|Envoy[ée]s)\b/i.test(m.path)) return m.path;
    }
    if (list.some((m) => m.path?.startsWith("[Gmail]"))) return "[Gmail]/Sent Mail";
    return null;
  } catch { return null; }
}

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
    if (!sent) { try { await client.logout(); } catch {} return { ok: false }; }
    try { await client.append(sent, mime, ["\\Seen"]); try { await client.logout(); } catch {} return { ok: true, folder: sent }; }
    catch { try { await client.logout(); } catch {} return { ok: false, folder: sent }; }
  } catch { try { client.close(); } catch {} return { ok: false }; }
}

/** Detecta errores de RATE LIMIT del servidor SMTP (no del destinatario). */
function isServerRateLimitError(err: any): boolean {
  const msg = ((err?.message || "") + " " + (err?.response || "")).toLowerCase();
  if (/\b(450|421|451|429)\b/.test(msg)) return true;
  if (/too\s*many|rate\s*limit|send\s*limit|throttl|mail\s*send\s*limit|requested\s*action\s*aborted|mailbox\s*unavailable/i.test(msg)) return true;
  return false;
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

  // Cuentas asignadas con SMTP ok
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

  // Filtro por daily limit
  const campaignDailyLimit = campaign.options.daily_limit_per_account ?? 30;
  function dailyLimitFor(a: EmailAccount) {
    return Math.min(getEffectiveDailyLimit(a), campaignDailyLimit);
  }
  function isUnderDailyLimit(a: EmailAccount): boolean {
    return (a.sent_today ?? 0) < dailyLimitFor(a);
  }

  /** True si la cuenta está en COOLDOWN largo (>10 min en next_eligible_at).
   *  El gap normal del worker es 6-9 min — esto se ignora en manual.
   *  Un cooldown >10 min siempre viene de un error de servidor (450, 421, etc.)
   *  → SÍ se respeta en manual para no seguir martilleando IONOS. */
  function isInLongCooldown(a: EmailAccount): boolean {
    if (!a.next_eligible_at) return false;
    const remainingMs = new Date(a.next_eligible_at).getTime() - Date.now();
    return remainingMs > 10 * 60_000; // >10 min = cooldown real
  }

  // Construye orden de cuentas a probar
  const isFirstStep = stepIdx === 0 || !lead.last_message_id;
  let accountOrder: EmailAccount[] = [];
  if (lead.sticky_account_id) {
    const sticky = assigned.find((a) => a.id === lead.sticky_account_id);
    if (sticky) accountOrder.push(sticky);
  }
  // En step 1 (sin sticky) O fallback en step 1 si sticky falla, añade el resto
  if (!lead.sticky_account_id || isFirstStep) {
    for (const a of assigned) {
      if (accountOrder.find((x) => x.id === a.id)) continue;
      accountOrder.push(a);
    }
  }
  const eligible = accountOrder.filter((a) => isUnderDailyLimit(a) && !isInLongCooldown(a));
  if (eligible.length === 0) {
    const cooldownDetails = accountOrder
      .filter(isInLongCooldown)
      .map((a) => ({
        email: a.email,
        cooldown_remaining_min: Math.ceil((new Date(a.next_eligible_at!).getTime() - Date.now()) / 60_000),
        last_error: a.last_smtp_error || "rate limit del servidor",
      }));
    const dailyExceeded = accountOrder.filter((a) => !isUnderDailyLimit(a)).map((a) => a.email);

    // Log el bloqueo en email-sent para que aparezca en /logs
    const blockMsg = cooldownDetails.length > 0
      ? `BLOQUEADO: ${cooldownDetails.length} cuenta(s) en cooldown IONOS — ${cooldownDetails.map((c) => `${c.email}(${c.cooldown_remaining_min}min)`).join(", ")}`
      : `BLOQUEADO: ${dailyExceeded.length} cuenta(s) alcanzaron daily limit`;
    try {
      await logSentMessage({
        type: "campaign",
        account_id: accountOrder[0]?.id || "",
        account_email: accountOrder[0]?.email || "(ninguna disponible)",
        to_address: lead.email,
        subject: `(manual bloqueado) step ${stepIdx + 1}`,
        body: "Manual send-now bloqueado: ninguna cuenta disponible",
        campaign_id: id,
        campaign_step: stepIdx + 1,
        lead_id: lead.id,
        lead_email: lead.email,
        ok: false,
        error: blockMsg,
      });
    } catch {}

    return NextResponse.json({
      error: `Ninguna cuenta disponible para enviar AHORA`,
      hint: cooldownDetails.length > 0
        ? `${cooldownDetails.length} cuenta${cooldownDetails.length > 1 ? "s" : ""} en cooldown por IONOS (servidor bloqueó por enviar demasiado). Espera o pulsa "Resetear cooldowns" en /connect-accounts.`
        : `${dailyExceeded.length} cuenta${dailyExceeded.length > 1 ? "s" : ""} alcanzaron daily limit. Espera a mañana.`,
      cooldown_details: cooldownDetails,
      daily_exceeded: dailyExceeded,
      action: cooldownDetails.length > 0 ? "wait_or_reset" : "wait_tomorrow",
    }, { status: 503 });
  }

  // ── Renderizar ──
  const subjectRaw = renderTemplate(variant.subject || "(sin asunto)", lead.variables, { seed: lead.id });
  let bodyHtml = renderTemplate(variant.body || "", lead.variables, { seed: lead.id });

  function trimAll(s: string): string {
    return s.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/gi, "").trim();
  }
  // Fallback a otra variante si la elegida quedó vacía tras render
  if (!trimAll(bodyHtml)) {
    for (const v of step.variants) {
      if (v.id === variant.id) continue;
      const candidate = renderTemplate(v.body || "", lead.variables, { seed: lead.id });
      if (trimAll(candidate)) { bodyHtml = candidate; break; }
    }
  }

  if (!subjectRaw.trim()) {
    return NextResponse.json({
      error: `El step ${stepIdx + 1} variante ${variant.label} no tiene SUBJECT`,
      hint: "Edita la campaña → Sequences → Step " + (stepIdx + 1) + " y rellena el subject"
    }, { status: 400 });
  }
  if (!trimAll(bodyHtml)) {
    const varsInBody = new Set<string>();
    for (const v of step.variants) {
      const re = /\{\{\s*([a-zA-Z0-9_]+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(v.body || "")) !== null) varsInBody.add(m[1]);
    }
    const leadVarsSet = new Set(Object.keys(lead.variables || {}));
    const missing = Array.from(varsInBody).filter((v) => !leadVarsSet.has(v) || !(lead.variables[v] || "").trim());
    return NextResponse.json({
      error: `Faltan variables en este lead`,
      hint: missing.length > 0
        ? `Tu mensaje usa: ${Array.from(varsInBody).map((v) => `{{${v}}}`).join(", ")}. Faltan: ${missing.map((v) => `{{${v}}}`).join(", ")}.`
        : `El body de la variante está literalmente vacío.`,
      action: "edit_lead",
      missing_variables: missing,
    }, { status: 400 });
  }

  // Threading
  const inReplyTo = isFirstStep ? "" : normalizeMsgId(lead.last_message_id || "");
  const referencesArr = isFirstStep
    ? []
    : (lead.thread_references || []).concat(inReplyTo ? [inReplyTo] : []).filter(Boolean);
  const subjectOut = isFirstStep ? subjectRaw : ensureRe(lead.thread_subject || subjectRaw);
  const textBody = bodyHtml.replace(/<[^>]+>/g, "");
  const useTextOnly = campaign.options.text_only_all || (campaign.options.text_only_first && isFirstStep);
  const htmlOut = useTextOnly
    ? undefined
    : `<div style="font-family:-apple-system,sans-serif;font-size:14px;line-height:1.55;color:#0a0d14;white-space:pre-wrap">${bodyHtml.replace(/\n/g, "<br>")}</div>`;

  // ── BUCLE: prueba cada cuenta hasta que una mande ──
  const attempts: Array<{ account: string; error: string }> = [];
  for (const tryAccount of eligible) {
    const t0 = Date.now();
    const transporter = nodemailer.createTransport({
      host: tryAccount.smtp_host,
      port: tryAccount.smtp_port,
      secure: tryAccount.smtp_secure,
      auth: { user: tryAccount.smtp_user, pass: cleanPass(tryAccount.smtp_password) },
      connectionTimeout: 10000, greetingTimeout: 8000, socketTimeout: 15000,
      family: 4, tls: { rejectUnauthorized: false },
      name: "onepulso.online",
    } as any);
    const fromName = tryAccount.display_name
      || [tryAccount.first_name, tryAccount.last_name].filter(Boolean).join(" ")
      || tryAccount.email.split("@")[0];
    const newMessageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${tryAccount.email.split("@")[1] || "onepulso.local"}>`;
    const headers: Record<string, string> = {
      "X-OnePulso-Campaign": campaign.id,
      "X-OnePulso-Lead": lead.id,
      "X-OnePulso-Variant": variant.id,
      "X-OnePulso-Step": String(stepIdx + 1),
      "X-OnePulso-Manual": "1",
    };
    if (campaign.options.insert_unsubscribe_header) {
      headers["List-Unsubscribe"] = `<mailto:${tryAccount.email}?subject=Unsubscribe>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }

    try {
      const info = await transporter.sendMail({
        from: `"${fromName}" <${tryAccount.email}>`,
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

      // === ÉXITO ===
      try { transporter.close(); } catch {}
      let appendResult: { ok: boolean; folder?: string } = { ok: false };
      try {
        const mime = [
          `From: "${fromName}" <${tryAccount.email}>`,
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
        appendResult = await appendToSent(tryAccount, mime);
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
          sticky_account_id: lead.sticky_account_id || tryAccount.id,
          finished_reason: isFinalStep ? "completed_sequence" : null,
          thread_subject: lead.thread_subject || subjectRaw,
          last_message_id: info.messageId || newMessageId,
          thread_references: [...(lead.thread_references || []), info.messageId || newMessageId],
        };
        await writeLeads(id, leads);
      }

      // Actualizar cuenta (sent_today + gap normal para próximos envíos)
      const tz = campaign.schedule.timezone || "Europe/Madrid";
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const gapMinutes = (campaign.options.min_gap_minutes ?? 6) + Math.random() * (campaign.options.random_gap_minutes ?? 3);
      const freshAcc = await getEmailAccount(tryAccount.id);
      if (freshAcc) {
        await upsertEmailAccount({
          ...freshAcc,
          sent_today: (freshAcc.sent_today ?? 0) + 1,
          sent_today_date: today,
          last_send_at: nowIso,
          next_eligible_at: new Date(Date.now() + gapMinutes * 60_000).toISOString(),
        });
      }

      await logSentMessage({
        type: "campaign",
        account_id: tryAccount.id,
        account_email: tryAccount.email,
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
        account: tryAccount.email,
        message_id: info.messageId || newMessageId,
        appended_to_sent: appendResult.ok,
        attempts_failed: attempts,  // si rotamos por algún fallo previo
        lead_status: leads[leads.findIndex((l) => l.id === leadId)]?.status,
      });
    } catch (e: any) {
      try { transporter.close(); } catch {}
      const ms = Date.now() - t0;
      const errMsg = `${e.code ? e.code + ": " : ""}${e.message}`;
      attempts.push({ account: tryAccount.email, error: errMsg });

      // Log el fallo en email-sent
      await logSentMessage({
        type: "campaign",
        account_id: tryAccount.id,
        account_email: tryAccount.email,
        to_address: lead.email,
        subject: subjectOut,
        body: textBody,
        campaign_id: id,
        campaign_step: stepIdx + 1,
        campaign_variant: variant.label,
        lead_id: lead.id,
        lead_email: lead.email,
        ok: false,
        error: errMsg,
        ms,
      });

      // ¿Es error de rate limit del servidor (IONOS)?
      if (isServerRateLimitError(e)) {
        // Cooldown 30 min en esa cuenta
        const fresh = await getEmailAccount(tryAccount.id);
        if (fresh) {
          await upsertEmailAccount({
            ...fresh,
            next_eligible_at: new Date(Date.now() + 30 * 60_000).toISOString(),
            last_smtp_error: `Rate limit del servidor — cooldown 30min`,
          });
        }

        // Calcula stats reales de la cuenta en la última hora
        try {
          const { listSent } = await import("@/lib/email-sent-log");
          const allSent = await listSent();
          const cutoff = Date.now() - 60 * 60_000;
          const lastHour = allSent.filter(
            (s) => s.account_id === tryAccount.id && new Date(s.sent_at).getTime() > cutoff && s.ok,
          ).length;

          // Si NO es step 1, no podemos rotar
          if (!isFirstStep) {
            return NextResponse.json({
              ok: false,
              error: `IONOS bloqueó temporalmente ${tryAccount.email} (rate limit del servidor).`,
              hint: `Esta cuenta envió ${lastHour} emails en la última hora — IONOS tiene un límite de ~30/h por cuenta. Es step ${stepIdx + 1} y para preservar el threading SOLO puede enviarse desde esta cuenta. Cooldown automático aplicado: ~30 min.`,
              attempts_failed: attempts,
              account: tryAccount.email,
              account_stats: {
                sent_last_hour: lastHour,
                sent_today: tryAccount.sent_today ?? 0,
                cooldown_min: 30,
              },
              server_error: errMsg,
            }, { status: 503 });
          }
        } catch {}
        // En step 1, sigue probando la siguiente cuenta
        continue;
      }

      // Errores no relacionados con rate limit (bounce 5xx, dns, etc.):
      // no merecen probar otras cuentas — el problema es del destinatario.
      return NextResponse.json({
        ok: false,
        error: errMsg,
        ms,
        attempts_failed: attempts,
      }, { status: 500 });
    }
  }

  // Si llegamos aquí, ninguna cuenta funcionó
  return NextResponse.json({
    ok: false,
    error: "Ninguna de las cuentas asignadas pudo enviar el email.",
    hint: "Todas devolvieron rate limit del servidor (IONOS está limitando). Espera ~30 min y reintenta.",
    attempts_failed: attempts,
    accounts_tried: eligible.length,
  }, { status: 503 });
}
