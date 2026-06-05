import { NextRequest, NextResponse } from "next/server";
import { deleteEmailAccount, listEmailAccounts, safe } from "@/lib/email-accounts";
import { getAllAccountAssignments } from "@/lib/email-account-campaigns";
import { getWorkspaceId } from "@/lib/workspace";

export const runtime = "nodejs";

/**
 * Cache en memoria por workspace (TTL 5s) para evitar recomputar
 * assignments + listCampaigns cada poll (la UI hace polling cada 60s
 * pero también hay backbutton, revisits, navegación múltiple).
 */
type CacheEntry = { at: number; payload: any };
const responseCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5_000;

export async function GET() {
  const ws = await getWorkspaceId();
  const cached = responseCache.get(ws);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.payload);
  }

  const all = await listEmailAccounts();
  const assignments = await getAllAccountAssignments(all);
  const payload = {
    accounts: all.map((a) => ({
      ...safe(a),
      assigned_campaigns: assignments.get(a.id) || [],
    })),
  };

  responseCache.set(ws, { at: Date.now(), payload });
  // Limpieza ligera de entries viejas (no usamos toda la memoria si hay muchos ws)
  if (responseCache.size > 100) {
    const cutoff = Date.now() - CACHE_TTL_MS;
    for (const [k, v] of responseCache) if (v.at < cutoff) responseCache.delete(k);
  }

  return NextResponse.json(payload);
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
  const ok = await deleteEmailAccount(id);
  // Invalida cache del workspace
  const ws = await getWorkspaceId();
  responseCache.delete(ws);
  return NextResponse.json({ ok });
}
