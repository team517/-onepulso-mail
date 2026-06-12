/**
 * Next.js instrumentation hook — corre UNA VEZ al arrancar el servidor.
 *
 * Arranca el worker de envíos + sync IMAP en background, garantizando que
 * en producción (Railway) los envíos automáticos y la sincronización del
 * Unibox funcionan aunque nadie abra la web. El proceso Node sigue activo
 * mientras el servicio esté corriendo.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // ── Migración one-shot: rollback de datos legacy del admin workspace ──
  try {
    const { migrateAdminWorkspaceIfNeeded } = await import("./lib/migrate-admin-workspace");
    const r = await migrateAdminWorkspaceIfNeeded();
    if (r.skipped) {
      console.log("[instrumentation] admin-workspace migration already done");
    } else {
      console.log(`[instrumentation] admin-workspace migration: ${r.migrated} keys migrated`);
    }
  } catch (e: any) {
    console.error("[instrumentation] admin-workspace migration failed:", e?.message);
  }

  // ── Worker de envíos + sync IMAP (lo único que esta plataforma necesita) ──
  try {
    const { startEmailScheduler } = await import("./lib/email-scheduler");
    startEmailScheduler();
    console.log("[instrumentation] email worker + IMAP sync started on boot");
  } catch (e: any) {
    console.error("[instrumentation] failed to start email worker:", e?.message);
  }
}
