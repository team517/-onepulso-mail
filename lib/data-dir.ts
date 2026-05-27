import path from "path";

/**
 * Devuelve la ruta base donde se guarda toda la data (threads, configs, memoria, etc.).
 *
 * En local: ./data
 * En Railway: usar variable de entorno DATA_DIR apuntando a un Volume montado (ej. /data).
 *
 * Para configurar en Railway:
 *   1) Settings → Volumes → Add Volume → mount path "/data"
 *   2) Variables → DATA_DIR=/data
 */
export function getDataDir(): string {
  if (process.env.DATA_DIR && process.env.DATA_DIR.trim()) {
    return process.env.DATA_DIR.trim();
  }
  return path.join(process.cwd(), "data");
}

/** Devuelve la ruta completa a un archivo dentro del data dir */
export function dataPath(...segments: string[]): string {
  return path.join(getDataDir(), ...segments);
}
