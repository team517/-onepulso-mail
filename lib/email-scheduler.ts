/**
 * Wrapper para arrancar el worker de envíos al boot del servidor.
 *
 * Importado por `instrumentation.ts` — garantiza que el worker está
 * corriendo desde el momento que Railway/Node levanta el proceso, sin
 * depender de que llegue una request HTTP primero.
 */
import { startWorker, stopWorker, getWorkerStatus } from "./email-campaign-worker";

let started = false;

/** Idempotente — llamarlo N veces no arranca N workers. */
export function startEmailScheduler(intervalSeconds = 30): void {
  if (started) return;
  started = true;
  startWorker(intervalSeconds);
}

export function stopEmailScheduler(): void {
  if (!started) return;
  started = false;
  stopWorker();
}

export function emailSchedulerStatus() {
  return { started, ...getWorkerStatus() };
}
