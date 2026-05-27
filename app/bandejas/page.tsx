"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BG, INK, INK_2, INK_3, INK_4, INK_5, LINE, LINE2, PAPER, SURF, SURF_2,
  BRAND_G, GREEN, ORANGE, PURPLE, PURPLE_DEEP, BLUE, DANGER,
  FONT_SANS, FONT_UI, FONT_MONO, FONT_SERIF,
  TopNav, BrandFonts, useToast, Eyebrow,
  brandBtn, ghostBtn, inputStyle,
} from "../email-campaigns/_shell";

type Message = {
  id: string;
  uid: number;
  account_id: string;
  account_email: string;
  message_id: string;
  from_address: string;
  from_name?: string;
  to_address: string;
  subject: string;
  date: string;
  preview: string;
  flags: string[];
  thread_id: string;
  starred?: boolean;
  user_read?: boolean;
};

type FullMessage = Message & { text?: string; html?: string };

type SentMessage = {
  id: string;
  type: "reply" | "followup" | "test" | "campaign";
  account_id: string;
  account_email: string;
  to_address: string;
  to_name?: string;
  subject: string;
  body: string;
  body_html?: string;
  message_id?: string;
  thread_id?: string;
  source_inbox_message_id?: string;
  followup_id?: string;
  campaign_id?: string;
  campaign_step?: number;
  campaign_variant?: string;
  lead_email?: string;
  ok: boolean;
  error?: string | null;
  appended_to_sent?: boolean;
  sent_folder?: string;
  ms?: number;
  sent_at: string;
};

type FollowUp = {
  id: string;
  account_email: string;
  thread_id: string;
  to_address: string;
  subject: string;
  body: string;
  scheduled_for: string;
  only_if_no_reply: boolean;
  status: "pending" | "sent" | "cancelled" | "failed";
  sent_at?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  last_error?: string | null;
};

type AccountSummary = {
  id: string;
  email: string;
  smtp_ok: boolean;
  imap_ok: boolean;
  messages_count: number;
  meta: { last_sync: string | null; last_error: string | null; total_messages: number };
};

