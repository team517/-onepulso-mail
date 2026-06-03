/**
 * Sistema de workspaces — cada usuario tiene su propio espacio aislado.
 *
 * El workspace ID se obtiene de:
 *   1. AsyncLocalStorage context (usado por el worker que itera usuarios)
 *   2. Cookie de sesión firmada (userId.hmac)
 *   3. Fallback: workspace del AUTH_EMAIL env (admin de emergencia)
 *
 * Las storage keys se prefijan con `ws/{workspace}/` automáticamente.
 */
import { cookies } from "next/headers";
import { AsyncLocalStorage } from "async_hooks";
import crypto from "crypto";

const SECRET = process.env.AUTH_SECRET || "onepulso-mail-2026-session";
const AUTH_EMAIL = (process.env.AUTH_EMAIL || "team@onepulso.online").trim().toLowerCase();
/** Workspace del admin original (AUTH_EMAIL). Determinístico por email para
 *  que cualquier deploy reuse los mismos datos. */
export const DEFAULT_ADMIN_WS = `admin-${crypto.createHash("sha1").update(AUTH_EMAIL).digest("hex").slice(0, 12)}`;

const ctx = new AsyncLocalStorage<string>();

/** Firma userId con HMAC para el cookie de sesión. */
export function signSession(userId: string): string {
  const sig = crypto.createHmac("sha256", SECRET).update(userId).digest("hex").slice(0, 32);
  return `${userId}.${sig}`;
}

/** Verifica el formato firmado del cookie. Devuelve userId si OK. */
export function verifySession(value: string): string | null {
  if (!value || !value.includes(".")) return null;
  const idx = value.lastIndexOf(".");
  const userId = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  if (!userId || !sig) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(userId).digest("hex").slice(0, 32);
  // timing-safe compare
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex")) ? userId : null;
  } catch {
    return null;
  }
}

/** Workspace ID para la request actual. AsyncLocalStorage > cookies > anon.
 *  NUNCA cae a admin si la sesión es inválida/ausente — eso provocaría que
 *  un usuario sin sesión válida leyera/escribiera en el espacio del admin. */
export async function getWorkspaceId(): Promise<string> {
  const fromCtx = ctx.getStore();
  if (fromCtx) return fromCtx;
  try {
    const c = await cookies();
    const sess = c.get("onepulso_session")?.value;
    if (sess) {
      const userId = verifySession(sess);
      if (userId === "__admin__") return DEFAULT_ADMIN_WS;
      if (userId) return `u-${userId}`;
    }
  } catch {}
  // Workspace inerte: cualquier lectura devolverá vacío, cualquier escritura
  // se almacena en un namespace huérfano que nadie más ve. El middleware
  // debería haber redirigido a /login antes de llegar aquí.
  return "anon-no-session";
}

/** Ejecuta una función en un workspace concreto. Lo usa el worker iterando users. */
export function withWorkspace<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return ctx.run(workspaceId, fn);
}

/** Lista de TODOS los workspace IDs conocidos: admin + 1 por usuario.
 *  El worker lo usa para iterar. */
export async function listAllWorkspaces(): Promise<string[]> {
  const { listUsers } = await import("./users");
  const users = await listUsers();
  return [DEFAULT_ADMIN_WS, ...users.map((u) => `u-${u.id}`)];
}

/** Compone una clave de storage prefijada por el workspace actual. */
export async function scopedKey(key: string): Promise<string> {
  const ws = await getWorkspaceId();
  return `ws/${ws}/${key}`;
}

/** Devuelve el userId firmado del cookie (sin namespace ws/). null si no hay sesión válida. */
export async function getCurrentUserId(): Promise<string | null> {
  try {
    const c = await cookies();
    const sess = c.get("onepulso_session")?.value;
    if (!sess) return null;
    return verifySession(sess);
  } catch {
    return null;
  }
}

/** El usuario actual es el admin del entorno (AUTH_EMAIL via env)? */
export async function isCurrentUserAdmin(): Promise<boolean> {
  const uid = await getCurrentUserId();
  if (uid === "__admin__") return true;
  if (!uid) return false;
  // Usuario creado en la plataforma con role: "admin"
  const { getUser } = await import("./users");
  const u = await getUser(uid);
  return u?.role === "admin";
}

/** El usuario actual está logueado? Para gating de endpoints. */
export async function requireAuth(): Promise<string | null> {
  return await getCurrentUserId();
}
