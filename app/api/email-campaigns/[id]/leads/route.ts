/**
 * GET    /api/email-campaigns/[id]/leads          → lista (con paginación opcional)
 * POST   /api/email-campaigns/[id]/leads          → añade leads (JSON o CSV)
 *
 *   JSON: { leads: [{ email, ...vars }] }
 *   CSV:  { csv: "email,first_name,..." }
 *
 * Auto-detecta columnas como variables. La columna `email` es obligatoria.
 *
 * DELETE /api/email-campaigns/[id]/leads          → borra leads { ids: [...] }
 */
import { NextRequest, NextResponse } from "next/server";
import { addLeadsBulk, deleteLeads, getCampaign, listLeads } from "@/lib/email-campaigns";
import { headerToKey, parseLeadsCsv } from "@/lib/csv-leads";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCampaign(id);
  if (!c) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").toLowerCase();
  const status = url.searchParams.get("status");
  const limit = Math.max(1, Math.min(500, parseInt(url.searchParams.get("limit") || "100")));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0"));

  let leads = await listLeads(id);
  if (q) {
    leads = leads.filter((l) =>
      l.email.includes(q) ||
      Object.values(l.variables).some((v) => String(v).toLowerCase().includes(q))
    );
  }
  if (status) {
    leads = leads.filter((l) => l.status === status);
  }
  const total = leads.length;
  return NextResponse.json({
    total,
    leads: leads.slice(offset, offset + limit),
    variables: c.variables,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCampaign(id);
  if (!c) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });

  // Detectamos el tipo de body:
  //   - multipart/form-data → para CSVs grandes (file + selected_lines JSON string)
  //   - application/json    → { csv?, leads?, selected_lines? } para pegado pequeño
  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  let csv = "";
  let jsonLeads: any[] | null = null;
  let selectedLines: Set<number> | null = null;

  if (contentType.startsWith("multipart/form-data")) {
    const fd = await req.formData();
    const file = fd.get("file");
    if (file && typeof (file as any).text === "function") {
      csv = await (file as Blob).text();
    } else {
      // Fallback: campo csv como texto
      const ct = fd.get("csv");
      if (typeof ct === "string") csv = ct;
    }
    const sl = fd.get("selected_lines");
    if (typeof sl === "string" && sl.trim()) {
      try {
        const arr = JSON.parse(sl);
        if (Array.isArray(arr)) selectedLines = new Set(arr.map((n: any) => Number(n)));
      } catch {}
    }
  } else {
    const body = await req.json().catch(() => ({}));
    if (typeof body.csv === "string") csv = body.csv;
    if (Array.isArray(body.leads)) jsonLeads = body.leads;
    if (Array.isArray(body.selected_lines)) {
      selectedLines = new Set<number>(body.selected_lines.map((n: any) => Number(n)));
    }
  }

  let rows: { email: string; variables: Record<string, string> }[] = [];
  let detectedVars: string[] = [];
  let errorRows: { line: number; reason: string; email?: string }[] = [];
  let blankRowsSkipped = 0;

  if (csv.trim()) {
    const parsed = parseLeadsCsv(csv);
    if (parsed.rawHeaders.length === 0) {
      return NextResponse.json({ error: "CSV vacío o sin cabeceras" }, { status: 400 });
    }
    if (!parsed.emailHeader) {
      return NextResponse.json({
        error: "El CSV no tiene columna de email",
        hint: "Añade una columna llamada `email`, `e-mail`, `correo` (case-insensitive).",
        detected_headers: parsed.rawHeaders,
      }, { status: 400 });
    }
    detectedVars = parsed.variableKeys;
    blankRowsSkipped = parsed.blankRowsSkipped;

    for (const r of parsed.rows) {
      if (selectedLines && !selectedLines.has(r.line)) continue;
      if (r.__error) { errorRows.push({ line: r.line, reason: r.__error, email: r.email || undefined }); continue; }
      rows.push({ email: r.email, variables: r.variables });
    }
  } else if (jsonLeads) {
    rows = jsonLeads.map((l: any) => ({
      email: String(l.email || "").trim().toLowerCase(),
      variables: Object.fromEntries(
        Object.entries(l).filter(([k]) => k !== "email").map(([k, v]) => [headerToKey(k), String(v ?? "")])
      ),
    })).filter((r: any) => r.email);
    detectedVars = Array.from(new Set(rows.flatMap((r) => Object.keys(r.variables))));
  } else {
    return NextResponse.json({ error: "Manda { csv } o { leads: [] }" }, { status: 400 });
  }

  const result = await addLeadsBulk(id, rows);
  return NextResponse.json({
    ok: true,
    ...result,
    detected_variables: detectedVars,
    blank_rows_skipped: blankRowsSkipped,
    error_rows: errorRows,
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
  if (ids.length === 0) return NextResponse.json({ error: "Falta lista 'ids'" }, { status: 400 });
  const removed = await deleteLeads(id, ids);
  return NextResponse.json({ ok: true, removed });
}
