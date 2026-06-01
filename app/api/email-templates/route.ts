/**
 * GET  /api/email-templates       → lista (filtros opcionales)
 * POST /api/email-templates       → crea { name, subject, body, category?, tags? }
 */
import { NextRequest, NextResponse } from "next/server";
import { createTemplate, listTemplates } from "@/lib/email-templates";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").toLowerCase();
  const category = url.searchParams.get("category");
  const tag = url.searchParams.get("tag");
  let all = await listTemplates();
  if (q) {
    all = all.filter((t) =>
      t.name.toLowerCase().includes(q) ||
      t.subject.toLowerCase().includes(q) ||
      t.body.toLowerCase().includes(q)
    );
  }
  if (category) all = all.filter((t) => t.category === category);
  if (tag) all = all.filter((t) => (t.tags || []).includes(tag));
  // Más recientes primero (por updated_at)
  all.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  return NextResponse.json({ templates: all });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const t = await createTemplate(body);
  return NextResponse.json({ ok: true, template: t });
}
