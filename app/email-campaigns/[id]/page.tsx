"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  BG, INK, INK_2, INK_3, INK_4, INK_5, LINE, LINE2, PAPER, SURF, SURF_2,
  BRAND_G, GREEN, ORANGE, PURPLE, PURPLE_DEEP, BLUE, DANGER,
  FONT_SANS, FONT_UI, FONT_MONO, FONT_SERIF,
  TopNav, BrandFonts, useToast,
  brandBtn, ghostBtn, inputStyle,
} from "../_shell";
import { parseLeadsCsv } from "@/lib/csv-leads";

/* ── Types ────────────────────────────────────────────────────────────── */
type Variant = { id: string; label: string; subject: string; body: string; weight: number };
type Step = { id: string; delay_days: number; delay_hours: number; variants: Variant[] };
type Schedule = { timezone: string; days: number[]; start_hour: number; end_hour: number };
type Options = {
  stop_on_reply: boolean; stop_on_auto_reply: boolean; stop_company_on_reply: boolean;
  track_opens: boolean; track_clicks: boolean;
  text_only_first: boolean; text_only_all: boolean;
  insert_unsubscribe_header: boolean;
  daily_limit_per_account: number;
  max_new_leads_per_day: number;
  min_gap_minutes: number; random_gap_minutes: number;
  sticky_sender: boolean;
  account_rotation: "round-robin" | "random" | "weighted";
  cc?: string; bcc?: string;
};
type Metrics = {
  total_leads: number; active_leads: number; contacted: number;
  opened: number; clicked: number; replied: number;
  bounced: number; unsubscribed: number; completed: number;
};
type Campaign = {
  id: string; name: string;
  status: "draft" | "active" | "paused" | "completed";
  created_at: string; updated_at: string;
  steps: Step[];
  account_ids: string[];
  schedule: Schedule;
  options: Options;
  variables: string[];
  tags?: string[];
  metrics?: Metrics;
};
type Lead = {
  id: string; email: string;
  variables: Record<string, string>;
  status: "new" | "active" | "paused" | "completed" | "bounced" | "replied" | "unsubscribed";
  current_step: number;
  sticky_account_id?: string;
  added_at: string;
  last_contacted_at?: string | null;
};
type Account = {
  id: string; email: string; display_name?: string;
  provider: string; smtp_host: string; smtp_port: number;
  smtp_ok: boolean; imap_ok: boolean;
  daily_limit?: number; warmup_enabled?: boolean; sent_today?: number;
  tags?: string[];
};

type Tab = "overview" | "sequences" | "leads" | "schedule" | "options" | "accounts";

