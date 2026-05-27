/**
 * GET /api/email-sent → lista de enviados con filtros + paginación
 *   ?type=reply|followup|test|campaign
 *   ?account_id=…
 *   ?thread_id=…
 *   ?campaign_id=…
 *   ?q=texto       busca en subject + to + body
 *   ?limit=100&offset=0
 */
import { NextRequest, NextResponse } from "next/server";
import { listSent } from "@/lib/email-sent-log";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const accountId = url.searchParams.get("account_id");
  const threadId = url.searchParams.get("thread_id");
  const campaignId = url.searchParams.get("campaign_id");
  const q = (url.searchParams.get("q") || "").toLowerCase();
  const limit = Math.max(1, Math.min(500, parseInt(url.searchParams.get("limit") || "100")));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0"));

  let all = await listSent();
  if (type) all = all.filter((s) => s.type === type);
  if (accountId) all = all.filter((s) => s.account_id === accountId);
  if (threadId) all = all.filter((s) => s.thread_id === threadId);
  if (campaignId) all = all.filter((s) => s.campaign_id === campaignId);
  if (q) {
    all = all.filter((s) =>
      s.subject.toLowerCase().includes(q) ||
      s.to_address.toLowerCase().includes(q) ||
      (s.to_name || "").toLowerCase().includes(q) ||
      s.body.toLowerCase().includes(q)
    );
  }

  // Ya viene ordenado desc por sent_at desde el store
  const total = all.length;
  const sliced = all.slice(offset, offset + limit).map((s) => ({
    // No exponemos body_html completo en la lista (solo en el detail)
    ...s,
    body_html: undefined,
  }));
  return NextResponse.json({ total, sent: sliced });
}
