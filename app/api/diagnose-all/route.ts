/**
 * GET /api/diagnose-all
 *
 * Diagnóstico COMPLETO del workspace actual (logueado): cuentas conectadas,
 * campañas con su estado, asignación de cuentas, distribución de leads y
 * últimos envíos. Solo lectura. Sirve para "encontrar" la campaña Libertis y
 * ver por qué envía / no envía sin tocar nada.
 *
 * Filtra por ?q=libertis para ver solo lo que matchea.
 */
import { NextRequest, NextResponse } from "next/server";
import { listCampaigns, listLeads } from "@/lib/email-campaigns";
import { listEmailAccounts } from "@/lib/email-accounts";
import { listSent } from "@/lib/email-sent-log";
import { getWorkspaceId } from "@/lib/workspace";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const q = (new URL(req.url).searchParams.get("q") || "").toLowerCase();
  const ws = await getWorkspaceId();

  const [campaigns, accounts, sent] = await Promise.all([
    listCampaigns(),
    listEmailAccounts(),
    listSent(),
  ]);

  const filteredCampaigns = q
    ? campaigns.filter((c) => c.name.toLowerCase().includes(q))
    : campaigns;

  const campaignReports = await Promise.all(
    filteredCampaigns.map(async (c) => {
      const leads = await listLeads(c.id);
      // Cuentas asignadas a esta campaña (por id o tag)
      const idSet = new Set(c.account_ids || []);
      const tagSet = new Set(c.account_tags || []);
      const assigned = accounts.filter((a) => {
        if (idSet.has(a.id)) return true;
        if (tagSet.size > 0 && (a.tags || []).some((t) => tagSet.has(t))) return true;
        return false;
      });

      // Distribución de leads por estado
      const dist: Record<string, number> = {};
      for (const l of leads) dist[l.status] = (dist[l.status] || 0) + 1;

      // Envíos de esta campaña
      const campSent = sent.filter((s) => s.campaign_id === c.id && s.type === "campaign");
      const sentOk = campSent.filter((s) => s.ok).length;
      const sentFail = campSent.filter((s) => !s.ok).length;

      return {
        id: c.id,
        name: c.name,
        status: c.status,
        steps: c.steps.length,
        total_leads: leads.length,
        leads_by_status: dist,
        schedule: `${(c.schedule.days || []).join(",")} ${c.schedule.start_hour}:00-${c.schedule.end_hour}:00 ${c.schedule.timezone}`,
        daily_limit_per_account: c.options?.daily_limit_per_account,
        gap_minutes: `${c.options?.min_gap_minutes}-${(c.options?.min_gap_minutes ?? 0) + (c.options?.random_gap_minutes ?? 0)}`,
        assigned_accounts: assigned.map((a) => ({
          email: a.email,
          smtp_ok: a.smtp_ok,
          imap_ok: a.imap_ok,
          sent_today: a.sent_today ?? 0,
          next_eligible_at: a.next_eligible_at || null,
          last_smtp_error: a.last_smtp_error || null,
        })),
        assigned_count: assigned.length,
        sends_ok: sentOk,
        sends_failed: sentFail,
        // Diagnóstico rápido: ¿por qué podría no enviar?
        diagnosis: (() => {
          const issues: string[] = [];
          if (c.status !== "active") issues.push(`status="${c.status}" (debe ser "active")`);
          if (assigned.length === 0) issues.push("0 cuentas asignadas");
          if (assigned.length > 0 && assigned.every((a) => !a.smtp_ok)) issues.push("todas las cuentas asignadas tienen SMTP en error");
          if (leads.length === 0) issues.push("0 leads importados");
          if (leads.length > 0 && (dist["new"] || 0) + (dist["active"] || 0) === 0) issues.push("no quedan leads enviables (todos replied/bounced/completed)");
          if (c.steps.every((s) => s.variants.every((v) => !v.subject?.trim() && !v.body?.trim()))) issues.push("todos los steps están vacíos");
          return issues.length ? issues : ["✓ sin problemas obvios — debería enviar en horario"];
        })(),
      };
    }),
  );

  return NextResponse.json({
    ok: true,
    workspace: ws,
    accounts_total: accounts.length,
    campaigns_total: campaigns.length,
    matched: filteredCampaigns.length,
    accounts: accounts.map((a) => ({
      email: a.email,
      provider: a.provider,
      smtp_ok: a.smtp_ok,
      imap_ok: a.imap_ok,
      sent_today: a.sent_today ?? 0,
      tags: a.tags || [],
    })),
    campaigns: campaignReports,
  });
}
