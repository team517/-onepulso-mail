/**
 * Worker de envíos para campañas de email — pulido a nivel Instantly.
 *
 * Reglas:
 *   1. Solo procesa campañas con status="active".
 *   2. Solo usa cuentas asignadas a la campaña (por id O por tag).
 *   3. Gap RANDOM 6–9 min entre envíos por cuenta — persistente entre restarts
 *      (vive en EmailAccount.next_eligible_at + last_send_at, no en memoria).
 *   4. Respeta schedule: días + horas + timezone (Europe/Madrid por defecto).
 *   5. Respeta daily_limit_per_account; sent_today se resetea al cambiar de día
 *      en la TZ del schedule de la campaña — NO en UTC.
 *   6. Sticky sender. Si el sticky está borrado, fallback al pool.
 *   7. Variante por hash determinista del lead.
 *   8. Espera delay_days/delay_hours entre steps.
 *   9. Para de enviar si lead.status ∈ {replied, bounced, unsubscribed, completed, paused}.
 *  10. THREADING: step 2..N llegan como "Re: <subject>" con In-Reply-To +
 *      References al Message-ID guardado del step anterior. Igual que Instantly.
 *  11. APPEND a la carpeta Sent del IMAP para que el correo aparezca en el
 *      mailbox externo (no solo en /bandejas).
 *  12. Mutex: solo un tick corre a la vez. Si el anterior tarda >30s, el
 *      siguiente se salta para no duplicar envíos.
 *  13. Fallos de SMTP se loguean en /bandejas → Enviados (con ok:false +
 *      error) además del log en memoria.
 */
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import {
  Campaign, Lead, Step, Variant,
  getCampaign, listCampaigns, listLeads, writeLeads,
  pickVariant, renderTemplate, saveCampaign,
} from "./email-campaigns";
import { EmailAccount, getEffectiveDailyLimit, listEmailAccounts, upsertEmailAccount, getEmailAccount } from "./email-accounts";
import { syncAllInboxes } from "./email-inbox-sync";
import { detectRepliesForAccounts } from "./email-reply-detector";
import { listFollowUps, updateFollowUp } from "./email-followups";
import { listMessagesForAccount } from "./email-inbox-store";
import { sendThreadReply } from "./email-thread-send";
import { logSentMessage } from "./email-sent-log";
import { isBlocked, listBlocklist } from "./email-blocklist";

/** Estado en memoria del worker — espejo de lo que se persiste en EmailAccount. */
type AccountRuntimeState = {
  last_send_at: string | null;
  sent_today: number;
  today: string;                // yyyy-mm-dd en la TZ de la campaña
  next_eligible_at: string | null;
};

type WorkerState = {
  running: boolean;
  loops: number;
  last_loop_at: string | null;
  /** Estado runtime por cuenta — se sincroniza con EmailAccount al inicio y tras cada send. */
  accounts: Map<string, AccountRuntimeState>;
  /** Cursor round-robin por campaña (in-memory; no crítico si se reinicia). */
  rrCursors: Map<string, number>;
  /** Log de últimos eventos para debug. */
  log: WorkerLogEntry[];
};

export type WorkerLogEntry = {
  at: string;
  level: "info" | "warn" | "error" | "send";
  message: string;
  campaign_id?: string;
  campaign_name?: string;
  lead_id?: string;
  lead_email?: string;
  account_id?: string;
  account_email?: string;
  step?: number;
  variant?: string;
};

const STATE: WorkerState = {
  running: false,
  loops: 0,
  last_loop_at: null,
  accounts: new Map(),
  rrCursors: new Map(),
  log: [],
};

/** Mutex: solo un tick corre a la vez. */
let TICK_IN_FLIGHT = false;

function log(entry: Omit<WorkerLogEntry, "at">) {
  STATE.log.push({ ...entry, at: new Date().toISOString() });
  if (STATE.log.length > 500) STATE.log.shift();
}

export function getWorkerStatus() {
  return {
    running: STATE.running,
    loops: STATE.loops,
    last_loop_at: STATE.last_loop_at,
    tracked_accounts: STATE.accounts.size,
    recent_log: STATE.log.slice(-50).reverse(),
  };
}

