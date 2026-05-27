/**
 * POST /api/email-campaigns/[id]/steps
 *   Crea un step nuevo. Body: { delay_days?, delay_hours?, after_step_id? }
 *   Por defecto se añade al final con delay=3 días si ya hay otros pasos.
 */
import { NextRequest, NextResponse } from "next/server";
import { getCampaign, newStep, saveCampaign } from "@/lib/email-campaigns";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCampaign(id);
  if (!c) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const isFirst = c.steps.length === 0;
  const step = newStep(body.delay_days ?? (isFirst ? 0 : 3));
  if (body.delay_hours !== undefined) step.delay_hours = Number(body.delay_hours) || 0;
  c.steps.push(step);
  await saveCampaign(c);
  return NextResponse.json({ ok: true, step, campaign: c });
}
