/**
 * GET    /api/email-campaigns/[id]            → campaign + leads_count
 * PATCH  /api/email-campaigns/[id]            → actualiza partes (name, schedule, options, account_ids, status, tags)
 * DELETE /api/email-campaigns/[id]            → borra
 */
import { NextRequest, NextResponse } from "next/server";
import {
  deleteCampaign, getCampaign, listLeads, saveCampaign,
  type Campaign, type CampaignOptions, type CampaignSchedule,
} from "@/lib/email-campaigns";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCampaign(id);
  if (!c) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });
  const leads = await listLeads(id);
  return NextResponse.json({ campaign: c, leads_count: leads.length });
}

const PATCH_TOP = new Set(["name", "status", "tags", "account_ids", "account_tags", "variables"]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCampaign(id);
  if (!c) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });
  const body = await req.json().catch(() => ({}));

  for (const [k, v] of Object.entries(body)) {
    if (PATCH_TOP.has(k)) (c as any)[k] = v;
  }
  if (body.schedule && typeof body.schedule === "object") {
    c.schedule = { ...c.schedule, ...(body.schedule as Partial<CampaignSchedule>) };
  }
  if (body.options && typeof body.options === "object") {
    c.options = { ...c.options, ...(body.options as Partial<CampaignOptions>) };
  }
  if (Array.isArray(body.steps)) {
    c.steps = body.steps; // reemplaza la secuencia entera (drag/drop, etc.)
  }
  await saveCampaign(c);
  return NextResponse.json({ ok: true, campaign: c });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await deleteCampaign(id);
  return NextResponse.json({ ok });
}
