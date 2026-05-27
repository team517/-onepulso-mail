/**
 * GET  /api/email-campaigns        → lista
 * POST /api/email-campaigns        → crea ({ name })
 */
import { NextRequest, NextResponse } from "next/server";
import { listCampaigns, newCampaign, saveCampaign } from "@/lib/email-campaigns";
import { startWorker } from "@/lib/email-campaign-worker";

export const runtime = "nodejs";

// Auto-arranca el worker al primer hit al listado de campañas.
// El worker es idempotente: si ya está corriendo, no hace nada.
startWorker(30);

export async function GET() {
  const all = await listCampaigns();
  // No filtramos nada — leads van por endpoint separado.
  return NextResponse.json({ campaigns: all });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim() || "Nueva campaña";
  const c = newCampaign(name);
  await saveCampaign(c);
  return NextResponse.json({ ok: true, campaign: c });
}
