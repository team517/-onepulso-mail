/**
 * POST /api/email-accounts/bulk-connect
 *
 * Body: { accounts: EmailAccountInput[] }
 *
 * Para cada cuenta:
 *  - Detecta SMTP/IMAP defaults (gmail / outlook / custom)
 *  - Verifica SMTP (nodemailer.verify)
 *  - Verifica IMAP (ImapFlow connect + logout)
 *  - Persiste la cuenta con el resultado (smtp_ok, imap_ok, errores)
 *
 * Devuelve un array de resultados por cuenta — el cliente sabe si todo OK o
 * qué fila falló y por qué.
 *
 * Procesa en paralelo (hasta 5 a la vez) para que un bulk de 30 cuentas tarde
 * ~6× lo que tarda 1.
 */
import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import {
  detectDefaults,
  EmailAccount,
  EmailAccountInput,
  listEmailAccounts,
  newAccountId,
  safe,
} from "@/lib/email-accounts";
import { writeJson } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

type VerifyResult = {
  email: string;
  smtp_ok: boolean;
  imap_ok: boolean;
  smtp_error?: string | null;
  imap_error?: string | null;
  smtp_ms?: number;
  imap_ms?: number;
  saved: boolean;
  account?: ReturnType<typeof safe>;
};

function cleanPass(p: string) {
  // Gmail app passwords se copian a veces con espacios — los quita.
  return (p || "").replace(/\s+/g, "");
}

async function verifySmtp(acc: {
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_password: string;
}): Promise<{ ok: boolean; error?: string; ms: number }> {
  const t0 = Date.now();
  const t = nodemailer.createTransport({
    host: acc.smtp_host,
    port: acc.smtp_port,
    secure: acc.smtp_secure,
    auth: { user: acc.smtp_user, pass: cleanPass(acc.smtp_password) },
    connectionTimeout: 10000,
    greetingTimeout: 8000,
    socketTimeout: 12000,
    family: 4,
    tls: { rejectUnauthorized: false },
    name: "onepulso.online",
  });
  try {
    await t.verify();
    return { ok: true, ms: Date.now() - t0 };
  } catch (e: any) {
    return {
      ok: false,
      error: `${e.code ? e.code + ": " : ""}${e.message}`,
      ms: Date.now() - t0,
    };
  } finally {
    try { t.close(); } catch {}
  }
}

async function verifyImap(acc: {
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  imap_user: string;
  imap_password: string;
}): Promise<{ ok: boolean; error?: string; ms: number }> {
  const t0 = Date.now();
  const client = new ImapFlow({
    host: acc.imap_host,
    port: acc.imap_port,
    secure: acc.imap_secure,
    auth: { user: acc.imap_user, pass: cleanPass(acc.imap_password) },
    logger: false,
    tls: { rejectUnauthorized: false },
  });
  try {
    // Damos timeout duro de 12s
    const connected = await Promise.race([
      client.connect().then(() => true),
      new Promise<false>((res) => setTimeout(() => res(false), 12000)),
    ]);
    if (!connected) {
      try { client.close(); } catch {}
      return { ok: false, error: "timeout 12s", ms: Date.now() - t0 };
    }
    // Listar carpetas como prueba de funcionalidad mínima
    await client.list();
    await client.logout();
    return { ok: true, ms: Date.now() - t0 };
  } catch (e: any) {
    try { client.close(); } catch {}
    return {
      ok: false,
      error: `${e.code ? e.code + ": " : ""}${e.message}`,
      ms: Date.now() - t0,
    };
  }
}

