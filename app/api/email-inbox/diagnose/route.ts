/**
 * GET /api/email-inbox/diagnose
 *
 * Diagnóstico completo del estado del Unibox para depurar "no llegan mensajes".
 * Devuelve por cada cuenta:
 *   - imap_ok, last_imap_error
 *   - cuántos mensajes hay almacenados (total, no-warmup, warmup, bounce)
 *   - último sync
 * Más el workspace ID actual (para detectar divergencia worker↔UI).
 */
import { NextResponse } from "next/server";
import { listEmailAccounts } from "@/lib/email-accounts";
import { listMessagesForAccount, getMeta } from "@/lib/email-inbox-store";
import { getWorkspaceId } from "@/lib/workspace";

export const runtime = "nodejs";

export async function GET() {
  const ws = await getWorkspaceId();
  const accounts = await listEmailAccounts();

  const perAccount = await Promise.all(
    accounts.map(async (a) => {
      const msgs = await listMessagesForAccount(a.id);
      const meta = await getMeta(a.id);
      return {
        email: a.email,
        imap_ok: a.imap_ok,
        imap_host: a.imap_host,
        imap_port: a.imap_port,
        last_imap_error: a.last_imap_error || null,
        has_imap_credentials: !!(a.imap_host && (a.imap_user || a.email) && a.imap_password),
        stored_total: msgs.length,
        stored_legit: msgs.filter((m) => !m.is_warmup && !m.is_bounce).length,
        stored_warmup: msgs.filter((m) => m.is_warmup).length,
        stored_bounce: msgs.filter((m) => m.is_bounce).length,
        stored_from_spam: msgs.filter((m) => (m as any).from_spam).length,
        last_sync: meta.last_sync,
        last_sync_error: meta.last_error,
      };
    }),
  );

  return NextResponse.json({
    ok: true,
    workspace: ws,
    accounts_total: accounts.length,
    accounts_with_imap: perAccount.filter((a) => a.has_imap_credentials).length,
    accounts_imap_ok: perAccount.filter((a) => a.imap_ok).length,
    total_messages_stored: perAccount.reduce((s, a) => s + a.stored_total, 0),
    total_legit_visible: perAccount.reduce((s, a) => s + a.stored_legit, 0),
    accounts: perAccount,
  });
}
