/**
 * GET /api/email-inbox  → lista mensajes de TODAS las cuentas conectadas, agrupados por thread.
 *
 * Query params:
 *   ?account_id=X            filtra solo esa cuenta
 *   ?q=texto                 busca en subject + from + preview
 *   ?starred=1               solo starred
 *   ?unread=1                solo no leídos (no \\Seen y no user_read)
 *   ?include_warmup=1        incluye mensajes marcados como warmup (default: ocultos)
 *   ?include_bounces=1       incluye bounces NDR (default: ocultos)
 *   ?only_warmup=1           SOLO warmup (vista de auditoría)
 *   ?only_bounces=1          SOLO bounces (vista de auditoría)
 *   ?limit=50&offset=0
 */
import { NextRequest, NextResponse } from "next/server";
import { listEmailAccounts } from "@/lib/email-accounts";
import { listMessagesForAccount, getMeta } from "@/lib/email-inbox-store";
import { listCampaigns, listLeads } from "@/lib/email-campaigns";
import { isAutoReply } from "@/lib/email-bounce";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").toLowerCase();
  const accountId = url.searchParams.get("account_id");
  const onlyStarred = url.searchParams.get("starred") === "1";
  const onlyUnread = url.searchParams.get("unread") === "1";
  const includeWarmup = url.searchParams.get("include_warmup") === "1";
  const includeBounces = url.searchParams.get("include_bounces") === "1";
  const onlyWarmup = url.searchParams.get("only_warmup") === "1";
  const onlyBounces = url.searchParams.get("only_bounces") === "1";
  const limit = Math.max(1, Math.min(500, parseInt(url.searchParams.get("limit") || "100")));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0"));

  const accounts = await listEmailAccounts();
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const targetIds = accountId ? [accountId] : accounts.map((a) => a.id);

  const buckets = await Promise.all(targetIds.map((id) => listMessagesForAccount(id)));
  const metas = await Promise.all(targetIds.map((id) => getMeta(id)));
  let all = buckets.flat();

  // Indexa leads por email → permite marcar mensajes que son respuestas de
  // leads en cualquiera de tus campañas (resaltado verde "🎯 Reply de X").
  const leadIndex = new Map<string, { campaign_id: string; campaign_name: string; lead_status: string }>();
  try {
    const campaigns = await listCampaigns();
    for (const c of campaigns) {
      const leads = await listLeads(c.id);
      for (const l of leads) {
        // Solo metemos la PRIMERA campaña que contiene el lead (si está en
        // varias). Suficiente para mostrar el badge.
        const key = l.email.toLowerCase();
        if (!leadIndex.has(key)) {
          leadIndex.set(key, { campaign_id: c.id, campaign_name: c.name, lead_status: l.status });
        }
      }
    }
  } catch {}

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

  // Filtros warmup / bounces:
  //   · Vista por defecto: oculta warmup + bounces (lo legítimo de un cold email)
  //   · only_warmup → solo warmup (auditoría)
  //   · only_bounces → solo bounces (revisar NDRs)
  //   · include_* → no filtra (lo ves todo)
  if (onlyWarmup) {
    all = all.filter((m) => m.is_warmup);
  } else if (onlyBounces) {
    all = all.filter((m) => m.is_bounce);
  } else {
    if (!includeWarmup) all = all.filter((m) => !m.is_warmup);
    if (!includeBounces) all = all.filter((m) => !m.is_bounce);
  }

  // Ordena por fecha desc
  all.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  // ── DEDUPE de "broadcasts" (mismo remitente envía a varias de TUS cuentas) ──
  // Si un mismo from + mismo subject (sin "Re:") llega a varias de nuestras
  // cuentas en el mismo día, son la MISMA conversación lógica. Mostramos solo
  // la más reciente y agregamos las otras cuentas en `also_received_by`.
  //
  // Esto resuelve el caso: alguien hace reply-all a 5 de tus cuentas que le
  // mandaste cold email → no quieres ver 5 mensajes idénticos en el Unibox.
  const stripRe = (s: string) => (s || "").replace(/^(?:\s*re\s*:\s*)+/i, "").trim();
  const dedupKey = (m: any) => {
    const from = (m.from_address || "").toLowerCase();
    const subj = stripRe(m.subject || "").toLowerCase();
    const day = (m.date || "").slice(0, 10);  // YYYY-MM-DD
    return `${from}::${subj}::${day}`;
  };

  const grouped = new Map<string, { primary: any; others: { account_id: string; account_email: string; message_id: string }[] }>();
  for (const m of all) {
    const key = dedupKey(m);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { primary: m, others: [] });
    } else {
      // El mensaje más reciente queda como primary (ya ordenado por fecha desc,
      // así que el primero en grouped es siempre el más reciente).
      existing.others.push({
        account_id: m.account_id,
        account_email: m.account_email,
        message_id: m.message_id,
      });
    }
  }

  const deduped = Array.from(grouped.values()).map(({ primary, others }) => ({
    ...primary,
    also_received_by: others,    // array vacío si no hay duplicados
    received_count: 1 + others.length,
  }));

  // Re-ordena por fecha desc tras el dedupe (Map preserva insertion order pero
  // por seguridad)
  deduped.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const total = deduped.length;
  const sliced = deduped.slice(offset, offset + limit).map((m) => {
    const fromLower = (m.from_address || "").toLowerCase();
    const leadMatch = leadIndex.get(fromLower);
    const autoReplyDetected = isAutoReply({
      from: m.from_address,
      fromName: m.from_name,
      subject: m.subject,
      text: m.text,
    });
    return {
      ...m,
      // No exponemos text/html completos en la lista (solo en el detail GET)
      text: undefined,
      html: undefined,
      // Badges informativos:
      is_lead_reply: !!leadMatch,
      lead_campaign_id: leadMatch?.campaign_id,
      lead_campaign_name: leadMatch?.campaign_name,
      lead_status: leadMatch?.lead_status,
      is_auto_reply: autoReplyDetected,
    };
  });

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