async function processOne(input: EmailAccountInput): Promise<VerifyResult> {
  const email = String(input.email || "").trim().toLowerCase();
  const sharedPass = String(input.password || "");
  const smtpPass = String(input.smtp_password || sharedPass || "");
  const imapPass = String(input.imap_password || sharedPass || "");

  if (!email || !email.includes("@") || (!smtpPass && !imapPass)) {
    return {
      email: email || "(sin email)",
      smtp_ok: false,
      imap_ok: false,
      smtp_error: "email o password vacíos",
      imap_error: "email o password vacíos",
      saved: false,
    };
  }

  const defaults = detectDefaults(email);

  // Si el usuario pasa puerto pero no secure, lo inferimos:
  //   465 → TLS implícito (secure: true)
  //   587 → STARTTLS (secure: false)
  //   25  → plain (secure: false)
  //   993 → IMAPS (secure: true)
  //   143 → IMAP plano + STARTTLS (secure: false)
  function inferSecure(port: number | undefined, fallback: boolean): boolean {
    if (port === 465 || port === 993) return true;
    if (port === 587 || port === 25 || port === 143) return false;
    return fallback;
  }

  const smtpPort = input.smtp_port || defaults.smtp_port;
  const imapPort = input.imap_port || defaults.imap_port;

  const merged = {
    email,
    display_name: input.display_name,
    provider: (input.provider || defaults.provider) as EmailAccount["provider"],
    smtp_host: input.smtp_host || defaults.smtp_host,
    smtp_port: smtpPort,
    smtp_secure: input.smtp_secure ?? inferSecure(smtpPort, defaults.smtp_secure),
    smtp_user: input.smtp_user || email,
    smtp_password: smtpPass,
    imap_host: input.imap_host || defaults.imap_host,
    imap_port: imapPort,
    imap_secure: input.imap_secure ?? inferSecure(imapPort, defaults.imap_secure),
    imap_user: input.imap_user || email,
    imap_password: imapPass,
  };

  // Verify SMTP + IMAP en paralelo (la cuenta puede aguantarlos a la vez)
  const [smtp, imap] = await Promise.all([
    verifySmtp(merged),
    verifyImap(merged),
  ]);

  const now = new Date().toISOString();
  const account: EmailAccount = {
    id: newAccountId(),
    email,
    display_name: input.display_name || [input.first_name, input.last_name].filter(Boolean).join(" "),
    first_name: input.first_name,
    last_name: input.last_name,
    smtp_host: merged.smtp_host,
    smtp_port: merged.smtp_port,
    smtp_secure: merged.smtp_secure,
    smtp_user: merged.smtp_user,
    smtp_password: cleanPass(smtpPass),
    imap_host: merged.imap_host,
    imap_port: merged.imap_port,
    imap_secure: merged.imap_secure,
    imap_user: merged.imap_user,
    imap_password: cleanPass(imapPass),
    provider: merged.provider,
    smtp_ok: smtp.ok,
    imap_ok: imap.ok,
    last_smtp_error: smtp.ok ? null : (smtp.error || "fallo desconocido"),
    last_imap_error: imap.ok ? null : (imap.error || "fallo desconocido"),
    connected_at: now,
    last_verified_at: now,
    daily_limit: input.daily_limit,
    warmup_enabled: input.warmup_enabled,
    warmup_limit: input.warmup_limit,
    warmup_increment: input.warmup_increment,
    sent_today: 0,
    tags: input.tags,
  };

  // Devolvemos la cuenta candidata; el saveBatch al final del POST se encarga
  // de escribir todas en una sola operación atómica.
  return {
    email,
    smtp_ok: smtp.ok,
    imap_ok: imap.ok,
    smtp_error: smtp.ok ? null : (smtp.error || null),
    imap_error: imap.ok ? null : (imap.error || null),
    smtp_ms: smtp.ms,
    imap_ms: imap.ms,
    saved: smtp.ok || imap.ok,
    account: safe(account),
    _accountFull: account, // marker (no se serializa fuera, lo quitamos abajo)
  } as VerifyResult & { _accountFull?: EmailAccount };
}

/** Pool con concurrencia limitada — N tareas a la vez. */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const accounts: EmailAccountInput[] = Array.isArray(body?.accounts) ? body.accounts : [];
  if (accounts.length === 0) {
    return NextResponse.json({ error: "Lista de cuentas vacía" }, { status: 400 });
  }
  if (accounts.length > 100) {
    return NextResponse.json({ error: "Máximo 100 cuentas por lote" }, { status: 400 });
  }

  const t0 = Date.now();
  const rawResults = (await runWithConcurrency(accounts, 5, processOne)) as (VerifyResult & { _accountFull?: EmailAccount })[];

  // Persistencia atómica: leemos la lista actual, mergeamos por email, escribimos UNA vez.
  // Así evitamos race conditions cuando 5 cuentas escriben en paralelo.
  const existing = await listEmailAccounts();
  const byEmail = new Map<string, EmailAccount>(existing.map((a) => [a.email.toLowerCase(), a]));

  for (const r of rawResults) {
    if (!r.saved || !r._accountFull) continue;
    const key = r._accountFull.email.toLowerCase();
    const prev = byEmail.get(key);
    if (prev) {
      // preservar id estable + counters
      byEmail.set(key, { ...r._accountFull, id: prev.id, sent_today: prev.sent_today ?? 0, tags: r._accountFull.tags || prev.tags });
    } else {
      byEmail.set(key, r._accountFull);
    }
  }

  await writeJson("email-accounts", Array.from(byEmail.values()));

  // Limpiamos el campo interno antes de enviar al cliente.
  const results: VerifyResult[] = rawResults.map(({ _accountFull, ...rest }) => rest);
  const total_ms = Date.now() - t0;

  const summary = {
    total: results.length,
    fully_ok: results.filter((r) => r.smtp_ok && r.imap_ok).length,
    smtp_ok: results.filter((r) => r.smtp_ok).length,
    imap_ok: results.filter((r) => r.imap_ok).length,
    failed: results.filter((r) => !r.smtp_ok && !r.imap_ok).length,
    saved: results.filter((r) => r.saved).length,
  };

  return NextResponse.json({ ok: true, total_ms, summary, results });
}
