// REDEPLOY MARKER: 2026-05-13 — fuerza nueva IP egress en Railway
/**
 * Next.js instrumentation hook — corre UNA VEZ al arrancar el servidor.
 *
 * Aquí arrancamos los schedulers de background:
 *  - email-scheduler: cada 30s envía follow-ups vencidos + sincroniza inbox
 *  - linkedin-scheduler: cada 30s publica posts programados
 *
 * Esto garantiza que en producción (Railway) los envíos automáticos funcionan
 * incluso si nadie abre la plataforma. El proceso Node está siempre activo
 * mientras el servicio esté corriendo.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { startEmailScheduler } = await import("./lib/email-scheduler");
    startEmailScheduler();
    console.log("[instrumentation] email-scheduler started on boot");
  } catch (e: any) {
    console.error("[instrumentation] failed to start email-scheduler:", e.message);
  }

  try {
    const { startScheduler } = await import("./lib/scheduler");
    if (typeof startScheduler === "function") {
      startScheduler();
      console.log("[instrumentation] linkedin-scheduler started on boot");
    }
  } catch (e: any) {
    console.warn("[instrumentation] linkedin-scheduler skipped:", e?.message);
  }

  // Unibox reminders: scheduler que envía recordatorios programados y
  // cancela los que recibieron respuesta del destinatario.
  try {
    const { startUniboxRemindersScheduler } = await import("./lib/unibox-reminders-scheduler");
    startUniboxRemindersScheduler();
    console.log("[instrumentation] unibox-reminders-scheduler started on boot");
  } catch (e: any) {
    console.warn("[instrumentation] unibox-reminders skipped:", e?.message);
  }

  // Personalización: marcar como "interrupted" los jobs en running tras un
  // restart Y arrancar el watchdog que los auto-reanuda cada 60s. Así, si
  // un job se queda atascado (LLM colgado, deploy en caliente, OOM, etc.)
  // se retoma solo sin intervención manual.
  try {
    const { detectInterruptedJobs, startPersonalizationWatchdog } = await import("./lib/personalization");
    const n = await detectInterruptedJobs(2);
    if (n > 0) console.log(`[instrumentation] ${n} jobs de personalizacion marcados como interrupted en boot`);
    startPersonalizationWatchdog(60_000);
    console.log("[instrumentation] personalization-watchdog started on boot (auto-resume cada 60s)");
  } catch (e: any) {
    console.warn("[instrumentation] personalization watchdog skipped:", e?.message);
  }
}
