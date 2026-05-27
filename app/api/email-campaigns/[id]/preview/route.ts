/**
 * POST /api/email-campaigns/[id]/preview
 *   Body: { step_id, variant_id?, lead_id? }
 *   Devuelve { subject, body } con variables sustituidas para el lead indicado
 *   (o el primer lead disponible). Si variant_id está vacío, escoge la variante
 *   que tocaría a ese lead según pickVariant().
 */
import { NextRequest, NextResponse } from "next/server";
import { getCampaign, listLeads, pickVariant, renderTemplate } from "@/lib/email-campaigns";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCampaign(id);
  if (!c) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const stepId = String(body.step_id || "");
  const step = c.steps.find((s) => s.id === stepId);
  if (!step) return NextResponse.json({ error: "Step no encontrado" }, { status: 404 });

  const leads = await listLeads(id);
  let lead = leads[0];
  if (body.lead_id) lead = leads.find((l) => l.id === body.lead_id) || lead;

  const dummyVars: Record<string, string> = {
    first_name: "Ana", last_name: "García", email: "ana@example.com",
    company: "Acme Corp", website: "https://acme.com", job_title: "Head of Sales",
  };
  const vars = lead?.variables || dummyVars;

  let variant;
  if (body.variant_id) {
    variant = step.variants.find((v) => v.id === body.variant_id);
  }
  if (!variant) {
    const seed = lead?.id || "preview";
    variant = pickVariant(step, seed);
  }
  if (!variant) return NextResponse.json({ error: "No hay variantes en este step" }, { status: 400 });

  const seed = lead?.id || variant.id;
  const subject = renderTemplate(variant.subject, vars, { highlightMissing: true, seed });
  const html    = renderTemplate(variant.body, vars,    { highlightMissing: true, seed });

  return NextResponse.json({
    subject, body: html,
    variant: { id: variant.id, label: variant.label },
    lead: lead ? { id: lead.id, email: lead.email, variables: lead.variables } : null,
    used_dummy: !lead,
  });
}
