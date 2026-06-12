/**
 * Usuarios de la plataforma. Multi-user lightweight: todos comparten los mismos
 * datos (cuentas, campañas, bandejas) pero cada uno tiene su propio login.
 *
 * Password hashing: pbkdf2 con SHA-256 (built-in Node, sin deps).
 *
 * Storage key: users → User[]
 */
import crypto from "crypto";
import { readJson, writeJson } from "./storage";

const KEY = "users";

export type User = {
  id: string;
  email: string;          // único — usado para login
  name?: string;          // opcional, display name
  role: "admin" | "user"; // admin puede crear/eliminar usuarios
  password_hash: string;  // pbkdf2 hex
  password_salt: string;  // hex
  created_at: string;
  last_login_at?: string | null;
};

export type SafeUser = Omit<User, "password_hash" | "password_salt"> & { has_password: boolean };

export function safeUser(u: User): SafeUser {
  const { password_hash, password_salt, ...rest } = u;
  return { ...rest, has_password: !!password_hash };
}

function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const useSalt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, useSalt, 100_000, 64, "sha256").toString("hex");
  return { hash, salt: useSalt };
}

export function verifyPassword(password: string, user: User): boolean {
  if (!password || !user.password_hash || !user.password_salt) return false;
  const { hash } = hashPassword(password, user.password_salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.password_hash, "hex"));
}

export async function listUsers(): Promise<User[]> {
  const arr = await readJson<User[]>(KEY);
  return Array.isArray(arr) ? arr : [];
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const all = await listUsers();
  const e = email.toLowerCase().trim();
  return all.find((u) => u.email.toLowerCase() === e) || null;
}

export async function getUser(id: string): Promise<User | null> {
  const all = await listUsers();
  return all.find((u) => u.id === id) || null;
}

export async function createUser(data: { email: string; password: string; name?: string; role?: "admin" | "user" }): Promise<{ user?: User; error?: string }> {
  const email = data.email.toLowerCase().trim();
  if (!email || !email.includes("@")) return { error: "Email inválido" };
  if (!data.password || data.password.length < 6) return { error: "Contraseña mínimo 6 caracteres" };
  const all = await listUsers();
  if (all.find((u) => u.email.toLowerCase() === email)) {
    return { error: "Ya existe un usuario con ese email" };
  }
  const { hash, salt } = hashPassword(data.password);
  const u: User = {
    id: crypto.randomUUID(),
    email,
    name: data.name?.trim() || undefined,
    role: data.role || "user",
    password_hash: hash,
    password_salt: salt,
    created_at: new Date().toISOString(),
    last_login_at: null,
  };
  all.unshift(u);
  await writeJson(KEY, all);
  return { user: u };
}

export async function updateUser(id: string, patch: Partial<Pick<User, "name" | "role" | "last_login_at">>): Promise<User | null> {
  const all = await listUsers();
  const idx = all.findIndex((u) => u.id === id);
  if (idx < 0) return null;
  all[idx] = { ...all[idx], ...patch, id: all[idx].id };
  await writeJson(KEY, all);
  return all[idx];
}

export async function changePassword(id: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  if (!newPassword || newPassword.length < 6) return { ok: false, error: "Contraseña mínimo 6 caracteres" };
  const all = await listUsers();
  const idx = all.findIndex((u) => u.id === id);
  if (idx < 0) return { ok: false, error: "Usuario no encontrado" };
  const { hash, salt } = hashPassword(newPassword);
  all[idx].password_hash = hash;
  all[idx].password_salt = salt;
  await writeJson(KEY, all);
  return { ok: true };
}

export async function deleteUser(id: string): Promise<boolean> {
  const all = await listUsers();
  const next = all.filter((u) => u.id !== id);
  if (next.length === all.length) return false;
  await writeJson(KEY, next);
  return true;
}
