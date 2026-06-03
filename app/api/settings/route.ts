/**
 * GET  /api/settings           → settings actuales (cualquier autenticado puede leer)
 * POST /api/settings           → patch parcial (admin only)
 */
import { NextRequest, NextResponse } from "next/server";
import { getSettings, setSettings } from "@/lib/settings";
import { getCurrentUserId, isCurrentUserAdmin } from "@/lib/workspace";

export const runtime = "nodejs";

export async function GET() {
  if (!(await getCurrentUserId())) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  return NextResponse.json({ settings: await getSettings() });
}

export async function POST(req: NextRequest) {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const settings = await setSettings(body);
  return NextResponse.json({ ok: true, settings });
}
