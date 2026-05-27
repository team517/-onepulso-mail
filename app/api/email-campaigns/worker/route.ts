/**
 * GET  /api/email-campaigns/worker  → status del worker + log reciente
 * POST /api/email-campaigns/worker  → { action: "start"|"stop"|"tick"|"reset_today" }
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getWorkerStatus, startWorker, stopWorker, tickWorker,
} from "@/lib/email-campaign-worker";

export const runtime = "nodejs";
export const maxDuration = 60;

// Auto-arranca al cargar este módulo (primer hit a la API).
startWorker(30);

export async function GET() {
  return NextResponse.json(getWorkerStatus());
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  switch (action) {
    case "start":
      startWorker(Number(body.interval_seconds) || 30);
      return NextResponse.json({ ok: true, status: getWorkerStatus() });
    case "stop":
      stopWorker();
      return NextResponse.json({ ok: true, status: getWorkerStatus() });
    case "tick":
      await tickWorker();
      return NextResponse.json({ ok: true, status: getWorkerStatus() });
    default:
      return NextResponse.json({ error: "action debe ser start/stop/tick" }, { status: 400 });
  }
}