/* ── Page ────────────────────────────────────────────────────────────── */
export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const campaignId = String(params.id);
  const { show: showToast, ToastNode } = useToast();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("sequences");
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/email-campaigns/${campaignId}`);
      if (!r.ok) {
        if (r.status === 404) { router.replace("/email-campaigns"); return; }
        showToast("Error cargando campaña"); return;
      }
      const j = await r.json();
      setCampaign(j.campaign);
      setNameDraft(j.campaign.name);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [campaignId]);

  async function patch(body: any) {
    const r = await fetch(`/api/email-campaigns/${campaignId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const j = await r.json();
    if (j.ok) setCampaign(j.campaign);
    return j;
  }

  async function saveName() {
    if (!nameDraft.trim() || !campaign || nameDraft === campaign.name) { setRenaming(false); return; }
    await patch({ name: nameDraft.trim() });
    setRenaming(false);
    showToast("✓ Nombre actualizado");
  }

  async function changeStatus(s: Campaign["status"]) {
    await patch({ status: s });
    showToast(`✓ ${s === "active" ? "Campaña activada" : s === "paused" ? "Campaña pausada" : "Estado actualizado"}`);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/landing");
  }

  if (loading || !campaign) {
    return (
      <div style={{ minHeight: "100vh", background: BG, fontFamily: FONT_UI, color: INK_2 }}>
        <BrandFonts />
        <TopNav activeKey="campanas" onLogout={logout} />
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "64px 28px", color: INK_4 }}>
          {loading ? "Cargando campaña…" : "Campaña no encontrada"}
        </div>
        {ToastNode}
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: FONT_UI, color: INK_2 }}>
      <BrandFonts />
      <TopNav activeKey="campanas" onLogout={logout} toast={showToast} />

      {/* HEADER */}
      <section style={{ maxWidth: 1240, margin: "0 auto", padding: "32px 28px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: INK_4, marginBottom: 18 }}>
          <a href="/email-campaigns" style={{ color: INK_3, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Campañas
          </a>
          <span style={{ color: INK_5 }}>/</span>
          <span style={{ color: INK_2 }}>{campaign.name}</span>
        </div>

        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            {renaming ? (
              <input
                autoFocus value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") { setNameDraft(campaign.name); setRenaming(false); } }}
                style={{
                  width: "100%", maxWidth: 720,
                  fontFamily: FONT_SANS, fontWeight: 800,
                  fontSize: "clamp(28px, 4vw, 40px)", letterSpacing: "-0.035em",
                  color: INK, background: "transparent",
                  border: `1.5px solid ${PURPLE}`, borderRadius: 10, padding: "6px 12px",
                  outline: "none",
                }}
              />
            ) : (
              <h1 onClick={() => setRenaming(true)} style={{
                margin: 0, cursor: "text",
                fontFamily: FONT_SANS, fontWeight: 800,
                fontSize: "clamp(28px, 4vw, 40px)",
                letterSpacing: "-0.035em", lineHeight: 1.05, color: INK,
                display: "inline-flex", alignItems: "center", gap: 10,
              }}>
                {campaign.name}
                <button title="Renombrar" style={{
                  background: "transparent", border: 0, color: INK_5, cursor: "pointer", padding: 4,
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
              </h1>
            )}
            <div style={{ marginTop: 10, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <StatusBadge status={campaign.status} />
              <span style={{ fontSize: 13, color: INK_4, fontFamily: FONT_MONO }}>
                {campaign.steps.length} step{campaign.steps.length === 1 ? "" : "s"} ·
                {" "}{campaign.steps.reduce((s, st) => s + st.variants.length, 0)} variantes ·
                {" "}{campaign.account_ids.length} cuenta{campaign.account_ids.length === 1 ? "" : "s"} ·
                {" "}creada {new Date(campaign.created_at).toLocaleDateString("es-ES")}
              </span>
            </div>
          </div>

          {/* Status actions */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {campaign.status !== "active" && (
              <button onClick={() => changeStatus("active")} style={brandBtn}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                Activar campaña
              </button>
            )}
            {campaign.status === "active" && (
              <button onClick={() => changeStatus("paused")} style={ghostBtn}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                Pausar
              </button>
            )}
          </div>
        </div>
      </section>

      {/* TABS */}
      <section style={{ maxWidth: 1240, margin: "0 auto", padding: "28px 28px 0" }}>
        <div style={{
          display: "flex", gap: 2, borderBottom: `1px solid ${LINE}`,
          overflowX: "auto", marginBottom: 24,
        }}>
          {([
            { id: "overview", label: "Analytics", icon: <IconChart /> },
            { id: "sequences", label: "Sequences", icon: <IconLayers /> },
            { id: "leads", label: "Leads", icon: <IconUsers /> },
            { id: "schedule", label: "Schedule", icon: <IconClock /> },
            { id: "options", label: "Options", icon: <IconSliders /> },
            { id: "accounts", label: "Email Accounts", icon: <IconMail /> },
          ] as { id: Tab; label: string; icon: React.ReactNode }[]).map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "12px 18px", marginBottom: -1,
              border: 0, background: "transparent",
              borderBottom: tab === t.id ? `2.5px solid ${INK}` : "2.5px solid transparent",
              color: tab === t.id ? INK : INK_3,
              fontFamily: FONT_UI, fontWeight: 600, fontSize: 14,
              cursor: "pointer", transition: "color .15s",
              whiteSpace: "nowrap",
            }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </section>

      {/* TAB CONTENT */}
      <section style={{ maxWidth: 1240, margin: "0 auto", padding: "0 28px 80px" }}>
        {tab === "overview" && <OverviewTab campaign={campaign} />}
        {tab === "sequences" && <SequencesTab campaign={campaign} setCampaign={setCampaign} toast={showToast} />}
        {tab === "leads" && <LeadsTab campaign={campaign} setCampaign={setCampaign} toast={showToast} />}
        {tab === "schedule" && <ScheduleTab campaign={campaign} onChange={async (s) => { await patch({ schedule: s }); showToast("✓ Schedule guardado"); }} />}
        {tab === "options" && <OptionsTab campaign={campaign} onChange={async (o) => { await patch({ options: o }); showToast("✓ Opciones guardadas"); }} />}
        {tab === "accounts" && <AccountsTab campaign={campaign} setCampaign={setCampaign} toast={showToast} />}
      </section>

      {ToastNode}
    </div>
  );
}

/* ── Status badge ────────────────────────────────────────────────────── */
function StatusBadge({ status }: { status: Campaign["status"] }) {
  const m: Record<typeof status, { bg: string; fg: string; label: string }> = {
    draft:     { bg: SURF_2, fg: INK_3, label: "Borrador" },
    active:    { bg: "rgba(31,138,91,0.10)", fg: GREEN, label: "Activa" },
    paused:    { bg: "rgba(249,166,3,0.12)", fg: "#b97500", label: "Pausada" },
    completed: { bg: "rgba(154,105,245,0.10)", fg: PURPLE, label: "Completada" },
  };
  const s = m[status];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 10px", borderRadius: 999,
      background: s.bg, color: s.fg,
      fontSize: 12, fontWeight: 600,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor" }} />
      {s.label}
    </span>
  );
}

/* ════════════════════════════════════════════════════════════════════
   TAB 1: OVERVIEW (Analytics)
   ════════════════════════════════════════════════════════════════════ */
function OverviewTab({ campaign }: { campaign: Campaign }) {
  const m = campaign.metrics || { total_leads: 0, active_leads: 0, contacted: 0, opened: 0, clicked: 0, replied: 0, bounced: 0, unsubscribed: 0, completed: 0 };
  const openRate  = m.contacted > 0 ? Math.round((m.opened / m.contacted) * 100) : 0;
  const replyRate = m.contacted > 0 ? Math.round((m.replied / m.contacted) * 100) : 0;
  const clickRate = m.contacted > 0 ? Math.round((m.clicked / m.contacted) * 100) : 0;

  const cards: { label: string; value: number | string; sub?: string; color?: string }[] = [
    { label: "Leads totales", value: m.total_leads, sub: `${m.active_leads} activos` },
    { label: "Contactados", value: m.contacted, sub: m.total_leads > 0 ? `${Math.round(m.contacted / m.total_leads * 100)}% del total` : "0%" },
    { label: "Open rate", value: `${openRate}%`, sub: `${m.opened} aperturas`, color: ORANGE },
    { label: "Click rate", value: `${clickRate}%`, sub: `${m.clicked} clics`, color: BLUE },
    { label: "Reply rate", value: `${replyRate}%`, sub: `${m.replied} respuestas`, color: GREEN },
    { label: "Bounces", value: m.bounced, sub: `${m.unsubscribed} unsubs`, color: DANGER },
  ];

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 28 }}>
        {cards.map((c) => (
          <div key={c.label} style={cardStyle}>
            <div style={{ fontSize: 11, color: INK_4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{c.label}</div>
            <div style={{ fontFamily: FONT_SANS, fontWeight: 800, fontSize: 32, color: c.color || INK, letterSpacing: "-0.03em", marginTop: 6, lineHeight: 1 }}>
              {c.value}
            </div>
            {c.sub && <div style={{ fontSize: 12, color: INK_4, marginTop: 4, fontFamily: FONT_MONO }}>{c.sub}</div>}
          </div>
        ))}
      </div>

      {/* Funnel */}
      <div style={cardStyle}>
        <h3 style={cardTitle}>Funnel</h3>
        {[
          { label: "Leads", value: m.total_leads, max: m.total_leads || 1, color: SURF_2, fg: INK },
          { label: "Contactados", value: m.contacted, max: m.total_leads || 1, color: "rgba(154,105,245,0.20)", fg: PURPLE_DEEP },
          { label: "Abiertos", value: m.opened, max: m.total_leads || 1, color: "rgba(249,166,3,0.22)", fg: "#b97500" },
          { label: "Clic", value: m.clicked, max: m.total_leads || 1, color: "rgba(5,102,234,0.18)", fg: BLUE },
          { label: "Respondidos", value: m.replied, max: m.total_leads || 1, color: "rgba(31,138,91,0.20)", fg: GREEN },
        ].map((row) => {
          const pct = Math.max(2, Math.min(100, (row.value / row.max) * 100));
          return (
            <div key={row.label} style={{ marginTop: 14, display: "grid", gridTemplateColumns: "110px 1fr 60px", gap: 12, alignItems: "center" }}>
              <div style={{ fontSize: 13.5, color: INK_2, fontWeight: 600 }}>{row.label}</div>
              <div style={{ height: 30, background: SURF_2, borderRadius: 8, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: row.color, display: "flex", alignItems: "center", paddingLeft: 12, color: row.fg, fontWeight: 700, fontSize: 12.5, fontFamily: FONT_MONO }}>
                  {row.value}
                </div>
              </div>
              <div style={{ fontSize: 12, color: INK_4, textAlign: "right", fontFamily: FONT_MONO }}>
                {Math.round((row.value / row.max) * 100)}%
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ marginTop: 18, fontSize: 12.5, color: INK_5, fontFamily: FONT_MONO }}>
        Las métricas se actualizan cuando el worker de envíos procesa los pasos. Activa la campaña para empezar.
      </p>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   TAB 2: SEQUENCES (steps + variants editor)
   ════════════════════════════════════════════════════════════════════ */
/**
 * Editor de asunto + cuerpo con chips de variables y spintax que insertan
 * en EL CAMPO ENFOCADO (Asunto o Cuerpo) en la posición exacta del cursor.
 *
 * - `lastFocused` recuerda el último campo donde el usuario tenía el cursor.
 * - `insertAtCursor` reemplaza la selección (o inserta en cursor) y restaura
 *   el cursor justo después del texto insertado.
 * - El chip activo muestra "Insertar en {Asunto/Cuerpo}" como tooltip.
 */
function SubjectBodyEditor({
  variant, availableVariables, onChange, onAddVariable,
}: {
  variant: Variant;
  availableVariables: string[];
  onChange: (field: "subject" | "body", value: string) => void;
  onAddVariable: (name: string) => Promise<string | null>; // devuelve la clave slug creada (o null si error)
}) {
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [lastFocused, setLastFocused] = useState<"subject" | "body">("subject");
  const [showAddVar, setShowAddVar] = useState(false);
  const [newVarName, setNewVarName] = useState("");

  /** Inserta texto en el campo enfocado, en la posición del cursor (o reemplazando la selección). */
  function insertAtCursor(text: string) {
    const ref = lastFocused === "subject" ? subjectRef : bodyRef;
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const newValue = el.value.slice(0, start) + text + el.value.slice(end);
    onChange(lastFocused, newValue);
    // Restaurar foco + cursor después de re-render
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + text.length;
      try { el.setSelectionRange(pos, pos); } catch {}
    });
  }

  const subjectFocusedBorder = lastFocused === "subject" ? `1.5px solid ${PURPLE}` : `1px solid ${LINE2}`;
  const bodyFocusedBorder = lastFocused === "body" ? `1.5px solid ${PURPLE}` : `1px solid ${LINE2}`;

  return (
    <>
      {/* Subject */}
      <label style={{ display: "block", marginBottom: 12 }}>
        <div style={{ ...miniLabel, display: "flex", alignItems: "center", gap: 6 }}>
          Asunto
          {lastFocused === "subject" && (
            <span style={{ background: "rgba(154,105,245,0.12)", color: PURPLE_DEEP, padding: "1px 7px", borderRadius: 999, fontSize: 9.5, fontWeight: 700 }}>
              ACTIVO
            </span>
          )}
        </div>
        <input
          ref={subjectRef}
          value={variant.subject}
          onChange={(e) => onChange("subject", e.target.value)}
          onFocus={() => setLastFocused("subject")}
          placeholder="{Hola|Hey} {{first_name}}, sobre {{company_name}}…"
          style={{ ...inputStyle, border: subjectFocusedBorder, transition: "border-color .15s" }}
        />
      </label>

      {/* Body */}
      <label style={{ display: "block", marginBottom: 12 }}>
        <div style={{ ...miniLabel, display: "flex", alignItems: "center", gap: 6 }}>
          Cuerpo del email
          {lastFocused === "body" && (
            <span style={{ background: "rgba(154,105,245,0.12)", color: PURPLE_DEEP, padding: "1px 7px", borderRadius: 999, fontSize: 9.5, fontWeight: 700 }}>
              ACTIVO
            </span>
          )}
        </div>
        <textarea
          ref={bodyRef}
          value={variant.body}
          onChange={(e) => onChange("body", e.target.value)}
          onFocus={() => setLastFocused("body")}
          rows={14}
          placeholder={"Hola {{first_name}},\n\nVi que en {{company_name}} sois {{job_title|equipo}}. {Quería|Quería preguntarte si} sería interesante una llamada esta semana.\n\nUn saludo,\n{{sender_first_name|}}"}
          style={{
            ...inputStyle, height: "auto", padding: "12px 14px",
            fontFamily: FONT_UI, fontSize: 14, lineHeight: 1.6, resize: "vertical",
            border: bodyFocusedBorder, transition: "border-color .15s",
          }}
        />
      </label>

      {/* Helpers: chips que insertan en el campo activo (Asunto o Cuerpo) */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 11.5, color: INK_4, fontWeight: 600, marginRight: 4 }}>
          Insertar en <strong style={{ color: PURPLE_DEEP, textTransform: "capitalize" }}>{lastFocused === "subject" ? "Asunto" : "Cuerpo"}</strong>:
        </span>
        {availableVariables.length === 0 && (
          <span style={{ fontSize: 11.5, color: INK_5, fontStyle: "italic", marginRight: 4 }}>
            Sube un CSV o créalas a mano →
          </span>
        )}
        {availableVariables.map((v) => (
          <button
            key={v}
            type="button"
            onMouseDown={(e) => e.preventDefault()}  // evita perder foco del input
            onClick={() => insertAtCursor(`{{${v}}}`)}
            style={{
              padding: "3px 9px", borderRadius: 6,
              background: SURF, color: PURPLE_DEEP,
              border: `1px solid ${LINE}`, fontFamily: FONT_MONO, fontSize: 11.5, fontWeight: 600,
              cursor: "pointer",
            }}
            title={`Insertar {{${v}}} en ${lastFocused === "subject" ? "Asunto" : "Cuerpo"}`}
          >
            {"{{"}{v}{"}}"}
          </button>
        ))}
        {/* + Añadir variable manualmente */}
        {showAddVar ? (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <input
              autoFocus
              value={newVarName}
              onChange={(e) => setNewVarName(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && newVarName.trim()) {
                  const created = await onAddVariable(newVarName.trim());
                  if (created) {
                    setNewVarName(""); setShowAddVar(false);
                    insertAtCursor(`{{${created}}}`);
                  }
                } else if (e.key === "Escape") {
                  setNewVarName(""); setShowAddVar(false);
                }
              }}
              placeholder="nombre_variable"
              style={{
                height: 26, padding: "0 8px",
                border: `1px solid ${PURPLE}`, borderRadius: 6,
                fontFamily: FONT_MONO, fontSize: 11.5, color: INK_2,
                outline: "none", minWidth: 130,
              }}
            />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={async () => {
                if (!newVarName.trim()) { setShowAddVar(false); return; }
                const created = await onAddVariable(newVarName.trim());
                if (created) {
                  setNewVarName(""); setShowAddVar(false);
                  insertAtCursor(`{{${created}}}`);
                }
              }}
              style={{
                height: 26, padding: "0 8px",
                background: BRAND_G, color: "#fff", border: 0, borderRadius: 6,
                fontWeight: 700, fontSize: 11, cursor: "pointer",
              }}
            >✓</button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setNewVarName(""); setShowAddVar(false); }}
              style={{ background: "transparent", border: 0, color: INK_4, cursor: "pointer", fontSize: 14, padding: "0 4px" }}
            >×</button>
          </span>
        ) : (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setShowAddVar(true)}
            style={{
              padding: "3px 9px", borderRadius: 6,
              background: "rgba(154,105,245,0.10)", color: PURPLE_DEEP,
              border: `1px dashed rgba(154,105,245,0.4)`, fontFamily: FONT_UI, fontSize: 11.5, fontWeight: 600,
              cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4,
            }}
            title="Añadir variable nueva (sin CSV)"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Variable
          </button>
        )}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insertAtCursor("{Hola|Hey|Buenas}")}
          style={{
            padding: "3px 9px", borderRadius: 6,
            background: "rgba(249,166,3,0.12)", color: "#b97500",
            border: `1px solid rgba(249,166,3,0.25)`, fontFamily: FONT_MONO, fontSize: 11.5, fontWeight: 600,
            cursor: "pointer", marginLeft: 6,
          }}
          title={`Insertar spintax en ${lastFocused === "subject" ? "Asunto" : "Cuerpo"}`}
        >
          {"{spintax|opciones}"}
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const tpl = prompt("Spintax personalizado (separa con |):", "opción1|opción2|opción3");
            if (tpl && tpl.includes("|")) insertAtCursor(`{${tpl}}`);
          }}
          style={{
            padding: "3px 9px", borderRadius: 6,
            background: "transparent", color: INK_3,
            border: `1px dashed ${LINE2}`, fontFamily: FONT_UI, fontSize: 11.5, fontWeight: 600,
            cursor: "pointer",
          }}
          title="Crear spintax personalizado"
        >
          + spintax custom
        </button>
      </div>
    </>
  );
}

