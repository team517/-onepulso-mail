/**
 * MIGRACIÓN DESACTIVADA — y rollback de la anterior.
 *
 * La migración original copió datos legacy al workspace del admin sin
 * distinguir a qué usuario pertenecían realmente. Resultado: cuentas de
 * varios usuarios (admin + Tiare etc.) acabaron mezcladas en el workspace
 * `ws/{adminWs}/...`.
 *
 * Esta versión:
 *   - BORRA todo lo que la migración previa hubiera copiado al admin workspace
 *     (excepto el marker para que no se vuelva a ejecutar).
 *   - Mantiene los datos legacy intactos en su key original (sin prefix) —
 *     ningún read del nuevo sistema los toca, pero quedan recuperables en
 *     Postgres por si el admin los quiere importar a mano más adelante.
 *   - Marca como completada para que NUNCA vuelva a correr.
 *
 * Cada usuario — incluido el admin — empieza con su workspace vacío y
 * aislado. Reconectan sus cuentas SMTP/IMAP vía Bulk CSV / Bulk IONOS.
 */
import { readJson, writeJson, deleteJson, listKeys } from "./storage";
import { DEFAULT_ADMIN_WS } from "./workspace";

const MIGRATION_MARKER = `ws/${DEFAULT_ADMIN_WS}/__migrated_v1`;
const ROLLBACK_MARKER  = `ws/${DEFAULT_ADMIN_WS}/__rollback_v1`;

/** Roll-back idempotente: borra TODO lo que esté bajo el workspace del admin
 *  (excepto el marker de rollback). Cualquier usuario que haga login después
 *  arranca limpio. */
export async function migrateAdminWorkspaceIfNeeded(): Promise<{ migrated: number; skipped: boolean; rolled_back?: number }> {
  // Si el rollback ya corrió, no tocamos nada — admin puede haber añadido
  // cuentas nuevas a su workspace y NO queremos borrarlas.
  const rolledBack = await readJson<{ at: string }>(ROLLBACK_MARKER);
  if (rolledBack) {
    return { migrated: 0, skipped: true };
  }

  // 1. Borrar TODO lo que esté bajo `ws/{adminWs}/` (datos contaminados
  //    por la migración anterior). Excluye el ROLLBACK_MARKER (que aún
  //    no existe en esta primera pasada).
  const prefix = `ws/${DEFAULT_ADMIN_WS}/`;
  const allKeys = await listKeys(prefix);
  let deleted = 0;
  for (const k of allKeys) {
    if (k === ROLLBACK_MARKER) continue;
    await deleteJson(k);
    deleted++;
  }

  // 2. Marca el rollback como hecho — Y también el MIGRATION_MARKER para
  //    que la versión vieja de migración (que pudiera quedar caché) no
  //    se ejecute.
  const now = new Date().toISOString();
  await writeJson(ROLLBACK_MARKER, { at: now, deleted });
  await writeJson(MIGRATION_MARKER, { at: now, rolled_back: true });

  console.log(`[migrate] rollback completo: ${deleted} keys borradas del admin workspace`);
  return { migrated: 0, skipped: false, rolled_back: deleted };
}
