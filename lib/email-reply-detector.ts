/**
 * Detección automática de respuestas:
 * Tras un sync de IMAP, escanea los mensajes RECIÉN entrados y los matchea
 * contra los leads de TODAS las campañas (por email del remitente).
 *
 * Si encuentra un match: marca el lead como `status: "replied"` + registra
 * timestamp + finished_reason → el worker NO le seguirá enviando.
 *
 * Esto convierte el "Stop on reply" de la campaña en algo realmente automático
 * (antes solo lo hacía si la cuenta tenía sticky_sender).
 */
import { listCampaigns, listLeads, writeLeads, saveCampaign, type Lead } from "./email-campaigns";
import { listMessagesForAccount, type InboxMessage } from "./email-inbox-store";
import { EmailAccount } from "./email-accounts";

export type ReplyDetection = {
  lead_id: string;
  lead_email: string;
  campaign_id: string;
  campaign_name: string;
  detected_at: string;
  via_account: string;
  message_id?: string;
  subject?: string;
};

/** Escanea cada cuenta en busca de nuevos replies de leads. Idempotente. */
export async function detectRepliesForAccounts(
  accountIds: string[],
  since?: Date,
): Promise<{ detections: ReplyDetection[]; campaigns_touched: number }> {
  const campaigns = await listCampaigns();
  if (campaigns.length === 0) return { detections: [], campaigns_touched: 0 };

  const sinceMs = since ? since.getTime() : 0;

  // Index: email → [{ campaign, lead }]
  // Un mismo email puede estar en varias campañas — marcamos en todas.
  type Entry = { campaign_id: string; campaign_name: string; lead: Lead };
  const leadIndex = new Map<string, Entry[]>();
  const allLeadsByCampaign = new Map<string, Lead[]>();

  for (const c of campaigns) {
    const leads = await listLeads(c.id);
    allLeadsByCampaign.set(c.id, leads);
    for (const l of leads) {
      // No marcamos como reply si ya está completed/bounced/unsubscribed
      if (["replied", "bounced", "unsubscribed"].includes(l.status)) continue;
      const key = l.email.toLowerCase();
      if (!leadIndex.has(key)) leadIndex.set(key, []);
      leadIndex.get(key)!.push({ campaign_id: c.id, campaign_name: c.name, lead: l });
    }
  }
  if (leadIndex.size === 0) return { detections: [], campaigns_touched: 0 };

  const detections: ReplyDetection[] = [];
  const dirtyCampaigns = new Set<string>();

  for (const accountId of accountIds) {
    const msgs = await listMessagesForAccount(accountId);
    for (const m of msgs) {
      const msgDate = new Date(m.date).getTime();
      if (msgDate < sinceMs) continue;
      const from = (m.from_address || "").toLowerCase();
      const matches = leadIndex.get(from);
      if (!matches || matches.length === 0) continue;
      for (const { campaign_id, campaign_name, lead } of matches) {
        // Ya marcado como replied en otra iteración (mismo lead en varias cuentas) → skip
        if (lead.status === "replied") continue;
        // Solo marcamos como replied si el mensaje es POSTERIOR al primer envío,
        // o si no se ha contactado todavía (raro — alguien escribe a una cold-email
        // antes de recibir el primer email — lo ignoramos).
        if (lead.last_contacted_at) {
          const sentMs = new Date(lead.last_contacted_at).getTime();
          if (msgDate <= sentMs) continue; // mensaje anterior al envío, no es reply real
        }
        lead.status = "replied";
        lead.last_event = `reply received via ${m.account_email}`;
        lead.finished_reason = `Respuesta recibida desde ${m.account_email}`;
        // Anotamos cuándo se detectó (en last_contacted_at no, que es para envíos salientes)
        (lead as any).replied_at = new Date().toISOString();

        detections.push({
          lead_id: lead.id,
          lead_email: lead.email,
          campaign_id,
          campaign_name,
          detected_at: (lead as any).replied_at,
          via_account: m.account_email,
          message_id: m.message_id,
          subject: m.subject,
        });
        dirtyCampaigns.add(campaign_id);
      }
    }
  }

  // Persistir los leads modificados, una vez por campaña
  for (const campaignId of dirtyCampaigns) {
    const leads = allLeadsByCampaign.get(campaignId);
    if (!leads) continue;
    await writeLeads(campaignId, leads);
    // Actualiza métricas
    const c = campaigns.find((x) => x.id === campaignId);
    if (c) {
      c.metrics = c.metrics || {
        total_leads: 0, active_leads: 0, contacted: 0, opened: 0, clicked: 0,
        replied: 0, bounced: 0, unsubscribed: 0, completed: 0,
      };
      c.metrics.replied = leads.filter((l) => l.status === "replied").length;
      c.metrics.active_leads = leads.filter((l) => l.status === "active" || l.status === "new").length;
      await saveCampaign(c);
    }
  }

  return { detections, campaigns_touched: dirtyCampaigns.size };
}
