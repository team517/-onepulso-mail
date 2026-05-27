import { existsSync, readFileSync } from "fs";
import { readJson, writeJson } from "./storage";
import { dataPath } from "./data-dir";

const KEY = "credentials";
const FILE = dataPath("credentials.json"); // sólo se usa para readCredentialsSync (env override)

const KNOWN_KEYS = [
  "ANTHROPIC_API_KEY",
  "INSTANTLY_API_KEY",
  "OPENAI_API_KEY",
  "LINKEDIN_CLIENT_ID",
  "LINKEDIN_CLIENT_SECRET",
] as const;

export type CredentialKey = (typeof KNOWN_KEYS)[number];

type CredentialMap = Partial<Record<CredentialKey, string>>;

/**
 * Versión SÍNCRONA (sólo lee del filesystem local).
 * Se usa al boot para inyectar credentials en process.env antes de que
 * cualquier otra cosa lea env vars. Si no existe el archivo, devuelve {}.
 * En Railway prod las credentials vienen de env vars directamente.
 */
export function readCredentialsSync(): CredentialMap {
  try {
    if (!existsSync(FILE)) return {};
    return JSON.parse(readFileSync(FILE, "utf-8"));
  } catch {
    return {};
  }
}

export async function readCredentials(): Promise<CredentialMap> {
  return (await readJson<CredentialMap>(KEY)) ?? {};
}

export async function writeCredentials(creds: CredentialMap) {
  await writeJson(KEY, creds);
}

export async function setCredential(key: CredentialKey, value: string) {
  const cur = await readCredentials();
  if (value && value.trim()) cur[key] = value.trim();
  else delete cur[key];
  await writeCredentials(cur);
}

export async function clearCredential(key: CredentialKey) {
  const cur = await readCredentials();
  delete cur[key];
  await writeCredentials(cur);
}

export function mask(value: string | undefined): string {
  if (!value) return "";
  if (value.length <= 8) return "•".repeat(value.length);
  return value.slice(0, 6) + "•".repeat(Math.max(value.length - 10, 4)) + value.slice(-4);
}

export function isKnown(k: string): k is CredentialKey {
  return (KNOWN_KEYS as readonly string[]).includes(k);
}
