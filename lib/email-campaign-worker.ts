/**
 * Worker de envíos para campañas de email.
 *
 * Reglas (igual que Instantly + lo que pidió el usuario):
 *   1. Solo procesa campañas con status="active".
 *   2. Solo usa cuentas asignadas a la campaña (campaign.account_ids).
 *   3. Por cada cuenta, hay un GAP RANDOM de 6–9 minutos entre envíos.
 *      Configurable vía options.min_gap_minutes / random_gap_minutes.
 *   4. Respeta el schedule: días de la semana + franja horaria + timezone.
 *   5. Respeta daily_limit_per_account (resetea cada día UTC).
 *   6. Sticky sender: si el lead ya tiene sticky_account_id, lo usa siempre.
 *      Si no, asigna uno por round-robin / random y lo fija.
 *   7. Variante elegida por hash determinista del lead (estabilidad A/B).
 *   8. Espera delay_days/delay_hours entre steps (calculado desde last_contacted_at).
 *   9. Si options.stop_on_reply o el lead tiene status "replied"/"bounced"/"unsubscribed",
 *      no envía.
 *
 * El worker corre en intervalos cortos (cada 30s) y decide qué/cuándo enviar.
 * Es deliberadamente conservador: si tiene duda, no envía. Mejor perder un
 * minuto que quemar una cuenta.
 */
import nodemailer from "nodemailer";
import {
  Campaign, Lead, Step, Variant,
  getCampaign, listCampaigns, listLeads, writeLeads,
  pickAccount, pickVariant, renderTemplate, saveCampaign,
} from "./email-campaigns";
import { EmailAccount, listEmailAccounts, upsertEmailAccount, getEmailAccount } from "./email-accounts";
import { syncAllInboxes } from "./email-inbox-sync";
import { listFollowUps, updateFollowUp } from "./email-followups";
import { listMessagesForAccount } from "./email-inbox-store";
import { sendThreadReply } from "./email-thread-send";
import { logSentMessage } from "./email-sent-log";
import { isBlocked, listBlocklist, type BlockEntry } from "./email-blocklist";

/** Estado en memoria del worker — historial de envíos por cuenta (para gaps). */
type AccountState = {
  /** ISO timestamp del último envío. */
  last_send_at: string | null;
  /** Cuenta de envíos del día (yyyy-mm-dd). */
  sent_today: number;
  /** Día UTC en formato yyyy-mm-dd. */
  today: string;
  /** Próximo timestamp en el que la cuenta puede enviar (gap random aplicado). */
  next_eligible_at: string | null;
  /** Cursor round-robin (compartido por campaña). */
};

