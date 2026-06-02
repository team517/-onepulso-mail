/**
 * PATCH  /api/users/[id]  → { name?, role? }
 * POST   /api/users/[id]  → { password }  (cambia contraseña)
 * DELETE /api/users/[id]  → elimina
 */
import { NextRequest, NextResponse } from "next/server";
import { changePassword, deleteUser, safeUser, updateUser } from "@/lib/users";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: any = {};
  if (typeof body.name === "string") patch.name = body.name.trim() || undefined;
  if (body.role === "admin" || body.role === "user") patch.role = body.role;
  const u = await updateUser(id, patch);
  if (!u) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true, user: safeUser(u) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const r = await changePassword(id, String(body.password || ""));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await deleteUser(id);
  if (!ok) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
