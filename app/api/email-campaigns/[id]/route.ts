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
import { listEmailAccounts, upsertEmailAccount } from "@/lib/email-accounts";

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

  // Si se está ACTIVANDO la campaña, arranca el slow ramp de las cuentas
  // asignadas que lo tengan habilitado pero aún sin started_at.
  if (body.status === "active") {
    const idSet = new Set(c.account_ids || []);
    const tagSet = new Set(c.account_tags || []);
    const allAccounts = await listEmailAccounts();
    const assigned = allAccounts.filter((a) => {
      if (idSet.has(a.id)) return true;
      if (tagSet.size > 0 && (a.tags || []).some((t) => tagSet.has(t))) return true;
      return false;
    });
    const nowIso = new Date().toISOString();
    for (const acc of assigned) {
      if (acc.slow_ramp_enabled && !acc.slow_ramp_started_at) {
        await upsertEmailAccount({ ...acc, slow_ramp_started_at: nowIso });
      }
    }
  }

  return NextResponse.json({ ok: true, campaign: c });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await deleteCampaign(id);
  return NextResponse.json({ ok });
}
