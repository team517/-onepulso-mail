/**
 * Sincronización IMAP por cuenta para la bandeja unificada.
 *
 * Reusa los detectores del Unibox legacy:
 *   - isWarmupMessage (códigos random en subject / body) — descarta warmup
 *   - isBounceOrFailure (mailer-daemon, delivery failure, etc.) — descarta bounces
 *
 * Almacena los mensajes válidos en email-inbox-store.
 */
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { isWarmupMessage } from "./email-warmup";
import { isBounceOrFailure } from "./email-bounce";
import {
  computeThreadId, getMeta, InboxMessage, listMessagesForAccount,
  newMessageId, writeMessagesForAccount, writeMeta,
} from "./email-inbox-store";
import { EmailAccount } from "./email-accounts";

/** Sincroniza una sola cuenta — descarga últimos 200 mensajes de INBOX. */
export async function syncInboxForAccount(account: EmailAccount): Promise<{
  account_id: string;
  account_email: string;
  ok: boolean;
  new_count: number;
  warmup_filtered: number;
  bounce_filtered: number;
  total_in_inbox: number;
  ms: number;
  error?: string;
}> {
  const t0 = Date.now();
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

  const result = {
    account_id: account.id,
    account_email: account.email,
    ok: false, new_count: 0, warmup_filtered: 0, bounce_filtered: 0, total_in_inbox: 0, ms: 0, error: undefined as string | undefined,
  };

  try {
    await Promise.race([
      client.connect(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("IMAP connect timeout 15s")), 15000)),
    ]);
    const lock = await client.getMailboxLock("INBOX");
    try {
      const status = await client.status("INBOX", { messages: true });
      const total = status.messages || 0;
      result.total_in_inbox = total;

      if (total === 0) {
        result.ok = true;
        await writeMeta(account.id, {
          account_id: account.id, last_sync: new Date().toISOString(),
          last_error: null, last_uid: null, total_messages: 0,
        });
        try { await client.logout(); } catch {}
        return { ...result, ms: Date.now() - t0 };
      }

      // Trae hasta los últimos 200 mensajes (cobertura amplia, dedupe por UID)
      const existing = await listMessagesForAccount(account.id);
      const existingUids = new Set(existing.map((m) => m.uid));
      const start = Math.max(1, total - 199);
      const range = `${start}:*`;

      const fresh: InboxMessage[] = [];
      for await (const msg of client.fetch(range, { envelope: true, source: true, uid: true, flags: true })) {
        if (existingUids.has(msg.uid)) continue;
        if (!msg.source) continue;
        try {
          const parsed = await simpleParser(msg.source);
          const subject = parsed.subject || (msg.envelope as any)?.subject || "(sin asunto)";
          const text = parsed.text || "";
          const html = (parsed.html as string) || "";
          const fromAddress = parsed.from?.value?.[0]?.address || (msg.envelope as any)?.from?.[0]?.address || "";
          const fromName = parsed.from?.value?.[0]?.name || (msg.envelope as any)?.from?.[0]?.name || "";
          const toAddress = parsed.to ? (Array.isArray(parsed.to) ? parsed.to[0]?.value?.[0]?.address : parsed.to.value?.[0]?.address) : account.email;

          // Detección de warmup / bounce — NO descartamos el mensaje, solo lo
          // marcamos con flag. El API oculta los warmup/bounce por defecto pero
          // el usuario puede ver "Mostrar warmup" / "Mostrar bounces" si sospecha
          // de un falso positivo (un email legítimo mal clasificado).
          const warmup = isWarmupMessage({ subject, text, html, from: fromAddress, fromName });
          const bounce = isBounceOrFailure({ from: fromAddress, fromAddress, fromName, subject, text });
          if (warmup) result.warmup_filtered++;
          if (bounce) result.bounce_filtered++;

          // Normalizar Message-ID con <>
          let messageId = parsed.messageId || (msg.envelope as any)?.messageId || "";
          if (messageId && !messageId.startsWith("<")) messageId = `<${messageId}>`;

          let inReplyTo = parsed.inReplyTo || (msg.envelope as any)?.inReplyTo || "";
          if (inReplyTo && !inReplyTo.startsWith("<")) inReplyTo = `<${inReplyTo}>`;

          const references = parsed.references
            ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references])
            : [];

          const date = (parsed.date || (msg.envelope as any)?.date || new Date()).toISOString?.() || new Date().toISOString();
          const preview = (text || html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 180);

          fresh.push({
            id: newMessageId(),
            uid: msg.uid,
            account_id: account.id,
            account_email: account.email,
            message_id: messageId,
            in_reply_to: inReplyTo || undefined,
            references,
            from_address: fromAddress,
            from_name: fromName,
            to_address: toAddress || account.email,
            subject,
            date,
            preview,
            text: text.slice(0, 50000),
            html: html.slice(0, 100000),
            flags: Array.isArray(msg.flags) ? msg.flags : [],
            thread_id: computeThreadId(inReplyTo, references, messageId),
            is_warmup: warmup,
            is_bounce: bounce,
          });
        } catch {
          // Mensaje malformado: lo saltamos sin abortar el sync entero
        }
      }

      result.new_count = fresh.length;

      // Reclasifica is_warmup/is_bounce de los mensajes EXISTENTES con la heurística
      // actual — así cuando endurecemos los filtros, los mensajes viejos también
      // se filtran sin tener que resincronizar desde IMAP.
      const reclassified = existing.map((m) => {
        const wm = isWarmupMessage({
          subject: m.subject, text: m.text, html: m.html,
          from: m.from_address, fromName: m.from_name,
        });
        const bn = isBounceOrFailure({
          from: m.from_address, fromAddress: m.from_address,
          fromName: m.from_name, subject: m.subject, text: m.text,
        });
        if (wm !== m.is_warmup || bn !== m.is_bounce) {
          return { ...m, is_warmup: wm, is_bounce: bn };
        }
        return m;
      });

      const merged = [...fresh, ...reclassified];

      // Dedupe por (account_id + uid + message_id) — preserva starred/user_read
      const seen = new Set<string>();
      const deduped: InboxMessage[] = [];
      for (const m of merged) {
        const key = `${m.account_id}:${m.uid}:${m.message_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(m);
      }

      await writeMessagesForAccount(account.id, deduped);
      await writeMeta(account.id, {
        account_id: account.id,
        last_sync: new Date().toISOString(),
        last_error: null,
        last_uid: total,
        total_messages: deduped.length,
      });
      result.ok = true;
    } finally {
      try { lock.release(); } catch {}
      try { await client.logout(); } catch {}
    }
  } catch (e: any) {
    result.ok = false;
    result.error = `${e.code ? e.code + ": " : ""}${e.message}`;
    try { client.close(); } catch {}
    const prevMeta = await getMeta(account.id);
    await writeMeta(account.id, { ...prevMeta, last_error: result.error, last_sync: new Date().toISOString() });
  }

  result.ms = Date.now() - t0;
  return result;
}

/** Sync de todas las cuentas conectadas (concurrencia limitada). */
export async function syncAllInboxes(accounts: EmailAccount[], concurrency = 3) {
  const filtered = accounts.filter((a) => a.imap_ok);
  const results: Awaited<ReturnType<typeof syncInboxForAccount>>[] = [];
  let i = 0;
  async function worker() {
    while (i < filtered.length) {
      const idx = i++;
      results[idx] = await syncInboxForAccount(filtered[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, filtered.length) }, worker));
  return results;
}
