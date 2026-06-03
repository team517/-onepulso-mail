/**
 * POST /api/email-campaigns/[id]/leads/chunk
 *
 * Body: { leads: [{ email, variables: {...} }, ...], skip_blocklist?: boolean, skip_other_campaigns?: boolean }
 *
 * Importa un chunk de leads pre-parseados. El cliente parsea el CSV una vez
 * y envía batches de 100 para mostrar progreso al usuario sin chocar contra
 * el body-size limit.
 *
 * **Auto-dedupe** (estilo Instantly) por defecto:
 *   · Salta emails de la blocklist global del workspace.
 *   · Salta emails que ya están en OTRAS campañas del mismo workspace.
 * El cliente puede desactivar cada uno con `skip_blocklist:false` o
 * `skip_other_campaigns:false`.
 */
import { NextRequest, NextResponse } from "next/server";
import { addLeadsBulk, getCampaign, listCampaigns, listLeads } from "@/lib/email-campaigns";
import { listBlocklist, isBlocked } from "@/lib/email-blocklist";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCampaign(id);
  if (!c) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const raw = Array.isArray(body.leads) ? body.leads : [];
  if (raw.length === 0) {
    return NextResponse.json({ error: "Chunk vacío" }, { status: 400 });
  }
  if (raw.length > 500) {
    return NextResponse.json({ error: "Chunk demasiado grande (máx 500 por request)" }, { status: 400 });
  }

  const skipBlocklist = body.skip_blocklist !== false;        // default true
  const skipOtherCampaigns = body.skip_other_campaigns !== false; // default true

  // Conjuntos de exclusión
  const blocklist = skipBlocklist ? await listBlocklist() : [];
  const otherEmails = new Set<string>();
  if (skipOtherCampaigns) {
    const all = await listCampaigns();
    for (const other of all) {
      if (other.id === id) continue;
      const ls = await listLeads(other.id);
      for (const l of ls) otherEmails.add(l.email.toLowerCase());
    }
  }

  let skippedBlocklist = 0;
  let skippedOther = 0;

  // Normaliza estructura: email + variables + filtra duplicados/bloqueados
  const leads: { email: string; variables: Record<string, string> }[] = [];
  for (const l of raw) {
    const email = String(l?.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue;

    if (skipBlocklist && isBlocked(email, blocklist)) { skippedBlocklist++; continue; }
    if (skipOtherCampaigns && otherEmails.has(email)) { skippedOther++; continue; }

    const variables: Record<string, string> = {};
    if (l.variables && typeof l.variables === "object") {
      for (const [k, v] of Object.entries(l.variables)) {
        if (v !== undefined && v !== null && String(v).trim() !== "") {
          variables[String(k)] = String(v);
        }
      }
    }
    leads.push({ email, variables });
  }

  const result = await addLeadsBulk(id, leads);
  return NextResponse.json({
    ok: true,
    ...result,
    skipped_blocklist: skippedBlocklist,
    skipped_other_campaigns: skippedOther,
    variables: result.campaign_variables,
  });
}
