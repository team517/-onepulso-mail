import { NextRequest, NextResponse } from "next/server";

const SESSION_TOKEN = process.env.AUTH_SECRET || "onepulso-mail-2026-session";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Rutas públicas - no requieren auth
  if (
    pathname === "/landing" ||
    pathname.startsWith("/landing/") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get("onepulso_session")?.value;

  if (!token || token !== SESSION_TOKEN) {
    // Anónimo en la raíz → landing pública.
    if (pathname === "/") {
      return NextResponse.redirect(new URL("/landing", req.url));
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
