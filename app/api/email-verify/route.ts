/**
 * POST /api/email-verify
 *
 * Body: { emails: string[] }
 *
 * Verifica un batch de hasta 500 emails con verificación interna (sin APIs externas):
 *   - Syntax check
 *   - DNS MX lookup (cached 24h)
 *   - Disposable domain check
 *   - Role-based check
 *
 * Devuelve cada email con su verdict + razones.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyEmailBatch } from "@/lib/email-verification";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const emails = Array.isArray(body.emails) ? body.emails : [];
  if (emails.length === 0) {
    return NextResponse.json({ error: "No hay emails para verificar" }, { status: 400 });
  }
  if (emails.length > 500) {
    return NextResponse.json({ error: "Máximo 500 emails por request" }, { status: 400 });
  }
  const t0 = Date.now();
  const results = await verifyEmailBatch(emails, 20);
  const ms = Date.now() - t0;

  const summary = {
    total: results.length,
    valid: results.filter((r) => r.verdict === "valid").length,
    invalid: results.filter((r) => r.verdict === "invalid").length,
    risky: results.filter((r) => r.verdict === "risky").length,
    unknown: results.filter((r) => r.verdict === "unknown").length,
  };

  return NextResponse.json({ ok: true, ms, summary, results });
}
