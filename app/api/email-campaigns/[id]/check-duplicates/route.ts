/**
 * POST /api/email-campaigns/[id]/check-duplicates
 *
 * Body: {
 *   emails: string[],
 *   scope: {
 *     this_campaign?: boolean,    // default true — duplicados dentro de la campaña actual
 *     other_campaigns?: boolean,  // default true — duplicados en otras campañas
 *     blocklist?: boolean,        // default true — emails bloqueados global
 *   }
 * }
 *
 * Returns:
 *   {
 *     total: number,
 *     in_this_campaign: string[],      // ya están en la campaña actual
 *     in_other_campaigns: [{           // están en otras campañas
 *       email,
 *       campaigns: [{ id, name, status }]
 *     }],
 *     blocked: string[],               // están en blocklist global
 *     unique: string[],                // no aparecen en ninguna parte
 *   }
 */
import { NextRequest, NextResponse } from "next/server";
import { getCampaign, listCampaigns, listLeads } from "@/lib/email-campaigns";
import { isBlocked, listBlocklist } from "@/lib/email-blocklist";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCampaign(id);
  if (!c) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const rawEmails: string[] = Array.isArray(body?.emails) ? body.emails : [];
  const emails = Array.from(new Set(rawEmails.map((e) => (e || "").trim().toLowerCase()).filter((e) => e.includes("@"))));
  if (emails.length === 0) {
    return NextResponse.json({ error: "Sin emails que comprobar" }, { status: 400 });
  }

  const checkThis = body?.scope?.this_campaign !== false;
  const checkOther = body?.scope?.other_campaigns !== false;
  const checkBlock = body?.scope?.blocklist !== false;

  const emailSet = new Set(emails);
  const inThisCampaign: string[] = [];
  const otherMatches = new Map<string, { id: string; name: string; status: string }[]>();
  const blockedEmails: string[] = [];

  // ── Check campaña actual
  if (checkThis) {
    const thisLeads = await listLeads(id);
    for (const l of thisLeads) {
      const e = l.email.toLowerCase();
      if (emailSet.has(e)) inThisCampaign.push(e);
    }
  }

  // ── Check otras campañas
  if (checkOther) {
    const allCampaigns = await listCampaigns();
    for (const oc of allCampaigns) {
      if (oc.id === id) continue;
      const leads = await listLeads(oc.id);
      for (const l of leads) {
        const e = l.email.toLowerCase();
        if (emailSet.has(e)) {
          if (!otherMatches.has(e)) otherMatches.set(e, []);
          // Dedup por campaña (un lead duplicado dentro de otra campaña no se cuenta dos veces)
          const arr = otherMatches.get(e)!;
          if (!arr.find((x) => x.id === oc.id)) {
            arr.push({ id: oc.id, name: oc.name, status: oc.status });
          }
        }
      }
    }
  }

  // ── Check blocklist
  if (checkBlock) {
    const blocklist = await listBlocklist();
    for (const e of emails) {
      if (isBlocked(e, blocklist)) blockedEmails.push(e);
    }
  }

  // ── Unique = no aparecen en ningún sitio
  const dupSet = new Set([
    ...inThisCampaign,
    ...Array.from(otherMatches.keys()),
    ...blockedEmails,
  ]);
  const unique = emails.filter((e) => !dupSet.has(e));

  return NextResponse.json({
    total: emails.length,
    in_this_campaign: inThisCampaign,
    in_other_campaigns: Array.from(otherMatches.entries()).map(([email, campaigns]) => ({ email, campaigns })),
    blocked: blockedEmails,
    unique,
    summary: {
      duplicates_in_this_campaign: inThisCampaign.length,
      duplicates_in_other_campaigns: otherMatches.size,
      blocked: blockedEmails.length,
      unique: unique.length,
    },
  });
}
