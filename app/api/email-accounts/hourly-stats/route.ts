/**
 * GET /api/email-accounts/hourly-stats
 *
 * Devuelve, por cada cuenta del workspace, cuántos emails ha enviado en
 * la última hora y el estado de cooldown si lo tiene.
 *
 * Útil para diagnosticar errores 450 "mail send limit exceeded" de IONOS
 * y otros proveedores que limitan por hora además de por día.
 */
import { NextResponse } from "next/server";
import { listEmailAccounts } from "@/lib/email-accounts";
import { listSent } from "@/lib/email-sent-log";

export const runtime = "nodejs";

export async function GET() {
  const accounts = await listEmailAccounts();
  const sent = await listSent();

  const cutoff60 = Date.now() - 60 * 60 * 1000;
  const cutoff10 = Date.now() - 10 * 60 * 1000;

  const stats = accounts.map((a) => {
    const fromAccount = sent.filter(
      (s) => s.account_id === a.id && new Date(s.sent_at).getTime() > cutoff60,
    );
    const lastHour = fromAccount.length;
    const lastTenMin = fromAccount.filter(
      (s) => new Date(s.sent_at).getTime() > cutoff10,
    ).length;
    const lastHourOk = fromAccount.filter((s) => s.ok).length;
    const lastHourFailed = fromAccount.filter((s) => !s.ok).length;

    const cooldownMs = a.next_eligible_at
      ? new Date(a.next_eligible_at).getTime() - Date.now()
      : 0;
    const inCooldown = cooldownMs > 60_000; // si pasa de 1 min, lo consideramos cooldown real

    // Recomendación basada en stats
    let status: "ok" | "warning" | "danger" = "ok";
    let hint = "";
    if (inCooldown) {
      status = "danger";
      hint = `Cuenta en cooldown — disponible en ${Math.ceil(cooldownMs / 60_000)} min`;
    } else if (lastHour >= 25) {
      status = "danger";
      hint = `${lastHour} envíos en la última hora — IONOS te bloqueará pronto`;
    } else if (lastHour >= 15) {
      status = "warning";
      hint = `${lastHour}/h — acercándote al límite de IONOS (~30/h)`;
    } else if (lastTenMin >= 5) {
      status = "warning";
      hint = `${lastTenMin} envíos en 10 min — ritmo muy alto`;
    } else {
      hint = `${lastHour} en última hora, ${lastTenMin} en últimos 10 min`;
    }

    return {
      account_id: a.id,
      account_email: a.email,
      last_hour: lastHour,
      last_ten_min: lastTenMin,
      last_hour_ok: lastHourOk,
      last_hour_failed: lastHourFailed,
      sent_today: a.sent_today ?? 0,
      daily_limit: a.daily_limit ?? 30,
      cooldown_until: a.next_eligible_at,
      in_cooldown: inCooldown,
      cooldown_remaining_min: inCooldown ? Math.ceil(cooldownMs / 60_000) : 0,
      last_smtp_error: a.last_smtp_error || null,
      status,
      hint,
    };
  });

  return NextResponse.json({
    ok: true,
    accounts: stats,
    summary: {
      total_accounts: accounts.length,
      ok: stats.filter((s) => s.status === "ok").length,
      warning: stats.filter((s) => s.status === "warning").length,
      danger: stats.filter((s) => s.status === "danger").length,
      in_cooldown: stats.filter((s) => s.in_cooldown).length,
    },
  });
}
