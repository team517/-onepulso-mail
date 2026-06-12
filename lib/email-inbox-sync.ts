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

/**
 * Carga TODOS los emails de leads del workspace actual.
 * Se usa para evitar marcar como warmup/bounce mensajes que vienen de un
 * lead real (que es la respuesta legítima que estás esperando).
 */
async function loadLeadEmailsForCurrentWorkspace(): Promise<Set<string>> {
  try {
    const { listCampaigns, listLeads } = await import("./email-campaigns");
    const campaigns = await listCampaigns();
    const set = new Set<string>();
    for (const c of campaigns) {
      const leads = await listLeads(c.id);
      for (const l of leads) set.add(l.email.toLowerCase());
    }
    return set;
  } catch {
    return new Set();
  }
}

/** Detecta el path de la carpeta Spam/Junk del proveedor. */
async function findSpamFolder(client: ImapFlow): Promise<string | null> {
  try {
    const list = (await client.list()) as any[];
    // Por specialUse (más fiable)
    for (const m of list) {
      if (m.specialUse === "\\Junk") return m.path;
    }
    // Por nombre en varios idiomas
    for (const m of list) {
      if (/\b(spam|junk|junk\s?mail|junk\s?e-?mail|correo\s?no\s?deseado|spam\s?folder)\b/i.test(m.path || "")) {
        return m.path;
      }
    }
    // Gmail-specific
    if (list.some((m) => m.path?.startsWith("[Gmail]"))) return "[Gmail]/Spam";
    return null;
  } catch {
    return null;
  }
}