function SequencesTab({ campaign, setCampaign, toast }: { campaign: Campaign; setCampaign: (c: Campaign | ((p: Campaign) => Campaign)) => void; toast: (s: string) => void }) {
  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const [activeVariantIdx, setActiveVariantIdx] = useState(0);
  const [preview, setPreview] = useState<{ subject: string; body: string; lead_email?: string } | null>(null);
  const [showSendTest, setShowSendTest] = useState(false);
  const savingTimerRef = useRef<any>(null);

  const step = campaign.steps[activeStepIdx];
  const variant = step?.variants[activeVariantIdx];

  useEffect(() => {
    setActiveVariantIdx(0);
  }, [activeStepIdx]);

  /** Aplica el campaign devuelto por el server SIN provocar un refetch global. */
  function applyServerCampaign(c: Campaign) {
    setCampaign(c);
  }

  async function addStep() {
    const r = await fetch(`/api/email-campaigns/${campaign.id}/steps`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    const j = await r.json();
    if (j.ok) {
      const newIdx = j.campaign.steps.length - 1;
      applyServerCampaign(j.campaign);
      setActiveStepIdx(newIdx);
      toast("✓ Step añadido");
    }
  }

  async function removeStep(stepId: string) {
    if (campaign.steps.length <= 1) { toast("Tiene que haber al menos 1 step"); return; }
    if (!confirm("¿Eliminar este step y sus variantes?")) return;
    const r = await fetch(`/api/email-campaigns/${campaign.id}/steps/${stepId}`, { method: "DELETE" });
    const j = await r.json();
    if (j.ok) {
      setActiveStepIdx(Math.max(0, activeStepIdx - 1));
      applyServerCampaign(j.campaign);
      toast("✓ Step eliminado");
    }
  }

  async function patchStep(stepId: string, body: any) {
    // Optimista: actualizamos local primero
    setCampaign((prev) => ({
      ...prev,
      steps: prev.steps.map((s) => s.id === stepId ? { ...s, ...body } : s),
    }));
    // Persistimos en background — sin re-fetch
    fetch(`/api/email-campaigns/${campaign.id}/steps/${stepId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).catch(() => {});
  }

  async function addVariant() {
    if (!step) return;
    const r = await fetch(`/api/email-campaigns/${campaign.id}/steps/${step.id}/variants`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const j = await r.json();
    if (j.ok) {
      applyServerCampaign(j.campaign);
      // Selecciona la nueva variante (última del step)
      const updatedStep = j.campaign.steps.find((s: Step) => s.id === step.id);
      if (updatedStep) setActiveVariantIdx(updatedStep.variants.length - 1);
      toast(`✓ Variante ${j.variant.label} añadida`);
    }
  }
  async function duplicateVariant() {
    if (!step || !variant) return;
    const r = await fetch(`/api/email-campaigns/${campaign.id}/steps/${step.id}/variants`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from_variant_id: variant.id }) });
    const j = await r.json();
    if (j.ok) {
      applyServerCampaign(j.campaign);
      const updatedStep = j.campaign.steps.find((s: Step) => s.id === step.id);
      if (updatedStep) setActiveVariantIdx(updatedStep.variants.length - 1);
      toast(`✓ Duplicada como ${j.variant.label}`);
    }
  }
  async function removeVariant() {
    if (!step || !variant) return;
    if (step.variants.length <= 1) { toast("Tiene que haber al menos 1 variante"); return; }
    if (!confirm(`¿Eliminar variante ${variant.label}?`)) return;
    const r = await fetch(`/api/email-campaigns/${campaign.id}/steps/${step.id}/variants/${variant.id}`, { method: "DELETE" });
    const j = await r.json();
    if (j.ok) {
      setActiveVariantIdx(Math.max(0, activeVariantIdx - 1));
      applyServerCampaign(j.campaign);
      toast("✓ Variante eliminada");
    }
  }

  /** Autosave debounced de subject/body: actualiza local de inmediato, persiste sin re-fetch. */
  function onChangeContent(field: "subject" | "body", value: string) {
    if (!step || !variant) return;
    // Update OPTIMISTA del estado local — sin tocar el server todavía
    setCampaign((prev) => ({
      ...prev,
      steps: prev.steps.map((s) =>
        s.id === step.id
          ? { ...s, variants: s.variants.map((v) => v.id === variant.id ? { ...v, [field]: value } : v) }
          : s
      ),
    }));
    if (savingTimerRef.current) clearTimeout(savingTimerRef.current);
    savingTimerRef.current = setTimeout(() => {
      fetch(`/api/email-campaigns/${campaign.id}/steps/${step.id}/variants/${variant.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      }).catch(() => {});
    }, 600);
  }

  async function runPreview() {
    if (!step) return;
    const r = await fetch(`/api/email-campaigns/${campaign.id}/preview`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step_id: step.id, variant_id: variant?.id }),
    });
    const j = await r.json();
    if (j.subject !== undefined) {
      setPreview({ subject: j.subject, body: j.body, lead_email: j.lead?.email });
    }
  }
  useEffect(() => {
    if (variant) runPreview();
  }, [activeStepIdx, activeVariantIdx, variant?.subject, variant?.body]);

  if (!step || !variant) {
    return <div style={cardStyle}>No hay steps. <button onClick={addStep} style={brandBtn}>+ Añadir step</button></div>;
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 18 }}>
      {/* LEFT: steps list */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: INK_4, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
          Secuencia ({campaign.steps.length})
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {campaign.steps.map((s, i) => (
            <div key={s.id} style={{
              padding: "12px 14px",
              background: i === activeStepIdx ? "#fff" : SURF,
              border: `1px solid ${i === activeStepIdx ? "rgba(154,105,245,0.4)" : LINE}`,
              borderRadius: 12, cursor: "pointer",
              boxShadow: i === activeStepIdx ? "0 0 0 3px rgba(154,105,245,0.10)" : "none",
            }} onClick={() => setActiveStepIdx(i)}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    width: 22, height: 22, borderRadius: "50%",
                    background: i === activeStepIdx ? BRAND_G : SURF_2,
                    color: i === activeStepIdx ? "#fff" : INK_3,
                    display: "grid", placeItems: "center",
                    fontFamily: FONT_MONO, fontSize: 11, fontWeight: 700,
                  }}>{i + 1}</span>
                  <span style={{ fontWeight: 600, color: INK, fontSize: 13.5 }}>
                    {i === 0 ? "Email inicial" : `Follow-up ${i}`}
                  </span>
                </div>
                {campaign.steps.length > 1 && (
                  <button onClick={(e) => { e.stopPropagation(); removeStep(s.id); }} style={{
                    background: "transparent", border: 0, color: INK_5, cursor: "pointer", padding: 4,
                  }} title="Eliminar step">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                  </button>
                )}
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: INK_4 }}>
                {i === 0 ? "Envío inmediato" : `Espera ${s.delay_days}d ${s.delay_hours ? s.delay_hours + "h" : ""}`}
                <span style={{ color: INK_5 }}> · {s.variants.length} variante{s.variants.length === 1 ? "" : "s"}</span>
              </div>
            </div>
          ))}
          <button onClick={addStep} style={{
            padding: "12px 14px", border: `1px dashed ${LINE2}`, borderRadius: 12,
            background: "transparent", color: INK_3, cursor: "pointer",
            fontFamily: FONT_UI, fontSize: 13, fontWeight: 600,
            display: "flex", alignItems: "center", gap: 8, justifyContent: "center",
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Añadir step
          </button>
        </div>
      </div>

      {/* RIGHT: editor */}
      <div style={{ display: "grid", gridTemplateColumns: "1.05fr 1fr", gap: 16 }}>
        {/* EDITOR */}
        <div style={cardStyle}>
          {/* Delay control (excepto step 0) */}
          {activeStepIdx > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: SURF, border: `1px solid ${LINE}`, borderRadius: 10, marginBottom: 14, fontSize: 13 }}>
              <IconClock /> Enviar después de
              <input type="number" min={0} max={90} value={step.delay_days}
                onChange={(e) => patchStep(step.id, { delay_days: Math.max(0, parseInt(e.target.value) || 0) })}
                style={{ ...inputStyle, width: 64, height: 32, padding: "0 8px", textAlign: "center" }}
              /> días
              <input type="number" min={0} max={23} value={step.delay_hours}
                onChange={(e) => patchStep(step.id, { delay_hours: Math.max(0, parseInt(e.target.value) || 0) })}
                style={{ ...inputStyle, width: 64, height: 32, padding: "0 8px", textAlign: "center" }}
              /> horas (después del step anterior)
            </div>
          )}

          {/* Variant tabs */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            {step.variants.map((v, i) => (
              <button key={v.id} onClick={() => setActiveVariantIdx(i)} style={{
                padding: "5px 12px", borderRadius: 8,
                border: i === activeVariantIdx ? `1.5px solid ${PURPLE}` : `1px solid ${LINE2}`,
                background: i === activeVariantIdx ? "rgba(154,105,245,0.08)" : "#fff",
                color: i === activeVariantIdx ? PURPLE_DEEP : INK_2,
                fontFamily: FONT_UI, fontSize: 12.5, fontWeight: 700,
                cursor: "pointer",
              }}>
                Variante {v.label}
                {v.weight !== 1 && <span style={{ marginLeft: 6, color: INK_4, fontFamily: FONT_MONO, fontSize: 10.5 }}>×{v.weight}</span>}
              </button>
            ))}
            <button onClick={addVariant} style={{
              padding: "5px 10px", borderRadius: 8,
              border: `1px dashed ${LINE2}`, background: "transparent",
              color: INK_3, fontFamily: FONT_UI, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
            }}>+ Añadir variante</button>
            {step.variants.length > 1 && (
              <button onClick={removeVariant} title="Eliminar esta variante" style={{
                marginLeft: "auto", padding: "5px 8px",
                background: "transparent", border: 0, color: INK_5, cursor: "pointer",
              }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              </button>
            )}
          </div>

          {/* Subject + Body con tracking de campo activo */}
          <SubjectBodyEditor
            variant={variant}
            availableVariables={campaign.variables || []}
            onChange={onChangeContent}
            onAddVariable={async (name) => {
              // Slug local (mismo helper que en CSV import)
              const slug = name.trim()
                .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "_")
                .replace(/^_+|_+$/g, "")
                .replace(/^(\d)/, "v_$1");
              if (!slug) { toast("Nombre de variable inválido"); return null; }
              const existing = campaign.variables || [];
              if (existing.includes(slug)) { toast(`{{${slug}}} ya existe`); return slug; }
              const updated = [...existing, slug];
              // Optimista local + PATCH en background
              setCampaign((prev) => ({ ...prev, variables: updated }));
              fetch(`/api/email-campaigns/${campaign.id}`, {
                method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ variables: updated }),
              }).catch(() => {});
              toast(`✓ Variable {{${slug}}} creada`);
              return slug;
            }}
          />


          <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={duplicateVariant} style={ghostBtn}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              Duplicar variante
            </button>
            <button onClick={() => setShowSendTest(true)} style={brandBtn}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              Enviar test
            </button>
            <div style={{ marginLeft: "auto", alignSelf: "center", fontSize: 11.5, color: INK_5, fontFamily: FONT_MONO }}>
              Auto-guardado · {variant.body.length} caracteres
            </div>
          </div>
        </div>

        {/* PREVIEW */}
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <h3 style={{ ...cardTitle, margin: 0 }}>Vista previa</h3>
            {preview?.lead_email && (
              <span style={{ fontSize: 11.5, color: INK_4, fontFamily: FONT_MONO }}>como {preview.lead_email}</span>
            )}
            <button onClick={runPreview} style={{ marginLeft: "auto", ...ghostBtn, height: 32, fontSize: 12 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/></svg>
              Re-renderizar
            </button>
          </div>
          {preview ? (
            <>
              <div style={{ padding: "10px 12px", background: SURF, borderRadius: 8, fontSize: 12, color: INK_3, marginBottom: 10 }}>
                <strong style={{ color: INK_2 }}>De:</strong> {campaign.account_ids.length ? "(cuenta rotada)" : <span style={{ color: "#b97500" }}>(sin cuentas asignadas)</span>} ·
                <strong style={{ color: INK_2 }}> Para:</strong> {preview.lead_email || "lead@example.com"}
              </div>
              <div style={{ padding: "10px 14px", borderBottom: `1px solid ${LINE}`, marginBottom: 12 }}>
                <div style={miniLabel}>Asunto</div>
                <div style={{ fontFamily: FONT_SANS, fontSize: 16, fontWeight: 600, color: INK, marginTop: 4, lineHeight: 1.3 }}>
                  {preview.subject || <span style={{ color: INK_5, fontWeight: 400 }}>(sin asunto)</span>}
                </div>
              </div>
              <div style={{
                padding: "8px 14px", whiteSpace: "pre-wrap",
                color: INK_2, fontSize: 14, lineHeight: 1.6,
                fontFamily: FONT_UI,
                minHeight: 180,
              }}>
                {preview.body || <span style={{ color: INK_5 }}>(sin contenido)</span>}
              </div>
            </>
          ) : (
            <div style={{ color: INK_5, fontSize: 13.5 }}>Cargando vista previa…</div>
          )}
        </div>
      </div>

      {showSendTest && step && variant && (
        <SendTestModal
          campaign={campaign}
          step={step}
          variant={variant}
          onClose={() => setShowSendTest(false)}
          toast={toast}
        />
      )}
    </div>
  );
}

