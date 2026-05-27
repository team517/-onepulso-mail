import { NextRequest, NextResponse } from "next/server";
import { deleteEmailAccount, listEmailAccounts, safe } from "@/lib/email-accounts";

export const runtime = "nodejs";

export async function GET() {
  const all = await listEmailAccounts();
  return NextResponse.json({ accounts: all.map(safe) });
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
  const ok = await deleteEmailAccount(id);
  return NextResponse.json({ ok });
}
