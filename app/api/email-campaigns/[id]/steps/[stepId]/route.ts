/**
 * PATCH  /api/email-campaigns/[id]/steps/[stepId]
 *    Body: { delay_days?, delay_hours?, variants? (lista completa) }
 *    Si se manda `variants` se reemplaza toda la lista (drag/drop, edición masiva).
 *
 * DELETE /api/email-campaigns/[id]/steps/[stepId]   → elimina el step
 */
import { NextRequest, NextResponse } from "next/server";
import { getCampaign, saveCampaign } from "@/lib/email-campaigns";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; stepId: string }> }) {
  const { id, stepId } = await params;
  const c = await getCampaign(id);
  if (!c) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });
  const idx = c.steps.findIndex((s) => s.id === stepId);
  if (idx < 0) return NextResponse.json({ error: "Step no encontrado" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const s = c.steps[idx];
  if (body.delay_days !== undefined) s.delay_days = Math.max(0, Number(body.delay_days) || 0);
  if (body.delay_hours !== undefined) s.delay_hours = Math.max(0, Number(body.delay_hours) || 0);
  if (Array.isArray(body.variants)) s.variants = body.variants;
  await saveCampaign(c);
  return NextResponse.json({ ok: true, step: s, campaign: c });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; stepId: string }> }) {
  const { id, stepId } = await params;
  const c = await getCampaign(id);
  if (!c) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });
  const before = c.steps.length;
  c.steps = c.steps.filter((s) => s.id !== stepId);
  if (c.steps.length === before) return NextResponse.json({ error: "Step no encontrado" }, { status: 404 });
  await saveCampaign(c);
  return NextResponse.json({ ok: true, campaign: c });
}