/* ── Modal: enviar email de prueba ───────────────────────────────────── */
function SendTestModal({ campaign, step, variant, onClose, toast }: {
  campaign: Campaign; step: Step; variant: Variant;
  onClose: () => void; toast: (s: string) => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [toEmail, setToEmail] = useState("");
  const [fromAccountId, setFromAccountId] = useState<string>("");
  const [leadMode, setLeadMode] = useState<"dummy" | "first" | "specific">("first");
  const [specificLeadId, setSpecificLeadId] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message?: string; error?: string; ms?: number; subject?: string } | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/email-accounts").then((r) => r.json()),
      fetch(`/api/email-campaigns/${campaign.id}/leads?limit=200`).then((r) => r.json()),
    ]).then(([accRes, leadsRes]) => {
      const allAccounts: Account[] = accRes.accounts || [];
      setAccounts(allAccounts);
      setLeads(leadsRes.leads || []);
      // Por defecto, la primera cuenta asignada a la campaña que tenga SMTP OK
      const assignedOk = allAccounts.find((a) => campaign.account_ids.includes(a.id) && a.smtp_ok);
      const anyOk = allAccounts.find((a) => a.smtp_ok);
      setFromAccountId(assignedOk?.id || anyOk?.id || allAccounts[0]?.id || "");
    }).finally(() => setLoading(false));
  }, [campaign.id]);

  const validTo = !!toEmail && toEmail.includes("@") && /\.[a-z]{2,}$/i.test(toEmail);
  const canSend = validTo && !!fromAccountId && !sending;

  async function send() {
    setSending(true);
    setResult(null);
    const leadId =
      leadMode === "specific" ? specificLeadId :
      leadMode === "first" && leads[0] ? leads[0].id :
      undefined;
    try {
      const r = await fetch(`/api/email-campaigns/${campaign.id}/send-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step_id: step.id,
          variant_id: variant.id,
          from_account_id: fromAccountId,
          to_email: toEmail.trim().toLowerCase(),
          lead_id: leadId,
        }),
      });
      const j = await r.json();
      if (r.ok && j.ok) {
        setResult({ ok: true, message: `Enviado en ${j.ms}ms`, subject: j.subject, ms: j.ms });
        toast(`✓ Test enviado a ${toEmail}`);
      } else {
        setResult({ ok: false, error: j.error || "Error desconocido" });
      }
    } catch (e: any) {
      setResult({ ok: false, error: e.message });
    } finally {
      setSending(false);
    }
  }

  const selectedAccount = accounts.find((a) => a.id === fromAccountId);

  return (
    <ModalShell
      title="Enviar email de prueba"
      subtitle={`Variante ${variant.label} del step ${campaign.steps.indexOf(step) + 1} · Las variables se sustituyen como en un envío real.`}
      onClose={onClose}
      width={620}
      footer={
        <>
          <button onClick={onClose} style={ghostBtn} disabled={sending}>Cerrar</button>
          <button onClick={send} disabled={!canSend} style={{ ...brandBtn, opacity: canSend ? 1 : 0.55, cursor: canSend ? "pointer" : "not-allowed" }}>
            {sending
              ? "Enviando…"
              : <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  Enviar test
                </>}
          </button>
        </>
      }
    >
      {loading ? (
        <div style={{ color: INK_4 }}>Cargando cuentas y leads…</div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {/* Destinatario */}
          <label style={{ display: "block" }}>
            <div style={miniLabel}>Enviar a</div>
            <input
              type="email"
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
              placeholder="tu@email.com"
              style={inputStyle}
              autoFocus
            />
          </label>

          {/* Cuenta de envío */}
          <label style={{ display: "block" }}>
            <div style={miniLabel}>Cuenta de envío</div>
            {accounts.length === 0 ? (
              <div style={{ padding: "10px 14px", background: "rgba(255,51,68,0.06)", border: "1px solid rgba(255,51,68,0.2)", borderRadius: 10, color: "#c12530", fontSize: 13 }}>
                No tienes cuentas conectadas.{" "}
                <a href="/connect-accounts" style={{ color: PURPLE_DEEP, fontWeight: 600 }}>Conecta una primero →</a>
              </div>
            ) : (
              <select value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)} style={inputStyle}>
                {accounts.map((a) => {
                  const assigned = campaign.account_ids.includes(a.id);
                  return (
                    <option key={a.id} value={a.id} disabled={!a.smtp_ok}>
                      {assigned ? "★ " : ""}{a.email} · {a.provider}{!a.smtp_ok ? " · SMTP ERROR" : ""}
                    </option>
                  );
                })}
              </select>
            )}
            {selectedAccount && (
              <div style={{ fontSize: 11.5, color: INK_4, marginTop: 6, fontFamily: FONT_MONO }}>
                {selectedAccount.smtp_host}:{selectedAccount.smtp_port}
                {campaign.account_ids.includes(selectedAccount.id) && (
                  <span style={{ color: PURPLE_DEEP, marginLeft: 6 }}>· asignada a esta campaña</span>
                )}
              </div>
            )}
          </label>

          {/* Variables del lead */}
          <div>
            <div style={miniLabel}>Datos para sustituir variables</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              <button type="button" onClick={() => setLeadMode("first")} disabled={leads.length === 0} style={modeBtn(leadMode === "first")}>
                Primer lead {leads[0] ? `(${leads[0].email})` : "(no hay)"}
              </button>
              <button type="button" onClick={() => setLeadMode("specific")} disabled={leads.length === 0} style={modeBtn(leadMode === "specific")}>
                Lead específico
              </button>
              <button type="button" onClick={() => setLeadMode("dummy")} style={modeBtn(leadMode === "dummy")}>
                Datos dummy
              </button>
            </div>
            {leadMode === "specific" && (
              <select value={specificLeadId} onChange={(e) => setSpecificLeadId(e.target.value)} style={inputStyle}>
                <option value="">— elegir lead —</option>
                {leads.slice(0, 100).map((l) => (
                  <option key={l.id} value={l.id}>{l.email} · {Object.entries(l.variables).slice(0, 2).map(([k, v]) => `${k}=${String(v).slice(0, 16)}`).join(", ")}</option>
                ))}
                {leads.length > 100 && <option disabled>… ({leads.length - 100} más)</option>}
              </select>
            )}
            {leadMode === "dummy" && (
              <div style={{ fontSize: 11.5, color: INK_4, fontFamily: FONT_MONO, padding: 6 }}>
                Ana García · Acme Corp · Head of Sales · Madrid · SaaS
              </div>
            )}
          </div>

          {/* Resultado */}
          {result && (
            <div style={{
              padding: "10px 14px", borderRadius: 10,
              background: result.ok ? "rgba(31,138,91,0.08)" : "rgba(255,51,68,0.06)",
              border: `1px solid ${result.ok ? "rgba(31,138,91,0.25)" : "rgba(255,51,68,0.25)"}`,
              color: result.ok ? GREEN : "#c12530",
              fontSize: 13, lineHeight: 1.5,
            }}>
              {result.ok ? (
                <>
                  ✓ Test enviado correctamente {result.ms && <span style={{ fontFamily: FONT_MONO, color: INK_4 }}>({result.ms}ms)</span>}
                  {result.subject && <div style={{ marginTop: 6, color: INK_3, fontSize: 12 }}>Asunto: <strong style={{ color: INK_2 }}>{result.subject}</strong></div>}
                </>
              ) : (
                <>✗ {result.error}</>
              )}
            </div>
          )}
        </div>
      )}
    </ModalShell>
  );
}

const modeBtn = (on: boolean): React.CSSProperties => ({
  padding: "6px 12px", borderRadius: 8,
  border: on ? `1.5px solid ${PURPLE}` : `1px solid ${LINE2}`,
  background: on ? "rgba(154,105,245,0.08)" : "#fff",
  color: on ? PURPLE_DEEP : INK_2,
  fontFamily: FONT_UI, fontSize: 12.5, fontWeight: 600,
  cursor: "pointer",
});

/* ════════════════════════════════════════════════════════════════════
   TAB 3: LEADS (CSV upload + lista)
   ════════════════════════════════════════════════════════════════════ */
function LeadsTab({ campaign, setCampaign, toast }: { campaign: Campaign; setCampaign: (c: Campaign | ((p: Campaign) => Campaign)) => void; toast: (s: string) => void }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Lead["status"] | "all">("all");
  const [showUpload, setShowUpload] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  // Debounce de búsqueda para no spamear el server cada keystroke
  const searchTimerRef = useRef<any>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => setDebouncedSearch(search), 250);
  }, [search]);

  async function load() {
    if (!hasLoadedOnce) setLoading(true); // solo muestra spinner en la primera carga
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("limit", "500");
      const r = await fetch(`/api/email-campaigns/${campaign.id}/leads?${params}`);
      const j = await r.json();
      setLeads(j.leads || []);
      setTotal(j.total || 0);
      setHasLoadedOnce(true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [debouncedSearch, statusFilter]);

  async function removeSelected() {
    if (selected.size === 0) return;
    if (!confirm(`¿Eliminar ${selected.size} lead(s)?`)) return;
    // Optimista: quita los leads del estado local de inmediato
    const toRemove = Array.from(selected);
    setLeads((arr) => arr.filter((l) => !selected.has(l.id)));
    setTotal((t) => Math.max(0, t - toRemove.length));
    setCampaign((prev) => ({
      ...prev,
      metrics: prev.metrics ? { ...prev.metrics, total_leads: Math.max(0, (prev.metrics.total_leads || 0) - toRemove.length) } : prev.metrics,
    }));
    setSelected(new Set());
    try {
      await fetch(`/api/email-campaigns/${campaign.id}/leads`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: toRemove }),
      });
      toast("✓ Leads eliminados");
    } catch {
      // Si falla, recargamos para sincronizar
      load();
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 240, maxWidth: 380 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por email o variable…" style={{ ...inputStyle, paddingLeft: 38 }} />
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={INK_4} strokeWidth="2" style={{ position: "absolute", left: 12, top: 13 }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </div>
        <div style={{ display: "inline-flex", padding: 3, background: SURF, borderRadius: 10, border: `1px solid ${LINE}` }}>
          {(["all","new","active","replied","completed","bounced","unsubscribed","paused"] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)} style={segBtn(statusFilter === s)}>
              {s === "all" ? "Todos" : s}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          {selected.size > 0 && (
            <button onClick={removeSelected} style={{ ...ghostBtn, color: "#c12530", borderColor: "rgba(255,51,68,0.25)" }}>
              🗑 Eliminar {selected.size}
            </button>
          )}
          <button onClick={() => setShowUpload(true)} style={brandBtn}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Subir CSV
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <Pill label="Total" value={total} />
        <Pill label="Variables detectadas" value={campaign.variables.length} color={PURPLE} />
      </div>

      {/* Variables */}
      {campaign.variables.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 16, padding: "12px 16px" }}>
          <div style={{ fontSize: 11.5, color: INK_4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
            Variables que puedes usar en tus mensajes
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {campaign.variables.map((v) => (
              <span key={v} style={{
                padding: "2px 8px", borderRadius: 6,
                background: SURF, color: PURPLE_DEEP,
                border: `1px solid ${LINE}`, fontFamily: FONT_MONO, fontSize: 11.5, fontWeight: 600,
              }}>{"{{"}{v}{"}}"}</span>
            ))}
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ color: INK_4 }}>Cargando…</div>
      ) : leads.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", padding: "60px 20px" }}>
          <div style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 22, color: INK, letterSpacing: "-0.02em", marginBottom: 8 }}>
            {total === 0 ? "Sin leads todavía" : "No hay leads con ese filtro"}
          </div>
          <p style={{ color: INK_3, fontSize: 14, marginBottom: 20 }}>
            {total === 0
              ? "Sube un CSV con la columna email + las que quieras como variables (first_name, company, …)."
              : "Cambia el filtro o búsqueda."}
          </p>
          {total === 0 && <button onClick={() => setShowUpload(true)} style={brandBtn}>Subir CSV de leads</button>}
        </div>
      ) : (
        <div style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: 14, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ background: SURF }}>
              <tr>
                <th style={{ ...th, width: 32, padding: "10px 14px" }}>
                  <input type="checkbox"
                    checked={leads.length > 0 && selected.size === leads.length}
                    onChange={(e) => setSelected(e.target.checked ? new Set(leads.map((l) => l.id)) : new Set())}
                  />
                </th>
                <th style={th}>Email</th>
                <th style={th}>Variables</th>
                <th style={th}>Estado</th>
                <th style={th}>Step</th>
                <th style={th}>Sticky account</th>
                <th style={th}>Añadido</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} style={{ borderTop: `1px solid ${LINE}` }}>
                  <td style={{ ...td, padding: "10px 14px" }}>
                    <input type="checkbox"
                      checked={selected.has(l.id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(l.id); else next.delete(l.id);
                        setSelected(next);
                      }}
                    />
                  </td>
                  <td style={td}>
                    <div style={{ fontWeight: 600, color: INK }}>{l.email}</div>
                  </td>
                  <td style={td}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", maxWidth: 280 }}>
                      {Object.entries(l.variables).slice(0, 4).map(([k, v]) => (
                        <span key={k} style={{ fontSize: 11, color: INK_4, fontFamily: FONT_MONO }}>
                          <span style={{ color: PURPLE_DEEP }}>{k}</span>=<span style={{ color: INK_2 }}>{String(v).slice(0, 24)}</span>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={td}><LeadStatusBadge status={l.status} /></td>
                  <td style={{ ...td, fontFamily: FONT_MONO, fontSize: 12 }}>{l.current_step + 1}/{campaign.steps.length}</td>
                  <td style={{ ...td, fontFamily: FONT_MONO, fontSize: 11.5, color: INK_4 }}>
                    {l.sticky_account_id ? `…${l.sticky_account_id.slice(-6)}` : "—"}
                  </td>
                  <td style={{ ...td, color: INK_4, fontSize: 12 }}>
                    {new Date(l.added_at).toLocaleDateString("es-ES")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showUpload && (
        <CsvUploadModal
          campaignId={campaign.id}
          campaign={campaign}
          onClose={() => setShowUpload(false)}
          onDone={(updatedVars, newTotal) => {
            // Solo actualizamos lo que ha cambiado — sin recargar nada más.
            setShowUpload(false);
            setCampaign((prev) => ({
              ...prev,
              variables: updatedVars,
              metrics: prev.metrics
                ? { ...prev.metrics, total_leads: newTotal, active_leads: newTotal }
                : prev.metrics,
            }));
            load(); // solo recargamos la lista de leads (no la campaña entera)
          }}
          toast={toast}
        />
      )}
    </div>
  );
}

/**
 * Modal de import CSV — full-featured:
 *  - Parsea client-side con `parseLeadsCsv` (mismo parser que server)
 *  - Paginación en preview (100 por página) — sin matar el navegador con 6000+ filas
 *  - Click en cualquier parte de la fila para toggle selección
 *  - Mapeo de headers → variables visible
 *  - Import en chunks de 100 con barra de progreso
 *  - "Seleccionar página actual" / "Todas válidas" / "Ninguna"
 */
const PAGE_SIZE = 100;
const CHUNK_SIZE = 100;

function CsvUploadModal({ campaignId, campaign, onClose, onDone, toast }: {
  campaignId: string;
  campaign: Campaign;
  onClose: () => void;
  onDone: (updatedVariables: string[], newTotal: number) => void;
  toast: (s: string) => void;
}) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedLines, setSelectedLines] = useState<Set<number>>(new Set());
  const [hideErrors, setHideErrors] = useState(false);
  const [page, setPage] = useState(1);
  const [progress, setProgress] = useState<{ done: number; total: number; added: number; updated: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    return parseLeadsCsv(text);
  }, [text]);

  // Al cargar nuevo CSV: seleccionamos TODAS las filas válidas por defecto
  useEffect(() => {
    if (!parsed) { setSelectedLines(new Set()); return; }
    setSelectedLines(new Set(parsed.rows.filter((r) => !r.__error).map((r) => r.line)));
    setPage(1);
  }, [text]);

  async function onFile(f: File) {
    setFileName(f.name);
    const t = await f.text();
    setText(t);
  }

  // Lista de columnas variable (excluyendo email) — precomputado.
  const varColumns = useMemo(() => {
    if (!parsed) return [];
    const out: { raw: string; key: string }[] = [];
    let vi = 0;
    for (const h of parsed.rawHeaders) {
      if (h === parsed.emailHeader) continue;
      out.push({ raw: h, key: parsed.variableKeys[vi] });
      vi++;
    }
    return out;
  }, [parsed]);

  const visibleRows = useMemo(() => {
    if (!parsed) return [];
    return hideErrors ? parsed.rows.filter((r) => !r.__error) : parsed.rows;
  }, [parsed, hideErrors]);

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageRows = visibleRows.slice(pageStart, pageStart + PAGE_SIZE);

  const validCount = parsed ? parsed.rows.filter((r) => !r.__error).length : 0;
  const errorCount = parsed ? parsed.rows.length - validCount : 0;
  const toImportCount = parsed
    ? parsed.rows.filter((r) => !r.__error && selectedLines.has(r.line)).length
    : 0;

  function toggleLine(line: number) {
    const next = new Set(selectedLines);
    if (next.has(line)) next.delete(line); else next.add(line);
    setSelectedLines(next);
  }
  function selectAll() {
    if (!parsed) return;
    setSelectedLines(new Set(parsed.rows.filter((r) => !r.__error).map((r) => r.line)));
  }
  function selectNone() { setSelectedLines(new Set()); }
  function selectPage() {
    const next = new Set(selectedLines);
    for (const r of pageRows) if (!r.__error) next.add(r.line);
    setSelectedLines(next);
  }
  function deselectPage() {
    const next = new Set(selectedLines);
    for (const r of pageRows) next.delete(r.line);
    setSelectedLines(next);
  }

  /** Import en chunks de 100 con feedback en tiempo real. */
  async function submit() {
    if (!parsed) { toast("Pega un CSV o arrastra un archivo"); return; }
    if (!parsed.emailHeader) { toast("El CSV no tiene columna de email"); return; }
    if (toImportCount === 0) { toast("Selecciona al menos una fila válida"); return; }

    // Construye la lista de leads ya seleccionados y válidos
    const allLeads = parsed.rows
      .filter((r) => !r.__error && selectedLines.has(r.line))
      .map((r) => ({ email: r.email, variables: r.variables }));

    setSubmitting(true);
    setProgress({ done: 0, total: allLeads.length, added: 0, updated: 0 });

    let added = 0, updated = 0, failed = 0;
    let lastCampaignVariables: string[] = campaign.variables || [];
    let lastTotal = 0;
    try {
      for (let i = 0; i < allLeads.length; i += CHUNK_SIZE) {
        const chunk = allLeads.slice(i, i + CHUNK_SIZE);
        try {
          const r = await fetch(`/api/email-campaigns/${campaignId}/leads/chunk`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ leads: chunk }),
          });
          const j = await r.json();
          if (j.ok) {
            added += j.added || 0;
            updated += j.updated || 0;
            if (Array.isArray(j.variables)) lastCampaignVariables = j.variables;
            // El endpoint chunk no devuelve campaign_variables; usamos el último `total` y vars
            if (typeof j.total === "number") lastTotal = j.total;
          } else {
            failed += chunk.length;
          }
        } catch {
          failed += chunk.length;
        }
        setProgress({
          done: Math.min(i + CHUNK_SIZE, allLeads.length),
          total: allLeads.length,
          added, updated,
        });
      }
      toast(`✓ ${added} nuevos · ${updated} actualizados${failed ? ` · ${failed} fallidos` : ""}`);
      onDone(lastCampaignVariables, lastTotal);
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  }

  return (
    <ModalShell
      title="Subir leads vía CSV"
      subtitle="Email obligatorio (Email/E-mail/Correo). Resto de columnas → variables (FirstName→first_name, etc.). Soporta archivos grandes (probado con 6000+ filas)."
      onClose={onClose}
      width={1180}
      footer={
        <>
          <button onClick={onClose} style={ghostBtn} disabled={submitting}>Cancelar</button>
          <button
            onClick={submit}
            disabled={submitting || toImportCount === 0}
            style={{ ...brandBtn, opacity: submitting || toImportCount === 0 ? 0.55 : 1 }}
          >
            {submitting
              ? `Importando ${progress?.done ?? 0}/${progress?.total ?? toImportCount}…`
              : `Importar ${toImportCount} lead${toImportCount === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      {!parsed ? (
        <>
          <div onDragOver={(e) => e.preventDefault()} onDrop={async (e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) await onFile(f); }}
            style={{ border: `1.5px dashed ${LINE2}`, borderRadius: 12, padding: 40, textAlign: "center", marginBottom: 16, background: "linear-gradient(180deg, " + SURF + ", " + PAPER + " 80%)" }}>
            <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
            <div style={{
              width: 48, height: 48, borderRadius: 12, margin: "0 auto 14px",
              background: PAPER, border: `1px solid ${LINE}`, display: "grid", placeItems: "center", color: PURPLE_DEEP,
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            </div>
            <div style={{ color: INK_2, fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Arrastra aquí tu CSV de leads</div>
            <div style={{ color: INK_4, fontSize: 13, marginBottom: 16 }}>o pulsa para seleccionarlo</div>
            <button onClick={() => fileRef.current?.click()} style={ghostBtn}>Seleccionar archivo</button>
          </div>
          <details>
            <summary style={{ cursor: "pointer", color: INK_3, fontSize: 13, fontWeight: 600 }}>O pega el contenido del CSV</summary>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8}
              placeholder={"email,FirstName,LastName,CompanyName,Industry,City,Company short description\nana@acme.com,Ana,García,Acme,SaaS,Madrid,Plataforma de analytics\n…"}
              style={{ width: "100%", marginTop: 8, padding: "12px 14px", background: "#fff", border: `1px solid ${LINE2}`, borderRadius: 10, fontFamily: FONT_MONO, fontSize: 12, color: INK_2, outline: "none", boxSizing: "border-box", resize: "vertical" }}
            />
          </details>
        </>
      ) : (
        <>
          {/* Resumen */}
          <div style={{
            display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
            padding: "12px 16px", background: SURF, border: `1px solid ${LINE}`, borderRadius: 12,
            marginBottom: 14,
          }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 12, color: INK_4, fontWeight: 600 }}>{fileName ? `Archivo: ${fileName}` : "CSV pegado"}</div>
              <div style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 18, color: INK, marginTop: 2 }}>
                {parsed.rows.length} fila{parsed.rows.length === 1 ? "" : "s"}{" "}
                <span style={{ color: GREEN, fontFamily: FONT_MONO, fontSize: 14 }}>· {validCount} OK</span>{" "}
                {errorCount > 0 && <span style={{ color: "#c12530", fontFamily: FONT_MONO, fontSize: 14 }}>· {errorCount} con error</span>}
                {parsed.blankRowsSkipped > 0 && <span style={{ color: INK_4, fontFamily: FONT_MONO, fontSize: 14 }}>· {parsed.blankRowsSkipped} vacías saltadas</span>}
              </div>
            </div>
            <button onClick={() => { setText(""); setFileName(null); setSelectedLines(new Set()); }} style={ghostBtn} disabled={submitting}>
              ↻ Subir otro
            </button>
          </div>

          {/* Progress bar */}
          {progress && (
            <div style={{
              padding: "10px 16px", background: "rgba(154,105,245,0.06)",
              border: "1px solid rgba(154,105,245,0.22)", borderRadius: 10, marginBottom: 14,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: INK_2, marginBottom: 6 }}>
                <span><strong>{progress.done}</strong>/{progress.total} importados</span>
                <span style={{ fontFamily: FONT_MONO, color: INK_4 }}>+{progress.added} nuevos · {progress.updated} actualizados</span>
              </div>
              <div style={{ height: 6, background: "#fff", border: `1px solid ${LINE}`, borderRadius: 999, overflow: "hidden" }}>
                <div style={{
                  width: `${(progress.done / Math.max(progress.total, 1)) * 100}%`,
                  height: "100%", background: BRAND_G, transition: "width .2s",
                }} />
              </div>
            </div>
          )}

          {/* Email column status */}
          {!parsed.emailHeader && (
            <div style={{ padding: "10px 14px", background: "rgba(255,51,68,0.06)", border: "1px solid rgba(255,51,68,0.2)", borderRadius: 10, marginBottom: 14, color: "#c12530", fontSize: 13 }}>
              ⚠ No se encontró columna de email. Añade una llamada <code style={{ background: "#fff", padding: "1px 6px", borderRadius: 4, fontFamily: FONT_MONO }}>email</code>, <code style={{ background: "#fff", padding: "1px 6px", borderRadius: 4, fontFamily: FONT_MONO }}>e-mail</code>, o <code style={{ background: "#fff", padding: "1px 6px", borderRadius: 4, fontFamily: FONT_MONO }}>correo</code>.
            </div>
          )}

          {/* Header mapping */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: INK_4, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
              Mapeo de columnas → variables ({varColumns.length + (parsed.emailHeader ? 1 : 0)})
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 140, overflow: "auto", padding: 2 }}>
              {parsed.emailHeader && <HeaderChip raw={parsed.emailHeader} key_={"(email del lead)"} isEmail />}
              {varColumns.map((c, i) => <HeaderChip key={c.raw + i} raw={c.raw} key_={c.key} />)}
            </div>
          </div>

          {/* Row controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, color: INK_3 }}>
              <strong style={{ color: INK }}>{toImportCount}</strong> seleccionada{toImportCount === 1 ? "" : "s"} de {validCount} válida{validCount === 1 ? "" : "s"}
            </span>
            <button onClick={selectAll} style={{ ...ghostBtn, height: 30, fontSize: 12 }}>Todas válidas</button>
            <button onClick={selectNone} style={{ ...ghostBtn, height: 30, fontSize: 12 }}>Ninguna</button>
            <button onClick={selectPage} style={{ ...ghostBtn, height: 30, fontSize: 12 }}>+ Esta página</button>
            <button onClick={deselectPage} style={{ ...ghostBtn, height: 30, fontSize: 12 }}>− Esta página</button>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: INK_3, marginLeft: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={hideErrors} onChange={(e) => setHideErrors(e.target.checked)} />
              Ocultar con error
            </label>
            <div style={{ marginLeft: "auto", fontSize: 12.5, color: INK_4, fontFamily: FONT_MONO }}>
              Mostrando {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, visibleRows.length)} de {visibleRows.length}
            </div>
          </div>

          {/* Rows table */}
          <div style={{
            maxHeight: 380, overflow: "auto",
            border: `1px solid ${LINE}`, borderRadius: 12,
          }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead style={{ position: "sticky", top: 0, background: SURF, zIndex: 1 }}>
                <tr>
                  <th style={{ ...th, width: 32, padding: "10px 12px" }}>
                    <input
                      type="checkbox"
                      checked={validCount > 0 && toImportCount === validCount}
                      ref={(el) => { if (el) el.indeterminate = toImportCount > 0 && toImportCount < validCount; }}
                      onChange={(e) => e.target.checked ? selectAll() : selectNone()}
                    />
                  </th>
                  <th style={{ ...th, width: 50 }}>Fila</th>
                  <th style={th}>Email</th>
                  {varColumns.map((c) => (
                    <th key={c.raw} style={th} title={c.raw}>
                      {c.raw.length > 22 ? c.raw.slice(0, 20) + "…" : c.raw}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const checked = selectedLines.has(r.line);
                  const disabled = !!r.__error;
                  return (
                    <tr
                      key={r.line}
                      onClick={() => !disabled && toggleLine(r.line)}
                      style={{
                        borderTop: `1px solid ${LINE}`,
                        background: r.__error ? "rgba(255,51,68,0.04)" : checked ? "rgba(154,105,245,0.06)" : "transparent",
                        cursor: disabled ? "not-allowed" : "pointer",
                        userSelect: "none",
                      }}
                    >
                      <td style={{ padding: "8px 12px", verticalAlign: "middle" }} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => !disabled && toggleLine(r.line)}
                        />
                      </td>
                      <td style={{ padding: "8px 12px", color: INK_4, fontFamily: FONT_MONO, fontSize: 11, verticalAlign: "middle" }}>{r.line}</td>
                      <td style={{ padding: "8px 12px", verticalAlign: "middle" }}>
                        <div style={{ fontWeight: 600, color: r.__error ? "#c12530" : INK, fontSize: 12.5 }}>
                          {r.email || <span style={{ color: INK_5, fontWeight: 400, fontStyle: "italic" }}>(vacío)</span>}
                        </div>
                        {r.__error && <div style={{ color: "#c12530", fontSize: 10.5, marginTop: 2 }}>⚠ {r.__error}</div>}
                      </td>
                      {varColumns.map((c) => {
                        const v = r.variables[c.key] ?? "";
                        return (
                          <td key={c.raw} style={{ padding: "8px 12px", verticalAlign: "middle", color: INK_2, fontSize: 12 }}>
                            {v ? (v.length > 36 ? v.slice(0, 34) + "…" : v) : <span style={{ color: INK_5 }}>—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{
              display: "flex", justifyContent: "center", alignItems: "center", gap: 6,
              marginTop: 12,
            }}>
              <button onClick={() => setPage(1)} disabled={safePage === 1} style={pageBtn}>«</button>
              <button onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage === 1} style={pageBtn}>‹</button>
              <span style={{ fontSize: 12.5, color: INK_2, fontFamily: FONT_MONO, padding: "0 8px" }}>
                Página <strong>{safePage}</strong> / {totalPages}
              </span>
              <button onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage === totalPages} style={pageBtn}>›</button>
              <button onClick={() => setPage(totalPages)} disabled={safePage === totalPages} style={pageBtn}>»</button>
              <input
                type="number"
                min={1} max={totalPages}
                value={safePage}
                onChange={(e) => {
                  const p = parseInt(e.target.value);
                  if (!isNaN(p)) setPage(Math.max(1, Math.min(totalPages, p)));
                }}
                style={{ ...inputStyle, width: 70, height: 30, padding: "0 8px", marginLeft: 8, fontFamily: FONT_MONO, fontSize: 12, textAlign: "center" }}
              />
            </div>
          )}
        </>
      )}
    </ModalShell>
  );
}

const pageBtn: React.CSSProperties = {
  width: 32, height: 30, padding: 0,
  borderRadius: 6, border: `1px solid ${LINE2}`,
  background: "#fff", color: INK_2,
  fontFamily: FONT_UI, fontSize: 14, fontWeight: 600,
  cursor: "pointer",
};

function HeaderChip({ raw, key_, isEmail }: { raw: string; key_: string; isEmail?: boolean }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 10px", borderRadius: 8,
      background: isEmail ? "rgba(154,105,245,0.12)" : "#fff",
      border: `1px solid ${isEmail ? "rgba(154,105,245,0.3)" : LINE}`,
      fontSize: 12,
    }}>
      <span style={{ color: INK_2, fontWeight: 600, fontFamily: FONT_UI }}>{raw}</span>
      <span style={{ color: INK_5 }}>→</span>
      <span style={{ fontFamily: FONT_MONO, color: isEmail ? PURPLE_DEEP : INK_3, fontWeight: 600 }}>
        {isEmail ? "email" : `{{${key_}}}`}
      </span>
    </div>
  );
}

function LeadStatusBadge({ status }: { status: Lead["status"] }) {
  const m: Record<Lead["status"], { bg: string; fg: string }> = {
    new:          { bg: SURF, fg: INK_3 },
    active:       { bg: "rgba(154,105,245,0.10)", fg: PURPLE_DEEP },
    paused:       { bg: "rgba(249,166,3,0.12)", fg: "#b97500" },
    completed:    { bg: "rgba(31,138,91,0.10)", fg: GREEN },
    bounced:      { bg: "rgba(255,51,68,0.10)", fg: "#c12530" },
    replied:      { bg: "rgba(31,138,91,0.15)", fg: GREEN },
    unsubscribed: { bg: "rgba(255,51,68,0.06)", fg: "#c12530" },
  };
  const s = m[status];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600,
      background: s.bg, color: s.fg, textTransform: "capitalize",
    }}>{status}</span>
  );
}

