/**
 * GET    /api/email-inbox/[id]   → mensaje completo (text + html) por id interno
 * PATCH  /api/email-inbox/[id]   → { starred?, user_read? }
 * DELETE /api/email-inbox/[id]   → borra local + intenta mover a Trash en IMAP (best-effort)
 */
import { NextRequest, NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { listEmailAccounts } from "@/lib/email-accounts";
import { listMessagesForAccount, writeMessagesForAccount } from "@/lib/email-inbox-store";

export const runtime = "nodejs";
export const maxDuration = 30;

async function findMessage(id: string) {
  const accounts = await listEmailAccounts();
  for (const a of accounts) {
    const msgs = await listMessagesForAccount(a.id);
    const m = msgs.find((x) => x.id === id);
    if (m) return { account: a, message: m, all: msgs };
  }
  return null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await findMessage(id);
  if (!found) return NextResponse.json({ error: "Mensaje no encontrado" }, { status: 404 });
  // Devuelve también los demás mensajes del mismo thread
  const thread = found.all.filter((m) => m.thread_id === found.message.thread_id);
  return NextResponse.json({
    message: found.message,
    thread,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const found = await findMessage(id);
  if (!found) return NextResponse.json({ error: "Mensaje no encontrado" }, { status: 404 });

  const updated = found.all.map((m) => {
    if (m.id !== id) return m;
    return {
      ...m,
      starred: typeof body.starred === "boolean" ? body.starred : m.starred,
      user_read: typeof body.user_read === "boolean" ? body.user_read : m.user_read,
    };
  });
  await writeMessagesForAccount(found.account.id, updated);
  return NextResponse.json({ ok: true, message: updated.find((m) => m.id === id) });
}

/** Intenta mover el mensaje a la carpeta Trash del IMAP. */
async function deleteFromImap(account: any, uid: number): Promise<{ ok: boolean; folder?: string; error?: string }> {
  const client = new ImapFlow({
    host: account.imap_host,
    port: account.imap_port,
    secure: account.imap_secure,
    auth: {
      user: account.imap_user || account.email,
      pass: (account.imap_password || "").replace(/\s+/g, ""),
    },
    logger: false,
    tls: { rejectUnauthorized: false },
  });
  try {
    await Promise.race([
      client.connect(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("IMAP connect timeout 12s")), 12000)),
    ]);
    // Detectar Trash folder estrictamente — NUNCA Junk/Spam por accidente.
    // Prioridad: specialUse=\Trash → regex en path → Gmail fallback.
    const list = (await client.list()) as any[];
    let trash: string | null = null;
    for (const m of list) {
      if (m.specialUse === "\\Trash") { trash = m.path; break; }
    }
    if (!trash) {
      for (const m of list) {
        if (/\b(Trash|Papelera|Deleted\s?Items|Elementos\s?eliminados|Corbeille|Cestino|Prullenbak|Papierkorb)\b/i.test(m.path) &&
            !/\b(Spam|Junk)\b/i.test(m.path)) {
          trash = m.path; break;
        }
      }
    }
    if (!trash && list.some((m: any) => m.path.startsWith("[Gmail]"))) trash = "[Gmail]/Trash";

    const lock = await client.getMailboxLock("INBOX");
    try {
      if (trash) {
        // Move + expunge
        try {
          await client.messageMove({ uid: String(uid) } as any, trash, { uid: true } as any);
        } catch {
          // Si no soporta MOVE, copia y marca deleted
          await client.messageCopy({ uid: String(uid) } as any, trash, { uid: true } as any);
          await client.messageFlagsAdd({ uid: String(uid) } as any, ["\\Deleted"], { uid: true } as any);
          try { await (client as any).expunge(); } catch {}
        }
      } else {
        // Sin trash detectado → solo marca \\Deleted + expunge
        await client.messageFlagsAdd({ uid: String(uid) } as any, ["\\Deleted"], { uid: true } as any);
        try { await (client as any).expunge(); } catch {}
      }
    } finally {
      try { lock.release(); } catch {}
    }
    try { await client.logout(); } catch {}
    return { ok: true, folder: trash || "(deleted+expunged)" };
  } catch (e: any) {
    try { client.close(); } catch {}
    return { ok: false, error: `${e.code ? e.code + ": " : ""}${e.message}` };
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await findMessage(id);
  if (!found) return NextResponse.json({ error: "Mensaje no encontrado" }, { status: 404 });

  // 1) Eliminar del store local de inmediato
  const next = found.all.filter((m) => m.id !== id);
  await writeMessagesForAccount(found.account.id, next);

  // 2) Best-effort: mover a Trash en IMAP. No bloquea ni revierte la respuesta
  //    si falla (el usuario ya no lo verá en la bandeja local).
  let imapResult: { ok: boolean; folder?: string; error?: string } = { ok: false };
  try {
    imapResult = await deleteFromImap(found.account, found.message.uid);
  } catch (e: any) {
    imapResult = { ok: false, error: e.message };
  }

  return NextResponse.json({
    ok: true,
    deleted_local: true,
    imap_moved: imapResult.ok,
    imap_folder: imapResult.folder,
    imap_error: imapResult.error,
  });
}
