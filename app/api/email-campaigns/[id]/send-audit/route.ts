/**
 * GET /api/email-campaigns/[id]/send-audit
 *
 * Audita el estado de envíos de la campaña. Te dice:
 *   - Cuántos leads hay totales
 *   - Cuántos han recibido CADA step
 *   - Cuántos envíos fallaron (con error)
 *   - Cuántos están atascados (deberían haber enviado y no lo hicieron)
 *   - Cuántos replied / bounced / unsubscribed
 *   - Per-cuenta: cuántos envíos hizo cada una
 *
 * Ideal para verificar "¿se ha enviado todo correctamente?"
 */
import { NextRequest, NextResponse } from "next/server";
import { getCampaign, listLeads } from "@/lib/email-campaigns";
import { listSent } from "@/lib/email-sent-log";
import { listEmailAccounts } from "@/lib/email-accounts";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });

  const [leads, sentAll, accounts] = await Promise.all([
    listLeads(id),
    listSent(),
    listEmailAccounts(),
  ]);

  // Filtra envíos de esta campaña
  const sent = sentAll.filter((s) => s.campaign_id === id && s.type === "campaign");
  const sentOk = sent.filter((s) => s.ok);
  const sentFailed = sent.filter((s) => !s.ok);

  // Step distribution: cuántos leads están en cada step
  const stepDistribution: Record<string, number> = {
    new: 0,           // current_step = 0, never sent
    step_1: 0,        // current_step = 1, sent step 0 (the first email)
    step_2: 0,
    step_3: 0,
    completed: 0,
    replied: 0,
    bounced: 0,
    unsubscribed: 0,
    paused: 0,
  };

  for (const l of leads) {
    if (l.status === "replied") stepDistribution.replied++;
    else if (l.status === "bounced") stepDistribution.bounced++;
    else if (l.status === "unsubscribed") stepDistribution.unsubscribed++;
    else if (l.status === "paused") stepDistribution.paused++;
    else if (l.status === "completed") stepDistribution.completed++;
    else if (l.current_step === 0) stepDistribution.new++;
    else {
      const key = `step_${l.current_step}`;
      stepDistribution[key] = (stepDistribution[key] || 0) + 1;
    }
  }

  // Per-step sends actuales (de email-sent OK)
  const sentByStep: Record<number, number> = {};
  for (const s of sentOk) {
    const step = s.campaign_step || 0;
    sentByStep[step] = (sentByStep[step] || 0) + 1;
  }

  // Per-account stats
  const sentByAccount: Record<string, { email: string; total: number; ok: number; failed: number }> = {};
  for (const s of sent) {
    if (!s.account_id) continue;
    if (!sentByAccount[s.account_id]) {
      sentByAccount[s.account_id] = { email: s.account_email || "", total: 0, ok: 0, failed: 0 };
    }
    sentByAccount[s.account_id].total++;
    if (s.ok) sentByAccount[s.account_id].ok++;
    else sentByAccount[s.account_id].failed++;
  }

  // Identifica cuentas asignadas que NO han enviado nada
  const assignedAccounts = accounts.filter((a) => {
    if (campaign.account_ids?.includes(a.id)) return true;
    if (campaign.account_tags?.some((t) => (a.tags || []).includes(t))) return true;
    return false;
  });
  const idleAccounts = assignedAccounts.filter((a) => !sentByAccount[a.id]);

  // Detecta leads "atascados": deberían haber enviado pero no lo hicieron
  // (lead en status activo + no en blocklist + delay del siguiente step ya cumplido)
  const now = new Date();
  const stuck: { email: string; current_step: number; last_event?: string; reason: string }[] = [];
  for (const l of leads) {
    if (!["active", "new"].includes(l.status)) continue;
    if (l.current_step >= campaign.steps.length) continue;
    const step = campaign.steps[l.current_step];
    if (!l.last_contacted_at) {
      // Lead nuevo nunca contactado — esto es normal si no ha entrado al pool
      // todavía (cap diario alcanzado) — no es atascado per se
      continue;
    }
    const ms = (step.delay_days * 24 + step.delay_hours) * 60 * 60 * 1000;
    const dueAt = new Date(l.last_contacted_at).getTime() + ms;
    if (dueAt < now.getTime() - 24 * 60 * 60 * 1000) {
      // Lleva >24h vencido y no se ha enviado → atascado
      stuck.push({
        email: l.email,
        current_step: l.current_step,
        last_event: l.last_event || undefined,
        reason: "Delay del próximo step ya vencido hace >24h — sticky account podría estar saturada o rate-limited",
      });
    }
  }

  // Errores SMTP recientes (últimos 50)
  const recentErrors = sentFailed
    .slice()
    .sort((a, b) => (b.sent_at || "").localeCompare(a.sent_at || ""))
    .slice(0, 50)
    .map((s) => ({
      sent_at: s.sent_at,
      to: s.to_address,
      account: s.account_email,
      step: s.campaign_step,
      error: s.error,
    }));

  // Resumen general
  const summary = {
    campaign_name: campaign.name,
    campaign_status: campaign.status,
    total_leads: leads.length,
    total_sends_attempted: sent.length,
    total_sends_ok: sentOk.length,
    total_sends_failed: sentFailed.length,
    success_rate: sent.length > 0 ? (sentOk.length / sent.length) * 100 : 0,
    replied: stepDistribution.replied,
    bounced: stepDistribution.bounced,
    unsubscribed: stepDistribution.unsubscribed,
    completed: stepDistribution.completed,
    stuck_count: stuck.length,
    idle_accounts_count: idleAccounts.length,
    assigned_accounts_count: assignedAccounts.length,
  };

  return NextResponse.json({
    ok: true,
    summary,
    step_distribution: stepDistribution,
    sent_by_step: sentByStep,
    sent_by_account: Object.entries(sentByAccount).map(([account_id, stats]) => ({
      account_id,
      ...stats,
    })),
    idle_accounts: idleAccounts.map((a) => ({
      id: a.id,
      email: a.email,
      smtp_ok: a.smtp_ok,
      imap_ok: a.imap_ok,
      sent_today: a.sent_today ?? 0,
    })),
    stuck_leads: stuck.slice(0, 50), // máx 50 para no saturar
    recent_errors: recentErrors,
  });
}