function Pill({ label, value, color = INK }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: 10, padding: "8px 14px" }}>
      <div style={{ fontSize: 11, color: INK_4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 18, color, letterSpacing: "-0.01em" }}>{value}</div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   TAB 4: SCHEDULE
   ════════════════════════════════════════════════════════════════════ */
function ScheduleTab({ campaign, onChange }: { campaign: Campaign; onChange: (s: Schedule) => void }) {
  const [draft, setDraft] = useState<Schedule>(campaign.schedule);
  const dayNames = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, maxWidth: 980 }}>
      <div style={cardStyle}>
        <h3 style={cardTitle}>Días de envío</h3>
        <p style={{ fontSize: 13.5, color: INK_3, marginTop: 0, marginBottom: 14 }}>
          La campaña solo enviará en los días seleccionados.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {dayNames.map((d, i) => {
            const on = draft.days.includes(i);
            return (
              <button key={i} onClick={() => {
                const next = on ? draft.days.filter((x) => x !== i) : [...draft.days, i].sort();
                setDraft({ ...draft, days: next });
              }} style={{
                width: 56, height: 56, borderRadius: 12,
                border: on ? `1.5px solid ${PURPLE}` : `1px solid ${LINE2}`,
                background: on ? "rgba(154,105,245,0.10)" : "#fff",
                color: on ? PURPLE_DEEP : INK_3,
                fontWeight: 700, fontSize: 13.5, fontFamily: FONT_UI,
                cursor: "pointer", transition: "all .15s",
              }}>{d}</button>
            );
          })}
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={cardTitle}>Franja horaria</h3>
        <p style={{ fontSize: 13.5, color: INK_3, marginTop: 0, marginBottom: 14 }}>
          Hora de inicio y fin (en la zona horaria de la campaña).
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "block" }}>
            <div style={miniLabel}>Desde</div>
            <select value={draft.start_hour} onChange={(e) => setDraft({ ...draft, start_hour: parseInt(e.target.value) })} style={inputStyle}>
              {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>)}
            </select>
          </label>
          <label style={{ display: "block" }}>
            <div style={miniLabel}>Hasta</div>
            <select value={draft.end_hour} onChange={(e) => setDraft({ ...draft, end_hour: parseInt(e.target.value) })} style={inputStyle}>
              {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>)}
            </select>
          </label>
        </div>
        <label style={{ display: "block", marginTop: 14 }}>
          <div style={miniLabel}>Zona horaria</div>
          <select value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} style={inputStyle}>
            {["Europe/Madrid","Europe/Lisbon","Europe/London","Europe/Berlin","Europe/Paris","America/New_York","America/Los_Angeles","America/Mexico_City","America/Bogota","America/Buenos_Aires","Asia/Dubai","Asia/Singapore","Asia/Tokyo","Australia/Sydney","UTC"].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={() => onChange(draft)}
          disabled={JSON.stringify(draft) === JSON.stringify(campaign.schedule)}
          style={{ ...brandBtn, opacity: JSON.stringify(draft) === JSON.stringify(campaign.schedule) ? 0.55 : 1 }}
        >
          Guardar schedule
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   TAB 5: OPTIONS
   ════════════════════════════════════════════════════════════════════ */
function OptionsTab({ campaign, onChange }: { campaign: Campaign; onChange: (o: Options) => void }) {
  const [draft, setDraft] = useState<Options>(campaign.options);
  const dirty = JSON.stringify(draft) !== JSON.stringify(campaign.options);

  function set<K extends keyof Options>(k: K, v: Options[K]) {
    setDraft({ ...draft, [k]: v });
  }

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", display: "flex", flexDirection: "column", gap: 12 }}>

      <OptionRow
        title="Stop sending emails on reply"
        desc="No sigue enviando emails a un lead si ya ha respondido"
        value={draft.stop_on_reply}
        onChange={(v) => set("stop_on_reply", v)}
      />

      <OptionRow
        title="Stop on auto-reply (OOO)"
        desc="Pausa cuando llega un fuera-de-oficina o respuesta automática"
        value={draft.stop_on_auto_reply}
        onChange={(v) => set("stop_on_auto_reply", v)}
      />

      <OptionRow
        title="Stop campaign for company on reply"
        desc="Si alguien de @empresa.com responde, pausa también al resto de @empresa.com"
        value={draft.stop_company_on_reply}
        onChange={(v) => set("stop_company_on_reply", v)}
      />

      <OptionRow
        title="Open tracking"
        desc="Trackea aperturas de email"
        value={draft.track_opens}
        onChange={(v) => set("track_opens", v)}
        rightExtra={
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13.5, color: INK_2, cursor: "pointer", marginRight: 14 }}>
            <input type="checkbox" checked={draft.track_clicks} onChange={(e) => set("track_clicks", e.target.checked)} />
            Link tracking
          </label>
        }
      />

      <OptionRow
        title="Delivery optimization"
        desc="Desactiva tracking y prioriza entregabilidad"
        recommended
        custom
        rightExtra={
          <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "4px 8px" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: INK_2, cursor: "pointer" }}>
              <input type="checkbox" checked={draft.text_only_all} onChange={(e) => set("text_only_all", e.target.checked)} />
              Enviar todos como texto plano (sin HTML)
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: INK_2, cursor: "pointer" }}>
              <input type="checkbox" checked={draft.text_only_first} onChange={(e) => set("text_only_first", e.target.checked)} />
              Solo el primer email como texto plano
            </label>
          </div>
        }
      />

      <OptionRow
        title="List-Unsubscribe header"
        desc="Añade cabecera RFC 8058 — Gmail/Outlook lo premian con mejor inbox placement"
        value={draft.insert_unsubscribe_header}
        onChange={(v) => set("insert_unsubscribe_header", v)}
        recommended
      />

      <OptionRow
        title="Sticky sender"
        desc="La cuenta que envió step 1 a un lead, le sigue enviando los follow-ups (preserva threading)"
        value={draft.sticky_sender}
        onChange={(v) => set("sticky_sender", v)}
        recommended
      />

      {/* Daily limit + rotation (controles más complejos en su propia card) */}
      <div style={{ ...cardStyle, padding: "18px 22px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 }}>
          <h3 style={{ ...cardTitle, margin: 0 }}>Daily limit</h3>
          <span style={{ fontSize: 12, color: INK_4 }}>Velocidad y volumen de envío</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14 }}>
          <NumberField label="Emails/día/cuenta" value={draft.daily_limit_per_account} onChange={(v) => set("daily_limit_per_account", v)} hint="Instantly: 30 recomendado" />
          <NumberField label="Max nuevos leads/día" value={draft.max_new_leads_per_day} onChange={(v) => set("max_new_leads_per_day", v)} hint="Step 1 only" />
          <NumberField label="Gap min (minutos)" value={draft.min_gap_minutes} onChange={(v) => set("min_gap_minutes", v)} hint="Pidió 6 mínimo" />
          <NumberField label="Gap aleatorio extra" value={draft.random_gap_minutes} onChange={(v) => set("random_gap_minutes", v)} hint="3 → entre 6-9 min" />
        </div>
        <div style={{ marginTop: 12, padding: "8px 12px", background: SURF, borderRadius: 8, fontSize: 11.5, color: INK_3 }}>
          ⚡ Con los valores actuales, cada cuenta enviará 1 email cada <strong>{draft.min_gap_minutes}-{draft.min_gap_minutes + draft.random_gap_minutes}</strong> min de forma aleatoria. Máx <strong>{draft.daily_limit_per_account}</strong> envíos/día por cuenta.
        </div>
      </div>

      {/* Rotation */}
      <div style={{ ...cardStyle, padding: "18px 22px" }}>
        <h3 style={cardTitle}>Account rotation</h3>
        <p style={{ fontSize: 12.5, color: INK_3, margin: "0 0 12px" }}>Cómo se elige qué cuenta envía a cada lead nuevo.</p>
        <div style={{ display: "flex", gap: 8 }}>
          {(["round-robin","random"] as const).map((r) => (
            <button key={r} onClick={() => set("account_rotation", r)} style={{
              flex: 1, padding: "12px 14px", borderRadius: 10,
              border: draft.account_rotation === r ? `1.5px solid ${PURPLE}` : `1px solid ${LINE2}`,
              background: draft.account_rotation === r ? "rgba(154,105,245,0.08)" : "#fff",
              color: draft.account_rotation === r ? PURPLE_DEEP : INK_2,
              fontWeight: 600, fontSize: 13, fontFamily: FONT_UI, cursor: "pointer",
              textAlign: "left",
            }}>
              <div style={{ fontWeight: 700 }}>{r === "round-robin" ? "Round-robin" : "Aleatorio"}</div>
              <div style={{ fontSize: 11.5, color: INK_4, marginTop: 2 }}>
                {r === "round-robin" ? "Reparte por turno entre las cuentas asignadas." : "Elige una cuenta al azar para cada lead."}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* CC/BCC */}
      <div style={{ ...cardStyle, padding: "18px 22px" }}>
        <h3 style={cardTitle}>CC / BCC</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <TextField label="CC (separados por coma)" value={draft.cc || ""} onChange={(v) => set("cc", v)} placeholder="copia@dominio.com" />
          <TextField label="BCC (separados por coma)" value={draft.bcc || ""} onChange={(v) => set("bcc", v)} placeholder="oculta@dominio.com" />
        </div>
      </div>

      {/* Save sticky */}
      {dirty && (
        <div style={{
          position: "sticky", bottom: 24,
          display: "flex", justifyContent: "flex-end", gap: 10,
          padding: "12px 16px", background: PAPER, border: `1px solid ${PURPLE}`,
          borderRadius: 14, boxShadow: "0 12px 28px rgba(154,105,245,0.18)",
          marginTop: 8,
        }}>
          <span style={{ alignSelf: "center", marginRight: "auto", fontSize: 13, color: INK_3 }}>Tienes cambios sin guardar</span>
          <button onClick={() => setDraft(campaign.options)} style={ghostBtn}>Descartar</button>
          <button onClick={() => onChange(draft)} style={brandBtn}>Guardar opciones</button>
        </div>
      )}
    </div>
  );
}

