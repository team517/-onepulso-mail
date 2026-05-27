/**
 * DELETE /api/email-followups/[id]   → cancela (marca cancelled)
 * PATCH  /api/email-followups/[id]   → edita body/subject/scheduled_for/only_if_no_reply
 */
import { NextRequest, NextResponse } from "next/server";
import { cancelFollowUp, getFollowUp, updateFollowUp } from "@/lib/email-followups";

export const runtime = "nodejs";

const PATCHABLE = new Set(["body", "subject", "scheduled_for", "only_if_no_reply"]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fu = await getFollowUp(id);
  if (!fu) return NextResponse.json({ error: "Follow-up no encontrado" }, { status: 404 });
  if (fu.status !== "pending") {
    return NextResponse.json({ error: `No editable (status=${fu.status})` }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const patch: any = {};
  for (const [k, v] of Object.entries(body)) {
    if (PATCHABLE.has(k)) patch[k] = v;
  }
  if (patch.scheduled_for) {
    const d = new Date(String(patch.scheduled_for));
    if (isNaN(d.getTime())) return NextResponse.json({ error: "scheduled_for inválido" }, { status: 400 });
    patch.scheduled_for = d.toISOString();
  }
  const updated = await updateFollowUp(id, patch);
  return NextResponse.json({ ok: true, followup: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await cancelFollowUp(id);
  if (!ok) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
