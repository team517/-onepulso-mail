/**
 * GET    /api/email-sent/[id] → detalle (con body completo)
 * DELETE /api/email-sent/[id] → borra del registro (no del IMAP)
 */
import { NextRequest, NextResponse } from "next/server";
import { deleteSent, getSentById } from "@/lib/email-sent-log";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSentById(id);
  if (!s) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json({ sent: s });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await deleteSent(id);
  if (!ok) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
