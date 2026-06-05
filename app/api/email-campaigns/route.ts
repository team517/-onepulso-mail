/**
 * GET  /api/email-campaigns        → lista
 * POST /api/email-campaigns        → crea ({ name })
 */
import { NextRequest, NextResponse } from "next/server";
import { listCampaigns, newCampaign, saveCampaign } from "@/lib/email-campaigns";
import { startWorker } from "@/lib/email-campaign-worker";
import { getWorkspaceId } from "@/lib/workspace";

export const runtime = "nodejs";

// Auto-arranca el worker al primer hit al listado de campañas.
// El worker es idempotente: si ya está corriendo, no hace nada.
startWorker(30);

/** Cache en memoria por workspace (TTL 5s). Reduce drásticamente la carga
 *  cuando varias pestañas/usuarios pollean el listado. */
type CacheEntry = { at: number; payload: any };
const responseCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5_000;

export async function GET() {
  const ws = await getWorkspaceId();
  const cached = responseCache.get(ws);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.payload);
  }

  const all = await listCampaigns();
  const payload = { campaigns: all };
  responseCache.set(ws, { at: Date.now(), payload });
  if (responseCache.size > 100) {
    const cutoff = Date.now() - CACHE_TTL_MS;
    for (const [k, v] of responseCache) if (v.at < cutoff) responseCache.delete(k);
  }

  return NextResponse.json(payload);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim() || "Nueva campaña";
  const c = newCampaign(name);
  await saveCampaign(c);
  // Invalida cache para reflejar la nueva campaña inmediatamente
  const ws = await getWorkspaceId();
  responseCache.delete(ws);
  return NextResponse.json({ ok: true, campaign: c });
}
