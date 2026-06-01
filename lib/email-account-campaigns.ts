/**
 * Helper para cruzar cuentas con campañas:
 * Para cada cuenta, ¿en qué campañas está siendo usada?
 *
 * Una cuenta puede estar asignada a una campaña de 2 formas:
 *   - Por ID explícito (campaign.account_ids incluye el account.id)
 *   - Por TAG (campaign.account_tags incluye alguno de account.tags)
 *
 * Esto es read-only (no muta nada).
 */
import { listCampaigns, type Campaign } from "./email-campaigns";
import type { EmailAccount } from "./email-accounts";

export type AccountAssignment = {
  campaign_id: string;
  campaign_name: string;
  status: Campaign["status"];
  via: "id" | "tag";
  tag?: string;  // si via=tag, qué tag conecta
};

export type AccountAssignmentMap = Map<string, AccountAssignment[]>;

/**
 * Calcula las asignaciones de TODAS las cuentas en una sola pasada
 * (más eficiente que llamar por cuenta cuando hay muchas).
 */
export async function getAllAccountAssignments(accounts: EmailAccount[]): Promise<AccountAssignmentMap> {
  const out: AccountAssignmentMap = new Map();
  for (const a of accounts) out.set(a.id, []);

  const campaigns = await listCampaigns();
  for (const c of campaigns) {
    const accountIds = new Set(c.account_ids || []);
    const campaignTags = new Set(c.account_tags || []);

    for (const a of accounts) {
      // ¿Asignada por ID?
      if (accountIds.has(a.id)) {
        out.get(a.id)!.push({
          campaign_id: c.id,
          campaign_name: c.name,
          status: c.status,
          via: "id",
        });
        continue; // ya añadida, no doblamos por tag aunque también matchee
      }
      // ¿Asignada por TAG?
      if (campaignTags.size > 0) {
        const accountTags = a.tags || [];
        const matching = accountTags.find((t) => campaignTags.has(t));
        if (matching) {
          out.get(a.id)!.push({
            campaign_id: c.id,
            campaign_name: c.name,
            status: c.status,
            via: "tag",
            tag: matching,
          });
        }
      }
    }
  }
  return out;
}
