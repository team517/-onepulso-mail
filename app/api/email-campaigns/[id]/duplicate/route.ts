import { NextRequest, NextResponse } from "next/server";
import { duplicateCampaign } from "@/lib/email-campaigns";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const name = body.name ? String(body.name) : undefined;
  const c = await duplicateCampaign(id, name);
  if (!c) return NextResponse.json({ error: "No se pudo duplicar" }, { status: 404 });
  return NextResponse.json({ ok: true, campaign: c });
}
