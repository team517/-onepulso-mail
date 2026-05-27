/**
 * POST /api/email-campaigns/[id]/leads/chunk
 *
 * Body: { leads: [{ email, variables: {...} }, ...] }
 *
 * Importa un chunk de leads pre-parseados. El cliente parsea el CSV una vez
 * y envía batches de 100 para mostrar progreso al usuario sin chocar contra
 * el body-size limit ni colgar el navegador con grandes payloads.
 */
import { NextRequest, NextResponse } from "next/server";
import { addLeadsBulk, getCampaign } from "@/lib/email-campaigns";

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

  // Normaliza estructura: email (string) + variables (Record)
  const leads: { email: string; variables: Record<string, string> }[] = [];
  for (const l of raw) {
    const email = String(l?.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
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
  // Devolvemos campaign_variables (cumulativas en la campaña) además de las
  // del chunk, para que el cliente pueda actualizar la UI sin re-fetch.
  return NextResponse.json({
    ok: true,
    ...result,
    variables: result.campaign_variables, // <-- el cliente las usa como fuente de verdad
  });
}
