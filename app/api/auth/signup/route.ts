/**
 * Endpoint público de registro. Crea un usuario nuevo con workspace aislado
 * y lo loguea automáticamente.
 */
import { NextRequest, NextResponse } from "next/server";
import { createUser, getUserByEmail } from "@/lib/users";
import { getSettings } from "@/lib/settings";
import { signSession } from "@/lib/workspace";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").toLowerCase().trim();
    const password = String(body.password || "").trim();
    const name = String(body.name || "").trim() || undefined;

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Email inválido" }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json({ error: "Contraseña mínimo 6 caracteres" }, { status: 400 });
    }

    // Dedup
    const existing = await getUserByEmail(email);
    if (existing) {
      return NextResponse.json({ error: "Ya existe una cuenta con ese email — inicia sesión" }, { status: 409 });
    }

    const { user, error } = await createUser({ email, password, name, role: "user" });
    if (error || !user) {
      return NextResponse.json({ error: error || "No se pudo crear la cuenta" }, { status: 400 });
    }

    const settings = await getSettings();
    const remember = settings.default_session_days;

    const proto = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "");
    const isHttps = proto === "https";

    const res = NextResponse.json({
      ok: true,
      user: { email: user.email, name: user.name || user.email.split("@")[0], role: user.role },
      session_days: remember,
    });
    res.cookies.set({
      name: "onepulso_session",
      value: signSession(user.id),
      httpOnly: true,
      secure: isHttps,
      sameSite: "lax",
      maxAge: remember * 24 * 60 * 60,
      path: "/",
    });
    return res;
  } catch (e: any) {
    console.error("[auth/signup] error:", e);
    return NextResponse.json({ error: e.message || "Error del servidor" }, { status: 500 });
  }
}
