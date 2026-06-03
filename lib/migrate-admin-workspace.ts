/**
 * Migración one-shot: mueve todos los datos legacy (sin prefix de workspace)
 * al workspace del admin (`ws/{DEFAULT_ADMIN_WS}/...`).
 *
 * Antes del multi-tenant las keys eran:
 *   email-accounts, email-campaigns/index, email-campaigns/{id},
 *   email-campaigns/{id}/leads, email-inbox/{accId}/messages,
 *   email-inbox/{accId}/meta, email-blocklist, email-followups,
 *   email-sent, email-templates
 *
 * Ahora son:
 *   ws/{adminWs}/email-accounts, ws/{adminWs}/email-campaigns/index, ...
 *
 * Se ejecuta UNA vez al boot. Marca `ws/{adminWs}/__migrated_v1` cuando
 * termina para no repetirse en el siguiente arranque.
 */
import { readJson, writeJson, listKeys } from "./storage";
import { DEFAULT_ADMIN_WS } from "./workspace";

const MIGRATION_MARKER = `ws/${DEFAULT_ADMIN_WS}/__migrated_v1`;

/** Prefijos legacy que pertenecen a la plataforma de email. */
const LEGACY_PREFIXES = [
  "email-accounts",
  "email-blocklist",
  "email-followups",
  "email-sent",
  "email-templates",
  "email-campaigns/",   // index + cada campaña + leads
  "email-inbox/",       // mensajes + meta por cuenta
];

export async function migrateAdminWorkspaceIfNeeded(): Promise<{ migrated: number; skipped: boolean }> {
  // Check marker
  const marker = await readJson<{ at: string }>(MIGRATION_MARKER);
  if (marker) return { migrated: 0, skipped: true };

  let migrated = 0;
  const seen = new Set<string>();

  for (const prefix of LEGACY_PREFIXES) {
    // Si el prefix NO termina en "/", es una key exacta (email-accounts, email-blocklist, etc.)
    if (!prefix.endsWith("/")) {
      if (seen.has(prefix)) continue;
      seen.add(prefix);
      const val = await readJson<any>(prefix);
      if (val !== null && val !== undefined) {
        await writeJson(`ws/${DEFAULT_ADMIN_WS}/${prefix}`, val);
        migrated++;
      }
      continue;
    }

    // Prefix "directorio": listar todas las keys que empiezan así.
    const keys = await listKeys(prefix);
    for (const k of keys) {
      if (seen.has(k)) continue;
      // Saltar las que YA están scopeadas (evita recursividad)
      if (k.startsWith("ws/")) continue;
      seen.add(k);
      const val = await readJson<any>(k);
      if (val !== null && val !== undefined) {
        await writeJson(`ws/${DEFAULT_ADMIN_WS}/${k}`, val);
        migrated++;
      }
    }
  }

  // Marca como completada
  await writeJson(MIGRATION_MARKER, { at: new Date().toISOString(), migrated });

  return { migrated, skipped: false };
}
