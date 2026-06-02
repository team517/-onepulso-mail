import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail, updateUser, verifyPassword } from "@/lib/users";
import { getSettings } from "@/lib/settings";
import { signSession } from "@/lib/workspace";

const AUTH_EMAIL = (process.env.AUTH_EMAIL || "team@onepulso.online").trim();
const AUTH_PASSWORD = (process.env.AUTH_PASSWORD || "Xarifa229%").trim();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").toLowerCase().trim();
    const password = String(body.password || "").trim();

    const settings = await getSettings();
    const requested = Number(body.remember) || settings.default_session_days;
    const remember = Math.max(1, Math.min(settings.max_session_days, requested));

    let authed = false;
    let displayName: string | undefined;
    let role: "admin" | "user" = "admin";
    let sessionUserId: string | null = null;

    // 1. Comprueba usuarios creados en la plataforma (multi-usuario)
    const user = await getUserByEmail(email);
    if (user && verifyPassword(password, user)) {
      authed = true;
      displayName = user.name || user.email.split("@")[0];
      role = user.role;
      sessionUserId = user.id;
      await updateUser(user.id, { last_login_at: new Date().toISOString() });
    }

    // 2. Fallback al AUTH_EMAIL / AUTH_PASSWORD env (admin de emergencia)
    if (!authed && email === AUTH_EMAIL.toLowerCase() && password === AUTH_PASSWORD) {
      authed = true;
      displayName = "Admin";
      role = "admin";
      sessionUserId = "__admin__";
    }

    if (!authed) {
      return NextResponse.json(
        {
          error: "Email o contraseña incorrectos",
          hint: user ? "Contraseña incorrecta" : "No hay usuario con ese email — créalo desde Configuración",
        },
        { status: 401 }
      );
    }

    const proto = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "");
    const isHttps = proto === "https";

    const res = NextResponse.json({
      ok: true,
      user: { email, name: displayName, role },
      session_days: remember,
    });
    res.cookies.set({
      name: "onepulso_session",
      value: signSession(sessionUserId!),
      httpOnly: true,
      secure: isHttps,
      sameSite: "lax",
      maxAge: remember * 24 * 60 * 60,
      path: "/",
    });

    return res;
  } catch (e: any) {
    console.error("[auth/login] error:", e);
    return NextResponse.json({ error: e.message || "Error del servidor" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    expected_email: AUTH_EMAIL,
    multi_user: true,
  });
}
