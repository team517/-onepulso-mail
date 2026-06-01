/**
 * POST /api/email-accounts/slow-ramp
 *
 * Body: {
 *   ids: string[],                        // cuentas a configurar (o vacío = todas)
 *   enabled: boolean,                     // ON/OFF
 *   start_limit?: number,                 // default 5
 *   target_limit?: number,                // default 30
 *   increment?: number,                   // default 2
 *   increment_days?: number,              // default 1
 *   restart?: boolean,                    // si true, resetea started_at al ahora
 * }
 *
 * Aplica la config a TODAS las cuentas indicadas. Si enable=true y la cuenta
 * no tenía started_at (o restart=true), arranca la rampa con start_limit hoy.
 * Si enable=false, no resetea el started_at pero deja de aplicarse.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  listEmailAccounts, upsertEmailAccount, safe,
  SLOW_RAMP_DEFAULTS,
} from "@/lib/email-accounts";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const enabled = !!body.enabled;
  const restart = !!body.restart;
  const ids: string[] = Array.isArray(body.ids) ? body.ids : [];

  const startLimit = clampInt(body.start_limit, 1, 1000, SLOW_RAMP_DEFAULTS.start_limit);
  const targetLimit = clampInt(body.target_limit, 1, 1000, SLOW_RAMP_DEFAULTS.target_limit);
  const increment = clampInt(body.increment, 1, 100, SLOW_RAMP_DEFAULTS.increment);
  const incrementDays = clampInt(body.increment_days, 1, 30, SLOW_RAMP_DEFAULTS.increment_days);

  if (targetLimit < startLimit) {
    return NextResponse.json({ error: "target_limit debe ser ≥ start_limit" }, { status: 400 });
  }

  const all = await listEmailAccounts();
  const targets = ids.length > 0 ? all.filter((a) => ids.includes(a.id)) : all;
  if (targets.length === 0) {
    return NextResponse.json({ error: "Sin cuentas a configurar" }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const updated: any[] = [];
  for (const acc of targets) {
    const next = {
      ...acc,
      slow_ramp_enabled: enabled,
      slow_ramp_start_limit: startLimit,
      slow_ramp_target_limit: targetLimit,
      slow_ramp_increment: increment,
      slow_ramp_increment_days: incrementDays,
      slow_ramp_started_at: enabled
        ? (restart || !acc.slow_ramp_started_at ? nowIso : acc.slow_ramp_started_at)
        : acc.slow_ramp_started_at,
    };
    await upsertEmailAccount(next);
    updated.push(safe(next));
  }

  return NextResponse.json({
    ok: true,
    affected: updated.length,
    config: { enabled, startLimit, targetLimit, increment, incrementDays, restart },
    accounts: updated,
  });
}

function clampInt(v: any, min: number, max: number, def: number): number {
  const n = parseInt(v);
  if (isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}
