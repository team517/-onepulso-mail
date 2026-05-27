/**
 * POST /api/email-campaigns/[id]/steps/[stepId]/variants
 *   Crea una variante nueva. Si se manda { from_variant_id } duplica esa.
 */
import { NextRequest, NextResponse } from "next/server";
import { getCampaign, newVariant, saveCampaign, type Variant } from "@/lib/email-campaigns";

export const runtime = "nodejs";

function nextLabel(existing: Variant[]): string {
  const used = new Set(existing.map((v) => v.label.toUpperCase()));
  for (let i = 0; i < 26; i++) {
    const l = String.fromCharCode(65 + i);
    if (!used.has(l)) return l;
  }
  return `V${existing.length + 1}`;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; stepId: string }> }) {
  const { id, stepId } = await params;
  const c = await getCampaign(id);
  if (!c) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });
  const step = c.steps.find((s) => s.id === stepId);
  if (!step) return NextResponse.json({ error: "Step no encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  let v: Variant;
  if (body.from_variant_id) {
    const src = step.variants.find((x) => x.id === body.from_variant_id);
    if (!src) return NextResponse.json({ error: "Variante origen no encontrada" }, { status: 404 });
    v = { ...src, id: crypto.randomUUID(), label: nextLabel(step.variants) };
  } else {
    v = newVariant(nextLabel(step.variants));
    if (typeof body.subject === "string") v.subject = body.subject;
    if (typeof body.body === "string") v.body = body.body;
  }
  step.variants.push(v);
  await saveCampaign(c);
  return NextResponse.json({ ok: true, variant: v, campaign: c });
}
