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

  // Cambio de status (limitado a transiciones manuales razonables) con
  // coherencia de current_step / finished_reason para no dejar estado roto.
  if (body.status && ["new", "active", "paused", "completed"].includes(body.status)) {
    const patch: any = { status: body.status };
    if (body.status === "completed") {
      patch.finished_reason = leads[idx].finished_reason || "marcado manualmente";
    } else if (body.status === "new") {
      // Reset a "new" → vuelve al principio de la secuencia
      patch.current_step = 0;
      patch.finished_reason = null;
      patch.last_contacted_at = null;
      patch.last_message_id = null;
      patch.thread_subject = null;
      patch.thread_references = null;
    } else if (body.status === "active") {
      patch.finished_reason = null; // reactivar
    }
    leads[idx] = { ...leads[idx], ...patch };
  }

  await writeLeads(id, leads);
  return NextResponse.json({ ok: true, lead: leads[idx] });
}
