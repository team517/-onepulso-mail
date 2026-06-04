/**
 * PATCH /api/email-campaigns/[id]/leads/[leadId]
 *   Body: { variables?: Record<string,string>, status?: LeadStatus }
 *
 * Permite editar las variables o el status de un lead concreto.
 * Las variables se MERGEAN con las existentes (no se reemplazan enteras).
 */
import { NextRequest, NextResponse } from "next/server";
import { getCampaign, listLeads, writeLeads } from "@/lib/email-campaigns";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; leadId: string }> }) {
  const { id, leadId } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });

  const leads = await listLeads(id);
  const idx = leads.findIndex((l) => l.id === leadId);
  if (idx < 0) return NextResponse.json({ error: "Lead no encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  // Merge variables: lo nuevo sobrescribe lo viejo. Mantiene las existentes.
  if (body.variables && typeof body.variables === "object") {
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.variables)) {
      const key = String(k).trim();
      const val = String(v ?? "").trim();
      if (key) cleaned[key] = val;
    }
    leads[idx] = {
      ...leads[idx],
      variables: { ...leads[idx].variables, ...cleaned },
    };
  }

  // Cambio de status (limitado a transiciones manuales razonables)
  if (body.status && ["new", "active", "paused", "completed"].includes(body.status)) {
    leads[idx] = { ...leads[idx], status: body.status };
  }

  await writeLeads(id, leads);
  return NextResponse.json({ ok: true, lead: leads[idx] });
}
