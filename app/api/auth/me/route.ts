import { NextRequest, NextResponse } from "next/server";

const SESSION_TOKEN = process.env.AUTH_SECRET || "onepulso-xarifa-2026-session";

/**
 * GET /api/auth/me
 * Útil para debugar el estado de la sesión.
 * Devuelve { authenticated: bool }
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get("onepulso_session")?.value;
  return NextResponse.json({
    authenticated: !!token && token === SESSION_TOKEN,
    has_cookie: !!token,
    matches: token === SESSION_TOKEN,
  });
}