/**
 * Fila de opción estilo Instantly:
 *   - Título + descripción a la izquierda
 *   - Pareja Disable | Enable a la derecha (o contenido custom)
 *   - Opcionalmente badge "Recommended" y un componente extra (checkbox, etc.)
 */
function OptionRow({
  title, desc, value, onChange, recommended, custom, rightExtra,
}: {
  title: string; desc?: string;
  value?: boolean;
  onChange?: (v: boolean) => void;
  recommended?: boolean;
  /** Si true, NO renderiza los botones Enable/Disable. El padre pone su propio control en rightExtra. */
  custom?: boolean;
  rightExtra?: React.ReactNode;
}) {
  return (
    <div style={{
      background: PAPER, border: `1px solid ${LINE}`, borderRadius: 14,
      padding: "16px 22px",
      display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
      boxShadow: "0 1px 2px rgba(10,13,20,0.04)",
    }}>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 15, color: INK, letterSpacing: "-0.01em" }}>
            {title}
          </div>
          {recommended && (
            <span style={{
              padding: "2px 9px", borderRadius: 999,
              background: "rgba(31,138,91,0.10)", color: GREEN,
              fontSize: 11, fontWeight: 700,
            }}>Recommended</span>
          )}
        </div>
        {desc && <div style={{ fontSize: 12.5, color: INK_3, marginTop: 4, lineHeight: 1.4 }}>{desc}</div>}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {rightExtra}
        {!custom && onChange && (
          <EnableDisableToggle value={!!value} onChange={onChange} />
        )}
      </div>
    </div>
  );
}

function EnableDisableToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: "inline-flex", border: `1px solid ${LINE2}`, borderRadius: 10, overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => onChange(false)}
        style={{
          height: 38, padding: "0 18px",
          border: 0, cursor: "pointer",
          fontFamily: FONT_UI, fontSize: 13, fontWeight: 700,
          background: !value ? "#4f5266" : "#fff",
          color: !value ? "#fff" : INK_3,
          transition: "all .15s",
        }}
      >Disable</button>
      <button
        type="button"
        onClick={() => onChange(true)}
        style={{
          height: 38, padding: "0 18px",
          border: 0, borderLeft: `1px solid ${LINE2}`, cursor: "pointer",
          fontFamily: FONT_UI, fontSize: 13, fontWeight: 700,
          background: value ? GREEN : "#fff",
          color: value ? "#fff" : INK_3,
          transition: "all .15s",
        }}
      >Enable</button>
    </div>
  );
}

function Toggle({ label, checked, onChange, sub }: { label: string; checked: boolean; onChange: (v: boolean) => void; sub?: string }) {
  return (
    <label style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0", borderBottom: `1px solid ${LINE}`, cursor: "pointer" }}>
      <button onClick={(e) => { e.preventDefault(); onChange(!checked); }} type="button" style={{
        width: 36, height: 22, borderRadius: 999, border: 0,
        background: checked ? "linear-gradient(112deg, #f59e3a, #9a69f5)" : "#cbd5e1",
        position: "relative", cursor: "pointer", flexShrink: 0,
        transition: "background .2s",
      }}>
        <span style={{
          position: "absolute", top: 2, left: checked ? 16 : 2,
          width: 18, height: 18, borderRadius: "50%", background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
          transition: "left .2s",
        }} />
      </button>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: INK_2 }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: INK_4, marginTop: 3 }}>{sub}</div>}
      </div>
    </label>
  );
}

function NumberField({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <div style={miniLabel}>{label}</div>
      <input type="number" value={value} onChange={(e) => onChange(Math.max(0, parseInt(e.target.value) || 0))} style={inputStyle} />
      {hint && <div style={{ fontSize: 11, color: INK_4, marginTop: 4 }}>{hint}</div>}
    </label>
  );
}
function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <div style={miniLabel}>{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
    </label>
  );
}

