/**
 * GET    /api/email-followups       → lista de follow-ups (todos los estados)
 *   ?status=pending|sent|cancelled|failed
 *   ?thread_id=…
 *   ?account_id=…
 */
import { NextRequest, NextResponse } from "next/server";
import { listFollowUps } from "@/lib/email-followups";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const threadId = url.searchParams.get("thread_id");
  const accountId = url.searchParams.get("account_id");

  let all = await listFollowUps();
  if (status) all = all.filter((f) => f.status === status);
  if (threadId) all = all.filter((f) => f.thread_id === threadId);
  if (accountId) all = all.filter((f) => f.account_id === accountId);

  all.sort((a, b) => (a.scheduled_for || "").localeCompare(b.scheduled_for || ""));
  return NextResponse.json({ followups: all });
}
