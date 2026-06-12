import { Pool, PoolClient } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __pgInitPromise: Promise<void> | undefined;
}

/** Devuelve el pool de Postgres si DATABASE_URL está definido, si no null. */
export function getPool(): Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (globalThis.__pgPool) return globalThis.__pgPool;
  globalThis.__pgPool = new Pool({
    connectionString: url,
    ssl: url.includes("railway.internal") ? false : { rejectUnauthorized: false },
    max: 15,                       // Antes 5 → ahogaba con polls concurrentes
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return globalThis.__pgPool;
}

/** Inicializa el schema (tablas KV y blobs) si no existe. Idempotente.
 *  Memoiza UNA sola promesa para que llamadas concurrentes en el arranque
 *  no lancen CREATE TABLE en paralelo (el flag booleano anterior se seteaba
 *  tras el await, dejando una ventana de carrera). */
export async function ensureSchema(): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  if (globalThis.__pgInitPromise) return globalThis.__pgInitPromise;

  globalThis.__pgInitPromise = (async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS kv_store (
          key TEXT PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS kv_store_key_prefix_idx ON kv_store (key text_pattern_ops);

        CREATE TABLE IF NOT EXISTS blob_store (
          key TEXT PRIMARY KEY,
          mime TEXT NOT NULL DEFAULT 'application/octet-stream',
          data BYTEA NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
    } finally {
      client.release();
    }
  })();

  try {
    await globalThis.__pgInitPromise;
  } catch (e) {
    // Si falla, limpia para reintentar en la próxima llamada
    globalThis.__pgInitPromise = undefined;
    throw e;
  }
}

/** Helper para ejecutar query con conexión auto-gestionada */
export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL no configurado");
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export function isDbEnabled(): boolean {
  return !!process.env.DATABASE_URL;
}