/** Devuelve "yyyy-mm-dd" en la timezone indicada (Europe/Madrid por defecto). */
function dayInTz(date: Date, tz: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {  // en-CA → YYYY-MM-DD
      timeZone: tz || "Europe/Madrid",
      year: "numeric", month: "2-digit", day: "2-digit",
    });
    return fmt.format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** ¿Hoy y ahora caen dentro del schedule de la campaña? */
function inSchedule(now: Date, schedule: Campaign["schedule"]): boolean {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: schedule.timezone || "Europe/Madrid",
      weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const wkMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const weekdayStr = parts.find((p) => p.type === "weekday")?.value;
    if (!weekdayStr || !(weekdayStr in wkMap)) return false; // si falla TZ, NO enviar
    const weekday = wkMap[weekdayStr];
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "-1");
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0");
    if (hour < 0) return false;
    if (!schedule.days.includes(weekday)) return false;
    // start_hour incluido, end_hour excluido (igual que Instantly).
    const minutesNow = hour * 60 + minute;
    const minStart = schedule.start_hour * 60;
    const minEnd = schedule.end_hour * 60;
    if (minutesNow < minStart) return false;
    if (minutesNow >= minEnd) return false;
    return true;
  } catch {
    return false;
  }
}

/** Calcula cuándo debería enviarse el siguiente step de un lead. */
function nextSendTime(lead: Lead, step: Step): Date {
  if (!lead.last_contacted_at) return new Date(0); // primer envío: ya
  const last = new Date(lead.last_contacted_at);
  const ms = (step.delay_days * 24 + step.delay_hours) * 60 * 60 * 1000;
  return new Date(last.getTime() + ms);
}

/**
 * Lee el estado runtime de una cuenta — recuperando de disk (EmailAccount)
 * si no está en memoria. Esto garantiza que tras un restart de Railway:
 *   · No se reinician los gaps (cuenta sigue rate-limited hasta next_eligible_at)
 *   · sent_today se preserva (no se vuelven a enviar 30 emails de golpe)
 */
function getAccountState(account: EmailAccount, tz: string): AccountRuntimeState {
  const today = dayInTz(new Date(), tz);
  let s = STATE.accounts.get(account.id);
  if (!s) {
    // Recover de disk
    const savedDate = account.sent_today_date || today;
    s = {
      last_send_at: account.last_send_at || null,
      sent_today: savedDate === today ? (account.sent_today ?? 0) : 0,
      today,
      next_eligible_at: account.next_eligible_at || null,
    };
    STATE.accounts.set(account.id, s);
  }
  // Cambio de día → reset sent_today
  if (s.today !== today) {
    s.today = today;
    s.sent_today = 0;
  }
  return s;
}

function cleanPass(p: string) { return (p || "").replace(/\s+/g, ""); }

/** Detecta y construye el path de la carpeta Sent (varios proveedores). */
async function findSentFolder(client: ImapFlow): Promise<string | null> {
  const list = (await client.list()) as any[];
  for (const m of list) if (m.specialUse === "\\Sent") return m.path;
  for (const m of list) {
    if (/\b(Sent\s?Mail|Sent|Enviados|Gesendet|Verzonden|Inviata|Envoy[ée]s)\b/i.test(m.path)) return m.path;
  }
  if (list.some((m) => m.path?.startsWith("[Gmail]"))) return "[Gmail]/Sent Mail";
  return null;
}

/** APPEND best-effort del MIME enviado al Sent del IMAP. */
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
      new Promise((_, rej) => setTimeout(() => rej(new Error("IMAP connect timeout 10s")), 10000)),
    ]);
    const sent = await findSentFolder(client);
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

function normalizeMsgId(id: string): string {
  if (!id) return "";
  return id.trim().startsWith("<") ? id.trim() : `<${id.trim()}>`;
}

function ensureRe(s: string): string {
  if (!s) return "Re:";
  if (/^re:\s*/i.test(s)) return s;
  return `Re: ${s}`;
}

