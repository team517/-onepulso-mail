/**
 * POST /api/email-inbox/sync
 *   Body: { account_id?: string }
 *
 * Si se pasa account_id, sincroniza solo esa. Si no, todas.
 */
import { NextRequest, NextResponse } from "next/server";
import { listEmailAccounts } from "@/lib/email-accounts";
import { syncAllInboxes, syncInboxForAccount } from "@/lib/email-inbox-sync";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const accountId = body.account_id ? String(body.account_id) : null;
  const accounts = await listEmailAccounts();

  if (accountId) {
    const acc = accounts.find((a) => a.id === accountId);
    if (!acc) return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
    const r = await syncInboxForAccount(acc);
    return NextResponse.json({ ok: true, results: [r] });
  }
  const results = await syncAllInboxes(accounts, 3);
  return NextResponse.json({
    ok: true,
    summary: {
      total_accounts: results.length,
      ok_accounts: results.filter((r) => r.ok).length,
      new_messages: results.reduce((s, r) => s + r.new_count, 0),
      warmup_filtered: results.reduce((s, r) => s + r.warmup_filtered, 0),
      bounce_filtered: results.reduce((s, r) => s + r.bounce_filtered, 0),
    },
    results,
  });
}