export default function BandejasPage() {
  const router = useRouter();
  const { show: showToast, ToastNode } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "starred">("all");
  const [view, setView] = useState<"inbox" | "sent">("inbox");
  const [sentMessages, setSentMessages] = useState<SentMessage[]>([]);
  const [sentTotal, setSentTotal] = useState(0);
  const [sentTypeFilter, setSentTypeFilter] = useState<"all" | "reply" | "followup" | "test" | "campaign">("all");
  const [selectedSent, setSelectedSent] = useState<SentMessage | null>(null);
  const [loadingSent, setLoadingSent] = useState(false);
  const [accountFilter, setAccountFilter] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<{ message: FullMessage; thread: Message[] } | null>(null);
  const [syncSummary, setSyncSummary] = useState<{ new_messages: number; warmup_filtered: number; bounce_filtered: number; ok_accounts: number; total_accounts: number } | null>(null);
  const [showReply, setShowReply] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [threadFollowUps, setThreadFollowUps] = useState<FollowUp[] | null>(null);

  async function loadFollowUpsForThread(threadId: string) {
    const r = await fetch(`/api/email-followups?thread_id=${encodeURIComponent(threadId)}`);
    const j = await r.json();
    setThreadFollowUps(j.followups || []);
  }

  async function loadSent() {
    setLoadingSent(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (sentTypeFilter !== "all") params.set("type", sentTypeFilter);
      if (accountFilter) params.set("account_id", accountFilter);
      params.set("limit", "200");
      const r = await fetch("/api/email-sent?" + params.toString());
      const j = await r.json();
      setSentMessages(j.sent || []);
      setSentTotal(j.total || 0);
    } finally {
      setLoadingSent(false);
    }
  }
  useEffect(() => {
    if (view === "sent") loadSent();
  }, [view, debouncedSearch, sentTypeFilter, accountFilter]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  async function load() {
    if (!loading) setLoading(false); // sin spinner global en re-cargas
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (filter === "unread") params.set("unread", "1");
      if (filter === "starred") params.set("starred", "1");
      if (accountFilter) params.set("account_id", accountFilter);
      params.set("limit", "200");
      const r = await fetch("/api/email-inbox?" + params.toString());
      const j = await r.json();
      setMessages(j.messages || []);
      setTotal(j.total || 0);
      setAccounts(j.accounts || []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [debouncedSearch, filter, accountFilter]);

  // ── AUTO-SYNC cada 2 min ─────────────────────────────────────
  // El server-side worker ya sincroniza IMAP cada 2 min. Aquí solo recargamos
  // la lista local desde la API (sin tocar IMAP) para reflejar mensajes nuevos.
  useEffect(() => {
    const handle = setInterval(() => {
      // refresh silenciosa (sin spinner)
      load();
    }, 2 * 60 * 1000);
    return () => clearInterval(handle);
  }, [debouncedSearch, filter, accountFilter]);

  async function syncNow() {
    setSyncing(true);
    setSyncSummary(null);
    try {
      const r = await fetch("/api/email-inbox/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json();
      if (j.ok) {
        setSyncSummary(j.summary);
        showToast(`✓ +${j.summary.new_messages} nuevos · ${j.summary.warmup_filtered} warmup filtrados · ${j.summary.bounce_filtered} bounces filtrados`);
        await load();
      } else {
        showToast(j.error || "Error sincronizando");
      }
    } finally {
      setSyncing(false);
    }
  }

  async function openMessage(m: Message) {
    setSelectedMsgId(m.id);
    setSelectedThreadId(m.thread_id);
    setShowReply(false);
    setShowFollowUp(false);
    setThreadFollowUps(null);
    setDetailLoading(true);
    try {
      const r = await fetch(`/api/email-inbox/${m.id}`);
      const j = await r.json();
      if (j.message) {
        setDetail(j);
        // Carga follow-ups de este thread en background
        loadFollowUpsForThread(j.message.thread_id);
      }
    } finally {
      setDetailLoading(false);
    }
    // Marca como leído localmente + persiste
    if (!m.user_read) {
      setMessages((arr) => arr.map((x) => x.id === m.id ? { ...x, user_read: true } : x));
      fetch(`/api/email-inbox/${m.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_read: true }) }).catch(() => {});
    }
  }

  async function toggleStar(m: Message) {
    const next = !m.starred;
    setMessages((arr) => arr.map((x) => x.id === m.id ? { ...x, starred: next } : x));
    fetch(`/api/email-inbox/${m.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ starred: next }) }).catch(() => {});
  }

  async function blockSender(address: string, type: "email" | "domain") {
    const cleanAddr = address.trim().toLowerCase();
    const target = type === "email" ? cleanAddr : (cleanAddr.split("@")[1] || cleanAddr);
    const confirmMsg = type === "email"
      ? `¿Bloquear "${target}"?\n\nSe quitará de TODAS las campañas (los leads con este email pasarán a unsubscribed) y nunca más recibirán emails de la plataforma.`
      : `¿Bloquear todo el dominio "@${target}"?\n\nTodos los leads de ese dominio en TODAS las campañas pasarán a unsubscribed.`;
    if (!confirm(confirmMsg)) return;
    try {
      const r = await fetch("/api/email-blocklist", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: target, type, reason: "Bloqueado desde Unibox" }),
      });
      const j = await r.json();
      if (j.ok) {
        showToast(`✓ Bloqueado · ${j.affected_leads} lead(s) en ${j.affected_campaigns} campaña(s)`);
      } else {
        showToast(j.error || "Error bloqueando");
      }
    } catch (e: any) {
      showToast("Error: " + e.message);
    }
  }

  async function deleteMessage(m: Message | FullMessage) {
    if (!confirm("¿Eliminar este mensaje?\n\nSe quitará de la bandeja local y se moverá a la Papelera del IMAP.")) return;
    // Optimista: quita del estado local
    setMessages((arr) => arr.filter((x) => x.id !== m.id));
    setTotal((t) => Math.max(0, t - 1));
    if (detail && detail.message.id === m.id) {
      setDetail(null);
      setSelectedMsgId(null);
      setSelectedThreadId(null);
    }
    try {
      const r = await fetch(`/api/email-inbox/${m.id}`, { method: "DELETE" });
      const j = await r.json();
      if (j.ok) {
        if (j.imap_moved) {
          showToast(`✓ Eliminado · movido a "${j.imap_folder}"`);
        } else {
          showToast(`✓ Eliminado localmente${j.imap_error ? ` · IMAP: ${j.imap_error.slice(0, 50)}` : ""}`);
        }
      } else {
        showToast(j.error || "Error eliminando");
        load(); // re-sync para no quedar inconsistente
      }
    } catch (e: any) {
      showToast("Error eliminando: " + e.message);
      load();
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/landing");
  }

  // Agrupa mensajes por thread (mostramos solo el más reciente de cada thread)
  const threadsList = useMemo(() => {
    const byThread = new Map<string, Message[]>();
    for (const m of messages) {
      const arr = byThread.get(m.thread_id) || [];
      arr.push(m);
      byThread.set(m.thread_id, arr);
    }
    const heads: { head: Message; count: number; anyStarred: boolean; anyUnread: boolean }[] = [];
    for (const [tid, arr] of byThread) {
      arr.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      heads.push({
        head: arr[0],
        count: arr.length,
        anyStarred: arr.some((m) => m.starred),
        anyUnread: arr.some((m) => !m.flags.includes("\\Seen") && !m.user_read),
      });
    }
    heads.sort((a, b) => (b.head.date || "").localeCompare(a.head.date || ""));
    return heads;
  }, [messages]);

  const totalAccounts = accounts.length;
  const okAccounts = accounts.filter((a) => a.imap_ok).length;

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: FONT_UI, color: INK_2 }}>
      <BrandFonts />
      <TopNav activeKey="bandejas" onLogout={logout} toast={showToast} />

      {/* HERO */}
      <section style={{ position: "relative", overflow: "hidden", padding: "56px 0 24px" }}>
        <div style={{
          position: "absolute", top: -100, right: -120, width: 460, height: 460, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(5,102,234,0.12), transparent 60%)", filter: "blur(80px)", pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", bottom: -180, left: -140, width: 440, height: 440, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(209,92,254,0.12), transparent 60%)", filter: "blur(80px)", pointerEvents: "none",
        }} />
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 28px", position: "relative", zIndex: 1 }}>
          <Eyebrow color={BLUE}>Bandeja unificada · IMAP · {okAccounts}/{totalAccounts} cuentas activas</Eyebrow>
          <h1 style={{
            margin: "20px 0 0",
            fontFamily: FONT_SANS, fontWeight: 800,
            fontSize: "clamp(36px, 4.5vw, 56px)", letterSpacing: "-0.035em",
            lineHeight: 1.02, color: INK,
          }}>
            Todas tus <span style={{ fontFamily: FONT_SERIF, fontWeight: 400, fontStyle: "italic" }}>respuestas</span>{" "}
            <span style={{ background: BRAND_G, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>en un sitio.</span>
          </h1>
          <p style={{ margin: "16px 0 0", maxWidth: 600, fontSize: 16, lineHeight: 1.55, color: INK_3 }}>
            Bandeja unificada de IMAP de todas las cuentas conectadas. Filtramos automáticamente
            warmups (códigos en subject) y bounces — solo ves lo que importa.
          </p>
        </div>
      </section>

      {/* Action bar */}
      <section style={{ maxWidth: 1280, margin: "0 auto", padding: "12px 28px 0" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          background: PAPER, border: `1px solid ${LINE}`, borderRadius: 16,
          padding: "14px 18px", boxShadow: "0 1px 2px rgba(10,13,20,0.04)",
        }}>
          <div style={{ position: "relative", flex: 1, minWidth: 240, maxWidth: 400 }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar en asunto, remitente o cuerpo…"
              style={{ ...inputStyle, paddingLeft: 38 }}
            />
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={INK_4} strokeWidth="2" style={{ position: "absolute", left: 12, top: 13 }}>
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>

          {/* Toggle vista: Recibidos / Enviados */}
          <div style={{ display: "inline-flex", padding: 3, background: SURF, borderRadius: 10, border: `1px solid ${LINE}` }}>
            <button onClick={() => setView("inbox")} style={{ ...segBtn(view === "inbox"), display: "inline-flex", alignItems: "center", gap: 5 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg>
              Recibidos
            </button>
            <button onClick={() => setView("sent")} style={{ ...segBtn(view === "sent"), display: "inline-flex", alignItems: "center", gap: 5 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              Enviados
            </button>
          </div>

          {/* Sub-filtros — distintos según vista */}
          {view === "inbox" ? (
            <div style={{ display: "inline-flex", padding: 3, background: SURF, borderRadius: 10, border: `1px solid ${LINE}` }}>
              {(["all", "unread", "starred"] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} style={segBtn(filter === f)}>
                  {f === "all" ? "Todos" : f === "unread" ? "No leídos" : "★ Destacados"}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ display: "inline-flex", padding: 3, background: SURF, borderRadius: 10, border: `1px solid ${LINE}` }}>
              {(["all", "reply", "followup", "campaign", "test"] as const).map((t) => (
                <button key={t} onClick={() => setSentTypeFilter(t)} style={segBtn(sentTypeFilter === t)}>
                  {t === "all" ? "Todos" : t === "reply" ? "Respuestas" : t === "followup" ? "Follow-ups" : t === "campaign" ? "Campañas" : "Tests"}
                </button>
              ))}
            </div>
          )}

          {accounts.length > 1 && (
            <select
              value={accountFilter || ""}
              onChange={(e) => setAccountFilter(e.target.value || null)}
              style={{ ...inputStyle, height: 38, width: "auto", minWidth: 180 }}
            >
              <option value="">Todas las cuentas</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.email} ({a.messages_count})</option>
              ))}
            </select>
          )}

          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "5px 10px 5px 8px",
              background: "rgba(31,138,91,0.08)", border: "1px solid rgba(31,138,91,0.22)",
              borderRadius: 999, fontSize: 11.5, fontWeight: 600, color: GREEN,
              fontFamily: FONT_UI,
            }} title="El servidor sincroniza IMAP cada 2 min y el cliente refresca la lista automáticamente.">
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: GREEN, boxShadow: "0 0 0 3px rgba(31,138,91,0.18)" }} />
              Auto-sync · 2 min
            </span>
            <button onClick={syncNow} disabled={syncing} style={{ ...brandBtn, opacity: syncing ? 0.55 : 1 }}>
              {syncing ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
                  Sincronizando…
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
                  Sincronizar ahora
                </>
              )}
            </button>
          </div>
        </div>

        {syncSummary && (
          <div style={{
            marginTop: 10, padding: "10px 14px",
            background: "rgba(31,138,91,0.08)",
            border: "1px solid rgba(31,138,91,0.2)",
            borderRadius: 10, fontSize: 12.5, color: GREEN,
          }}>
            ✓ Sync completado: <strong>{syncSummary.ok_accounts}/{syncSummary.total_accounts}</strong> cuentas ·{" "}
            <strong>+{syncSummary.new_messages}</strong> nuevos ·{" "}
            <strong style={{ color: ORANGE }}>{syncSummary.warmup_filtered}</strong> warmup filtrados ·{" "}
            <strong style={{ color: DANGER }}>{syncSummary.bounce_filtered}</strong> bounces filtrados
          </div>
        )}
      </section>

      {/* Inbox + detail (vista RECIBIDOS) */}
      {view === "inbox" && (
      <section style={{
        maxWidth: 1280, margin: "0 auto", padding: "20px 28px 80px",
        display: "grid", gridTemplateColumns: "minmax(380px, 460px) 1fr", gap: 18,
        alignItems: "start",
      }}>
        {/* LIST */}
        <div style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: 14, overflow: "hidden", minHeight: 400 }}>
          {loading ? (
            <div style={{ padding: 40, color: INK_4 }}>Cargando…</div>
          ) : threadsList.length === 0 ? (
            <EmptyInbox accounts={accounts} onSync={syncNow} syncing={syncing} />
          ) : (
            <>
              <div style={{ padding: "10px 16px", borderBottom: `1px solid ${LINE}`, background: SURF, fontSize: 11, color: INK_4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {total} mensaje{total === 1 ? "" : "s"} · {threadsList.length} thread{threadsList.length === 1 ? "" : "s"}
              </div>
              <div style={{ maxHeight: "calc(100vh - 320px)", overflow: "auto" }}>
                {threadsList.map(({ head, count, anyStarred, anyUnread }) => {
                  const isActive = selectedThreadId === head.thread_id;
                  return (
                    <div
                      key={head.thread_id}
                      onClick={() => openMessage(head)}
                      style={{
                        padding: "12px 16px",
                        borderBottom: `1px solid ${LINE}`,
                        cursor: "pointer",
                        background: isActive ? "rgba(154,105,245,0.06)" : anyUnread ? "#fff" : "#fafafa",
                        borderLeft: isActive ? `3px solid ${PURPLE}` : "3px solid transparent",
                        transition: "background .12s",
                      }}
                      onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = SURF; }}
                      onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = anyUnread ? "#fff" : "#fafafa"; }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleStar(head); }}
                          style={{ background: "transparent", border: 0, cursor: "pointer", color: anyStarred ? ORANGE : INK_5, padding: 0, lineHeight: 0 }}
                          title={anyStarred ? "Quitar destacado" : "Destacar"}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill={anyStarred ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                        </button>
                        <div style={{ fontSize: 13.5, fontWeight: anyUnread ? 700 : 500, color: anyUnread ? INK : INK_2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                          {head.from_name || head.from_address}
                          {count > 1 && <span style={{ color: INK_4, fontWeight: 500, marginLeft: 6 }}>({count})</span>}
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteMessage(head); }}
                          className="row-delete-btn"
                          style={{ background: "transparent", border: 0, cursor: "pointer", color: INK_5, padding: 2, lineHeight: 0, opacity: 0, transition: "opacity .15s" }}
                          title="Eliminar"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                        </button>
                        <span style={{ fontSize: 11, color: INK_4, fontFamily: FONT_MONO }}>
                          {new Date(head.date).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: anyUnread ? 600 : 500, color: anyUnread ? INK : INK_2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2 }}>
                        {head.subject || "(sin asunto)"}
                      </div>
                      <div style={{ fontSize: 12, color: INK_4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {head.preview || "(sin contenido)"}
                      </div>
                      <div style={{ fontSize: 10.5, color: INK_5, marginTop: 4, fontFamily: FONT_MONO }}>
                        → {head.account_email}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* DETAIL */}
        <div style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: 14, padding: 24, minHeight: 400 }}>
          {!detail ? (
            <div style={{ textAlign: "center", padding: "80px 20px", color: INK_4 }}>
              <div style={{ width: 56, height: 56, borderRadius: 16, background: SURF, margin: "0 auto 16px", display: "grid", placeItems: "center", color: PURPLE_DEEP }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2" /><polyline points="22,6 12,13 2,6" /></svg>
              </div>
              <div style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 18, color: INK, marginBottom: 6 }}>
                Selecciona un mensaje
              </div>
              <p style={{ fontSize: 13.5, color: INK_3, margin: 0 }}>
                Elige un email de la lista para ver el contenido y los demás mensajes del thread.
              </p>
            </div>
          ) : detailLoading ? (
            <div style={{ color: INK_4 }}>Cargando mensaje…</div>
          ) : (
            <div>
              <h2 style={{ margin: 0, fontFamily: FONT_SANS, fontWeight: 700, fontSize: 22, letterSpacing: "-0.025em", color: INK, lineHeight: 1.2 }}>
                {detail.message.subject || "(sin asunto)"}
              </h2>
              <div style={{ marginTop: 10, fontSize: 12.5, color: INK_3 }}>
                <strong style={{ color: INK_2 }}>De:</strong> {detail.message.from_name ? `${detail.message.from_name} <${detail.message.from_address}>` : detail.message.from_address}
              </div>
              <div style={{ fontSize: 12.5, color: INK_3, marginTop: 2 }}>
                <strong style={{ color: INK_2 }}>Para:</strong> {detail.message.to_address}
                <span style={{ color: INK_5, marginLeft: 10, fontFamily: FONT_MONO }}>
                  · {new Date(detail.message.date).toLocaleString("es-ES")}
                </span>
              </div>
              <div style={{ marginTop: 6, fontSize: 11.5, color: INK_4, fontFamily: FONT_MONO }}>
                bandeja: {detail.message.account_email}
              </div>

              {/* Acciones */}
              <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                <button onClick={() => { setShowReply(true); setShowFollowUp(false); }} style={brandBtn}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></svg>
                  Responder
                </button>
                <button onClick={() => { setShowFollowUp(true); setShowReply(false); }} style={ghostBtn}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                  Programar follow-up
                </button>
                <button onClick={() => deleteMessage(detail.message)} style={{ ...ghostBtn, color: "#c12530", borderColor: "rgba(255,51,68,0.25)" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                  Eliminar
                </button>
                <button onClick={() => blockSender(detail.message.from_address, "email")} style={{ ...ghostBtn, color: "#c12530", borderColor: "rgba(255,51,68,0.25)" }} title="Bloquear este email — quita el lead de TODAS las campañas y nunca más se le envía">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg>
                  Bloquear remitente
                </button>
                <button onClick={() => loadFollowUpsForThread(detail.message.thread_id)} style={{ ...ghostBtn, marginLeft: "auto" }} title="Ver follow-ups programados">
                  Follow-ups del thread
                </button>
              </div>

              {/* Lista de follow-ups del thread */}
              {threadFollowUps && threadFollowUps.length > 0 && (
                <div style={{ marginTop: 14, padding: "12px 14px", background: "rgba(154,105,245,0.05)", border: "1px solid rgba(154,105,245,0.18)", borderRadius: 10 }}>
                  <div style={{ fontSize: 11, color: PURPLE_DEEP, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                    Follow-ups programados ({threadFollowUps.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {threadFollowUps.map((fu) => (
                      <div key={fu.id} style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "8px 12px", background: "#fff", border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 12,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, color: INK }}>
                            {fu.status === "pending" ? `Para ${new Date(fu.scheduled_for).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` :
                             fu.status === "sent" ? `Enviado ${new Date(fu.sent_at!).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` :
                             fu.status === "cancelled" ? "Cancelado" : "Falló"}
                            {fu.only_if_no_reply && fu.status === "pending" && (
                              <span style={{ color: INK_4, fontWeight: 500, marginLeft: 6, fontSize: 11 }}>· solo si no responden</span>
                            )}
                          </div>
                          <div style={{ color: INK_4, fontSize: 11, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {fu.body.slice(0, 90)}
                          </div>
                          {fu.cancellation_reason && (
                            <div style={{ color: ORANGE, fontSize: 10.5, marginTop: 2 }}>{fu.cancellation_reason}</div>
                          )}
                          {fu.last_error && (
                            <div style={{ color: "#c12530", fontSize: 10.5, marginTop: 2 }}>{fu.last_error}</div>
                          )}
                        </div>
                        <StatusFu status={fu.status} />
                        {fu.status === "pending" && (
                          <button onClick={async () => {
                            if (!confirm("¿Cancelar este follow-up?")) return;
                            await fetch(`/api/email-followups/${fu.id}`, { method: "DELETE" });
                            setThreadFollowUps((arr) => arr ? arr.filter((x) => x.id !== fu.id) : null);
                            showToast("✓ Follow-up cancelado");
                          }} style={{ background: "transparent", border: 0, color: INK_4, cursor: "pointer", fontSize: 14, padding: 4 }}>×</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Composer de reply */}
              {showReply && (
                <ReplyComposer
                  message={detail.message}
                  onCancel={() => setShowReply(false)}
                  onSent={() => { setShowReply(false); showToast("✓ Respuesta enviada"); }}
                  toast={showToast}
                />
              )}

              {/* Modal follow-up */}
              {showFollowUp && (
                <FollowUpModal
                  message={detail.message}
                  onClose={() => setShowFollowUp(false)}
                  onScheduled={() => { setShowFollowUp(false); showToast("✓ Follow-up programado"); loadFollowUpsForThread(detail.message.thread_id); }}
                  toast={showToast}
                />
              )}

              <hr style={{ border: 0, borderTop: `1px solid ${LINE}`, margin: "20px 0" }} />

              {detail.message.html ? (
                <div
                  style={{ fontSize: 14, lineHeight: 1.55, color: INK_2, overflowX: "auto" }}
                  dangerouslySetInnerHTML={{
                    __html: detail.message.html
                      .replace(/<script[\s\S]*?<\/script>/gi, "")
                      .replace(/<style[\s\S]*?<\/style>/gi, ""),
                  }}
                />
              ) : (
                <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 14, lineHeight: 1.55, color: INK_2, fontFamily: FONT_UI, margin: 0 }}>
                  {detail.message.text || detail.message.preview || "(sin contenido)"}
                </pre>
              )}

              {detail.thread.length > 1 && (
                <>
                  <hr style={{ border: 0, borderTop: `1px solid ${LINE}`, margin: "24px 0 14px" }} />
                  <div style={{ fontSize: 11.5, color: INK_4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                    Resto del thread ({detail.thread.length - 1})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {detail.thread.filter((m) => m.id !== detail.message.id).map((m) => (
                      <div key={m.id} onClick={() => openMessage(m as any)} style={{
                        padding: "8px 12px", borderRadius: 8,
                        background: SURF, border: `1px solid ${LINE}`, cursor: "pointer", fontSize: 12.5,
                      }}>
                        <div style={{ fontWeight: 600, color: INK }}>{m.from_name || m.from_address}</div>
                        <div style={{ color: INK_4, fontSize: 11, marginTop: 2 }}>
                          {new Date(m.date).toLocaleString("es-ES")} · {m.preview.slice(0, 80)}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </section>
      )}

      {/* Vista ENVIADOS */}
      {view === "sent" && (
        <SentView
          messages={sentMessages}
          total={sentTotal}
          loading={loadingSent}
          selected={selectedSent}
          onSelect={setSelectedSent}
          onDelete={async (s) => {
            if (!confirm("¿Borrar este registro? No afecta al email ya enviado, solo a la entrada del log.")) return;
            setSentMessages((arr) => arr.filter((x) => x.id !== s.id));
            if (selectedSent?.id === s.id) setSelectedSent(null);
            await fetch(`/api/email-sent/${s.id}`, { method: "DELETE" });
            showToast("✓ Registro eliminado");
          }}
        />
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        /* Botón de delete en cada fila — solo aparece al hover */
        div:hover > div > .row-delete-btn { opacity: 0.7 !important; }
        .row-delete-btn:hover { opacity: 1 !important; color: #c12530 !important; }
      `}</style>
      {ToastNode}
    </div>
  );
}

/** Vista de mensajes ENVIADOS: lista a la izquierda + detalle a la derecha. */
function SentView({
  messages, total, loading, selected, onSelect, onDelete,
}: {
  messages: SentMessage[]; total: number; loading: boolean;
  selected: SentMessage | null;
  onSelect: (s: SentMessage | null) => void;
  onDelete: (s: SentMessage) => void;
}) {
  return (
    <section style={{
      maxWidth: 1280, margin: "0 auto", padding: "20px 28px 80px",
      display: "grid", gridTemplateColumns: "minmax(380px, 460px) 1fr", gap: 18,
      alignItems: "start",
    }}>
      {/* LIST */}
      <div style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: 14, overflow: "hidden", minHeight: 400 }}>
        {loading ? (
          <div style={{ padding: 40, color: INK_4 }}>Cargando enviados…</div>
        ) : messages.length === 0 ? (
          <div style={{ padding: "60px 24px", textAlign: "center" }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: SURF, margin: "0 auto 14px", display: "grid", placeItems: "center", color: PURPLE_DEEP }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            </div>
            <div style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 18, color: INK, marginBottom: 6 }}>Sin enviados</div>
            <p style={{ fontSize: 13.5, color: INK_3, margin: 0 }}>
              Cada respuesta, follow-up, test o paso de campaña aparecerá aquí.
            </p>
          </div>
        ) : (
          <>
            <div style={{ padding: "10px 16px", borderBottom: `1px solid ${LINE}`, background: SURF, fontSize: 11, color: INK_4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {total} enviado{total === 1 ? "" : "s"}
            </div>
            <div style={{ maxHeight: "calc(100vh - 360px)", overflow: "auto" }}>
              {messages.map((s) => {
                const isActive = selected?.id === s.id;
                return (
                  <div
                    key={s.id}
                    onClick={() => onSelect(s)}
                    style={{
                      padding: "12px 16px",
                      borderBottom: `1px solid ${LINE}`,
                      cursor: "pointer",
                      background: isActive ? "rgba(154,105,245,0.06)" : "#fff",
                      borderLeft: isActive ? `3px solid ${PURPLE}` : "3px solid transparent",
                      transition: "background .12s",
                    }}
                    onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = SURF; }}
                    onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "#fff"; }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <TypeBadge type={s.type} />
                      <div style={{ fontSize: 13, fontWeight: 600, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                        → {s.to_name || s.to_address}
                      </div>
                      <span style={{ fontSize: 11, color: INK_4, fontFamily: FONT_MONO }}>
                        {new Date(s.sent_at).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: INK_2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2 }}>
                      {s.subject || "(sin asunto)"}
                    </div>
                    <div style={{ fontSize: 12, color: INK_4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.body.slice(0, 120)}
                    </div>
                    <div style={{ fontSize: 10.5, color: INK_5, marginTop: 4, fontFamily: FONT_MONO, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <span>desde {s.account_email}</span>
                      {!s.ok && <span style={{ color: "#c12530" }}>· FALLÓ</span>}
                      {s.ok && s.appended_to_sent && <span style={{ color: GREEN }}>· en {s.sent_folder || "Sent"}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* DETAIL */}
      <div style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: 14, padding: 24, minHeight: 400 }}>
        {!selected ? (
          <div style={{ textAlign: "center", padding: "80px 20px", color: INK_4 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: SURF, margin: "0 auto 16px", display: "grid", placeItems: "center", color: PURPLE_DEEP }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            </div>
            <div style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 18, color: INK, marginBottom: 6 }}>Selecciona un envío</div>
            <p style={{ fontSize: 13.5, color: INK_3, margin: 0 }}>
              Aparecerán todos los emails que has enviado desde la plataforma — respuestas, follow-ups, tests y campañas.
            </p>
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <TypeBadge type={selected.type} large />
              <span style={{ fontSize: 11.5, color: INK_4, fontFamily: FONT_MONO }}>
                {new Date(selected.sent_at).toLocaleString("es-ES")}
                {typeof selected.ms === "number" && ` · ${selected.ms}ms`}
              </span>
              <button onClick={() => onDelete(selected)} style={{
                marginLeft: "auto", height: 30, padding: "0 12px", borderRadius: 8,
                border: `1px solid rgba(255,51,68,0.25)`, background: "#fff", color: "#c12530",
                fontFamily: FONT_UI, fontWeight: 600, fontSize: 12, cursor: "pointer",
              }}>🗑 Borrar registro</button>
            </div>

            <h2 style={{ margin: 0, fontFamily: FONT_SANS, fontWeight: 700, fontSize: 22, letterSpacing: "-0.025em", color: INK, lineHeight: 1.2 }}>
              {selected.subject || "(sin asunto)"}
            </h2>
            <div style={{ marginTop: 10, fontSize: 12.5, color: INK_3 }}>
              <strong style={{ color: INK_2 }}>De:</strong> {selected.account_email}
            </div>
            <div style={{ fontSize: 12.5, color: INK_3, marginTop: 2 }}>
              <strong style={{ color: INK_2 }}>Para:</strong> {selected.to_name ? `${selected.to_name} <${selected.to_address}>` : selected.to_address}
            </div>

            {/* Contexto */}
            {(selected.campaign_id || selected.followup_id || selected.thread_id) && (
              <div style={{ marginTop: 10, padding: "8px 12px", background: SURF, border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 11.5, color: INK_3, fontFamily: FONT_MONO, lineHeight: 1.6 }}>
                {selected.campaign_id && (
                  <div>
                    <strong>Campaña:</strong> <a href={`/email-campaigns/${selected.campaign_id}`} style={{ color: PURPLE_DEEP }}>{selected.campaign_id.slice(0, 8)}…</a>
                    {selected.campaign_step && ` · step ${selected.campaign_step}`}
                    {selected.campaign_variant && ` · variante ${selected.campaign_variant}`}
                  </div>
                )}
                {selected.lead_email && <div><strong>Lead:</strong> {selected.lead_email}</div>}
                {selected.followup_id && <div><strong>Follow-up:</strong> {selected.followup_id.slice(0, 8)}…</div>}
                {selected.thread_id && <div><strong>Thread:</strong> {selected.thread_id.slice(0, 32)}…</div>}
                {selected.message_id && <div><strong>Message-ID:</strong> {selected.message_id.slice(0, 60)}…</div>}
              </div>
            )}

            {!selected.ok && selected.error && (
              <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(255,51,68,0.06)", border: "1px solid rgba(255,51,68,0.2)", borderRadius: 8, color: "#c12530", fontSize: 13 }}>
                <strong>Error de envío:</strong> {selected.error}
              </div>
            )}

            <hr style={{ border: 0, borderTop: `1px solid ${LINE}`, margin: "20px 0" }} />

            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 14, lineHeight: 1.55, color: INK_2, fontFamily: FONT_UI, margin: 0 }}>
              {selected.body || "(sin cuerpo)"}
            </pre>
          </div>
        )}
      </div>
    </section>
  );
}

function TypeBadge({ type, large }: { type: SentMessage["type"]; large?: boolean }) {
  const m: Record<SentMessage["type"], { bg: string; fg: string; label: string }> = {
    reply:    { bg: "rgba(31,138,91,0.10)", fg: GREEN, label: "Respuesta" },
    followup: { bg: "rgba(249,166,3,0.12)", fg: "#b97500", label: "Follow-up" },
    campaign: { bg: "rgba(154,105,245,0.10)", fg: PURPLE_DEEP, label: "Campaña" },
    test:     { bg: SURF_2, fg: INK_3, label: "Test" },
  };
  const s = m[type];
  return (
    <span style={{
      padding: large ? "4px 12px" : "2px 8px",
      borderRadius: 999, fontSize: large ? 12 : 10.5, fontWeight: 700,
      background: s.bg, color: s.fg, textTransform: large ? "none" : "uppercase",
      letterSpacing: large ? "0" : "0.05em", whiteSpace: "nowrap", flexShrink: 0,
    }}>
      {s.label}
    </span>
  );
}

/** Composer inline para responder al mensaje activo. */
function ReplyComposer({ message, onCancel, onSent, toast }: {
  message: FullMessage; onCancel: () => void; onSent: () => void; toast: (s: string) => void;
}) {
  const [bodyText, setBodyText] = useState("");
  const [sending, setSending] = useState(false);

  // Cita el original como bloque al final por defecto (estilo Gmail/Outlook)
  useEffect(() => {
    const quoted = (message.text || message.preview || "")
      .split("\n").slice(0, 30).map((l) => `> ${l}`).join("\n");
    const dateStr = new Date(message.date).toLocaleString("es-ES");
    setBodyText(`\n\n\nEl ${dateStr}, ${message.from_name || message.from_address} escribió:\n${quoted}`);
    // Cursor al inicio
    setTimeout(() => {
      const ta = document.getElementById("reply-textarea") as HTMLTextAreaElement | null;
      if (ta) { ta.focus(); ta.setSelectionRange(0, 0); ta.scrollTop = 0; }
    }, 50);
  }, [message.id]);

  async function send() {
    if (!bodyText.trim()) { toast("Escribe algo antes de enviar"); return; }
    setSending(true);
    try {
      const r = await fetch(`/api/email-inbox/${message.id}/reply`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: bodyText }),
      });
      const j = await r.json();
      if (r.ok && j.ok) {
        onSent();
      } else {
        toast(j.error || "Error enviando");
      }
    } finally { setSending(false); }
  }

  return (
    <div style={{ marginTop: 16, padding: "16px 18px", background: SURF, border: `1px solid ${LINE}`, borderRadius: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
        <div style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 14, color: INK, letterSpacing: "-0.01em" }}>
          Responder a {message.from_name || message.from_address}
        </div>
        <div style={{ fontSize: 11.5, color: INK_4, fontFamily: FONT_MONO, marginLeft: "auto" }}>
          desde {message.account_email}
        </div>
      </div>
      <textarea
        id="reply-textarea"
        value={bodyText}
        onChange={(e) => setBodyText(e.target.value)}
        rows={10}
        placeholder="Escribe tu respuesta aquí…"
        style={{
          width: "100%", padding: "12px 14px",
          background: "#fff", border: `1px solid ${LINE2}`, borderRadius: 10,
          fontFamily: FONT_UI, fontSize: 14, lineHeight: 1.55, color: INK_2,
          outline: "none", boxSizing: "border-box", resize: "vertical",
        }}
      />
      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <button onClick={send} disabled={sending || !bodyText.trim()} style={{ ...brandBtn, opacity: sending || !bodyText.trim() ? 0.55 : 1 }}>
          {sending ? "Enviando…" : (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              Enviar respuesta
            </>
          )}
        </button>
        <button onClick={onCancel} style={ghostBtn} disabled={sending}>Cancelar</button>
        <div style={{ marginLeft: "auto", alignSelf: "center", fontSize: 11.5, color: INK_5, fontFamily: FONT_MONO }}>
          {bodyText.length} caracteres
        </div>
      </div>
    </div>
  );
}

/** Modal para programar un follow-up. */
function FollowUpModal({ message, onClose, onScheduled, toast }: {
  message: FullMessage; onClose: () => void; onScheduled: () => void; toast: (s: string) => void;
}) {
  // Por defecto: dentro de 3 días a las 10:00 hora local
  const defaultDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    d.setHours(10, 0, 0, 0);
    return d.toISOString().slice(0, 16); // datetime-local format
  };
  const [bodyText, setBodyText] = useState("");
  const [scheduledFor, setScheduledFor] = useState(defaultDate());
  const [onlyIfNoReply, setOnlyIfNoReply] = useState(true);
  const [sending, setSending] = useState(false);
  const [preset, setPreset] = useState<"3d" | "5d" | "7d" | "14d" | "custom">("3d");

  function applyPreset(p: typeof preset) {
    setPreset(p);
    if (p === "custom") return;
    const days = p === "3d" ? 3 : p === "5d" ? 5 : p === "7d" ? 7 : 14;
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(10, 0, 0, 0);
    setScheduledFor(d.toISOString().slice(0, 16));
  }

  async function schedule() {
    if (!bodyText.trim()) { toast("Escribe el cuerpo del follow-up"); return; }
    setSending(true);
    try {
      // datetime-local → ISO (interpretado como hora local del navegador)
      const localDate = new Date(scheduledFor);
      const r = await fetch(`/api/email-inbox/${message.id}/followup`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: bodyText,
          scheduled_for: localDate.toISOString(),
          only_if_no_reply: onlyIfNoReply,
        }),
      });
      const j = await r.json();
      if (r.ok && j.ok) {
        onScheduled();
      } else {
        toast(j.error || "Error programando");
      }
    } finally { setSending(false); }
  }

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(10,13,20,0.42)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 24,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: PAPER, borderRadius: 20, width: "100%", maxWidth: 640,
        boxShadow: "0 30px 90px rgba(10,13,20,0.22)", overflow: "hidden",
      }}>
        <div style={{ padding: "22px 26px", borderBottom: `1px solid ${LINE}` }}>
          <h2 style={{ margin: 0, fontFamily: FONT_SANS, fontWeight: 700, fontSize: 22, letterSpacing: "-0.025em", color: INK }}>
            Programar follow-up
          </h2>
          <p style={{ margin: "6px 0 0", color: INK_3, fontSize: 13.5 }}>
            Se enviará en el thread con <strong>{message.from_name || message.from_address}</strong> desde <strong>{message.account_email}</strong>.
          </p>
        </div>
        <div style={{ padding: 24, display: "grid", gap: 14 }}>
          {/* Presets */}
          <div>
            <div style={{ fontSize: 11, color: INK_3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Cuándo</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {([
                { id: "3d" as const, label: "En 3 días" },
                { id: "5d" as const, label: "En 5 días" },
                { id: "7d" as const, label: "En 1 semana" },
                { id: "14d" as const, label: "En 2 semanas" },
                { id: "custom" as const, label: "Personalizado" },
              ]).map((p) => (
                <button key={p.id} onClick={() => applyPreset(p.id)} style={{
                  height: 32, padding: "0 12px", borderRadius: 8,
                  border: preset === p.id ? `1.5px solid ${PURPLE}` : `1px solid ${LINE2}`,
                  background: preset === p.id ? "rgba(154,105,245,0.08)" : "#fff",
                  color: preset === p.id ? PURPLE_DEEP : INK_2,
                  fontWeight: 600, fontSize: 12.5, fontFamily: FONT_UI, cursor: "pointer",
                }}>{p.label}</button>
              ))}
            </div>
            <input
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => { setScheduledFor(e.target.value); setPreset("custom"); }}
              style={{ ...inputStyle, marginTop: 8 }}
            />
          </div>

          {/* Body */}
          <label style={{ display: "block" }}>
            <div style={{ fontSize: 11, color: INK_3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Mensaje</div>
            <textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              rows={8}
              placeholder={`Hola ${message.from_name?.split(" ")[0] || ""},\n\nNo sé si viste mi último mensaje — te dejo arriba el contexto.\n\nUn saludo,`}
              style={{
                width: "100%", padding: "12px 14px",
                background: "#fff", border: `1px solid ${LINE2}`, borderRadius: 10,
                fontFamily: FONT_UI, fontSize: 14, lineHeight: 1.55, color: INK_2,
                outline: "none", boxSizing: "border-box", resize: "vertical",
              }}
            />
          </label>

          {/* Only if no reply toggle */}
          <label style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 14px", background: SURF, border: `1px solid ${LINE}`, borderRadius: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={onlyIfNoReply} onChange={(e) => setOnlyIfNoReply(e.target.checked)} style={{ marginTop: 3 }} />
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: INK_2 }}>Solo si no me responden</div>
              <div style={{ fontSize: 11.5, color: INK_4, marginTop: 3, lineHeight: 1.4 }}>
                Recomendado. Si llega cualquier respuesta nueva en este thread antes de la fecha,
                el follow-up se auto-cancela. Evita enviarle a alguien que ya respondió.
              </div>
            </div>
          </label>
        </div>
        <div style={{ padding: "14px 26px", borderTop: `1px solid ${LINE}`, display: "flex", justifyContent: "flex-end", gap: 10, background: SURF }}>
          <button onClick={onClose} style={ghostBtn} disabled={sending}>Cancelar</button>
          <button onClick={schedule} disabled={sending || !bodyText.trim()} style={{ ...brandBtn, opacity: sending || !bodyText.trim() ? 0.55 : 1 }}>
            {sending ? "Programando…" : "Programar follow-up"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusFu({ status }: { status: FollowUp["status"] }) {
  const map: Record<FollowUp["status"], { bg: string; fg: string; label: string }> = {
    pending:    { bg: "rgba(249,166,3,0.12)", fg: "#b97500", label: "Pendiente" },
    sent:       { bg: "rgba(31,138,91,0.10)", fg: GREEN, label: "Enviado" },
    cancelled:  { bg: SURF_2, fg: INK_3, label: "Cancelado" },
    failed:     { bg: "rgba(255,51,68,0.08)", fg: "#c12530", label: "Falló" },
  };
  const s = map[status];
  return (
    <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: s.bg, color: s.fg }}>
      {s.label}
    </span>
  );
}

function EmptyInbox({ accounts, onSync, syncing }: { accounts: AccountSummary[]; onSync: () => void; syncing: boolean }) {
  const hasAccounts = accounts.length > 0;
  return (
    <div style={{ padding: "60px 28px", textAlign: "center" }}>
      <div style={{ width: 64, height: 64, borderRadius: 16, background: SURF, margin: "0 auto 18px", display: "grid", placeItems: "center", color: PURPLE_DEEP }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg>
      </div>
      <h2 style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 20, color: INK, margin: "0 0 8px", letterSpacing: "-0.02em" }}>
        {hasAccounts ? "Bandeja vacía" : "Conecta una cuenta primero"}
      </h2>
      <p style={{ fontSize: 13.5, color: INK_3, margin: "0 0 18px", maxWidth: 320, marginLeft: "auto", marginRight: "auto" }}>
        {hasAccounts
          ? "Pulsa Sincronizar para descargar los últimos correos de tus cuentas conectadas."
          : "Conecta al menos una cuenta IMAP/SMTP para empezar a recibir aquí."}
      </p>
      {hasAccounts ? (
        <button onClick={onSync} disabled={syncing} style={brandBtn}>
          {syncing ? "Sincronizando…" : "Sincronizar ahora"}
        </button>
      ) : (
        <a href="/connect-accounts" style={{ ...brandBtn, textDecoration: "none" }}>
          Conectar cuentas
        </a>
      )}
    </div>
  );
}

const segBtn = (on: boolean): React.CSSProperties => ({
  height: 30, padding: "0 12px", borderRadius: 7, border: 0,
  background: on ? PAPER : "transparent",
  color: on ? INK : INK_3,
  fontWeight: 600, fontSize: 12.5, fontFamily: FONT_UI, cursor: "pointer",
  boxShadow: on ? "0 1px 2px rgba(10,13,20,0.06)" : "none",
});