/** Sincroniza una sola cuenta — descarga últimos 200 mensajes de INBOX + 100 de Spam. */
export async function syncInboxForAccount(account: EmailAccount): Promise<{
  account_id: string;
  account_email: string;
  ok: boolean;
  new_count: number;
  new_count_spam: number;
  warmup_filtered: number;
  bounce_filtered: number;
  total_in_inbox: number;
  total_in_spam: number;
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
    ok: false, new_count: 0, new_count_spam: 0,
    warmup_filtered: 0, bounce_filtered: 0,
    total_in_inbox: 0, total_in_spam: 0,
    ms: 0, error: undefined as string | undefined,
  };

  // Cargar emails de leads del workspace ANTES del sync para que ningún
  // reply real de un lead se marque como warmup/bounce (aunque su nombre
  // sea "Kim" o "Mark" o lo que sea).
  const leadEmails = await loadLeadEmailsForCurrentWorkspace();

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

          // ¿Es este mensaje una respuesta de un LEAD real del workspace?
          // Si sí → BYPASS de filtros warmup/bounce. Una respuesta de un lead
          // SIEMPRE aparece en la bandeja, sin importar nombres genéricos en
          // la lista de warmup ni patrones que parezcan códigos.
          const isFromLead = leadEmails.has((fromAddress || "").toLowerCase());

          // Detección de warmup / bounce — solo se aplica si NO viene de un lead.
          // Si viene de un lead, marcamos warmup=false y bounce=false → aparecen
          // siempre en la vista "Todos".
          const warmup = isFromLead
            ? false
            : isWarmupMessage({ subject, text, html, from: fromAddress, fromName });
          const bounce = isFromLead
            ? false
            : isBounceOrFailure({ from: fromAddress, fromAddress, fromName, subject, text });
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
            folder: "INBOX",
            from_spam: false,
          });
        } catch {
          // Mensaje malformado: lo saltamos sin abortar el sync entero
        }
      }

      result.new_count = fresh.length;

      // Reclasifica is_warmup/is_bounce de los mensajes EXISTENTES con la heurística
      // actual. Si el mensaje viene de un LEAD del workspace → bypass de filtros
      // (es una respuesta legítima, debe aparecer siempre).
      const reclassified = existing.map((m) => {
        const isFromLead = leadEmails.has((m.from_address || "").toLowerCase());
        const wm = isFromLead ? false : isWarmupMessage({
          subject: m.subject, text: m.text, html: m.html,
          from: m.from_address, fromName: m.from_name,
        });
        const bn = isFromLead ? false : isBounceOrFailure({
          from: m.from_address, fromAddress: m.from_address,
          fromName: m.from_name, subject: m.subject, text: m.text,
        });
        if (wm !== m.is_warmup || bn !== m.is_bounce) {
          return { ...m, is_warmup: wm, is_bounce: bn };
        }
        return m;
      });

      // ── SCAN DE SPAM/JUNK (después de procesar INBOX, ANTES del lock release)
      // Liberamos lock del INBOX y abrimos el de Spam.
      let spamFresh: InboxMessage[] = [];
      try { lock.release(); } catch {}

      const existingByMsgId = new Set(existing.map((m) => m.message_id).filter(Boolean));
      try {
        const spamPath = await findSpamFolder(client);
        if (spamPath) {
          const spamLock = await client.getMailboxLock(spamPath);
          try {
            const spamStatus = await client.status(spamPath, { messages: true });
            const spamTotal = spamStatus.messages || 0;
            result.total_in_spam = spamTotal;
            if (spamTotal > 0) {
              const spamStart = Math.max(1, spamTotal - 99);  // últimos 100 de Spam
              const spamRange = `${spamStart}:*`;
              for await (const msg of client.fetch(spamRange, { envelope: true, source: true, uid: true, flags: true })) {
                if (!msg.source) continue;
                try {
                  const parsed = await simpleParser(msg.source);
                  const subject = parsed.subject || (msg.envelope as any)?.subject || "(sin asunto)";
                  const text = parsed.text || "";
                  const html = (parsed.html as string) || "";
                  const fromAddress = parsed.from?.value?.[0]?.address || (msg.envelope as any)?.from?.[0]?.address || "";
                  const fromName = parsed.from?.value?.[0]?.name || (msg.envelope as any)?.from?.[0]?.name || "";
                  const toAddress = parsed.to ? (Array.isArray(parsed.to) ? parsed.to[0]?.value?.[0]?.address : parsed.to.value?.[0]?.address) : account.email;

                  let messageId = parsed.messageId || (msg.envelope as any)?.messageId || "";
                  if (messageId && !messageId.startsWith("<")) messageId = `<${messageId}>`;

                  // Skip si ya está en BD (entonces ya lo procesamos como INBOX o Spam previamente)
                  if (messageId && existingByMsgId.has(messageId)) continue;

                  const isFromLead = leadEmails.has((fromAddress || "").toLowerCase());

                  let inReplyTo = parsed.inReplyTo || (msg.envelope as any)?.inReplyTo || "";
                  if (inReplyTo && !inReplyTo.startsWith("<")) inReplyTo = `<${inReplyTo}>`;
                  const references = parsed.references
                    ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references])
                    : [];
                  const date = (parsed.date || (msg.envelope as any)?.date || new Date()).toISOString?.() || new Date().toISOString();
                  const preview = (text || html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 180);

                  // Spam: aplicamos los MISMOS filtros warmup/bounce que INBOX.
                  // Si es de un lead → bypass de filtros (siempre visible).
                  const warmup = isFromLead ? false : isWarmupMessage({ subject, text, html, from: fromAddress, fromName });
                  const bounce = isFromLead ? false : isBounceOrFailure({ from: fromAddress, fromAddress, fromName, subject, text });
                  if (warmup) result.warmup_filtered++;
                  if (bounce) result.bounce_filtered++;

                  spamFresh.push({
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
                    folder: spamPath,
                    from_spam: true,  // ← badge especial en UI
                  });
                } catch {
                  // mensaje malformado, salta
                }
              }
              result.new_count_spam = spamFresh.length;
            }
          } finally {
            try { spamLock.release(); } catch {}
          }
        }
      } catch (e: any) {
        // No abortamos si Spam falla — el INBOX ya está procesado.
        // Solo registramos en el error message del result si nada más falló.
        if (!result.error) result.error = `Spam scan: ${e.message}`;
      }

      const merged = [...fresh, ...reclassified, ...spamFresh];

      // Dedupe por message_id PRIMERO (más fiable que UID porque UID
      // depende del folder), luego por (account_id + uid + folder)
      const seen = new Set<string>();
      const deduped: InboxMessage[] = [];
      for (const m of merged) {
        const key = m.message_id
          ? `${m.account_id}:mid:${m.message_id}`
          : `${m.account_id}:fld:${m.folder || "INBOX"}:uid:${m.uid}`;
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
      // lock del INBOX ya se libera dentro (antes de scan de Spam).
      // Como defensa por si algo falló antes de release:
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

/** Sync de todas las cuentas conectadas (concurrencia limitada).
 *
 *  IMPORTANTE: ya NO filtramos por imap_ok. Cualquier cuenta que tenga
 *  host + user + password de IMAP se intenta sincronizar. Si el sync
 *  funciona, marcamos imap_ok=true automáticamente (auto-recovery). Si
 *  falla, marcamos imap_ok=false con el error. Así ninguna cuenta
 *  conectada se queda sin sincronizar en silencio. */
export async function syncAllInboxes(accounts: EmailAccount[], concurrency = 5) {
  // Solo necesita credenciales IMAP mínimas — NO el flag imap_ok.
  const syncable = accounts.filter(
    (a) => a.imap_host && (a.imap_user || a.email) && a.imap_password,
  );
  const results: Awaited<ReturnType<typeof syncInboxForAccount>>[] = [];
  let i = 0;
  async function worker() {
    while (i < syncable.length) {
      const idx = i++;
      const acc = syncable[idx];
      const r = await syncInboxForAccount(acc);
      results[idx] = r;
      // Auto-recovery del flag imap_ok según el resultado del sync real.
      try {
        const { getEmailAccount, upsertEmailAccount } = await import("./email-accounts");
        const fresh = await getEmailAccount(acc.id);
        if (fresh) {
          if (r.ok && !fresh.imap_ok) {
            await upsertEmailAccount({ ...fresh, imap_ok: true, last_imap_error: null });
          } else if (!r.ok && fresh.imap_ok && r.error) {
            await upsertEmailAccount({ ...fresh, imap_ok: false, last_imap_error: r.error });
          }
        }
      } catch {}
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, syncable.length) }, worker));
  return results;
}
