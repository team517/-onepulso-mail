/**
 * GET /api/auth/me  → info del usuario actualmente logueado.
 *
 * Devuelve: { authenticated, id?, email?, name?, role?, is_admin, workspace? }
 *
 * El frontend lo usa para:
 *   - decidir si mostrar la pestaña "Usuarios" en /configuracion
 *   - mostrar el nombre/email del usuario activo en la nav
 *   - aislar cada perfil de los demás (workspace ID visible para debug)
 */
import { NextResponse } from "next/server";
import { getCurrentUserId, isCurrentUserAdmin, DEFAULT_ADMIN_WS } from "@/lib/workspace";
import { getUser } from "@/lib/users";

export const runtime = "nodejs";

const AUTH_EMAIL = (process.env.AUTH_EMAIL || "team@onepulso.online").trim();

export async function GET() {
  const uid = await getCurrentUserId();

  if (!uid) {
    return NextResponse.json({ authenticated: false, is_admin: false });
  }

  // Admin env (no existe entrada en la tabla users)
  if (uid === "__admin__") {
    return NextResponse.json({
      authenticated: true,
      id: "__admin__",
      email: AUTH_EMAIL,
      name: "Admin",
      role: "admin" as const,
      is_admin: true,
      workspace: DEFAULT_ADMIN_WS,
    });
  }

  const u = await getUser(uid);
  if (!u) {
    return NextResponse.json({ authenticated: false, is_admin: false });
  }

  const isAdmin = await isCurrentUserAdmin();
  return NextResponse.json({
    authenticated: true,
    id: u.id,
    email: u.email,
    name: u.name || u.email.split("@")[0],
    role: u.role,
    is_admin: isAdmin,
    workspace: `u-${u.id}`,
  });
}