/** Envía un step de campaña, con threading inter-paso si toca. */
async function sendOne(
  account: EmailAccount, lead: Lead, variant: Variant, campaign: Campaign, stepIdx: number,
): Promise<{ ok: boolean; error?: string; message_id?: string; thread_subject?: string; references?: string[]; appended?: boolean; sent_folder?: string }> {
  const subjectRaw = renderTemplate(variant.subject || "(sin asunto)", lead.variables, { seed: lead.id });
  const bodyHtml = renderTemplate(variant.body || "", lead.variables, { seed: lead.id });
  if (!subjectRaw.trim() || !bodyHtml.trim()) {
    return { ok: false, error: "Variante con subject o body vacío" };
  }

  // ── Threading: step 0 abre hilo. Step 1+ → Re: + In-Reply-To + References
  const isFirstStep = stepIdx === 0 || !lead.last_message_id;
  const inReplyTo = isFirstStep ? "" : normalizeMsgId(lead.last_message_id || "");
  const referencesArr = isFirstStep
    ? []
    : (lead.thread_references || []).concat(inReplyTo ? [inReplyTo] : []).filter(Boolean);
  // Subject: en pasos posteriores reutilizamos el subject del primero (sin re-rendear
  // por si tiene variables que han cambiado, mantenemos la coherencia del hilo).
  const subjectOut = isFirstStep
    ? subjectRaw
    : ensureRe(lead.thread_subject || subjectRaw);

  const t = nodemailer.createTransport({
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

  // Message-ID propio para que coincida con el append y futuros pasos puedan
  // referenciarlo.
  const newMessageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${account.email.split("@")[1] || "onepulso.local"}>`;

  const headers: Record<string, string> = {
    "X-OnePulso-Campaign": campaign.id,
    "X-OnePulso-Lead": lead.id,
    "X-OnePulso-Variant": variant.id,
    "X-OnePulso-Step": String(stepIdx + 1),
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

  try {
    const info = await t.sendMail({
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

    // APPEND best-effort al Sent (igual que en sendThreadReply)
    let appended = false;
    let sentFolder: string | undefined;
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
      const r = await appendToSent(account, mime);
      appended = r.ok;
      sentFolder = r.folder;
    } catch {}

    return {
      ok: true,
      message_id: info.messageId || newMessageId,
      thread_subject: isFirstStep ? subjectRaw : (lead.thread_subject || subjectRaw),
      references: referencesArr.concat([info.messageId || newMessageId]),
      appended,
      sent_folder: sentFolder,
    };
  } catch (e: any) {
    return { ok: false, error: `${e.code ? e.code + ": " : ""}${e.message}` };
  } finally {
    try { t.close(); } catch {}
  }
}

/** Procesa UNA campaña: hace 0..N envíos según rate-limits. */
async function processCampaign(campaign: Campaign, allAccounts: EmailAccount[]) {
  const now = new Date();
  if (!inSchedule(now, campaign.schedule)) {
    return; // fuera de horario → nada
  }
  if (campaign.steps.length === 0 || campaign.steps.every((s) => s.variants.every((v) => !v.subject && !v.body))) {
    return; // campaña sin contenido
  }

  const tz = campaign.schedule.timezone || "Europe/Madrid";

  // Cuentas asignadas: por ID explícito O por tag. Las que tengan SMTP ok.
  const tagSet = new Set(campaign.account_tags || []);
  const idSet = new Set(campaign.account_ids || []);
  const assigned = allAccounts.filter((a) => {
    if (!a.smtp_ok) return false;
    if (idSet.has(a.id)) return true;
    if (tagSet.size > 0 && (a.tags || []).some((t) => tagSet.has(t))) return true;
    return false;
  });
  if (assigned.length === 0) return;

  const leads = await listLeads(campaign.id);
  if (leads.length === 0) return;

  // Blocklist global — saltamos cualquier lead bloqueado.
  const blocklist = await listBlocklist();

  // Leads candidatos
  const candidates: { lead: Lead; step: Step; stepIdx: number; variant: Variant }[] = [];
  for (const lead of leads) {
    if (["bounced", "replied", "unsubscribed", "completed", "paused"].includes(lead.status)) continue;
    if (isBlocked(lead.email, blocklist)) {
      lead.status = "unsubscribed";
      lead.finished_reason = "blocklist";
      continue;
    }
    const stepIdx = lead.current_step;
    if (stepIdx >= campaign.steps.length) continue;
    const step = campaign.steps[stepIdx];
    if (nextSendTime(lead, step) > now) continue;
    const variant = pickVariant(step, lead.id);
    candidates.push({ lead, step, stepIdx, variant });
  }
  if (candidates.length === 0) {
    await writeLeads(campaign.id, leads);
    return;
  }

  // Defaults pro-Instantly: 6–9 min gap, 30/día/cuenta.
  const minGap = campaign.options.min_gap_minutes ?? 6;
  const randomGap = campaign.options.random_gap_minutes ?? 3;
  const campaignDailyLimit = campaign.options.daily_limit_per_account ?? 30;
  const rotation = campaign.options.account_rotation;

  function getDailyLimitFor(account: EmailAccount): number {
    return Math.min(getEffectiveDailyLimit(account), campaignDailyLimit);
  }

  /** Cuenta lista para mandar AHORA. */
  function accountReady(account: EmailAccount): boolean {
    const s = getAccountState(account, tz);
    if (s.sent_today >= getDailyLimitFor(account)) return false;
    if (s.next_eligible_at && new Date(s.next_eligible_at) > now) return false;
    return true;
  }

  // ── ASIGNACIÓN: Paso 1 — sticky (con fallback si no existe) · Paso 2 — rotación
  type Pair = { account: EmailAccount; candidate: typeof candidates[number] };
  const planned: Pair[] = [];
  const usedAccounts = new Set<string>();
  const usedLeads = new Set<string>();

  // Mapa rápido para fallback de sticky
  const assignedById = new Map(assigned.map((a) => [a.id, a]));

  // PASO 1: sticky → su cuenta. Si la cuenta sticky NO está en assigned (fue
  // borrada o desasignada), limpiamos el sticky para que entre al pool fresco.
  for (const c of candidates) {
    if (!c.lead.sticky_account_id) continue;
    const stickyAccount = assignedById.get(c.lead.sticky_account_id);
    if (!stickyAccount) {
      // Sticky huérfano → resetear y dejar que el round-robin lo coja
      c.lead.sticky_account_id = undefined;
      continue;
    }
    if (usedAccounts.has(stickyAccount.id) || usedLeads.has(c.lead.id)) continue;
    if (!accountReady(stickyAccount)) continue; // espera al siguiente tick (preserva threading)
    planned.push({ account: stickyAccount, candidate: c });
    usedAccounts.add(stickyAccount.id);
    usedLeads.add(c.lead.id);
  }

  // PASO 2: leads sin sticky → rotación
  const freshLeads = candidates.filter((c) => !c.lead.sticky_account_id && !usedLeads.has(c.lead.id));
  if (freshLeads.length > 0) {
    let pool: EmailAccount[];
    if (rotation === "random") {
      pool = assigned.filter((a) => !usedAccounts.has(a.id) && accountReady(a));
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
    } else if (rotation === "weighted") {
      // Weighted: prioriza cuentas con MÁS daily limit disponible. Cuentas con
      // más cuota usan más rotación. Defensa: orden estable + ready-filter.
      pool = assigned
        .filter((a) => !usedAccounts.has(a.id) && accountReady(a))
        .sort((a, b) => {
          const aLeft = getDailyLimitFor(a) - getAccountState(a, tz).sent_today;
          const bLeft = getDailyLimitFor(b) - getAccountState(b, tz).sent_today;
          return bLeft - aLeft; // más cuota disponible primero
        });
    } else {
      // round-robin
      const cursor = STATE.rrCursors.get(campaign.id) ?? 0;
      const startIdx = cursor % assigned.length;
      pool = assigned.slice(startIdx).concat(assigned.slice(0, startIdx))
        .filter((a) => !usedAccounts.has(a.id) && accountReady(a));
    }

    let leadIdx = 0;
    for (const account of pool) {
      if (leadIdx >= freshLeads.length) break;
      const target = freshLeads[leadIdx++];
      planned.push({ account, candidate: target });
      usedAccounts.add(account.id);
      usedLeads.add(target.lead.id);
    }

    if (rotation === "round-robin") {
      const cursor = STATE.rrCursors.get(campaign.id) ?? 0;
      const advanced = planned.filter((p) => !p.candidate.lead.sticky_account_id).length;
      if (advanced > 0) {
        STATE.rrCursors.set(campaign.id, (cursor + advanced) % assigned.length);
      }
    }
  }

  // ── EJECUCIÓN
  for (const { account, candidate: target } of planned) {
    if (!accountReady(account)) continue;

    const accState = getAccountState(account, tz);
    const sendResult = await sendOne(account, target.lead, target.variant, campaign, target.stepIdx);
    const nowIso = new Date().toISOString();

    if (sendResult.ok) {
      const renderedSubject = renderTemplate(target.variant.subject || "(sin asunto)", target.lead.variables, { seed: target.lead.id });
      const renderedBody = renderTemplate(target.variant.body || "", target.lead.variables, { seed: target.lead.id });

      await logSentMessage({
        type: "campaign",
        account_id: account.id,
        account_email: account.email,
        to_address: target.lead.email,
        subject: target.stepIdx === 0 ? renderedSubject : ensureRe(target.lead.thread_subject || renderedSubject),
        body: renderedBody,
        message_id: sendResult.message_id,
        in_reply_to: target.stepIdx > 0 ? (target.lead.last_message_id || undefined) : undefined,
        references: target.stepIdx > 0 ? target.lead.thread_references || undefined : undefined,
        campaign_id: campaign.id,
        campaign_step: target.stepIdx + 1,
        campaign_variant: target.variant.label,
        lead_id: target.lead.id,
        lead_email: target.lead.email,
        ok: true,
        appended_to_sent: sendResult.appended,
        sent_folder: sendResult.sent_folder,
      });

      // Actualizar lead
      const leadIdx = leads.findIndex((l) => l.id === target.lead.id);
      if (leadIdx >= 0) {
        const isFinalStep = target.stepIdx + 1 >= campaign.steps.length;
        leads[leadIdx] = {
          ...target.lead,
          status: isFinalStep ? "completed" : "active",
          current_step: target.stepIdx + 1,
          last_contacted_at: nowIso,
          last_event: `sent step ${target.stepIdx + 1} variant ${target.variant.label}`,
          sticky_account_id: target.lead.sticky_account_id || account.id,
          finished_reason: isFinalStep ? "completed_sequence" : null,
          // Threading: el primer envío FIJA el subject del hilo; los siguientes
          // alargan References con su propio Message-ID.
          thread_subject: target.lead.thread_subject || renderedSubject,
          last_message_id: sendResult.message_id || null,
          thread_references: sendResult.references || target.lead.thread_references || null,
        };
      }

      // Métricas
      campaign.metrics = campaign.metrics || {
        total_leads: 0, active_leads: 0, contacted: 0, opened: 0, clicked: 0,
        replied: 0, bounced: 0, unsubscribed: 0, completed: 0,
      };
      campaign.metrics.contacted = (campaign.metrics.contacted || 0) + 1;
      if (leads.find((l) => l.id === target.lead.id)?.status === "completed") {
        campaign.metrics.completed = (campaign.metrics.completed || 0) + 1;
      }

      // ── Estado de la cuenta — PERSISTIDO en EmailAccount (sobrevive a restart)
      accState.sent_today += 1;
      accState.last_send_at = nowIso;
      const gapMinutes = minGap + Math.random() * randomGap;
      accState.next_eligible_at = new Date(now.getTime() + gapMinutes * 60_000).toISOString();

      // Espejo a disk
      const fresh = await getEmailAccount(account.id);
      if (fresh) {
        await upsertEmailAccount({
          ...fresh,
          sent_today: accState.sent_today,
          sent_today_date: accState.today,
          last_send_at: accState.last_send_at,
          next_eligible_at: accState.next_eligible_at,
        });
      }

      log({
        level: "send", message: `Email enviado · gap ${gapMinutes.toFixed(1)}m`,
        campaign_id: campaign.id, campaign_name: campaign.name,
        lead_id: target.lead.id, lead_email: target.lead.email,
        account_id: account.id, account_email: account.email,
        step: target.stepIdx + 1, variant: target.variant.label,
      });
    } else {
      // FALLO — siempre se loguea en /bandejas → Enviados (visibilidad para el usuario)
      const renderedSubject = renderTemplate(target.variant.subject || "(sin asunto)", target.lead.variables, { seed: target.lead.id });
      const renderedBody = renderTemplate(target.variant.body || "", target.lead.variables, { seed: target.lead.id });
      await logSentMessage({
        type: "campaign",
        account_id: account.id,
        account_email: account.email,
        to_address: target.lead.email,
        subject: renderedSubject,
        body: renderedBody,
        campaign_id: campaign.id,
        campaign_step: target.stepIdx + 1,
        campaign_variant: target.variant.label,
        lead_id: target.lead.id,
        lead_email: target.lead.email,
        ok: false,
        error: sendResult.error,
      });

      const permanent = /5\.[157]\.\d|EAUTH|EENVELOPE|550|551|553/i.test(sendResult.error || "");
      if (permanent) {
        const leadIdx = leads.findIndex((l) => l.id === target.lead.id);
        if (leadIdx >= 0) {
          leads[leadIdx].status = "bounced";
          leads[leadIdx].last_event = `bounce: ${sendResult.error}`;
          leads[leadIdx].finished_reason = sendResult.error;
        }
        campaign.metrics = campaign.metrics || {
          total_leads: 0, active_leads: 0, contacted: 0, opened: 0, clicked: 0,
          replied: 0, bounced: 0, unsubscribed: 0, completed: 0,
        };
        campaign.metrics.bounced = (campaign.metrics.bounced || 0) + 1;
      }
      log({
        level: "error", message: `Fallo envío: ${sendResult.error}`,
        campaign_id: campaign.id, campaign_name: campaign.name,
        lead_id: target.lead.id, lead_email: target.lead.email,
        account_id: account.id, account_email: account.email,
      });
      // Gap más corto tras fallo para no martillar
      accState.next_eligible_at = new Date(now.getTime() + 2 * 60_000).toISOString();
      const fresh = await getEmailAccount(account.id);
      if (fresh) {
        await upsertEmailAccount({ ...fresh, next_eligible_at: accState.next_eligible_at });
      }
    }
  }

  // Persistencia final por campaña
  await writeLeads(campaign.id, leads);
  campaign.metrics = campaign.metrics || {
    total_leads: 0, active_leads: 0, contacted: 0, opened: 0, clicked: 0,
    replied: 0, bounced: 0, unsubscribed: 0, completed: 0,
  };
  campaign.metrics.total_leads = leads.length;
  campaign.metrics.active_leads = leads.filter((l) => l.status === "active" || l.status === "new").length;
  await saveCampaign(campaign);
}

/** Una iteración del worker — con mutex global. */
export async function tickWorker() {
  if (TICK_IN_FLIGHT) {
    log({ level: "warn", message: "Tick saltado (anterior aún en curso)" });
    return;
  }
  TICK_IN_FLIGHT = true;
  STATE.last_loop_at = new Date().toISOString();
  STATE.loops += 1;
  try {
    const { listAllWorkspaces, withWorkspace } = await import("./workspace");
    const workspaces = await listAllWorkspaces();
    for (const ws of workspaces) {
      try {
        await withWorkspace(ws, () => tickWorkspace());
      } catch (e: any) {
        log({ level: "error", message: `Tick workspace ${ws} error: ${e.message}` });
      }
    }
  } finally {
    TICK_IN_FLIGHT = false;
  }
}

/** Procesa un único workspace. */
async function tickWorkspace() {
  try {
    const accounts = await listEmailAccounts();
    const campaigns = await listCampaigns();
    const active = campaigns.filter((c) => c.status === "active");

    for (const c of active) {
      const fresh = await getCampaign(c.id);
      if (!fresh || fresh.status !== "active") continue;
      try {
        await processCampaign(fresh, accounts);
      } catch (e: any) {
        log({ level: "error", message: `Excepción procesando campaña: ${e.message}`, campaign_id: c.id, campaign_name: c.name });
      }
    }

    // Sync IMAP cada 4 loops (≈ 2 min)
    if (STATE.loops % 4 === 0 || STATE.loops === 1) {
      try {
        const inboxResults = await syncAllInboxes(accounts, 3);
        const totalNew = inboxResults.reduce((s, r) => s + r.new_count, 0);
        const totalFiltered = inboxResults.reduce((s, r) => s + r.warmup_filtered + r.bounce_filtered, 0);
        if (totalNew > 0 || totalFiltered > 0) {
          log({ level: "info", message: `Sync IMAP: +${totalNew} nuevos, ${totalFiltered} filtrados` });
        }
        if (totalNew > 0) {
          const det = await detectRepliesForAccounts(accounts.map((a) => a.id));
          if (det.detections.length > 0) {
            for (const d of det.detections) {
              log({
                level: "info",
                message: `🟢 Reply detectado de ${d.lead_email} en "${d.campaign_name}"`,
                campaign_id: d.campaign_id, campaign_name: d.campaign_name,
                lead_email: d.lead_email, account_email: d.via_account,
              });
            }
          }
          // Detectar bounces NDR (mailer-daemon) — marca leads bounced
          try {
            const bouncesDetected = await detectBouncesFromInbox(accounts.map((a) => a.id));
            for (const b of bouncesDetected) {
              log({
                level: "warn",
                message: `📬 Bounce NDR detectado: ${b.lead_email} (${b.reason})`,
                campaign_id: b.campaign_id, campaign_name: b.campaign_name,
                lead_email: b.lead_email,
              });
            }
          } catch (e: any) {
            log({ level: "warn", message: `Detección de bounces falló: ${e.message}` });
          }
        }
      } catch (e: any) {
        log({ level: "warn", message: `Sync IMAP falló: ${e.message}` });
      }
    }

    try {
      await processFollowUps();
    } catch (e: any) {
      log({ level: "error", message: `Follow-ups error: ${e.message}` });
    }
  } catch (e: any) {
    log({ level: "error", message: `Tick error: ${e.message}` });
  }
}

/** Detecta NDR (mailer-daemon, delivery failure) en la bandeja y marca leads bounced. */
async function detectBouncesFromInbox(accountIds: string[]): Promise<Array<{ lead_email: string; campaign_id: string; campaign_name: string; reason: string }>> {
  const out: Array<{ lead_email: string; campaign_id: string; campaign_name: string; reason: string }> = [];
  const campaigns = await listCampaigns();
  // Indexa leads activos por email
  type LeadRef = { campaignId: string; campaignName: string; leadId: string; leadEmail: string };
  const leadIndex = new Map<string, LeadRef>();
  for (const c of campaigns) {
    const leads = await listLeads(c.id);
    for (const l of leads) {
      if (["bounced", "unsubscribed", "completed"].includes(l.status)) continue;
      leadIndex.set(l.email.toLowerCase(), { campaignId: c.id, campaignName: c.name, leadId: l.id, leadEmail: l.email });
    }
  }
  if (leadIndex.size === 0) return out;

  // Heurística: subject empieza por "Mail Delivery", "Undelivered", etc; body contiene email del lead.
  const NDR_SUBJ = /(mail\s*delivery|undeliverable|delivery\s*status|failure\s*notice|returned\s*mail|undelivered)/i;
  for (const accId of accountIds) {
    const msgs = await listMessagesForAccount(accId);
    for (const m of msgs) {
      if (!NDR_SUBJ.test(m.subject || "") && !/mailer-daemon|postmaster/i.test(m.from_address || "")) continue;
      const text = `${m.subject || ""} ${m.preview || ""} ${m.text || ""}`.toLowerCase();
      for (const [email, ref] of leadIndex.entries()) {
        if (!text.includes(email)) continue;
        // Marca como bounced
        const leads = await listLeads(ref.campaignId);
        const lidx = leads.findIndex((l) => l.id === ref.leadId);
        if (lidx >= 0 && leads[lidx].status !== "bounced") {
          leads[lidx].status = "bounced";
          leads[lidx].last_event = `NDR bounce detectado`;
          leads[lidx].finished_reason = "NDR";
          await writeLeads(ref.campaignId, leads);
          out.push({ lead_email: ref.leadEmail, campaign_id: ref.campaignId, campaign_name: ref.campaignName, reason: "NDR" });
        }
        leadIndex.delete(email);
      }
    }
  }
  return out;
}

/** Procesa follow-ups pendientes. */
async function processFollowUps() {
  const all = await listFollowUps();
  const pending = all.filter((f) => f.status === "pending");
  if (pending.length === 0) return;
  const now = new Date();

  for (const fu of pending) {
    const dueAt = new Date(fu.scheduled_for);
    if (dueAt > now) continue;

    if (fu.only_if_no_reply) {
      try {
        const accountMsgs = await listMessagesForAccount(fu.account_id);
        const created = new Date(fu.created_at).getTime();
        const newerInThread = accountMsgs.some((m) =>
          m.thread_id === fu.thread_id &&
          m.id !== fu.source_message_id &&
          new Date(m.date).getTime() > created
        );
        if (newerInThread) {
          await updateFollowUp(fu.id, {
            status: "cancelled",
            cancelled_at: new Date().toISOString(),
            cancellation_reason: "Llegó respuesta en el thread — follow-up auto-cancelado",
          });
          log({
            level: "info",
            message: `Follow-up auto-cancelado (respuesta detectada): ${fu.to_address}`,
            account_id: fu.account_id, account_email: fu.account_email,
          });
          continue;
        }
      } catch (e: any) {
        log({ level: "warn", message: `No pudimos verificar respuestas para FU ${fu.id}: ${e.message}` });
        continue;
      }
    }

    const account = await getEmailAccount(fu.account_id);
    if (!account) {
      await updateFollowUp(fu.id, { status: "failed", last_error: "Cuenta no encontrada" });
      continue;
    }
    if (!account.smtp_ok) {
      await updateFollowUp(fu.id, { status: "failed", last_error: `SMTP en error: ${account.last_smtp_error || ""}` });
      continue;
    }

    const result = await sendThreadReply({
      account,
      to: fu.to_address,
      subject: fu.subject,
      body: fu.body,
      in_reply_to: fu.in_reply_to,
      references: fu.references,
    });

    if (result.ok) {
      await updateFollowUp(fu.id, {
        status: "sent",
        sent_at: new Date().toISOString(),
        message_id: result.message_id || null,
      });
      await logSentMessage({
        type: "followup",
        account_id: account.id,
        account_email: account.email,
        to_address: fu.to_address,
        subject: fu.subject.startsWith("Re:") ? fu.subject : `Re: ${fu.subject}`,
        body: fu.body,
        message_id: result.message_id,
        in_reply_to: fu.in_reply_to,
        references: fu.references,
        thread_id: fu.thread_id,
        source_inbox_message_id: fu.source_message_id,
        followup_id: fu.id,
        ok: true,
        appended_to_sent: result.sent_appended,
        sent_folder: result.sent_folder,
        ms: result.ms,
      });
      log({
        level: "send", message: `Follow-up enviado a ${fu.to_address}`,
        account_id: account.id, account_email: account.email,
      });
    } else {
      await updateFollowUp(fu.id, { status: "failed", last_error: result.error });
      await logSentMessage({
        type: "followup",
        account_id: account.id,
        account_email: account.email,
        to_address: fu.to_address,
        subject: fu.subject,
        body: fu.body,
        thread_id: fu.thread_id,
        source_inbox_message_id: fu.source_message_id,
        followup_id: fu.id,
        ok: false, error: result.error, ms: result.ms,
      });
      log({
        level: "error", message: `Follow-up falló: ${result.error}`,
        account_id: account.id, account_email: account.email,
      });
    }
  }
}

/** Loop continuo del worker. */
let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startWorker(intervalSeconds = 30) {
  if (STATE.running) return;
  STATE.running = true;
  log({ level: "info", message: `Worker iniciado · intervalo ${intervalSeconds}s` });
  tickWorker().catch(() => {});
  intervalHandle = setInterval(() => { tickWorker().catch(() => {}); }, intervalSeconds * 1000);
}

export function stopWorker() {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  STATE.running = false;
  log({ level: "info", message: "Worker detenido" });
}
