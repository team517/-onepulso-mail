/**
 * GET  /api/settings           → settings actuales
 * POST /api/settings           → patch parcial
 */
import { NextRequest, NextResponse } from "next/server";
import { getSettings, setSettings } from "@/lib/settings";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ settings: await getSettings() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const settings = await setSettings(body);
  return NextResponse.json({ ok: true, settings });
}
