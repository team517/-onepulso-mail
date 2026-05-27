/**
 * POST /api/email-accounts/verify
 * Body: { ids: string[] }  (si está vacío, verifica todas)
 *
 * Re-verifica cuentas YA guardadas usando las credenciales en el store.
 * Actualiza smtp_ok / imap_ok / errors / last_verified_at.
 */
import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import {
  EmailAccount,
  listEmailAccounts,
  safe,
  upsertEmailAccount,
} from "@/lib/email-accounts";

export const runtime = "nodejs";
export const maxDuration = 120;

function cleanPass(p: string) {
  return (p || "").replace(/\s+/g, "");
}

async function verifySmtp(a: EmailAccount) {
  const t0 = Date.now();
  const t = nodemailer.createTransport({
    host: a.smtp_host, port: a.smtp_port, secure: a.smtp_secure,
    auth: { user: a.smtp_user, pass: cleanPass(a.smtp_password) },
    connectionTimeout: 10000, greetingTimeout: 8000, socketTimeout: 12000,
    family: 4, tls: { rejectUnauthorized: false }, name: "onepulso.online",
  });
  try {
    await t.verify();
    return { ok: true, ms: Date.now() - t0, error: null as string | null };
  } catch (e: any) {
    return { ok: false, ms: Date.now() - t0, error: `${e.code ? e.code + ": " : ""}${e.message}` };
  } finally {
    try { t.close(); } catch {}
  }
}

async function verifyImap(a: EmailAccount) {
  const t0 = Date.now();
  const client = new ImapFlow({
    host: a.imap_host, port: a.imap_port, secure: a.imap_secure,
    auth: { user: a.imap_user, pass: cleanPass(a.imap_password) },
    logger: false, tls: { rejectUnauthorized: false },
  });
  try {
    const ok = await Promise.race([
      client.connect().then(() => true),
      new Promise<false>((res) => setTimeout(() => res(false), 12000)),
    ]);
    if (!ok) {
      try { client.close(); } catch {}
      return { ok: false, ms: Date.now() - t0, error: "timeout 12s" };
    }
    await client.list();
    await client.logout();
    return { ok: true, ms: Date.now() - t0, error: null as string | null };
  } catch (e: any) {
    try { client.close(); } catch {}
    return { ok: false, ms: Date.now() - t0, error: `${e.code ? e.code + ": " : ""}${e.message}` };
  }
}

async function runWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
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
  let body: any = {};
  try { body = await req.json(); } catch {}
  const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];

  const all = await listEmailAccounts();
  const target = ids.length ? all.filter((a) => ids.includes(a.id)) : all;
  if (target.length === 0) {
    return NextResponse.json({ ok: true, results: [], summary: { total: 0, fully_ok: 0 } });
  }

  const t0 = Date.now();
  const results = await runWithConcurrency(target, 5, async (a) => {
    const [smtp, imap] = await Promise.all([verifySmtp(a), verifyImap(a)]);
    const updated: EmailAccount = {
      ...a,
      smtp_ok: smtp.ok,
      imap_ok: imap.ok,
      last_smtp_error: smtp.ok ? null : smtp.error,
      last_imap_error: imap.ok ? null : imap.error,
      last_verified_at: new Date().toISOString(),
    };
    await upsertEmailAccount(updated);
    return {
      id: a.id,
      email: a.email,
      smtp_ok: smtp.ok, imap_ok: imap.ok,
      smtp_error: smtp.error, imap_error: imap.error,
      smtp_ms: smtp.ms, imap_ms: imap.ms,
      account: safe(updated),
    };
  });

  return NextResponse.json({
    ok: true,
    total_ms: Date.now() - t0,
    summary: {
      total: results.length,
      fully_ok: results.filter((r) => r.smtp_ok && r.imap_ok).length,
    },
    results,
  });
}
