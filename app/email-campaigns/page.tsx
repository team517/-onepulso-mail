"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BG, INK, INK_2, INK_3, INK_4, INK_5, LINE, LINE2, PAPER, SURF, SURF_2,
  BRAND_G, GREEN, ORANGE, PURPLE, DANGER,
  FONT_SANS, FONT_UI, FONT_MONO, FONT_SERIF,
  TopNav, BrandFonts, Eyebrow, useToast,
  brandBtn, ghostBtn, inputStyle,
} from "./_shell";

type Campaign = {
  id: string;
  name: string;
  status: "draft" | "active" | "paused" | "completed";
  created_at: string;
  updated_at: string;
  steps: any[];
  account_ids: string[];
  variables: string[];
  tags?: string[];
  metrics?: {
    total_leads: number; active_leads: number; contacted: number;
    opened: number; clicked: number; replied: number;
    bounced: number; unsubscribed: number; completed: number;
  };
};

export default function CampaignListPage() {
  const router = useRouter();
  const { show: showToast, ToastNode } = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | Campaign["status"]>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [renaming, setRenaming] = useState<Campaign | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/email-campaigns");
      const j = await r.json();
      setCampaigns(j.campaigns || []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let list = campaigns;
    if (statusFilter !== "all") list = list.filter((c) => c.status === statusFilter);
    const q = search.toLowerCase().trim();
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q) || (c.tags || []).some((t) => t.toLowerCase().includes(q)));
    return list;
  }, [campaigns, search, statusFilter]);

  async function createCampaign(name: string) {
    const r = await fetch("/api/email-campaigns", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const j = await r.json();
    if (j.ok) {
      showToast("✓ Campaña creada");
      setShowCreate(false);
      router.push(`/email-campaigns/${j.campaign.id}`);
    } else {
      showToast(j.error || "Error");
    }
  }

  async function duplicate(c: Campaign) {
    const r = await fetch(`/api/email-campaigns/${c.id}/duplicate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const j = await r.json();
    if (j.ok) {
      // Insert directly al estado local — sin re-fetch
      setCampaigns((prev) => [j.campaign, ...prev]);
      showToast("✓ Campaña duplicada");
    }
  }

  async function rename(c: Campaign, newName: string) {
    setRenaming(null);
    // Optimista local
    setCampaigns((prev) => prev.map((x) => x.id === c.id ? { ...x, name: newName } : x));
    fetch(`/api/email-campaigns/${c.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    }).catch(() => {});
    showToast("✓ Nombre actualizado");
  }

  async function changeStatus(c: Campaign, status: Campaign["status"]) {
    // Optimista local
    setCampaigns((prev) => prev.map((x) => x.id === c.id ? { ...x, status } : x));
    fetch(`/api/email-campaigns/${c.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => {});
    showToast(`✓ ${status === "active" ? "Activada" : status === "paused" ? "Pausada" : "Estado actualizado"}`);
  }

  async function remove(c: Campaign) {
    if (!confirm(`¿Eliminar la campaña "${c.name}"? Se borrarán también sus leads.`)) return;
    // Optimista: la quitamos de la lista al instante
    setCampaigns((prev) => prev.filter((x) => x.id !== c.id));
    showToast("✓ Campaña eliminada");
    fetch(`/api/email-campaigns/${c.id}`, { method: "DELETE" }).catch(() => {});
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/landing");
  }

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: FONT_UI, color: INK_2 }}>
      <BrandFonts />
      <TopNav activeKey="campanas" onLogout={logout} toast={showToast} />

      {/* HERO compacto */}
      <section style={{ position: "relative", overflow: "hidden", padding: "64px 0 28px" }}>
        <div style={{
          position: "absolute", top: -100, right: -120, width: 480, height: 480, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(249,166,3,0.18), transparent 60%)",
          filter: "blur(80px)", pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", bottom: -180, left: -140, width: 480, height: 480, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(209,92,254,0.15), transparent 60%)",
          filter: "blur(80px)", pointerEvents: "none",
        }} />
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "0 28px", position: "relative", zIndex: 1 }}>
          <Eyebrow color={ORANGE}>{campaigns.length === 0 ? "Sin campañas todavía" : `${campaigns.length} campaña${campaigns.length === 1 ? "" : "s"}`}</Eyebrow>
          <h1 style={{
            margin: "22px 0 0",
            fontFamily: FONT_SANS, fontWeight: 800,
            fontSize: "clamp(40px, 5vw, 64px)", letterSpacing: "-0.04em",
            lineHeight: 1.02, color: INK, maxWidth: 900,
          }}>
            Campañas <span style={{ fontFamily: FONT_SERIF, fontWeight: 400, fontStyle: "italic", letterSpacing: "-0.025em" }}>de</span>{" "}
            <span style={{ background: BRAND_G, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>cold email.</span>
          </h1>
          <p style={{ margin: "20px 0 0", maxWidth: 620, fontSize: 18, lineHeight: 1.55, color: INK_3 }}>
            Crea secuencias multi-step con variantes A/B, sube tus leads en CSV y rota envíos entre tus
            cuentas conectadas. Sticky sender preserva el threading.
          </p>
        </div>
      </section>

      <section style={{ maxWidth: 1240, margin: "0 auto", padding: "20px 28px 0" }}>
        {/* Action bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          background: PAPER, border: `1px solid ${LINE}`, borderRadius: 16,
          padding: "14px 18px", boxShadow: "0 1px 2px rgba(10,13,20,0.04)",
        }}>
          <div style={{ position: "relative", flex: 1, minWidth: 220, maxWidth: 360 }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o tag…"
              style={{ ...inputStyle, paddingLeft: 38 }}
            />
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={INK_4} strokeWidth="2" style={{ position: "absolute", left: 12, top: 13 }}>
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <div style={{ display: "inline-flex", padding: 3, background: SURF, borderRadius: 10, border: `1px solid ${LINE}` }}>
            {(["all","draft","active","paused","completed"] as const).map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)} style={{
                height: 30, padding: "0 12px", borderRadius: 7, border: 0,
                background: statusFilter === s ? PAPER : "transparent",
                color: statusFilter === s ? INK : INK_3,
                fontWeight: 600, fontSize: 12.5, fontFamily: FONT_UI, cursor: "pointer",
                boxShadow: statusFilter === s ? "0 1px 2px rgba(10,13,20,0.06)" : "none",
              }}>
                {s === "all" ? "Todas" : s === "draft" ? "Borrador" : s === "active" ? "Activas" : s === "paused" ? "Pausadas" : "Completadas"}
              </button>
            ))}
          </div>
          <div style={{ marginLeft: "auto" }}>
            <button onClick={() => setShowCreate(true)} style={brandBtn}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Nueva campaña
            </button>
          </div>
        </div>
      </section>

      {/* List */}
      <section style={{ maxWidth: 1240, margin: "0 auto", padding: "20px 28px 80px" }}>
        {loading ? (
          <div style={{ color: INK_4, fontSize: 14 }}>Cargando…</div>
        ) : filtered.length === 0 ? (
          <EmptyState onCreate={() => setShowCreate(true)} hasAny={campaigns.length > 0} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {filtered.map((c) => (
              <CampaignCard
                key={c.id} c={c}
                onOpen={() => router.push(`/email-campaigns/${c.id}`)}
                onRename={() => setRenaming(c)}
                onDuplicate={() => duplicate(c)}
                onStatus={(s) => changeStatus(c, s)}
                onDelete={() => remove(c)}
              />
            ))}
          </div>
        )}
      </section>

      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onSubmit={createCampaign} />
      )}
      {renaming && (
        <RenameModal campaign={renaming} onClose={() => setRenaming(null)} onSubmit={(n) => rename(renaming, n)} />
      )}

      {ToastNode}
    </div>
  );
}

function CampaignCard({ c, onOpen, onRename, onDuplicate, onStatus, onDelete }: {
  c: Campaign;
  onOpen: () => void; onRename: () => void; onDuplicate: () => void;
  onStatus: (s: Campaign["status"]) => void; onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const m = c.metrics || { total_leads: 0, contacted: 0, opened: 0, replied: 0, active_leads: 0, clicked: 0, bounced: 0, unsubscribed: 0, completed: 0 };
  const variantCount = c.steps.reduce((s, st: any) => s + (st.variants?.length || 0), 0);

  return (
    <div style={{
      background: PAPER, border: `1px solid ${LINE}`, borderRadius: 16,
      padding: "20px 24px", boxShadow: "0 1px 2px rgba(10,13,20,0.04)",
      cursor: "pointer", transition: "border-color .15s, box-shadow .15s, transform .06s",
      position: "relative",
    }}
    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(154,105,245,0.3)"; }}
    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = LINE; }}
    >
      <div onClick={onOpen} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 18, alignItems: "center" }}>
        {/* Avatar */}
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: BRAND_G, display: "grid", placeItems: "center",
          color: "#fff", fontFamily: FONT_SANS, fontWeight: 800, fontSize: 18,
          letterSpacing: "-0.02em", boxShadow: "0 6px 18px rgba(209,92,254,0.22)",
        }}>{c.name.slice(0, 1).toUpperCase()}</div>

        {/* Name + meta */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 18, color: INK, letterSpacing: "-0.015em" }}>
              {c.name}
            </div>
            <StatusBadge status={c.status} />
          </div>
          <div style={{ display: "flex", gap: 18, marginTop: 6, fontSize: 12.5, color: INK_4 }}>
            <span><strong style={{ color: INK_2, fontFamily: FONT_MONO }}>{c.steps.length}</strong> step{c.steps.length === 1 ? "" : "s"}</span>
            <span><strong style={{ color: INK_2, fontFamily: FONT_MONO }}>{variantCount}</strong> variantes</span>
            <span><strong style={{ color: INK_2, fontFamily: FONT_MONO }}>{c.account_ids.length}</strong> cuentas</span>
            <span><strong style={{ color: INK_2, fontFamily: FONT_MONO }}>{m.total_leads}</strong> leads</span>
            {(c.tags || []).slice(0, 3).map((t) => (
              <span key={t} style={{
                padding: "1px 8px", borderRadius: 999, background: SURF, color: INK_2,
                fontSize: 11, fontWeight: 500, border: `1px solid ${LINE}`,
              }}>{t}</span>
            ))}
          </div>
        </div>

        {/* Mini metrics */}
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          <MetricMini label="Enviados" value={m.contacted} />
          <MetricMini label="Abiertos" value={m.opened} color={ORANGE} />
          <MetricMini label="Respondidos" value={m.replied} color={GREEN} />
          <button
            onClick={(e) => { e.stopPropagation(); setMenu(!menu); }}
            style={{
              width: 36, height: 36, borderRadius: 10,
              border: `1px solid ${LINE2}`, background: "#fff",
              display: "grid", placeItems: "center", cursor: "pointer", color: INK_3,
            }}
            title="Más opciones"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/></svg>
          </button>
        </div>
      </div>

      {/* Dropdown menu */}
      {menu && (
        <>
          <div onClick={() => setMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 30 }} />
          <div style={{
            position: "absolute", top: 64, right: 18, zIndex: 40,
            background: "#fff", border: `1px solid ${LINE}`, borderRadius: 12,
            boxShadow: "0 18px 48px rgba(10,13,20,0.18)",
            minWidth: 200, padding: 6,
          }}>
            <MenuItem onClick={() => { setMenu(false); onOpen(); }}>📂 Abrir</MenuItem>
            <MenuItem onClick={() => { setMenu(false); onRename(); }}>✏ Renombrar</MenuItem>
            <MenuItem onClick={() => { setMenu(false); onDuplicate(); }}>📋 Duplicar</MenuItem>
            <hr style={{ border: 0, borderTop: `1px solid ${LINE}`, margin: "4px 0" }} />
            {c.status !== "active" && <MenuItem onClick={() => { setMenu(false); onStatus("active"); }}>▶ Activar</MenuItem>}
            {c.status === "active" && <MenuItem onClick={() => { setMenu(false); onStatus("paused"); }}>⏸ Pausar</MenuItem>}
            {c.status !== "draft" && <MenuItem onClick={() => { setMenu(false); onStatus("draft"); }}>📝 Volver a borrador</MenuItem>}
            <hr style={{ border: 0, borderTop: `1px solid ${LINE}`, margin: "4px 0" }} />
            <MenuItem danger onClick={() => { setMenu(false); onDelete(); }}>🗑 Eliminar</MenuItem>
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%", textAlign: "left", padding: "8px 12px",
        border: 0, background: "transparent",
        fontFamily: FONT_UI, fontSize: 13.5, fontWeight: 500,
        color: danger ? "#c12530" : INK_2,
        cursor: "pointer", borderRadius: 8,
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = SURF; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
    >
      {children}
    </button>
  );
}

function MetricMini({ label, value, color = INK }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ minWidth: 64, textAlign: "right" }}>
      <div style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 16, color, letterSpacing: "-0.01em" }}>{value}</div>
      <div style={{ fontSize: 10.5, color: INK_4, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: Campaign["status"] }) {
  const styles: Record<typeof status, { bg: string; fg: string; label: string }> = {
    draft:     { bg: SURF_2, fg: INK_3, label: "Borrador" },
    active:    { bg: "rgba(31,138,91,0.10)", fg: GREEN, label: "Activa" },
    paused:    { bg: "rgba(249,166,3,0.12)", fg: "#b97500", label: "Pausada" },
    completed: { bg: "rgba(154,105,245,0.10)", fg: PURPLE, label: "Completada" },
  };
  const s = styles[status];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 9px", borderRadius: 999,
      background: s.bg, color: s.fg,
      fontSize: 11.5, fontWeight: 600,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
      {s.label}
    </span>
  );
}

function EmptyState({ onCreate, hasAny }: { onCreate: () => void; hasAny: boolean }) {
  return (
    <div style={{
      background: PAPER, border: `1px dashed ${LINE2}`, borderRadius: 20,
      padding: "72px 28px", textAlign: "center", position: "relative", overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(120% 60% at 50% 0%, rgba(209,92,254,0.06), transparent 60%)",
        pointerEvents: "none",
      }} />
      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{
          width: 72, height: 72, borderRadius: 20,
          background: BRAND_G, margin: "0 auto 22px",
          display: "grid", placeItems: "center", color: "#fff",
          boxShadow: "0 12px 28px rgba(209,92,254,0.28)",
        }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2" fill="currentColor" stroke="none"/>
          </svg>
        </div>
        <h2 style={{
          fontFamily: FONT_SANS, fontWeight: 800, fontSize: 28,
          color: INK, margin: "0 0 10px", letterSpacing: "-0.03em", lineHeight: 1.1,
        }}>
          {hasAny ? <>No hay campañas con <span style={{ fontFamily: FONT_SERIF, fontStyle: "italic", fontWeight: 400 }}>ese filtro</span></> : <>Crea tu <span style={{ fontFamily: FONT_SERIF, fontStyle: "italic", fontWeight: 400 }}>primera</span> campaña</>}
        </h2>
        <p style={{ margin: "0 0 28px", color: INK_3, fontSize: 16, maxWidth: 520, marginLeft: "auto", marginRight: "auto", lineHeight: 1.55 }}>
          {hasAny
            ? "Prueba otro filtro o crea una nueva campaña."
            : "Define la secuencia de emails, sube tus leads en CSV y elige las cuentas conectadas que enviarán. Las variables se auto-detectan del CSV."}
        </p>
        <button onClick={onCreate} style={brandBtn}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nueva campaña
        </button>
      </div>
    </div>
  );
}

function CreateModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  return (
    <Modal title="Nueva campaña" subtitle="Dale un nombre descriptivo. Luego añades pasos, leads y cuentas." onClose={onClose}
      footer={
        <>
          <button onClick={onClose} style={ghostBtn}>Cancelar</button>
          <button
            disabled={!name.trim() || submitting}
            onClick={async () => { setSubmitting(true); await onSubmit(name.trim()); setSubmitting(false); }}
            style={{ ...brandBtn, opacity: !name.trim() || submitting ? 0.55 : 1 }}
          >
            {submitting ? "Creando…" : "Crear y editar"}
          </button>
        </>
      }
    >
      <label style={{ display: "block" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: INK_3, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>Nombre</div>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="Ej: FinTech ES · CMO · Q2" onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { onSubmit(name.trim()); } }} />
      </label>
    </Modal>
  );
}

function RenameModal({ campaign, onClose, onSubmit }: { campaign: Campaign; onClose: () => void; onSubmit: (n: string) => Promise<void> }) {
  const [name, setName] = useState(campaign.name);
  return (
    <Modal title="Renombrar campaña" onClose={onClose}
      footer={
        <>
          <button onClick={onClose} style={ghostBtn}>Cancelar</button>
          <button disabled={!name.trim()} onClick={() => onSubmit(name.trim())} style={{ ...brandBtn, opacity: !name.trim() ? 0.55 : 1 }}>Guardar</button>
        </>
      }
    >
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onSubmit(name.trim()); }} />
    </Modal>
  );
}

function Modal({ title, subtitle, onClose, children, footer }: {
  title: string; subtitle?: string; onClose: () => void;
  children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(10,13,20,0.42)",
      backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 150, padding: 24,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: PAPER, borderRadius: 20, width: "100%", maxWidth: 540,
        boxShadow: "0 30px 90px rgba(10,13,20,0.22)", overflow: "hidden",
      }}>
        <div style={{ padding: "22px 26px", borderBottom: `1px solid ${LINE}` }}>
          <h2 style={{ margin: 0, fontFamily: FONT_SANS, fontWeight: 700, fontSize: 22, letterSpacing: "-0.025em", color: INK }}>{title}</h2>
          {subtitle && <p style={{ margin: "6px 0 0", color: INK_3, fontSize: 13.5 }}>{subtitle}</p>}
        </div>
        <div style={{ padding: 26 }}>{children}</div>
        {footer && <div style={{ padding: "14px 26px", borderTop: `1px solid ${LINE}`, display: "flex", justifyContent: "flex-end", gap: 10, background: SURF }}>{footer}</div>}
      </div>
    </div>
  );
}
