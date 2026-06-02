/**
 * GET  /api/users  → lista de usuarios (sin password)
 * POST /api/users  → crea { email, password, name?, role? }
 */
import { NextRequest, NextResponse } from "next/server";
import { createUser, listUsers, safeUser } from "@/lib/users";

export const runtime = "nodejs";

export async function GET() {
  const all = await listUsers();
  return NextResponse.json({ users: all.map(safeUser) });
}

export async function POST(req: NextRequest) {
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
