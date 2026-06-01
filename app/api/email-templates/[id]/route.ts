/**
 * GET    /api/email-templates/[id]
 * PATCH  /api/email-templates/[id]   → edit
 * DELETE /api/email-templates/[id]
 * POST   /api/email-templates/[id]/use   → marca usado (idempotente)
 */
import { NextRequest, NextResponse } from "next/server";
import { deleteTemplate, getTemplate, markTemplateUsed, updateTemplate } from "@/lib/email-templates";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTemplate(id);
  if (!t) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  return NextResponse.json({ template: t });
}

const PATCHABLE = new Set(["name", "subject", "body", "category", "tags"]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: any = {};
  for (const [k, v] of Object.entries(body)) {
    if (PATCHABLE.has(k)) patch[k] = v;
  }
  const t = await updateTemplate(id, patch);
  if (!t) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true, template: t });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await deleteTemplate(id);
  if (!ok) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // POST se usa para "use" (marcar como usada)
  const { id } = await params;
  await markTemplateUsed(id);
  return NextResponse.json({ ok: true });
}