type WorkerState = {
  running: boolean;
  loops: number;
  last_loop_at: string | null;
  /** Estado por cuenta. */
  accounts: Map<string, AccountState>;
  /** Cursor round-robin por campaña (campaignId → idx). */
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

/** ¿Hoy y ahora caen dentro del schedule de la campaña? */
function inSchedule(now: Date, schedule: Campaign["schedule"]): boolean {
  try {
    // Hora local en el timezone del schedule
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: schedule.timezone || "UTC",
      weekday: "short", hour: "2-digit", hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const wkMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const weekday = wkMap[parts.find((p) => p.type === "weekday")?.value || "Mon"];
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "12");
    if (!schedule.days.includes(weekday)) return false;
    if (hour < schedule.start_hour) return false;
    if (hour >= schedule.end_hour) return false;
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

function getAccountState(accountId: string): AccountState {
  let s = STATE.accounts.get(accountId);
  const today = new Date().toISOString().slice(0, 10);
  if (!s) {
    s = { last_send_at: null, sent_today: 0, today, next_eligible_at: null };
    STATE.accounts.set(accountId, s);
  }
  if (s.today !== today) {
    // Cambio de día → reset contador
    s.today = today;
    s.sent_today = 0;
  }
  return s;
}

function cleanPass(p: string) { return (p || "").replace(/\s+/g, ""); }

/** Hace el envío real vía SMTP, devuelve {ok, error}. */
async function sendOne(
  account: EmailAccount, lead: Lead, variant: Variant, campaign: Campaign,
): Promise<{ ok: boolean; error?: string; message_id?: string }> {
  const subject = renderTemplate(variant.subject || "(sin asunto)", lead.variables, { seed: lead.id });
  const html    = renderTemplate(variant.body || "", lead.variables, { seed: lead.id });
  if (!subject.trim() || !html.trim()) {
    return { ok: false, error: "Variante con subject o body vacío" };
  }

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

  const headers: Record<string, string> = {
    "X-OnePulso-Campaign": campaign.id,
    "X-OnePulso-Lead": lead.id,
    "X-OnePulso-Variant": variant.id,
  };
  if (campaign.options.insert_unsubscribe_header) {
    headers["List-Unsubscribe"] = `<mailto:${account.email}?subject=Unsubscribe>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  try {
    const info = await t.sendMail({
      from: `"${fromName}" <${account.email}>`,
      to: lead.email,
      subject,
      text: html.replace(/<[^>]+>/g, ""),
      html: campaign.options.text_only_all || (campaign.options.text_only_first && lead.current_step === 0)
        ? undefined
        : `<div style="font-family:-apple-system,sans-serif;font-size:14px;line-height:1.55;color:#0a0d14;white-space:pre-wrap">${html.replace(/\n/g, "<br>")}</div>`,
      cc: campaign.options.cc || undefined,
      bcc: campaign.options.bcc || undefined,
      headers,
    });
    return { ok: true, message_id: info.messageId };
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

  // Cuentas asignadas: por ID explícito O por tag. Las que tengan SMTP ok.
  const tagSet = new Set(campaign.account_tags || []);
  const idSet = new Set(campaign.account_ids || []);
  const assigned = allAccounts.filter((a) => {
    if (!a.smtp_ok) return false;
    if (idSet.has(a.id)) return true;
    if (tagSet.size > 0 && (a.tags || []).some((t) => tagSet.has(t))) return true;
    return false;
  });
  if (assigned.length === 0) return; // sin cuentas asignadas (ni por id ni por tag)

  const leads = await listLeads(campaign.id);
  if (leads.length === 0) return;

  // Blocklist global — saltamos cualquier lead bloqueado.
  const blocklist = await listBlocklist();

  // Leads candidatos: status enviable + es momento de su próximo step + no bloqueado
  const candidates: { lead: Lead; step: Step; stepIdx: number; variant: Variant }[] = [];
  for (const lead of leads) {
    if (["bounced", "replied", "unsubscribed", "completed", "paused"].includes(lead.status)) continue;
    if (isBlocked(lead.email, blocklist)) {
      // Marca el lead como unsubscribed para que ni siquiera lo intentemos
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
    // Igualmente persiste el estado por si hemos marcado leads como unsubscribed por blocklist
    await writeLeads(campaign.id, leads);
    return;
  }

  // Min/random gap configurables (default 6-9 min)
  const minGap = campaign.options.min_gap_minutes ?? 6;
  const randomGap = campaign.options.random_gap_minutes ?? 3;

  // Por cada cuenta asignada, intenta UN envío si está elegible
  for (const account of assigned) {
    const accState = getAccountState(account.id);

    // Daily limit
    const limit = campaign.options.daily_limit_per_account ?? 30;
    if (accState.sent_today >= limit) {
      continue;
    }
    // Rate-limit (gap entre envíos)
    if (accState.next_eligible_at && new Date(accState.next_eligible_at) > now) {
      continue;
    }

    // Decide a qué lead asignarle (sticky preferente, luego rotación)
    // Filtro 1: leads ya pegados a esta cuenta (sticky_account_id == account.id)
    let target = candidates.find((c) => c.lead.sticky_account_id === account.id);

    // Filtro 2: si no hay stickies, leads sin sticky_account_id (todavía no contactados)
    if (!target) {
      // Aplicamos rotación: si esta cuenta es la siguiente en el round-robin, recoge un lead nuevo
      const rr = STATE.rrCursors.get(campaign.id) ?? 0;
      const expectedAccount = assigned[rr % assigned.length];
      if (expectedAccount.id === account.id) {
        target = candidates.find((c) => !c.lead.sticky_account_id);
        if (target) {
          STATE.rrCursors.set(campaign.id, (rr + 1) % assigned.length);
        }
      }
      // Si options.account_rotation === "random", ignoramos round-robin
      if (!target && campaign.options.account_rotation === "random") {
        target = candidates.find((c) => !c.lead.sticky_account_id);
      }
    }

    if (!target) continue;

    // Envío real
    const sendResult = await sendOne(account, target.lead, target.variant, campaign);
    const nowIso = new Date().toISOString();

    if (sendResult.ok) {
      // Registro en el log de enviados (campaign step real)
      const renderedSubject = renderTemplate(target.variant.subject || "(sin asunto)", target.lead.variables, { seed: target.lead.id });
      const renderedBody = renderTemplate(target.variant.body || "", target.lead.variables, { seed: target.lead.id });
      await logSentMessage({
        type: "campaign",
        account_id: account.id,
        account_email: account.email,
        to_address: target.lead.email,
        subject: renderedSubject,
        body: renderedBody,
        message_id: sendResult.message_id,
        campaign_id: campaign.id,
        campaign_step: target.stepIdx + 1,
        campaign_variant: target.variant.label,
        lead_id: target.lead.id,
        lead_email: target.lead.email,
        ok: true,
      });

      // Marca el lead como contactado, avanza step, fija sticky
      const leadIdx = leads.findIndex((l) => l.id === target!.lead.id);
      if (leadIdx >= 0) {
        leads[leadIdx] = {
          ...target.lead,
          status: "active",
          current_step: target.stepIdx + 1,
          last_contacted_at: nowIso,
          last_event: `sent step ${target.stepIdx + 1} variant ${target.variant.label}`,
          sticky_account_id: target.lead.sticky_account_id || account.id,
          finished_reason: target.stepIdx + 1 >= campaign.steps.length ? "completed_sequence" : null,
        };
        if (target.stepIdx + 1 >= campaign.steps.length) {
          leads[leadIdx].status = "completed";
        }
      }

      // Métricas + sent_today
      campaign.metrics = campaign.metrics || {
        total_leads: 0, active_leads: 0, contacted: 0, opened: 0, clicked: 0,
        replied: 0, bounced: 0, unsubscribed: 0, completed: 0,
      };
      campaign.metrics.contacted = (campaign.metrics.contacted || 0) + 1;
      if (leads.find((l) => l.id === target!.lead.id)?.status === "completed") {
        campaign.metrics.completed = (campaign.metrics.completed || 0) + 1;
      }

      // Cuenta: sent_today + estado
      accState.sent_today += 1;
      accState.last_send_at = nowIso;

      // Próximo envío: 6-9 min random (min + 0..random)
      const gapMinutes = minGap + Math.random() * randomGap;
      accState.next_eligible_at = new Date(now.getTime() + gapMinutes * 60_000).toISOString();

      // Persistimos: cuenta (sent_today en EmailAccount), campaign + leads
      const acctFresh = await listEmailAccounts();
      const idx = acctFresh.findIndex((a) => a.id === account.id);
      if (idx >= 0) {
        acctFresh[idx].sent_today = accState.sent_today;
        await upsertEmailAccount(acctFresh[idx]);
      }

      log({
        level: "send", message: "Email enviado",
        campaign_id: campaign.id, campaign_name: campaign.name,
        lead_id: target.lead.id, lead_email: target.lead.email,
        account_id: account.id, account_email: account.email,
        step: target.stepIdx + 1, variant: target.variant.label,
      });
    } else {
      // Falla SMTP. Si es bounce permanente (5.x), marca lead como bounced.
      const permanent = /5\.[157]\.\d|EAUTH|EENVELOPE/i.test(sendResult.error || "");
      if (permanent) {
        const leadIdx = leads.findIndex((l) => l.id === target!.lead.id);
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
      // Aún así aplicamos un gap más corto para no martillar
      accState.next_eligible_at = new Date(now.getTime() + 2 * 60_000).toISOString();
    }
  }

  // Persiste leads y campaign al final (1 escritura por campaña por loop)
  await writeLeads(campaign.id, leads);
  campaign.metrics = campaign.metrics || {
    total_leads: 0, active_leads: 0, contacted: 0, opened: 0, clicked: 0,
    replied: 0, bounced: 0, unsubscribed: 0, completed: 0,
  };
  campaign.metrics.total_leads = leads.length;
  campaign.metrics.active_leads = leads.filter((l) => l.status === "active" || l.status === "new").length;
  await saveCampaign(campaign);
}

/** Una iteración del worker — revisa todas las campañas. */
export async function tickWorker() {
  STATE.last_loop_at = new Date().toISOString();
  STATE.loops += 1;
  try {
    const accounts = await listEmailAccounts();
    const campaigns = await listCampaigns();
    const active = campaigns.filter((c) => c.status === "active");

    for (const c of active) {
      // Cargar campaña fresca de disk (puede haber cambios)
      const fresh = await getCampaign(c.id);
      if (!fresh || fresh.status !== "active") continue;
      try {
        await processCampaign(fresh, accounts);
      } catch (e: any) {
        log({ level: "error", message: `Excepción procesando campaña: ${e.message}`, campaign_id: c.id, campaign_name: c.name });
      }
    }

    // Sync IMAP cada 4 loops (≈ 2 min con intervalo de 30s) — el usuario pidió 2 min
    if (STATE.loops % 4 === 0 || STATE.loops === 1) {
      try {
        const inboxResults = await syncAllInboxes(accounts, 3);
        const totalNew = inboxResults.reduce((s, r) => s + r.new_count, 0);
        const totalFiltered = inboxResults.reduce((s, r) => s + r.warmup_filtered + r.bounce_filtered, 0);
        if (totalNew > 0 || totalFiltered > 0) {
          log({
            level: "info",
            message: `Sync IMAP: +${totalNew} nuevos, ${totalFiltered} filtrados (warmup/bounce)`,
          });
        }
      } catch (e: any) {
        log({ level: "warn", message: `Sync IMAP falló: ${e.message}` });
      }
    }

    // Procesa follow-ups programados (cada tick)
    try {
      await processFollowUps();
    } catch (e: any) {
      log({ level: "error", message: `Follow-ups error: ${e.message}` });
    }
  } catch (e: any) {
    log({ level: "error", message: `Tick error: ${e.message}` });
  }
}

/**
 * Procesa follow-ups pendientes:
 *   - Si `only_if_no_reply`, comprueba que no haya mensajes nuevos en el thread
 *     desde que se creó el follow-up. Si los hay → cancela como "got_reply".
 *   - Si scheduled_for ya pasó → envía vía sendThreadReply.
 *   - Marca como sent (con message_id) o failed (con last_error).
 */
async function processFollowUps() {
  const all = await listFollowUps();
  const pending = all.filter((f) => f.status === "pending");
  if (pending.length === 0) return;
  const now = new Date();

  for (const fu of pending) {
    const dueAt = new Date(fu.scheduled_for);
    if (dueAt > now) continue; // todavía no toca

    // Check: ¿llegó respuesta en el thread desde que se creó?
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
        // Si falla la comprobación, NO enviamos — preferimos perder el follow-up
        // a mandar uno duplicado.
        log({ level: "warn", message: `No pudimos verificar respuestas para FU ${fu.id}: ${e.message}` });
        continue;
      }
    }

    // Envío
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

/** Loop continuo del worker — arranca con startWorker(). */
let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startWorker(intervalSeconds = 30) {
  if (STATE.running) return;
  STATE.running = true;
  log({ level: "info", message: `Worker iniciado · intervalo ${intervalSeconds}s` });
  // Ejecuta una vez al arrancar, después en intervalos
  tickWorker().catch(() => {});
  intervalHandle = setInterval(() => { tickWorker().catch(() => {}); }, intervalSeconds * 1000);
}

export function stopWorker() {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  STATE.running = false;
  log({ level: "info", message: "Worker detenido" });
}
