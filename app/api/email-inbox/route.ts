/**
 * GET /api/email-inbox  → lista mensajes de TODAS las cuentas conectadas, agrupados por thread.
 *
 * Query params:
 *   ?account_id=X         filtra solo esa cuenta
 *   ?q=texto              busca en subject + from + preview
 *   ?starred=1            solo starred
 *   ?unread=1             solo no leídos (no \\Seen y no user_read)
 *   ?limit=50&offset=0
 */
import { NextRequest, NextResponse } from "next/server";
import { listEmailAccounts } from "@/lib/email-accounts";
import { listMessagesForAccount, getMeta } from "@/lib/email-inbox-store";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").toLowerCase();
  const accountId = url.searchParams.get("account_id");
  const onlyStarred = url.searchParams.get("starred") === "1";
  const onlyUnread = url.searchParams.get("unread") === "1";
  const limit = Math.max(1, Math.min(500, parseInt(url.searchParams.get("limit") || "100")));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0"));

  const accounts = await listEmailAccounts();
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const targetIds = accountId ? [accountId] : accounts.map((a) => a.id);

  const buckets = await Promise.all(targetIds.map((id) => listMessagesForAccount(id)));
  const metas = await Promise.all(targetIds.map((id) => getMeta(id)));
  let all = buckets.flat();

  // Filtros
  if (q) {
    all = all.filter((m) =>
      m.subject.toLowerCase().includes(q) ||
      m.from_address.toLowerCase().includes(q) ||
      (m.from_name || "").toLowerCase().includes(q) ||
      m.preview.toLowerCase().includes(q)
    );
  }
  if (onlyStarred) all = all.filter((m) => m.starred);
  if (onlyUnread) all = all.filter((m) => !m.flags.includes("\\Seen") && !m.user_read);

  // Ordena por fecha desc
  all.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const total = all.length;
  const sliced = all.slice(offset, offset + limit).map((m) => ({
    ...m,
    // No exponemos text/html completos en la lista (solo en el detail GET)
    text: undefined,
    html: undefined,
  }));

  return NextResponse.json({
    total,
    messages: sliced,
    accounts: targetIds.map((id, i) => ({
      id, email: accountById.get(id)?.email, smtp_ok: accountById.get(id)?.smtp_ok ?? false,
      imap_ok: accountById.get(id)?.imap_ok ?? false,
      messages_count: buckets[i].length,
      meta: metas[i],
    })),
  });
}
