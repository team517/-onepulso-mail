/**
 * GET    /api/email-blocklist                → lista
 * POST   /api/email-blocklist                → { value, type?: "email"|"domain", reason? }
 *           → añade al blocklist Y marca leads existentes como unsubscribed
 *             en TODAS las campañas. Devuelve { affected_leads, affected_campaigns }.
 * DELETE /api/email-blocklist?id=…           → quita del blocklist (NO re-activa leads)
 */
import { NextRequest, NextResponse } from "next/server";
import { addToBlocklist, listBlocklist, removeFromBlocklist } from "@/lib/email-blocklist";
import { listCampaigns, listLeads, writeLeads, saveCampaign } from "@/lib/email-campaigns";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const list = await listBlocklist();
  return NextResponse.json({ blocklist: list });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const value = String(body.value || "").trim().toLowerCase();
  if (!value) return NextResponse.json({ error: "Falta value" }, { status: 400 });
  const type: "email" | "domain" = body.type === "domain" ? "domain" : "email";

  // Validación básica
  if (type === "email" && (!value.includes("@") || !/\.[a-z]{2,}$/i.test(value))) {
    return NextResponse.json({ error: "Email inválido" }, { status: 400 });
  }
  if (type === "domain" && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) {
    return NextResponse.json({ error: "Dominio inválido" }, { status: 400 });
  }

  // Recorre TODAS las campañas, marca como unsubscribed los leads que matcheen
  const campaigns = await listCampaigns();
  let affectedLeads = 0;
  let affectedCampaigns = 0;
  for (const c of campaigns) {
    const leads = await listLeads(c.id);
    let changed = 0;
    for (const l of leads) {
      const e = l.email.toLowerCase();
      const matches = type === "email"
        ? e === value
        : (e.split("@")[1] || "") === value;
      if (matches && l.status !== "unsubscribed") {
        l.status = "unsubscribed";
        l.finished_reason = `Bloqueado manualmente (${type}: ${value})`;
        l.last_event = "blocked";
        changed++;
      }
    }
    if (changed > 0) {
      affectedLeads += changed;
      affectedCampaigns++;
      await writeLeads(c.id, leads);
      // Actualiza métricas: active_leads baja, unsubscribed sube
      if (c.metrics) {
        c.metrics.unsubscribed = (c.metrics.unsubscribed || 0) + changed;
        c.metrics.active_leads = leads.filter((x) => x.status === "active" || x.status === "new").length;
        await saveCampaign(c);
      }
    }
  }

  const entry = await addToBlocklist({
    type, value, reason: body.reason || undefined,
    affected_leads: affectedLeads,
  });

  return NextResponse.json({
    ok: true,
    blocked: entry,
    affected_leads: affectedLeads,
    affected_campaigns: affectedCampaigns,
  });
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
  const ok = await removeFromBlocklist(id);
  return NextResponse.json({ ok });
}
