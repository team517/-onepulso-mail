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

type WorkerLog = {
  at: string;
  level: "info" | "warn" | "error" | "send";
  message: string;
  campaign_id?: string;
  campaign_name?: string;
  lead_email?: string;
  account_email?: string;
  step?: number;
  variant?: string;
};

type WorkerStatus = {
  running: boolean;
  loops: number;
  last_loop_at: string | null;
  tracked_accounts: number;
  recent_log: WorkerLog[];
};

type SentEntry = {
  id: string;
  type: "reply" | "followup" | "test" | "campaign";
  account_email: string;
  to_address: string;
  subject: string;
  sent_at: string;
  ok: boolean;
  error?: string | null;
  campaign_id?: string;
  campaign_step?: number;
  lead_email?: string;
};

export default function LogsPage() {
  const router = useRouter();
  const { show: showToast, ToastNode } = useToast();
  const [worker, setWorker] = useState<WorkerStatus | null>(null);
  const [sent, setSent] = useState<SentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "send" | "error" | "info" | "warn">("all");
  const [search, setSearch] = useState("");
  const [paused, setPaused] = useState(false);
  // Cuando es no-null, muestra el modal con el detalle del envío.
  const [detailId, setDetailId] = useState<string | null>(null);

  async function load() {
    try {
      const [w, s] = await Promise.all([
        fetch("/api/email-campaigns/worker").then((r) => r.json()),
        fetch("/api/email-sent?limit=200").then((r) => r.json()),
      ]);
      setWorker(w);
      setSent(s.sent || []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (paused) return;
    const h = setInterval(load, 40_000); // refresh cada 40s (antes 10s — demasiado parpadeo)
    return () => clearInterval(h);
  }, [paused]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/landing");
  }

  // Combina worker.recent_log + sent en un timeline unificado.
  type Event = {
    id: string;
    at: string;
    level: "send" | "info" | "warn" | "error";
    message: string;
    campaign_name?: string;
    campaign_id?: string;
    lead_email?: string;
    account_email?: string;
    step?: number;
    variant?: string;
    subject?: string;
  };
  const events: Event[] = useMemo(() => {
    const arr: Event[] = [];
    // Worker log
    (worker?.recent_log || []).forEach((e, i) => {
      arr.push({
        id: `w-${e.at}-${i}`,
        at: e.at,
        level: e.level,
        message: e.message,
        campaign_id: e.campaign_id,
        campaign_name: e.campaign_name,
        lead_email: e.lead_email,
        account_email: e.account_email,
        step: e.step,
        variant: e.variant,
      });
    });
    /** Clasifica el error SMTP en una categoría reconocible. */
    function classifyError(err: string): { icon: string; label: string; clean: string } {
      const e = (err || "").toLowerCase();
      if (/\b(450|421|451|429)\b|mail\s*send\s*limit|too\s*many|rate\s*limit|throttl|mailbox\s*unavailable/i.test(e)) {
        return { icon: "🚫", label: "IONOS rate limit", clean: "El servidor IONOS bloqueó temporalmente esta cuenta" };
      }
      if (/\b550\b|user\s*unknown|user\s*does\s*not\s*exist|no\s*such\s*user|address\s*not\s*found/i.test(e)) {
        return { icon: "💔", label: "Bounce permanente", clean: "El destinatario no existe (550)" };
      }
      if (/\b552\b|mailbox\s*(is\s*)?full|over\s*quota/i.test(e)) {
        return { icon: "📦", label: "Buzón lleno", clean: "El buzón del destinatario está lleno (552)" };
      }
      if (/eauth|535|authentication\s*failed/i.test(e)) {
        return { icon: "🔐", label: "Auth fallida", clean: "Password incorrecta o credencial expirada" };
      }
      if (/etimedout|econnreset|econnrefused|enotfound/i.test(e)) {
        return { icon: "🌐", label: "Error de red", clean: "Problema de conexión con el servidor SMTP" };
      }
      if (/blocked\s*by|blacklist|spam|reputation/i.test(e)) {
        return { icon: "🚷", label: "IP en blacklist", clean: "Reputación del servidor degradada" };
      }
      // Default: muestra los primeros 100 chars del error
      return { icon: "⚠", label: "Error SMTP", clean: (err || "").slice(0, 100) };
    }

    // Sent log (cada envío también aparece como "send" en el timeline global)
    sent.forEach((s) => {
      if (s.ok) {
        arr.push({
          id: `s-${s.id}`,
          at: s.sent_at,
          level: "send",
          message: `Email enviado · ${s.type}`,
          campaign_id: s.campaign_id,
          lead_email: s.lead_email || s.to_address,
          account_email: s.account_email,
          step: s.campaign_step,
          subject: s.subject,
        });
      } else {
        const c = classifyError(s.error || "");
        arr.push({
          id: `s-${s.id}`,
          at: s.sent_at,
          level: "error",
          message: `${c.icon} ${c.label} · ${c.clean}`,
          campaign_id: s.campaign_id,
          lead_email: s.lead_email || s.to_address,
          account_email: s.account_email,
          step: s.campaign_step,
          subject: s.subject,
        });
      }
    });
    arr.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
    return arr;
  }, [worker, sent]);

  const filteredRaw = events.filter((e) => {
    if (filter !== "all" && e.level !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!e.message.toLowerCase().includes(q) &&
          !(e.lead_email || "").toLowerCase().includes(q) &&
          !(e.account_email || "").toLowerCase().includes(q) &&
          !(e.campaign_name || "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  /** Colapsa mensajes idénticos consecutivos en 1 entrada con contador.
   *  Ejemplo: 6 "Tick saltado" → 1 fila con badge "×6". El timestamp es
   *  el más reciente del grupo. Reduce drasticamente el ruido. */
  const filtered = useMemo(() => {
    const out: Array<typeof filteredRaw[number] & { count?: number; firstAt?: string }> = [];
    for (const ev of filteredRaw) {
      const prev = out[out.length - 1];
      // Mismo level + mismo mensaje + misma cuenta/lead/campaña → agrupar
      if (
        prev &&
        prev.level === ev.level &&
        prev.message === ev.message &&
        prev.campaign_id === ev.campaign_id &&
        prev.lead_email === ev.lead_email &&
        prev.account_email === ev.account_email
      ) {
        prev.count = (prev.count || 1) + 1;
        prev.firstAt = ev.at; // el más viejo (los eventos están ordenados desc)
        continue;
      }
      out.push({ ...ev, count: 1 });
    }
    return out;
  }, [filteredRaw]);

  const counts = {
    send: events.filter((e) => e.level === "send").length,
    info: events.filter((e) => e.level === "info").length,
    warn: events.filter((e) => e.level === "warn").length,
    error: events.filter((e) => e.level === "error").length,
  };

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: FONT_UI, color: INK_2 }}>
      <BrandFonts />
      <TopNav activeKey="logs" onLogout={logout} toast={showToast} />

      {/* HERO */}
      <section style={{ position: "relative", overflow: "hidden", padding: "56px 0 24px" }}>
        <div style={{
          position: "absolute", top: -100, right: -120, width: 460, height: 460, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(154,105,245,0.12), transparent 60%)", filter: "blur(80px)", pointerEvents: "none",
        }} />
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "0 28px", position: "relative", zIndex: 1 }}>
          <Eyebrow color={PURPLE}>
            Worker {worker?.running ? "activo" : "detenido"} · loop #{worker?.loops ?? "—"}
            {worker?.last_loop_at && ` · último tick hace ${Math.max(0, Math.round((Date.now() - new Date(worker.last_loop_at).getTime()) / 1000))}s`}
          </Eyebrow>
          <h1 style={{
            margin: "20px 0 0",
            fontFamily: FONT_SANS, fontWeight: 800,
            fontSize: "clamp(36px, 4.5vw, 56px)", letterSpacing: "-0.035em",
            lineHeight: 1.02, color: INK,
          }}>
            Logs <span style={{ fontFamily: FONT_SERIF, fontWeight: 400, fontStyle: "italic" }}>en</span>{" "}
            <span style={{ background: BRAND_G, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>vivo.</span>
          </h1>
          <p style={{ margin: "16px 0 0", maxWidth: 600, fontSize: 16, lineHeight: 1.55, color: INK_3 }}>
            Cada envío, cada reply detectado, cada sync IMAP, cada error del worker — cross-campaña, en tiempo real.
          </p>
        </div>
      </section>

      {/* Action bar */}
      <section style={{ maxWidth: 1240, margin: "0 auto", padding: "12px 28px 0" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          background: PAPER, border: `1px solid ${LINE}`, borderRadius: 16,
          padding: "12px 16px", boxShadow: "0 1px 2px rgba(10,13,20,0.04)",
        }}>
          <div style={{ position: "relative", flex: 1, minWidth: 220, maxWidth: 360 }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar lead, cuenta, campaña…" style={{ ...inputStyle, paddingLeft: 36 }} />
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={INK_4} strokeWidth="2" style={{ position: "absolute", left: 11, top: 14 }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
          <div style={{ display: "inline-flex", padding: 3, background: SURF, borderRadius: 10, border: `1px solid ${LINE}`, gap: 2 }}>
            {(["all","send","info","warn","error"] as const).map((f) => {
              const count = f === "all" ? events.length : counts[f];
              return (
                <button key={f} onClick={() => setFilter(f)} style={{
                  height: 30, padding: "0 12px", borderRadius: 7, border: 0,
                  background: filter === f ? PAPER : "transparent",
                  color: filter === f ? INK : INK_3,
                  fontWeight: 600, fontSize: 12, fontFamily: FONT_UI, cursor: "pointer",
                  boxShadow: filter === f ? "0 1px 2px rgba(10,13,20,0.06)" : "none",
                  display: "inline-flex", alignItems: "center", gap: 5,
                }}>
                  {f === "all" ? "Todos" : f === "send" ? "Envíos" : f === "info" ? "Info" : f === "warn" ? "Warnings" : "Errores"}
                  <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: INK_4 }}>{count}</span>
                </button>
              );
            })}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button onClick={() => setPaused((v) => !v)} style={{
              ...ghostBtn, height: 38,
              background: paused ? "rgba(249,166,3,0.10)" : PAPER,
              color: paused ? "#b97500" : INK_2,
            }} title="Pausa/Reanuda el auto-refresh">
              {paused ? "▶ Reanudar" : "⏸ Pausar"}
            </button>
            <button onClick={load} style={ghostBtn} title="Recargar ahora">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              Refrescar
            </button>
            <button
              onClick={async () => {
                await fetch("/api/email-campaigns/worker", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "tick" }) });
                showToast("✓ Tick forzado");
                load();
              }}
              style={brandBtn}
            >
              Forzar tick
            </button>
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 11.5, color: INK_4, display: "flex", gap: 14, flexWrap: "wrap" }}>
          <span>Worker: <strong style={{ color: worker?.running ? GREEN : "#c12530" }}>{worker?.running ? "RUNNING" : "STOPPED"}</strong></span>
          <span>Loops: <strong style={{ color: INK_2, fontFamily: FONT_MONO }}>{worker?.loops ?? 0}</strong></span>
          <span>Cuentas tracked: <strong style={{ color: INK_2, fontFamily: FONT_MONO }}>{worker?.tracked_accounts ?? 0}</strong></span>
          {!paused && <span style={{ color: GREEN }}>· auto-refresh cada 40s</span>}
        </div>
      </section>

      {/* Timeline */}
      <section style={{ maxWidth: 1240, margin: "0 auto", padding: "16px 28px 80px" }}>
        <div style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: 14, overflow: "hidden" }}>
          {loading ? (
            <div style={{ padding: 40, color: INK_4 }}>Cargando…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "60px 24px", textAlign: "center" }}>
              <div style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 18, color: INK, marginBottom: 6 }}>
                {events.length === 0 ? "Sin actividad del worker todavía" : "Sin eventos con este filtro"}
              </div>
              <p style={{ fontSize: 13.5, color: INK_3, margin: 0 }}>
                {events.length === 0
                  ? "Activa una campaña con cuentas asignadas para ver actividad."
                  : "Cambia el filtro o la búsqueda."}
              </p>
            </div>
          ) : (
            <div>
              {filtered.map((e) => (
                <LogRow
                  key={e.id}
                  event={e}
                  count={e.count}
                  firstAt={e.firstAt}
                  onClick={
                    e.id.startsWith("s-")
                      ? () => setDetailId(e.id.slice(2))  // quita prefijo "s-"
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {detailId && (
        <SentDetailModal sentId={detailId} onClose={() => setDetailId(null)} />
      )}

      {ToastNode}
    </div>
  );
}

function SentDetailModal({ sentId, onClose }: { sentId: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(`/api/email-sent/${sentId}`)
      .then((r) => r.json())
      .then((j) => setData(j.sent))
      .finally(() => setLoading(false));
  }, [sentId]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(10,13,20,0.42)",
        backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 200, padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: PAPER, borderRadius: 18, width: "100%", maxWidth: 760,
          maxHeight: "88vh", display: "flex", flexDirection: "column",
          boxShadow: "0 30px 90px rgba(10,13,20,0.22)", overflow: "hidden",
        }}
      >
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${LINE}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: FONT_SANS, fontWeight: 700, fontSize: 20, color: INK }}>
              Detalle del envío
            </h2>
            {data && (
              <div style={{ fontSize: 12, color: INK_4, fontFamily: FONT_MONO, marginTop: 4 }}>
                {data.type} · {new Date(data.sent_at).toLocaleString("es-ES")}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: 0, fontSize: 22, color: INK_4, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 24, overflow: "auto", flex: 1 }}>
          {loading ? (
            <div style={{ color: INK_4 }}>Cargando…</div>
          ) : !data ? (
            <div style={{ color: "#c12530" }}>No se encontró el envío</div>
          ) : (
            <>
              {/* Status */}
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "5px 12px", borderRadius: 999,
                background: data.ok ? "rgba(31,138,91,0.10)" : "rgba(255,51,68,0.08)",
                color: data.ok ? GREEN : "#c12530",
                fontSize: 12, fontWeight: 700, marginBottom: 14,
              }}>
                {data.ok ? "✓ Enviado correctamente" : "✗ Falló"}
                {data.ms && <span style={{ color: INK_4, fontWeight: 500 }}>· {data.ms}ms</span>}
              </div>

              {/* Meta */}
              <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "6px 12px", fontSize: 13, marginBottom: 18, color: INK_2 }}>
                <span style={{ color: INK_4, fontFamily: FONT_MONO }}>De:</span>
                <span>{data.account_email}</span>
                <span style={{ color: INK_4, fontFamily: FONT_MONO }}>Para:</span>
                <span>{data.to_address}</span>
                {data.campaign_id && (
                  <>
                    <span style={{ color: INK_4, fontFamily: FONT_MONO }}>Campaña:</span>
                    <span><a href={`/email-campaigns/${data.campaign_id}`} style={{ color: PURPLE_DEEP }}>ver campaña →</a></span>
                  </>
                )}
                {data.campaign_step && (
                  <>
                    <span style={{ color: INK_4, fontFamily: FONT_MONO }}>Step:</span>
                    <span>{data.campaign_step}{data.campaign_variant ? ` · variante ${data.campaign_variant}` : ""}</span>
                  </>
                )}
                {data.message_id && (
                  <>
                    <span style={{ color: INK_4, fontFamily: FONT_MONO }}>Message-ID:</span>
                    <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: INK_4 }}>{data.message_id}</span>
                  </>
                )}
                {data.appended_to_sent !== undefined && (
                  <>
                    <span style={{ color: INK_4, fontFamily: FONT_MONO }}>Sent IMAP:</span>
                    <span style={{ color: data.appended_to_sent ? GREEN : INK_4 }}>
                      {data.appended_to_sent ? `✓ guardado en ${data.sent_folder || "Sent"}` : "no append"}
                    </span>
                  </>
                )}
              </div>

              {/* Subject */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: INK_4, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                  Subject
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: INK, fontFamily: FONT_SANS }}>
                  {data.subject || "(sin subject)"}
                </div>
              </div>

              {/* Body */}
              <div>
                <div style={{ fontSize: 11, color: INK_4, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                  Cuerpo del mensaje
                </div>
                <div style={{
                  background: SURF, border: `1px solid ${LINE}`, borderRadius: 10,
                  padding: "14px 16px", whiteSpace: "pre-wrap",
                  fontFamily: "-apple-system, sans-serif",
                  fontSize: 13.5, lineHeight: 1.55, color: INK_2,
                  maxHeight: 380, overflow: "auto",
                }}>
                  {data.body || "(cuerpo vacío)"}
                </div>
              </div>

              {/* Error si falló */}
              {!data.ok && data.error && (
                <div style={{
                  marginTop: 16, padding: "12px 14px",
                  background: "rgba(255,51,68,0.06)", border: "1px solid rgba(255,51,68,0.2)",
                  borderRadius: 10, color: "#c12530", fontSize: 13, fontFamily: FONT_MONO,
                }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Error:</div>
                  {data.error}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function LogRow({ event: e, count, firstAt, onClick }: { event: any; count?: number; firstAt?: string; onClick?: () => void }) {
  const map: Record<string, { color: string; bg: string; label: string; icon: string }> = {
    send:  { color: GREEN, bg: "rgba(31,138,91,0.10)", label: "SEND", icon: "✉" },
    info:  { color: BLUE, bg: "rgba(5,102,234,0.10)", label: "INFO", icon: "ⓘ" },
    warn:  { color: "#b97500", bg: "rgba(249,166,3,0.12)", label: "WARN", icon: "⚠" },
    error: { color: "#c12530", bg: "rgba(255,51,68,0.08)", label: "ERROR", icon: "✗" },
  };
  const c = map[e.level] || map.info;
  const ageMin = Math.round((Date.now() - new Date(e.at).getTime()) / 60000);
  const ageStr = ageMin < 1 ? "ahora" : ageMin < 60 ? `${ageMin}m` : ageMin < 1440 ? `${Math.round(ageMin / 60)}h` : `${Math.round(ageMin / 1440)}d`;
  const isGrouped = (count || 1) > 1;

  return (
    <div
      onClick={onClick}
      style={{
        display: "grid",
        gridTemplateColumns: "auto 80px 1fr auto",
        gap: 12, alignItems: "center",
        padding: "10px 16px",
        borderTop: `1px solid ${LINE}`,
        fontSize: 12.5,
        cursor: onClick ? "pointer" : "default",
        transition: "background .12s",
      }}
      onMouseEnter={(ev) => { if (onClick) (ev.currentTarget as HTMLElement).style.background = "rgba(154,105,245,0.05)"; }}
      onMouseLeave={(ev) => { if (onClick) (ev.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      <span style={{
        width: 22, height: 22, borderRadius: "50%",
        background: c.bg, color: c.color,
        display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, flexShrink: 0,
      }}>{c.icon}</span>

      <span style={{
        fontFamily: FONT_MONO, fontSize: 10.5, fontWeight: 700,
        color: c.color, letterSpacing: "0.05em",
      }}>{c.label}</span>

      <div style={{ minWidth: 0 }}>
        <div style={{ color: INK_2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{e.message}</span>
          {isGrouped && (
            <span style={{
              fontFamily: FONT_MONO, fontSize: 10.5, fontWeight: 700,
              color: c.color, background: c.bg, padding: "2px 7px", borderRadius: 10,
              flexShrink: 0,
            }} title={firstAt ? `Primera vez: ${new Date(firstAt).toLocaleString("es-ES")}` : undefined}>
              ×{count}
            </span>
          )}
        </div>
        <div style={{ fontSize: 10.5, color: INK_4, marginTop: 2, fontFamily: FONT_MONO, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {e.campaign_name && (
            <a href={`/email-campaigns/${e.campaign_id}`} style={{ color: PURPLE_DEEP, textDecoration: "none" }}>📂 {e.campaign_name}</a>
          )}
          {e.step && <span>step {e.step}{e.variant ? `·${e.variant}` : ""}</span>}
          {e.lead_email && <span>→ {e.lead_email}</span>}
          {e.account_email && <span>vía {e.account_email}</span>}
          {e.subject && <span style={{ color: INK_5 }}>"{e.subject.slice(0, 50)}"</span>}
        </div>
      </div>

      <span style={{ fontSize: 10.5, color: INK_4, fontFamily: FONT_MONO, whiteSpace: "nowrap" }} title={new Date(e.at).toLocaleString("es-ES")}>
        {ageStr}
      </span>
    </div>
  );
}
