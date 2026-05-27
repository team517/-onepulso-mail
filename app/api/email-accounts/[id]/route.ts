/**
 * PATCH /api/email-accounts/[id]
 *   Body: parcial de la cuenta (tags, display_name, first_name, last_name,
 *   daily_limit, warmup_*).  Para cambiar credenciales hay que reconectarla.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  deleteEmailAccount,
  getEmailAccount,
  safe,
  upsertEmailAccount,
} from "@/lib/email-accounts";

export const runtime = "nodejs";

const PATCHABLE = new Set([
  "display_name", "first_name", "last_name",
  "daily_limit", "warmup_enabled", "warmup_limit", "warmup_increment",
  "tags", "sent_today",
]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const acc = await getEmailAccount(id);
  if (!acc) return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, any> = {};
  for (const [k, v] of Object.entries(body)) {
    if (PATCHABLE.has(k)) patch[k] = v;
  }
  const next = { ...acc, ...patch };
  await upsertEmailAccount(next);
  return NextResponse.json({ ok: true, account: safe(next) });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await deleteEmailAccount(id);
  return NextResponse.json({ ok });
}
