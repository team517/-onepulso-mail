/**
 * GET  /api/users  → lista de usuarios (sin password) — admin only
 * POST /api/users  → crea { email, password, name?, role? } — admin only
 *
 * El endpoint público para crear cuenta es /api/auth/signup.
 */
import { NextRequest, NextResponse } from "next/server";
import { createUser, listUsers, safeUser } from "@/lib/users";
import { isCurrentUserAdmin } from "@/lib/workspace";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  }
  const all = await listUsers();
  return NextResponse.json({ users: all.map(safeUser) });
}

export async function POST(req: NextRequest) {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const r = await createUser({
    email: String(body.email || ""),
    password: String(body.password || ""),
    name: body.name ? String(body.name) : undefined,
    role: body.role === "admin" ? "admin" : "user",
  });
  if (r.error || !r.user) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, user: safeUser(r.user) });
}
