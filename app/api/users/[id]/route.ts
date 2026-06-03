/**
 * PATCH  /api/users/[id]  → { name?, role? }      — admin O el propio usuario
 * POST   /api/users/[id]  → { password }          — admin O el propio usuario
 * DELETE /api/users/[id]  → elimina                — admin only
 */
import { NextRequest, NextResponse } from "next/server";
import { changePassword, deleteUser, safeUser, updateUser } from "@/lib/users";
import { getCurrentUserId, isCurrentUserAdmin } from "@/lib/workspace";

export const runtime = "nodejs";

async function canModify(targetId: string): Promise<boolean> {
  if (await isCurrentUserAdmin()) return true;
  const uid = await getCurrentUserId();
  return uid === targetId;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await canModify(id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const patch: any = {};
  if (typeof body.name === "string") patch.name = body.name.trim() || undefined;
  // Solo admin puede cambiar role
  if ((body.role === "admin" || body.role === "user") && (await isCurrentUserAdmin())) {
    patch.role = body.role;
  }
  const u = await updateUser(id, patch);
  if (!u) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true, user: safeUser(u) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await canModify(id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const r = await changePassword(id, String(body.password || ""));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  }
  const ok = await deleteUser(id);
  if (!ok) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
