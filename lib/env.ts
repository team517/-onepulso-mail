import { readFileSync } from "fs";
import { join } from "path";
import { readCredentialsSync } from "./credentials";

let dotenvCache: Record<string, string> | null = null;

function loadDotenv(): Record<string, string> {
  if (dotenvCache) return dotenvCache;
  dotenvCache = {};
  try {
    const content = readFileSync(join(process.cwd(), ".env.local"), "utf-8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      dotenvCache[key] = val;
    }
  } catch {
    /* no file */
  }
  return dotenvCache;
}

/**
 * Resolución de credenciales en orden de prioridad:
 *   1. data/credentials.json  (fijado desde la UI — siempre gana)
 *   2. process.env (si tiene valor real)
 *   3. .env.local
 */
export function envVar(name: string): string {
  // 1. credentials.json
  try {
    const creds = readCredentialsSync();
    if ((creds as any)[name] && (creds as any)[name].length > 0) {
      return (creds as any)[name];
    }
  } catch {
    /* skip */
  }
  // 2. process.env
  const fromProcess = process.env[name];
  if (fromProcess && fromProcess.length > 0) return fromProcess;
  // 3. .env.local file
  return loadDotenv()[name] ?? "";
}
