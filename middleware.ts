import { NextRequest, NextResponse } from "next/server";

const SECRET = process.env.AUTH_SECRET || "onepulso-mail-2026-session";

/** HMAC-SHA256 con Web Crypto (compatible con edge runtime). */
async function verifySession(value: string): Promise<string | null> {
  if (!value || !value.includes(".")) return null;
  const idx = value.lastIndexOf(".");
  const userId = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  if (!userId || !sig || sig.length !== 32) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const macBuf = await crypto.subtle.sign("HMAC", key, enc.encode(userId));
  const macHex = Array.from(new Uint8Array(macBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
  // timing-safe compare por longitud constante
  if (macHex.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < macHex.length; i++) diff |= macHex.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? userId : null;
}

export async function middleware(req: NextRequest) {
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
  const userId = token ? await verifySession(token) : null;

  if (!userId) {
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
