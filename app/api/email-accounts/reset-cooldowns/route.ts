/**
 * POST /api/email-accounts/reset-cooldowns
 *
 * Body opcional: { account_ids?: string[] }
 *
 * Limpia el next_eligible_at y last_smtp_error de las cuentas indicadas
 * (todas si no se pasan IDs). Útil cuando IONOS rate-limita cuentas y
 * quieres reintentar manualmente sin esperar al cooldown automático.
 *
 * ATENCIÓN: si la cuenta SIGUE en rate limit del servidor IONOS, el
 * próximo envío fallará igual. Esto solo limpia nuestro estado interno.
 */
import { NextRequest, NextResponse } from "next/server";
import { listEmailAccounts, upsertEmailAccount } from "@/lib/email-accounts";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const targetIds = Array.isArray(body.account_ids) ? new Set<string>(body.account_ids) : null;

  const all = await listEmailAccounts();
  const targets = targetIds ? all.filter((a) => targetIds.has(a.id)) : all;

  let reset = 0;
  for (const a of targets) {
    if (!a.next_eligible_at && !a.last_smtp_error) continue;
    await upsertEmailAccount({
      ...a,
      next_eligible_at: undefined as any,
      last_smtp_error: null,
    });
    reset++;
  }

  return NextResponse.json({
    ok: true,
    reset_count: reset,
    total_accounts: targets.length,
    message: reset === 0
      ? "Ninguna cuenta estaba en cooldown"
      : `${reset} cuenta${reset === 1 ? "" : "s"} desbloqueada${reset === 1 ? "" : "s"}`,
  });
}