function SectionCard({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div style={cardStyle}>
      <h3 style={cardTitle}>{title}</h3>
      {desc && <p style={{ fontSize: 12.5, color: INK_3, margin: "0 0 8px" }}>{desc}</p>}
      <div>{children}</div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   TAB 6: EMAIL ACCOUNTS (selecciona cuentas + rotación)
   ════════════════════════════════════════════════════════════════════ */
function AccountsTab({ campaign, setCampaign, toast }: { campaign: Campaign; setCampaign: (c: Campaign | ((p: Campaign) => Campaign)) => void; toast: (s: string) => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/email-accounts");
      const j = await r.json();
      setAccounts(j.accounts || []);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    accounts.forEach((a) => (a.tags || []).forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [accounts]);

  const filtered = accounts.filter((a) => {
    if (search && !a.email.includes(search.toLowerCase())) return false;
    if (tagFilter && !(a.tags || []).includes(tagFilter)) return false;
    return true;
  });

  // Las cuentas EFECTIVAMENTE asignadas = account_ids explícitos ∪ por tag.
  const selectedIds = new Set(campaign.account_ids);
  const selectedTags = new Set(campaign.account_tags || []);
  const isEffectivelyAssigned = (a: Account) => {
    if (selectedIds.has(a.id)) return true;
    if ((a.tags || []).some((t) => selectedTags.has(t))) return true;
    return false;
  };
  const effective = accounts.filter(isEffectivelyAssigned);

  /** Actualiza account_ids local + persiste sin re-fetch. */
  function setIds(ids: string[]) {
    setCampaign((prev) => ({ ...prev, account_ids: ids }));
    fetch(`/api/email-campaigns/${campaign.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_ids: ids }),
    }).catch(() => {});
  }
  function setTags(tags: string[]) {
    setCampaign((prev) => ({ ...prev, account_tags: tags }));
    fetch(`/api/email-campaigns/${campaign.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_tags: tags }),
    }).catch(() => {});
  }

  function toggle(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setIds(Array.from(next));
  }

  function toggleTag(t: string) {
    const next = new Set(selectedTags);
    if (next.has(t)) next.delete(t); else next.add(t);
    setTags(Array.from(next));
  }

  function selectAllFiltered() {
    const next = new Set(selectedIds);
    filtered.forEach((a) => next.add(a.id));
    setIds(Array.from(next));
    toast(`✓ ${filtered.length} cuentas seleccionadas`);
  }
  function selectNone() {
    setIds([]);
    setTags([]);
  }

  const totalLimit = effective.reduce((s, a) => s + (a.daily_limit ?? 50), 0);

  return (
    <div>
      <div style={{ ...cardStyle, marginBottom: 16, padding: "14px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 22, color: INK, letterSpacing: "-0.02em" }}>
              {effective.length} <span style={{ fontFamily: FONT_SERIF, fontStyle: "italic", fontWeight: 400, color: INK_3, fontSize: 18 }}>de</span> {accounts.length} cuentas activas
            </div>
            <div style={{ fontSize: 12.5, color: INK_4, marginTop: 2 }}>
              {selectedIds.size > 0 && <>Por ID: <strong style={{ color: INK_2, fontFamily: FONT_MONO }}>{selectedIds.size}</strong> · </>}
              {selectedTags.size > 0 && <>Por tag: <strong style={{ color: PURPLE_DEEP }}>{Array.from(selectedTags).join(", ")}</strong> (<strong style={{ color: INK_2 }}>{effective.length - selectedIds.size}</strong> cuentas) · </>}
              Capacidad: <strong style={{ color: INK_2, fontFamily: FONT_MONO }}>{totalLimit}</strong> emails/día ·
              {" "}Rotación: <strong style={{ color: INK_2 }}>{campaign.options.account_rotation}</strong> ·
              {" "}Sticky: <strong style={{ color: INK_2 }}>{campaign.options.sticky_sender ? "✓" : "✗"}</strong>
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button onClick={selectAllFiltered} disabled={filtered.length === 0} style={ghostBtn}>Marcar todas</button>
            <button onClick={selectNone} style={ghostBtn}>Quitar todas</button>
          </div>
        </div>
      </div>

      {/* Asignar por TAG — atajo "darf" */}
      {allTags.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 16, padding: "14px 18px", background: "linear-gradient(180deg, rgba(154,105,245,0.04), #fff)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
            <div style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 14, color: INK, letterSpacing: "-0.01em" }}>
              Asignar por tag <span style={{ fontFamily: FONT_SERIF, fontStyle: "italic", fontWeight: 400, color: INK_3 }}>(atajo)</span>
            </div>
            <span style={{ fontSize: 11.5, color: INK_4 }}>
              Selecciona un tag y TODAS las cuentas con ese tag entran en la rotación.
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {allTags.map((t) => {
              const on = selectedTags.has(t);
              const count = accounts.filter((a) => (a.tags || []).includes(t)).length;
              return (
                <button key={t} onClick={() => toggleTag(t)} style={{
                  height: 32, padding: "0 14px", borderRadius: 999,
                  border: on ? `1.5px solid ${PURPLE}` : `1px solid ${LINE2}`,
                  background: on ? "rgba(154,105,245,0.10)" : "#fff",
                  color: on ? PURPLE_DEEP : INK_2,
                  fontWeight: 600, fontSize: 12.5, fontFamily: FONT_UI, cursor: "pointer",
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}>
                  {on && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                  {t}
                  <span style={{ color: INK_4, fontFamily: FONT_MONO, fontSize: 11, fontWeight: 500 }}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 240, maxWidth: 360 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por email…" style={{ ...inputStyle, paddingLeft: 38 }} />
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={INK_4} strokeWidth="2" style={{ position: "absolute", left: 12, top: 13 }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </div>
        {allTags.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => setTagFilter(null)} style={tagPill(tagFilter === null)}>Todas</button>
            {allTags.map((t) => (
              <button key={t} onClick={() => setTagFilter(t)} style={tagPill(tagFilter === t)}>{t}</button>
            ))}
          </div>
        )}
        <a href="/connect-accounts" style={{ ...ghostBtn, marginLeft: "auto", textDecoration: "none" }}>
          + Conectar nueva cuenta
        </a>
      </div>

      {loading ? (
        <div style={{ color: INK_4 }}>Cargando…</div>
      ) : filtered.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", padding: "60px 20px", color: INK_4 }}>
          {accounts.length === 0 ? "Conecta primero una cuenta en /connect-accounts" : "No hay cuentas con ese filtro"}
        </div>
      ) : (
        <div style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: 14, overflow: "hidden" }}>
          {filtered.map((a, i) => {
            const byId = selectedIds.has(a.id);
            const byTag = !byId && (a.tags || []).some((t) => selectedTags.has(t));
            const active = byId || byTag;
            return (
            <div key={a.id} onClick={() => toggle(a.id)} style={{
              padding: "14px 18px",
              borderTop: i === 0 ? "none" : `1px solid ${LINE}`,
              cursor: "pointer",
              background: active ? "rgba(154,105,245,0.05)" : "#fff",
              display: "grid", gridTemplateColumns: "auto auto 1fr auto auto", gap: 14, alignItems: "center",
              transition: "background .15s",
            }}>
              <div title={byTag ? "Activada vía tag" : byId ? "Activada manualmente" : ""} style={{
                width: 22, height: 22, borderRadius: 6,
                border: `1.5px solid ${active ? PURPLE : LINE2}`,
                background: byId ? PURPLE : byTag ? "rgba(154,105,245,0.4)" : "#fff",
                display: "grid", placeItems: "center",
              }}>
                {active && (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: BRAND_G, color: "#fff",
                display: "grid", placeItems: "center",
                fontFamily: FONT_SANS, fontWeight: 700, fontSize: 12.5,
              }}>{a.email.slice(0, 2).toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: INK, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.email}</div>
                <div style={{ fontSize: 12, color: INK_4, fontFamily: FONT_MONO, marginTop: 2 }}>
                  {a.provider} · {a.smtp_host} · daily {a.daily_limit ?? 50}
                  {a.tags && a.tags.length > 0 && <span style={{ color: PURPLE_DEEP, marginLeft: 6 }}>· {a.tags.join(", ")}</span>}
                </div>
              </div>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "3px 9px", borderRadius: 999, fontSize: 11.5, fontWeight: 600,
                background: a.smtp_ok && a.imap_ok ? "rgba(31,138,91,0.10)" : "rgba(255,51,68,0.08)",
                color: a.smtp_ok && a.imap_ok ? GREEN : "#c12530",
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
                {a.smtp_ok && a.imap_ok ? "Conectada" : "Error"}
              </span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: INK_4 }}>
                {a.sent_today ?? 0}/{a.daily_limit ?? 50} hoy
              </span>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Common UI ────────────────────────────────────────────────────────── */
function ModalShell({ title, subtitle, onClose, children, footer, width = 720 }: any) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(10,13,20,0.42)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 150, padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: PAPER, borderRadius: 20, width: "100%", maxWidth: width, maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 30px 90px rgba(10,13,20,0.22)", overflow: "hidden" }}>
        <div style={{ padding: "22px 26px", borderBottom: `1px solid ${LINE}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: FONT_SANS, fontWeight: 700, fontSize: 22, letterSpacing: "-0.025em", color: INK, lineHeight: 1.1 }}>{title}</h2>
            {subtitle && <p style={{ margin: "6px 0 0", color: INK_3, fontSize: 13.5, lineHeight: 1.5 }}>{subtitle}</p>}
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: 0, fontSize: 22, color: INK_4, cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
        </div>
        <div style={{ padding: 26, overflow: "auto", flex: 1 }}>{children}</div>
        {footer && <div style={{ padding: "14px 26px", borderTop: `1px solid ${LINE}`, display: "flex", justifyContent: "flex-end", gap: 10, background: SURF }}>{footer}</div>}
      </div>
    </div>
  );
}

/* ── Icons ──────────────────────────────────────────────────────────── */
function IconChart()    { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>; }
function IconLayers()   { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>; }
function IconUsers()    { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>; }
function IconClock()    { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>; }
function IconSliders()  { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>; }
function IconMail()     { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22,6 12,13 2,6"/></svg>; }

/* ── Styles ──────────────────────────────────────────────────────────── */
const cardStyle: React.CSSProperties = {
  background: PAPER, border: `1px solid ${LINE}`, borderRadius: 14,
  padding: 18, boxShadow: "0 1px 2px rgba(10,13,20,0.04)",
};
const cardTitle: React.CSSProperties = {
  margin: "0 0 12px", fontFamily: FONT_SANS, fontWeight: 700, fontSize: 16,
  letterSpacing: "-0.015em", color: INK,
};
const miniLabel: React.CSSProperties = {
  fontSize: 11, color: INK_3, fontWeight: 600,
  textTransform: "uppercase", letterSpacing: "0.06em",
  marginBottom: 6, fontFamily: FONT_UI,
};
const th: React.CSSProperties = {
  textAlign: "left", padding: "12px 16px",
  fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.07em",
  color: INK_4, fontWeight: 700, fontFamily: FONT_UI,
};
const td: React.CSSProperties = { padding: "12px 16px", verticalAlign: "middle", color: INK_2 };
const segBtn = (on: boolean): React.CSSProperties => ({
  height: 30, padding: "0 12px", borderRadius: 7, border: 0,
  background: on ? PAPER : "transparent",
  color: on ? INK : INK_3,
  fontWeight: 600, fontSize: 12, fontFamily: FONT_UI, cursor: "pointer",
  textTransform: "capitalize",
  boxShadow: on ? "0 1px 2px rgba(10,13,20,0.06)" : "none",
});
const tagPill = (on: boolean): React.CSSProperties => ({
  height: 32, padding: "0 14px",
  borderRadius: 999, border: 0,
  background: on ? INK : SURF,
  color: on ? "#fff" : INK_2,
  fontWeight: 600, fontSize: 12.5, fontFamily: FONT_UI,
  cursor: "pointer",
});
