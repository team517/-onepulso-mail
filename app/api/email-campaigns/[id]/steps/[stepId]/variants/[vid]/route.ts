/**
 * PATCH  /api/email-campaigns/[id]/steps/[stepId]/variants/[vid]
 *   Body: { subject?, body?, label?, weight? }
 * DELETE  → elimina la variante (deja al menos una)
 */
import { NextRequest, NextResponse } from "next/server";
import { getCampaign, saveCampaign } from "@/lib/email-campaigns";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; stepId: string; vid: string }> }) {
  const { id, stepId, vid } = await params;
  const c = await getCampaign(id);
  if (!c) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });
  const step = c.steps.find((s) => s.id === stepId);
  if (!step) return NextResponse.json({ error: "Step no encontrado" }, { status: 404 });
  const v = step.variants.find((x) => x.id === vid);
  if (!v) return NextResponse.json({ error: "Variante no encontrada" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.subject === "string") v.subject = body.subject;
  if (typeof body.body === "string") v.body = body.body;
  if (typeof body.label === "string" && body.label.trim()) v.label = body.label.trim().slice(0, 6);
  if (body.weight !== undefined) v.weight = Math.max(1, Number(body.weight) || 1);
  await saveCampaign(c);
  return NextResponse.json({ ok: true, variant: v });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; stepId: string; vid: string }> }) {
  const { id, stepId, vid } = await params;
  const c = await getCampaign(id);
  if (!c) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });
  const step = c.steps.find((s) => s.id === stepId);
  if (!step) return NextResponse.json({ error: "Step no encontrado" }, { status: 404 });
  if (step.variants.length <= 1) return NextResponse.json({ error: "Debe quedar al menos 1 variante" }, { status: 400 });
  step.variants = step.variants.filter((x) => x.id !== vid);
  await saveCampaign(c);
  return NextResponse.json({ ok: true, campaign: c });
}
