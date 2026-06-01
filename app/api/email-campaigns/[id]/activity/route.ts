/**
 * GET /api/email-campaigns/[id]/activity → timeline de eventos de la campaña.
 *
 * Agrega:
 *   - Envíos (de email-sent log, type=campaign + type=followup)
 *   - Estados finales de leads (replied / bounced / unsubscribed / completed)
 *
 * Ordenado por fecha desc. Cada evento tiene:
 *   { type, at, lead_email, account_email?, subject?, error?, ... }
 */
import { NextRequest, NextResponse } from "next/server";
import { getCampaign, listLeads } from "@/lib/email-campaigns";
import { listSent } from "@/lib/email-sent-log";

export const runtime = "nodejs";

type Event = {
  id: string;
  type: "sent" | "send_failed" | "replied" | "bounced" | "unsubscribed" | "completed";
  at: string;
  lead_email?: string;
  account_email?: string;
  subject?: string;
  step?: number;
  variant?: string;
  error?: string | null;
  reason?: string | null;
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCampaign(id);
  if (!c) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });

  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(500, parseInt(url.searchParams.get("limit") || "200")));
  const filter = url.searchParams.get("type"); // sent | replied | bounced | ...

  const events: Event[] = [];

  // 1. Envíos desde el log
  const sent = await listSent();
  for (const s of sent) {
    if (s.campaign_id !== id) continue;
    events.push({
      id: s.id,
      type: s.ok ? "sent" : "send_failed",
      at: s.sent_at,
      lead_email: s.lead_email || s.to_address,
      account_email: s.account_email,
      subject: s.subject,
      step: s.campaign_step,
      variant: s.campaign_variant,
      error: s.error || null,
    });
  }

  // 2. Estados finales de leads
  const leads = await listLeads(id);
  for (const l of leads) {
    if (l.status === "replied") {
      events.push({
        id: `reply-${l.id}`,
        type: "replied",
        // Si guardamos replied_at, úsalo; si no, último contacto
        at: (l as any).replied_at || l.last_contacted_at || l.added_at,
        lead_email: l.email,
        reason: l.finished_reason,
      });
    } else if (l.status === "bounced") {
      events.push({
        id: `bounce-${l.id}`,
        type: "bounced",
        at: l.last_contacted_at || l.added_at,
        lead_email: l.email,
        reason: l.finished_reason,
      });
    } else if (l.status === "unsubscribed") {
      events.push({
        id: `unsub-${l.id}`,
        type: "unsubscribed",
        at: l.last_contacted_at || l.added_at,
        lead_email: l.email,
        reason: l.finished_reason,
      });
    } else if (l.status === "completed") {
      events.push({
        id: `done-${l.id}`,
        type: "completed",
        at: l.last_contacted_at || l.added_at,
        lead_email: l.email,
        reason: l.finished_reason || "completed sequence",
      });
    }
  }

  // Filtro
  let filtered = events;
  if (filter) filtered = filtered.filter((e) => e.type === filter);

  // Orden desc por fecha
  filtered.sort((a, b) => (b.at || "").localeCompare(a.at || ""));

  return NextResponse.json({
    total: filtered.length,
    events: filtered.slice(0, limit),
    summary: {
      sent: events.filter((e) => e.type === "sent").length,
      send_failed: events.filter((e) => e.type === "send_failed").length,
      replied: events.filter((e) => e.type === "replied").length,
      bounced: events.filter((e) => e.type === "bounced").length,
      unsubscribed: events.filter((e) => e.type === "unsubscribed").length,
      completed: events.filter((e) => e.type === "completed").length,
    },
  });
}
