"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/* ── Brand tokens (alineados al landing) ───────────────────────────────
 * Plataforma de Email INDEPENDIENTE: no comparte navegación, rutas ni
 * datos con la plataforma OnePulso principal. Solo comparte la identidad
 * visual (fonts + gradiente).
 */
const INK   = "#0a0d14";
const INK_2 = "#23252c";
const INK_3 = "#54565b";
const INK_4 = "#848689";
const INK_5 = "#b6b6b9";
const LINE  = "#ececef";
const LINE2 = "#e0e0e3";
const BG    = "#fafbfc";
const PAPER = "#ffffff";
const SURF  = "#f5f9fe";
const SURF_2= "#f3f3f3";
const GREEN = "#1f8a5b";
const ORANGE= "#f9a603";
const PURPLE= "#9a69f5";
const PURPLE_DEEP = "#7e3eda";
const BRAND_G = "linear-gradient(112deg, #f9a603 0%, #f59e3a 22%, #ea7fd3 55%, #b18bf8 78%, #9a69f5 100%)";

const FONT_SANS = "'Plus Jakarta Sans', system-ui, sans-serif";
const FONT_UI   = "'Inter', system-ui, -apple-system, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const FONT_SERIF= "'Instrument Serif', serif";

/* ── Tipos ────────────────────────────────────────────────────────────── */
type Account = {
  id: string;
  email: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  provider: string;
  smtp_host: string;
  smtp_port: number;
  imap_host: string;
  imap_port: number;
  smtp_ok: boolean;
  imap_ok: boolean;
  last_smtp_error?: string | null;
  last_imap_error?: string | null;
  connected_at: string;
  last_verified_at: string;
  daily_limit?: number;
  warmup_enabled?: boolean;
  warmup_limit?: number;
  warmup_increment?: number;
  sent_today?: number;
  tags?: string[];
};

type VerifyResult = {
  email: string;
  smtp_ok: boolean;
  imap_ok: boolean;
  smtp_error?: string | null;
  imap_error?: string | null;
  smtp_ms?: number;
  imap_ms?: number;
  saved: boolean;
};

type CsvRow = {
  email: string;
  password?: string;
  first_name?: string;
  last_name?: string;
  display_name?: string;
  imap_user?: string;
  imap_password?: string;
  imap_host?: string;
  imap_port?: number;
  smtp_user?: string;
  smtp_password?: string;
  smtp_host?: string;
  smtp_port?: number;
  daily_limit?: number;
  warmup_enabled?: boolean;
  warmup_limit?: number;
  warmup_increment?: number;
  __error?: string;
};

/* ── CSV parser (compatible con el esquema Evadan + flexible) ──────────── */
function parseCSV(text: string): CsvRow[] {
  const firstLine = text.split(/\r?\n/)[0] || "";
  let delim = ",";
  if ((firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length) delim = ";";
  if ((firstLine.match(/\t/g) || []).length > Math.max((firstLine.match(/,/g) || []).length, (firstLine.match(/;/g) || []).length)) delim = "\t";

  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === delim) { cur.push(field); field = ""; }
      else if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else { field += c; }
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }

  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (...names: string[]) => {
    for (const n of names) {
      const i = headers.indexOf(n.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };

  const cols = {
    email: idx("email", "e-mail", "correo"),
    first_name: idx("first name", "first_name", "firstname", "nombre"),
    last_name: idx("last name", "last_name", "lastname", "apellido", "apellidos"),
    display_name: idx("display name", "display_name", "name", "nombre completo"),
    imap_user: idx("imap username", "imap_username", "imap user", "imap_user"),
    imap_password: idx("imap password", "imap_password", "imap pass", "imap_pass"),
    imap_host: idx("imap host", "imap_host", "imap server", "imap"),
    imap_port: idx("imap port", "imap_port"),
    smtp_user: idx("smtp username", "smtp_username", "smtp user", "smtp_user"),
    smtp_password: idx("smtp password", "smtp_password", "smtp pass", "smtp_pass"),
    smtp_host: idx("smtp host", "smtp_host", "smtp server", "smtp"),
    smtp_port: idx("smtp port", "smtp_port"),
    password: idx("password", "pass", "contraseña"),
    daily_limit: idx("daily limit", "daily_limit", "limite diario"),
    warmup_enabled: idx("warmup enabled", "warmup_enabled", "warmup"),
    warmup_limit: idx("warmup limit", "warmup_limit"),
    warmup_increment: idx("warmup increment", "warmup_increment"),
  };

  const out: CsvRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row.some((c) => c && c.trim())) continue;
    const v = (i: number) => (i >= 0 && i < row.length ? (row[i] || "").trim() : "");
    const toInt = (s: string) => (s ? parseInt(s) : undefined);
    const toBool = (s: string) => {
      const x = (s || "").toLowerCase();
      return x === "true" || x === "1" || x === "yes" || x === "si" || x === "sí";
    };

    const email = v(cols.email).toLowerCase();
    const r0: CsvRow = {
      email,
      first_name: v(cols.first_name) || undefined,
      last_name: v(cols.last_name) || undefined,
      display_name: v(cols.display_name) || undefined,
      password: v(cols.password) || undefined,
      imap_user: v(cols.imap_user) || undefined,
      imap_password: v(cols.imap_password) || undefined,
      imap_host: v(cols.imap_host) || undefined,
      imap_port: toInt(v(cols.imap_port)),
      smtp_user: v(cols.smtp_user) || undefined,
      smtp_password: v(cols.smtp_password) || undefined,
      smtp_host: v(cols.smtp_host) || undefined,
      smtp_port: toInt(v(cols.smtp_port)),
      daily_limit: toInt(v(cols.daily_limit)),
      warmup_enabled: cols.warmup_enabled >= 0 ? toBool(v(cols.warmup_enabled)) : undefined,
      warmup_limit: toInt(v(cols.warmup_limit)),
      warmup_increment: toInt(v(cols.warmup_increment)),
    };

    if (!email || !email.includes("@")) {
      r0.__error = "Email inválido o vacío";
    } else if (!r0.imap_password && !r0.smtp_password && !r0.password) {
      r0.__error = "Falta contraseña (IMAP/SMTP/Password)";
    }
    out.push(r0);
  }
  return out;
}

function rowToInput(r: CsvRow) {
  return {
    email: r.email,
    password: r.password || r.imap_password || r.smtp_password || "",
    smtp_password: r.smtp_password,
    imap_password: r.imap_password,
    smtp_user: r.smtp_user,
    imap_user: r.imap_user,
    smtp_host: r.smtp_host,
    smtp_port: r.smtp_port,
    imap_host: r.imap_host,
    imap_port: r.imap_port,
    first_name: r.first_name,
    last_name: r.last_name,
    display_name: r.display_name || [r.first_name, r.last_name].filter(Boolean).join(" ") || undefined,
    daily_limit: r.daily_limit,
    warmup_enabled: r.warmup_enabled,
    warmup_limit: r.warmup_limit,
    warmup_increment: r.warmup_increment,
  };
}

/* ── Página ───────────────────────────────────────────────────────────── */
export default function ConnectAccountsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [newTag, setNewTag] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<Set<string>>(new Set());
  const [scrolled, setScrolled] = useState(false);

  const [showBulkCsv, setShowBulkCsv] = useState(false);
  const [showBulkIonos, setShowBulkIonos] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);

  function showToast(t: string) { setToast(t); setTimeout(() => setToast(null), 3200); }

  async function loadAccounts() {
    setLoading(true);
    try {
      const r = await fetch("/api/email-accounts");
      const j = await r.json();
      setAccounts(j.accounts || []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadAccounts(); }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const a of accounts) (a.tags || []).forEach((t) => s.add(t));
    return Array.from(s).sort();
  }, [accounts]);

  const filtered = useMemo(() => {
    if (!activeTag) return accounts;
    return accounts.filter((a) => (a.tags || []).includes(activeTag));
  }, [accounts, activeTag]);

  const stats = useMemo(() => {
    const total = accounts.length;
    const ok = accounts.filter((a) => a.smtp_ok && a.imap_ok).length;
    const sentToday = accounts.reduce((s, a) => s + (a.sent_today ?? 0), 0);
    const totalLimit = accounts.reduce((s, a) => s + (a.daily_limit ?? 50), 0);
    return { total, ok, sentToday, totalLimit };
  }, [accounts]);

  async function verifyIds(ids: string[]) {
    const next = new Set(verifying); ids.forEach((id) => next.add(id)); setVerifying(next);
    try {
      const r = await fetch("/api/email-accounts/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const j = await r.json();
      if (j.ok) {
        showToast(`✓ ${j.summary.fully_ok}/${j.summary.total} verificadas`);
        await loadAccounts();
      } else {
        showToast(j.error || "Error verificando");
      }
    } finally {
      const after = new Set(verifying); ids.forEach((id) => after.delete(id)); setVerifying(after);
    }
  }

  async function verifyAll() {
    const ids = accounts.map((a) => a.id);
    if (ids.length === 0) { showToast("No hay cuentas para verificar"); return; }
    await verifyIds(ids);
  }

  async function deleteAccount(id: string) {
    if (!confirm("¿Desconectar esta bandeja?")) return;
    await fetch(`/api/email-accounts/${id}`, { method: "DELETE" });
    showToast("✓ Bandeja desconectada");
    await loadAccounts();
  }

  async function patchAccount(id: string, patch: any) {
    const r = await fetch(`/api/email-accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const j = await r.json();
    if (j.ok) await loadAccounts();
  }

  async function addTagToAccount(id: string, tag: string) {
    const a = accounts.find((x) => x.id === id);
    if (!a) return;
    const set = new Set(a.tags || []); set.add(tag.trim());
    await patchAccount(id, { tags: Array.from(set) });
  }
  async function removeTagFromAccount(id: string, tag: string) {
    const a = accounts.find((x) => x.id === id);
    if (!a) return;
    const tags = (a.tags || []).filter((t) => t !== tag);
    await patchAccount(id, { tags });
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/landing");
  }

  async function submitCsvRows(rows: CsvRow[]) {
    const valid = rows.filter((r) => !r.__error);
    if (valid.length === 0) { showToast("No hay filas válidas en el CSV"); return; }
    showToast(`Verificando ${valid.length} cuentas…`);
    const r = await fetch("/api/email-accounts/bulk-connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accounts: valid.map(rowToInput) }),
    });
    const j = await r.json();
    if (j.ok) {
      const s = j.summary;
      showToast(`✓ ${s.fully_ok}/${s.total} verificadas · ${s.saved} guardadas`);
      await loadAccounts();
      setShowBulkCsv(false);
    } else {
      showToast(j.error || "Error en bulk");
    }
    return j.results as VerifyResult[];
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: BG,
      fontFamily: FONT_UI,
      color: INK_2,
      WebkitFontSmoothing: "antialiased",
    }}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />

      {/* ── Top nav (mismo lenguaje que el landing) ───────────── */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 50,
        background: scrolled ? "rgba(250,251,252,0.95)" : "rgba(250,251,252,0.85)",
        backdropFilter: "blur(14px)",
        borderBottom: scrolled ? `1px solid ${LINE}` : "1px solid transparent",
        transition: "border-color .2s, background .2s",
      }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "0 28px", height: 68, display: "flex", alignItems: "center", gap: 8 }}>
          <a href="/connect-accounts" style={{
            display: "inline-flex", alignItems: "baseline",
            fontFamily: FONT_SANS, fontWeight: 800, fontSize: 22, letterSpacing: "-0.04em",
            color: INK, textDecoration: "none",
          }}>
            onepulso<span style={{ fontFamily: FONT_SERIF, fontWeight: 400, fontStyle: "italic", fontSize: 18, marginLeft: 4, color: INK_3, letterSpacing: "-0.02em" }}>mail</span>
            <span style={{ display: "inline-flex", gap: 2.5, marginLeft: 6, alignSelf: "flex-start", marginTop: 2 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: INK_4 }} />
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: INK }} />
            </span>
          </a>
          <div style={{ display: "flex", gap: 2, marginLeft: 28 }}>
            <NavLink active>Cuentas</NavLink>
            <NavLink onClick={() => router.push("/email-campaigns")}>Campañas</NavLink>
            <NavLink onClick={() => router.push("/bandejas")}>Bandejas</NavLink>
            <NavLink onClick={() => showToast("Plantillas · próximamente")}>Plantillas</NavLink>
            <NavLink onClick={() => showToast("Logs · próximamente")}>Logs</NavLink>
            <NavLink onClick={() => showToast("Configuración · próximamente")}>Configuración</NavLink>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={eyebrowSm}><span style={dotPulse} /> {stats.ok}/{stats.total} bandejas activas</span>
            <button onClick={logout} style={{ ...textBtn }}>
              Cerrar sesión
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero (estilo landing pero compacto) ────────────────── */}
      <section style={{ position: "relative", overflow: "hidden", padding: "64px 0 28px" }}>
        <div style={{
          position: "absolute", top: -100, right: -120,
          width: 480, height: 480, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(249,166,3,0.18), transparent 60%)",
          filter: "blur(80px)", pointerEvents: "none", zIndex: 0,
        }} />
        <div style={{
          position: "absolute", bottom: -180, left: -140,
          width: 480, height: 480, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(209,92,254,0.15), transparent 60%)",
          filter: "blur(80px)", pointerEvents: "none", zIndex: 0,
        }} />

        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "0 28px", position: "relative", zIndex: 1 }}>
          <span style={eyebrow}><span style={dot} /> Plataforma de Email · SMTP / IMAP</span>
          <h1 style={{
            margin: "22px 0 0",
            fontFamily: FONT_SANS, fontWeight: 800,
            fontSize: "clamp(40px, 5vw, 64px)", letterSpacing: "-0.04em",
            lineHeight: 1.02, color: INK, maxWidth: 900,
          }}>
            Tus bandejas, <span style={{ fontFamily: FONT_SERIF, fontWeight: 400, fontStyle: "italic", letterSpacing: "-0.025em" }}>todas</span>{" "}
            <span style={{ background: BRAND_G, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>conectadas.</span>
          </h1>
          <p style={{ margin: "20px 0 0", maxWidth: 620, fontSize: 18, lineHeight: 1.55, color: INK_3 }}>
            Conecta cuentas SMTP+IMAP de una en una o sube un CSV entero. Verificamos cada bandeja
            contra el servidor real antes de guardar nada.
          </p>

          {/* Stats inline */}
          <div style={{ marginTop: 36, display: "flex", gap: 0, borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}` }}>
            <StatBlock label="Bandejas conectadas" value={String(stats.ok)} sub={`de ${stats.total}`} />
            <StatBlock label="Enviados hoy" value={String(stats.sentToday)} sub={`límite ${stats.totalLimit}`} />
            <StatBlock label="Verificación" value="SMTP+IMAP" sub="contra servidor real" mono />
            <StatBlock label="Concurrencia" value="5" sub="bandejas en paralelo" mono />
          </div>
        </div>
      </section>

      {/* ── Action bar ─────────────────────────────────────────── */}
      <section style={{ maxWidth: 1240, margin: "0 auto", padding: "20px 28px 0" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          background: PAPER, border: `1px solid ${LINE}`, borderRadius: 16,
          padding: "16px 18px",
          boxShadow: "0 1px 2px rgba(10,13,20,0.04)",
        }}>
          <h2 style={{ margin: 0, fontFamily: FONT_SANS, fontWeight: 700, fontSize: 18, letterSpacing: "-0.015em", color: INK }}>
            Cuentas
          </h2>
          <span style={{ fontSize: 13, color: INK_4 }}>· {accounts.length} en total</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={verifyAll} style={ghostBtn}><IconSignal /> Verificar todas</button>
            <button onClick={() => setShowBulkIonos(true)} style={ghostBtn}><IconGlobe /> Bulk IONOS</button>
            <button onClick={() => setShowBulkCsv(true)} style={ghostBtn}><IconUpload /> Bulk CSV</button>
            <button onClick={() => setShowAdd(true)} style={brandBtn}><IconPlus /> Añadir cuenta</button>
          </div>
        </div>

        {/* Tags row */}
        <div style={{
          marginTop: 12,
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          background: PAPER, border: `1px solid ${LINE}`, borderRadius: 14,
          padding: "10px 14px",
        }}>
          <IconTag style={{ color: INK_4 }} />
          <button onClick={() => setActiveTag(null)} style={tagPill(activeTag === null)}>
            Todas ({accounts.length})
          </button>
          {allTags.map((t) => (
            <button key={t} onClick={() => setActiveTag(t)} style={tagPill(activeTag === t)}>
              {t} ({accounts.filter((a) => a.tags?.includes(t)).length})
            </button>
          ))}
          <input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newTag.trim()) {
                setActiveTag(newTag.trim()); setNewTag("");
              }
            }}
            placeholder="Nuevo tag…"
            style={{
              height: 30, padding: "0 12px",
              border: `1px solid ${LINE2}`, borderRadius: 999,
              fontSize: 13, fontFamily: FONT_UI, outline: "none",
              background: "#fff", color: INK_2, minWidth: 130,
            }}
          />
          <button
            disabled={!newTag.trim()}
            onClick={() => { if (newTag.trim()) { setActiveTag(newTag.trim()); setNewTag(""); } }}
            style={{ ...tagPill(false), opacity: newTag.trim() ? 1 : 0.5 }}
          >
            + Crear
          </button>
        </div>

        {/* Selection bar */}
        {selected.size > 0 && (
          <div style={{
            marginTop: 12,
            display: "flex", alignItems: "center", gap: 12,
            background: "rgba(154,105,245,0.07)",
            border: "1px solid rgba(154,105,245,0.22)",
            borderRadius: 14, padding: "10px 16px",
          }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: PURPLE_DEEP }}>
              {selected.size} cuenta{selected.size === 1 ? "" : "s"} seleccionada{selected.size === 1 ? "" : "s"}
            </div>
            <button onClick={() => verifyIds(Array.from(selected))} style={{ ...ghostBtn, height: 32, fontSize: 12.5 }}>
              ↻ Verificar
            </button>
            <button
              onClick={async () => {
                const tag = prompt("Tag a asignar:");
                if (tag && tag.trim()) {
                  for (const id of selected) await addTagToAccount(id, tag.trim());
                  showToast("✓ Tag asignado");
                }
              }}
              style={{ ...ghostBtn, height: 32, fontSize: 12.5 }}
            >
              + Tag
            </button>
            <button
              onClick={async () => {
                if (!confirm(`¿Eliminar ${selected.size} cuenta(s)?`)) return;
                for (const id of selected) await fetch(`/api/email-accounts/${id}`, { method: "DELETE" });
                setSelected(new Set());
                await loadAccounts();
                showToast("✓ Cuentas eliminadas");
              }}
              style={{ ...ghostBtn, height: 32, fontSize: 12.5, color: "#c12530", borderColor: "rgba(255,51,68,0.3)" }}
            >
              🗑 Eliminar
            </button>
            <button onClick={() => setSelected(new Set())} style={{ marginLeft: "auto", background: "transparent", border: 0, color: INK_3, fontSize: 12.5, cursor: "pointer" }}>
              Limpiar selección
            </button>
          </div>
        )}
      </section>

      {/* ── Accounts list ────────────────────────────────────── */}
      <section style={{ maxWidth: 1240, margin: "0 auto", padding: "24px 28px 80px" }}>
        {loading ? (
          <div style={{ color: INK_4, fontSize: 14 }}>Cargando cuentas…</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            onAdd={() => setShowAdd(true)}
            onCsv={() => setShowBulkCsv(true)}
            onIonos={() => setShowBulkIonos(true)}
            hasAccounts={accounts.length > 0}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {filtered.map((a) => (
              <AccountCard
                key={a.id}
                account={a}
                selected={selected.has(a.id)}
                verifying={verifying.has(a.id)}
                onToggle={() => {
                  const next = new Set(selected);
                  if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
                  setSelected(next);
                }}
                onVerify={() => verifyIds([a.id])}
                onDelete={() => deleteAccount(a.id)}
                onEdit={() => setEditing(a)}
                onAddTag={(t) => addTagToAccount(a.id, t)}
                onRemoveTag={(t) => removeTagFromAccount(a.id, t)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Footer */}
      <footer style={{ borderTop: `1px solid ${LINE}`, padding: "32px 0", marginTop: 12 }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "0 28px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14, fontSize: 12.5, color: INK_4 }}>
          <div>onepulso <span style={{ fontFamily: FONT_SERIF, fontStyle: "italic", color: INK_3 }}>mail</span> · 2026 · plataforma de email independiente</div>
          <div style={{ fontFamily: FONT_MONO }}>SMTP + IMAP · sin tracking · self-hosted</div>
        </div>
      </footer>

      {/* Modals */}
      {showBulkCsv && (
        <BulkCsvModal onClose={() => setShowBulkCsv(false)} onSubmit={submitCsvRows} />
      )}
      {showBulkIonos && (
        <BulkIonosModal
          onClose={() => setShowBulkIonos(false)}
          onSubmit={async (rows) => {
            const r = await fetch("/api/email-accounts/bulk-connect", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ accounts: rows }),
            });
            const j = await r.json();
            if (j.ok) {
              showToast(`✓ ${j.summary.fully_ok}/${j.summary.total} verificadas · ${j.summary.saved} guardadas`);
              await loadAccounts();
              setShowBulkIonos(false);
            } else {
              showToast(j.error || "Error");
            }
          }}
        />
      )}
      {showAdd && (
        <AddAccountModal
          onClose={() => setShowAdd(false)}
          onSubmit={async (input) => {
            const r = await fetch("/api/email-accounts/bulk-connect", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ accounts: [input] }),
            });
            const j = await r.json();
            if (j.ok) {
              const res = j.results?.[0];
              if (res?.smtp_ok && res?.imap_ok) {
                showToast("✓ Cuenta conectada y verificada");
              } else {
                showToast(`Verificada con errores: SMTP ${res?.smtp_ok ? "✓" : "✗"} · IMAP ${res?.imap_ok ? "✓" : "✗"}`);
              }
              await loadAccounts();
              setShowAdd(false);
            } else {
              showToast(j.error || "Error");
            }
          }}
        />
      )}
      {editing && (
        <EditAccountModal
          account={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await patchAccount(editing.id, patch);
            setEditing(null);
            showToast("✓ Cambios guardados");
          }}
        />
      )}

      {toast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: INK, color: "#fff",
          padding: "12px 18px", borderRadius: 12,
          fontSize: 13.5, fontWeight: 500,
          boxShadow: "0 18px 48px rgba(10,13,20,0.18)",
          zIndex: 200,
        }}>{toast}</div>
      )}
    </div>
  );
}

/* ── Nav link (estilo landing) ─────────────────────────────────────── */
function NavLink({ children, active, onClick }: { children: React.ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: "8px 14px", borderRadius: 8,
      border: 0, background: "transparent",
      fontSize: 14, fontWeight: 500,
      color: active ? INK : INK_3,
      cursor: onClick ? "pointer" : "default",
      fontFamily: FONT_UI,
      transition: "color .15s, background .15s",
      position: "relative",
    }}
    onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = INK; }}
    onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = INK_3; }}
    >
      {children}
      {active && (
        <span style={{
          position: "absolute",
          left: "50%", bottom: -22,
          transform: "translateX(-50%)",
          width: 22, height: 2,
          background: BRAND_G,
          borderRadius: 2,
        }} />
      )}
    </button>
  );
}

/* ── Stat block (estilo landing) ────────────────────────────────────── */
function StatBlock({ label, value, sub, mono }: { label: string; value: string; sub?: string; mono?: boolean }) {
  return (
    <div style={{
      flex: 1, padding: "22px 28px 22px 0",
      borderRight: `1px solid ${LINE}`,
    }}>
      <div style={{
        fontFamily: mono ? FONT_MONO : FONT_SANS,
        fontWeight: 800, fontSize: mono ? 24 : 32,
        letterSpacing: "-0.025em",
        color: INK, lineHeight: 1.05,
      }}>{value}</div>
      <div style={{ marginTop: 6, fontSize: 13, color: INK_3, lineHeight: 1.4 }}>{label}</div>
      {sub && <div style={{ marginTop: 2, fontSize: 11.5, color: INK_5, fontFamily: FONT_MONO }}>{sub}</div>}
    </div>
  );
}

/* ── Account card ────────────────────────────────────────────────────── */
function AccountCard({
  account: a, selected, verifying,
  onToggle, onVerify, onDelete, onEdit, onAddTag, onRemoveTag,
}: {
  account: Account;
  selected: boolean;
  verifying: boolean;
  onToggle: () => void;
  onVerify: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onAddTag: (t: string) => void;
  onRemoveTag: (t: string) => void;
}) {
  const [addingTag, setAddingTag] = useState(false);
  const [tagInput, setTagInput] = useState("");

  const fullyOk = a.smtp_ok && a.imap_ok;
  const partial = a.smtp_ok !== a.imap_ok;
  const sentToday = a.sent_today ?? 0;
  const dailyLimit = a.daily_limit ?? 50;
  const usagePct = Math.min(100, Math.round((sentToday / Math.max(dailyLimit, 1)) * 100));

  // Iniciales para el avatar (estilo landing — chips de contacto)
  const initials = (a.first_name?.[0] || a.email[0] || "?").toUpperCase() +
                   (a.last_name?.[0] || a.email[1] || "").toUpperCase();

  return (
    <div style={{
      background: PAPER,
      border: `1px solid ${selected ? "rgba(154,105,245,0.45)" : LINE}`,
      borderRadius: 16,
      padding: "20px 22px",
      boxShadow: selected ? "0 0 0 3px rgba(154,105,245,0.10), 0 1px 2px rgba(10,13,20,0.04)" : "0 1px 2px rgba(10,13,20,0.04)",
      transition: "border-color .15s, box-shadow .15s, transform .06s",
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 18, alignItems: "center" }}>
        {/* Checkbox + avatar */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={onToggle} style={{
            width: 22, height: 22, borderRadius: "50%",
            border: `1.5px solid ${selected ? PURPLE : LINE2}`,
            background: selected ? PURPLE : "#fff",
            display: "grid", placeItems: "center",
            cursor: "pointer", padding: 0,
            transition: "all .15s",
          }}>
            {selected && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
          <div style={{
            width: 42, height: 42, borderRadius: 12,
            background: BRAND_G, color: "#fff",
            display: "grid", placeItems: "center",
            fontFamily: FONT_SANS, fontWeight: 700, fontSize: 13.5,
            letterSpacing: "-0.01em", flexShrink: 0,
            boxShadow: "0 4px 14px rgba(209,92,254,0.22)",
          }}>{initials}</div>
        </div>

        {/* Email + name */}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 600, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "-0.005em" }}>
            {a.email}
          </div>
          <div style={{ fontSize: 12.5, color: INK_4, marginTop: 3 }}>
            {a.display_name || [a.first_name, a.last_name].filter(Boolean).join(" ") || "—"}
            <span style={{ color: INK_5, marginLeft: 8, fontFamily: FONT_MONO, fontSize: 11 }}>
              · {a.provider} · {a.smtp_host}:{a.smtp_port}
            </span>
          </div>
        </div>

        {/* Status badge */}
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "5px 11px", borderRadius: 999,
          fontSize: 12.5, fontWeight: 600,
          background: fullyOk ? "rgba(31,138,91,0.10)" : partial ? "rgba(249,166,3,0.12)" : "rgba(255,51,68,0.08)",
          color: fullyOk ? GREEN : partial ? "#b97500" : "#c12530",
        }}>
          {fullyOk ? <IconCheckCircle /> : partial ? <IconAlertCircle /> : <IconXCircle />}
          {fullyOk ? "Conectada" : partial ? "Parcial" : "Error"}
        </div>
      </div>

      {/* Tags */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 14, paddingLeft: 90 }}>
        {(a.tags || []).map((t) => (
          <span key={t} style={tagChip}>
            {t}
            <button onClick={() => onRemoveTag(t)} style={{ background: "transparent", border: 0, cursor: "pointer", color: INK_4, padding: 0, marginLeft: 5, fontSize: 13 }}>×</button>
          </span>
        ))}
        {addingTag ? (
          <input
            autoFocus
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onBlur={() => { setAddingTag(false); setTagInput(""); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && tagInput.trim()) { onAddTag(tagInput.trim()); setTagInput(""); setAddingTag(false); }
              else if (e.key === "Escape") { setAddingTag(false); setTagInput(""); }
            }}
            placeholder="tag…"
            style={{ ...tagChip, border: `1px dashed ${LINE2}`, outline: "none", minWidth: 80, padding: "1px 8px" } as React.CSSProperties}
          />
        ) : (
          <button onClick={() => setAddingTag(true)} style={{ ...tagChip, border: `1px dashed ${LINE2}`, background: "transparent", cursor: "pointer" } as React.CSSProperties}>
            + tag
          </button>
        )}
      </div>

      {/* Stats row */}
      <div style={{
        display: "grid", gridTemplateColumns: "140px 1fr auto", gap: 24,
        alignItems: "center", marginTop: 16, paddingLeft: 90,
      }}>
        <div>
          <div style={miniLabel}>Enviados hoy</div>
          <div style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 20, color: INK, marginTop: 2, letterSpacing: "-0.02em" }}>
            {sentToday}<span style={{ color: INK_4, fontWeight: 500, fontSize: 14 }}>/{dailyLimit}</span>
          </div>
        </div>
        <div>
          <div style={{ ...miniLabel, marginBottom: 6 }}>Uso del día</div>
          <div style={{ height: 6, background: "#eef0f4", borderRadius: 999, overflow: "hidden" }}>
            <div style={{
              width: `${usagePct}%`, height: "100%",
              background: usagePct > 80 ? "#ef4444" : usagePct > 50 ? ORANGE : BRAND_G,
              transition: "width .3s",
            }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onEdit} style={iconBtn} title="Editar">
            <IconEdit /> Editar
          </button>
          <button
            onClick={onVerify}
            disabled={verifying}
            style={{ ...iconBtn, opacity: verifying ? 0.6 : 1, cursor: verifying ? "wait" : "pointer" }}
            title="Verificar"
          >
            <IconRefresh style={{ animation: verifying ? "spin 1s linear infinite" : "none" }} /> {verifying ? "…" : "Verificar"}
          </button>
          <button onClick={onDelete} style={{ ...iconBtn, color: "#c12530", borderColor: "rgba(255,51,68,0.25)" }} title="Eliminar">
            <IconTrash />
          </button>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        marginTop: 14, paddingTop: 12, paddingLeft: 90,
        borderTop: `1px solid ${LINE}`,
        fontSize: 11.5, color: INK_5,
        fontFamily: FONT_MONO,
      }}>
        Última verificación: {new Date(a.last_verified_at).toLocaleString("es-ES", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        {(!a.smtp_ok || !a.imap_ok) && (
          <div style={{ marginTop: 6, color: "#c12530", fontFamily: FONT_UI }}>
            {a.last_smtp_error && <div>• SMTP: {a.last_smtp_error.slice(0, 140)}</div>}
            {a.last_imap_error && <div>• IMAP: {a.last_imap_error.slice(0, 140)}</div>}
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ── Empty state ─────────────────────────────────────────────────────── */
function EmptyState({ onAdd, onCsv, onIonos, hasAccounts }: {
  onAdd: () => void; onCsv: () => void; onIonos: () => void; hasAccounts: boolean;
}) {
  return (
    <div style={{
      background: PAPER, border: `1px dashed ${LINE2}`, borderRadius: 20,
      padding: "72px 28px", textAlign: "center",
      position: "relative", overflow: "hidden",
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
          display: "grid", placeItems: "center",
          color: "#fff",
          boxShadow: "0 12px 28px rgba(209,92,254,0.28)",
        }}>
          <IconMail style={{ width: 30, height: 30 }} />
        </div>
        <h2 style={{
          fontFamily: FONT_SANS, fontWeight: 800, fontSize: 28,
          color: INK, margin: "0 0 10px",
          letterSpacing: "-0.03em", lineHeight: 1.1,
        }}>
          {hasAccounts ? <>No hay cuentas con <span style={{ fontFamily: FONT_SERIF, fontStyle: "italic", fontWeight: 400 }}>ese filtro</span></> : <>Conecta tu <span style={{ fontFamily: FONT_SERIF, fontStyle: "italic", fontWeight: 400 }}>primera</span> bandeja</>}
        </h2>
        <p style={{ margin: "0 0 28px", color: INK_3, fontSize: 16, maxWidth: 520, marginLeft: "auto", marginRight: "auto", lineHeight: 1.55 }}>
          {hasAccounts
            ? "Cambia de filtro o asigna esa etiqueta a alguna de tus cuentas."
            : "Sube un CSV, conecta varias IONOS de una tacada, o añade una a mano. Verificamos SMTP+IMAP contra los servidores reales."}
        </p>
        <div style={{ display: "inline-flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          <button onClick={onCsv} style={ghostBtn}><IconUpload /> Subir CSV</button>
          <button onClick={onIonos} style={ghostBtn}><IconGlobe /> Bulk IONOS</button>
          <button onClick={onAdd} style={brandBtn}><IconPlus /> Añadir cuenta</button>
        </div>
      </div>
    </div>
  );
}

/* ── Modals ──────────────────────────────────────────────────────────── */

function ModalShell({ title, subtitle, onClose, width = 720, children, footer }: {
  title: string; subtitle?: string; onClose: () => void; width?: number;
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
        background: PAPER, borderRadius: 20, width: "100%", maxWidth: width,
        maxHeight: "88vh", display: "flex", flexDirection: "column",
        boxShadow: "0 30px 90px rgba(10,13,20,0.22)",
        overflow: "hidden",
      }}>
        <div style={{
          padding: "22px 26px", borderBottom: `1px solid ${LINE}`,
          display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16,
        }}>
          <div>
            <h2 style={{
              margin: 0, fontFamily: FONT_SANS, fontWeight: 700,
              fontSize: 22, letterSpacing: "-0.025em", color: INK,
              lineHeight: 1.1,
            }}>{title}</h2>
            {subtitle && <p style={{ margin: "6px 0 0", color: INK_3, fontSize: 13.5, lineHeight: 1.5 }}>{subtitle}</p>}
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: 0, fontSize: 22, color: INK_4, cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
        </div>
        <div style={{ padding: 26, overflow: "auto", flex: 1 }}>{children}</div>
        {footer && (
          <div style={{
            padding: "14px 26px", borderTop: `1px solid ${LINE}`,
            display: "flex", justifyContent: "flex-end", gap: 10,
            background: SURF,
          }}>{footer}</div>
        )}
      </div>
    </div>
  );
}

function BulkCsvModal({
  onClose, onSubmit,
}: {
  onClose: () => void;
  onSubmit: (rows: CsvRow[]) => Promise<any>;
}) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<CsvRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!text) { setParsed([]); return; }
    setParsed(parseCSV(text));
  }, [text]);

  async function onFile(file: File) {
    const t = await file.text();
    setText(t);
  }

  const validCount = parsed.filter((p) => !p.__error).length;
  const errCount = parsed.length - validCount;

  return (
    <ModalShell
      title="Importar cuentas vía CSV"
      subtitle="Cabeceras compatibles: Email, First Name, Last Name, IMAP Username, IMAP Password, IMAP Host, IMAP Port, SMTP Username, SMTP Password, SMTP Host, SMTP Port, Daily Limit, Warmup Enabled, Warmup Limit, Warmup Increment."
      onClose={onClose}
      width={960}
      footer={
        <>
          <button onClick={onClose} style={ghostBtn}>Cancelar</button>
          <button
            onClick={async () => {
              setSubmitting(true);
              try { await onSubmit(parsed); } finally { setSubmitting(false); }
            }}
            disabled={submitting || validCount === 0}
            style={{ ...brandBtn, opacity: submitting || validCount === 0 ? 0.55 : 1, cursor: submitting || validCount === 0 ? "not-allowed" : "pointer" }}
          >
            {submitting ? "Verificando…" : `Verificar y conectar (${validCount})`}
          </button>
        </>
      }
    >
      <div
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={async (e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0]; if (f) await onFile(f);
        }}
        style={{
          border: `1.5px dashed ${LINE2}`,
          borderRadius: 14, padding: "26px",
          textAlign: "center", marginBottom: 18,
          background: "linear-gradient(180deg, " + SURF + ", " + PAPER + " 80%)",
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
        />
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          margin: "0 auto 14px",
          background: PAPER, border: `1px solid ${LINE}`,
          display: "grid", placeItems: "center", color: PURPLE_DEEP,
        }}>
          <IconUpload />
        </div>
        <div style={{ color: INK_2, fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
          Arrastra aquí tu archivo <code style={codeChip}>.csv</code>
        </div>
        <div style={{ color: INK_4, fontSize: 12.5, marginBottom: 14 }}>
          o púlsalo para seleccionarlo del ordenador
        </div>
        <button onClick={() => fileRef.current?.click()} style={ghostBtn}>
          Seleccionar CSV
        </button>
      </div>

      <details style={{ marginBottom: 14 }}>
        <summary style={{ cursor: "pointer", color: INK_3, fontSize: 13, fontWeight: 600 }}>
          O pega el contenido del CSV directamente
        </summary>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Email,First Name,Last Name,IMAP Username,IMAP Password,IMAP Host,IMAP Port,SMTP Username,SMTP Password,SMTP Host,SMTP Port,Daily Limit,Warmup Enabled,Warmup Limit,Warmup Increment&#10;tu@dominio.com,Xavi,Riera,tu@dominio.com,passw0rd,imap.ionos.es,993,tu@dominio.com,passw0rd,smtp.ionos.es,465,30,TRUE,50,2"
          rows={6}
          style={{
            width: "100%", marginTop: 10, padding: "12px 14px",
            background: "#fff", border: `1px solid ${LINE2}`, borderRadius: 10,
            fontFamily: FONT_MONO, fontSize: 12, color: INK_2,
            outline: "none", boxSizing: "border-box", resize: "vertical",
          }}
        />
      </details>

      {parsed.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 15, color: INK, letterSpacing: "-0.01em" }}>
              Vista previa · {parsed.length} fila{parsed.length === 1 ? "" : "s"}
            </div>
            <div style={{ fontSize: 12, color: INK_3 }}>
              <strong style={{ color: INK }}>{validCount}</strong> válidas{errCount > 0 && <>, <strong style={{ color: "#c12530" }}>{errCount}</strong> con error</>}
            </div>
          </div>
          <div style={{
            maxHeight: 320, overflow: "auto",
            border: `1px solid ${LINE}`, borderRadius: 12,
          }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead style={{ position: "sticky", top: 0, background: SURF }}>
                <tr>
                  <th style={th}>Email</th>
                  <th style={th}>Nombre</th>
                  <th style={th}>IMAP</th>
                  <th style={th}>SMTP</th>
                  <th style={th}>Daily</th>
                  <th style={th}>Warmup</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((p, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${LINE}`, background: p.__error ? "rgba(255,51,68,0.04)" : "transparent" }}>
                    <td style={td}>
                      <div style={{ fontWeight: 600, color: p.__error ? "#c12530" : INK }}>{p.email || "(vacío)"}</div>
                      {p.__error && <div style={{ color: "#c12530", fontSize: 11, marginTop: 2 }}>{p.__error}</div>}
                    </td>
                    <td style={td}>{[p.first_name, p.last_name].filter(Boolean).join(" ") || "—"}</td>
                    <td style={{ ...td, fontFamily: FONT_MONO, fontSize: 11 }}>
                      {p.imap_host ? `${p.imap_host}:${p.imap_port || 993}` : "(auto)"}
                    </td>
                    <td style={{ ...td, fontFamily: FONT_MONO, fontSize: 11 }}>
                      {p.smtp_host ? `${p.smtp_host}:${p.smtp_port || 587}` : "(auto)"}
                    </td>
                    <td style={td}>{p.daily_limit ?? "—"}</td>
                    <td style={td}>{p.warmup_enabled ? "✓" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </ModalShell>
  );
}

function BulkIonosModal({
  onClose, onSubmit,
}: {
  onClose: () => void;
  onSubmit: (rows: any[]) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const parsed = useMemo(() => {
    return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const parts = l.split(/[,;]/).map((p) => p.trim());
      const [email, password, displayName] = parts;
      const ok = email && email.includes("@") && password;
      return {
        email: (email || "").toLowerCase(),
        password: password || "",
        display_name: displayName || undefined,
        smtp_host: "smtp.ionos.es", smtp_port: 465, smtp_secure: true,
        imap_host: "imap.ionos.es", imap_port: 993, imap_secure: true,
        provider: "ionos" as const,
        __error: ok ? undefined : (!email ? "Email vacío" : "Falta password"),
      };
    });
  }, [text]);
  const validCount = parsed.filter((p) => !p.__error).length;

  return (
    <ModalShell
      title="Bulk IONOS"
      subtitle="Atajo para conectar varias cuentas IONOS — auto-rellena smtp.ionos.es:465 + imap.ionos.es:993. Una cuenta por línea: email, password."
      onClose={onClose}
      width={700}
      footer={
        <>
          <button onClick={onClose} style={ghostBtn}>Cancelar</button>
          <button
            onClick={async () => {
              setSubmitting(true);
              try {
                const rows = parsed.filter((p) => !p.__error).map(({ __error, ...rest }) => rest);
                await onSubmit(rows);
              } finally { setSubmitting(false); }
            }}
            disabled={submitting || validCount === 0}
            style={{ ...brandBtn, opacity: submitting || validCount === 0 ? 0.55 : 1, cursor: submitting || validCount === 0 ? "not-allowed" : "pointer" }}
          >
            {submitting ? "Verificando…" : `Conectar ${validCount} cuenta${validCount === 1 ? "" : "s"} IONOS`}
          </button>
        </>
      }
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"xavier@evadanlegal.com, OnePulso123%\nxavier@evadanlegal.es, OnePulso123%, Xavier Riera\n…"}
        rows={10}
        style={{
          width: "100%", padding: "14px 16px",
          background: "#fff", border: `1px solid ${LINE2}`, borderRadius: 12,
          fontFamily: FONT_MONO, fontSize: 13, color: INK_2,
          outline: "none", boxSizing: "border-box", resize: "vertical",
        }}
      />
      {parsed.length > 0 && (
        <div style={{ marginTop: 16, fontSize: 13, color: INK_3 }}>
          <strong style={{ color: INK }}>{validCount}</strong> válida{validCount === 1 ? "" : "s"} de {parsed.length}.
          Servidor: <code style={codeChip}>smtp.ionos.es:465</code> + <code style={codeChip}>imap.ionos.es:993</code>
        </div>
      )}
    </ModalShell>
  );
}

function AddAccountModal({
  onClose, onSubmit,
}: {
  onClose: () => void;
  onSubmit: (input: any) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [provider, setProvider] = useState<"auto" | "gmail" | "outlook" | "ionos" | "custom">("auto");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("");
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("");
  const [dailyLimit, setDailyLimit] = useState("50");
  const [warmup, setWarmup] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  return (
    <ModalShell
      title="Añadir cuenta"
      subtitle="Verificamos SMTP + IMAP contra el servidor real antes de guardar."
      onClose={onClose}
      width={640}
      footer={
        <>
          <button onClick={onClose} style={ghostBtn}>Cancelar</button>
          <button
            disabled={submitting || !email || !password}
            onClick={async () => {
              setSubmitting(true);
              try {
                await onSubmit({
                  email: email.toLowerCase(),
                  password,
                  first_name: firstName || undefined,
                  last_name: lastName || undefined,
                  display_name: [firstName, lastName].filter(Boolean).join(" ") || undefined,
                  provider: provider === "auto" ? undefined : provider,
                  smtp_host: smtpHost || undefined,
                  smtp_port: smtpPort ? parseInt(smtpPort) : undefined,
                  imap_host: imapHost || undefined,
                  imap_port: imapPort ? parseInt(imapPort) : undefined,
                  daily_limit: dailyLimit ? parseInt(dailyLimit) : undefined,
                  warmup_enabled: warmup,
                });
              } finally { setSubmitting(false); }
            }}
            style={{ ...brandBtn, opacity: submitting || !email || !password ? 0.55 : 1, cursor: submitting || !email || !password ? "not-allowed" : "pointer" }}
          >
            {submitting ? "Verificando…" : "Verificar y conectar"}
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} placeholder="tu@dominio.com" />
          </Field>
          <Field label="Contraseña / app password">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} placeholder="••••••••••" />
          </Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Nombre">
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} style={inputStyle} placeholder="Xavier" />
          </Field>
          <Field label="Apellido">
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} style={inputStyle} placeholder="Riera" />
          </Field>
        </div>
        <Field label="Proveedor">
          <select value={provider} onChange={(e) => {
            const p = e.target.value as any;
            setProvider(p);
            if (p === "ionos") { setSmtpHost("smtp.ionos.es"); setSmtpPort("465"); setImapHost("imap.ionos.es"); setImapPort("993"); }
            else if (p === "gmail") { setSmtpHost("smtp.gmail.com"); setSmtpPort("465"); setImapHost("imap.gmail.com"); setImapPort("993"); }
            else if (p === "outlook") { setSmtpHost("smtp.office365.com"); setSmtpPort("587"); setImapHost("outlook.office365.com"); setImapPort("993"); }
            else if (p === "auto") { setSmtpHost(""); setSmtpPort(""); setImapHost(""); setImapPort(""); }
          }} style={inputStyle}>
            <option value="auto">Auto-detectar por dominio</option>
            <option value="gmail">Gmail</option>
            <option value="outlook">Outlook / Microsoft 365</option>
            <option value="ionos">IONOS</option>
            <option value="custom">Personalizado</option>
          </select>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 2fr 1fr", gap: 10 }}>
          <Field label="SMTP host"><input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} style={inputStyle} placeholder="smtp.dominio.com" /></Field>
          <Field label="Port"><input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} style={inputStyle} placeholder="465" /></Field>
          <Field label="IMAP host"><input value={imapHost} onChange={(e) => setImapHost(e.target.value)} style={inputStyle} placeholder="imap.dominio.com" /></Field>
          <Field label="Port"><input value={imapPort} onChange={(e) => setImapPort(e.target.value)} style={inputStyle} placeholder="993" /></Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "end" }}>
          <Field label="Límite diario de envío"><input value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} style={inputStyle} placeholder="50" /></Field>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: INK_2, paddingBottom: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={warmup} onChange={(e) => setWarmup(e.target.checked)} />
            Warmup activado
          </label>
        </div>
      </div>
    </ModalShell>
  );
}

function EditAccountModal({ account, onClose, onSave }: {
  account: Account;
  onClose: () => void;
  onSave: (patch: any) => Promise<void>;
}) {
  const [firstName, setFirstName] = useState(account.first_name || "");
  const [lastName, setLastName] = useState(account.last_name || "");
  const [dailyLimit, setDailyLimit] = useState(String(account.daily_limit ?? 50));
  const [warmup, setWarmup] = useState(!!account.warmup_enabled);
  const [warmupLimit, setWarmupLimit] = useState(String(account.warmup_limit ?? 50));
  const [warmupInc, setWarmupInc] = useState(String(account.warmup_increment ?? 2));
  const [tagsText, setTagsText] = useState((account.tags || []).join(", "));
  const [saving, setSaving] = useState(false);

  return (
    <ModalShell
      title={`Editar · ${account.email}`}
      subtitle="Cambios sobre nombre, límites de envío y tags. Para cambiar credenciales hay que reconectarla."
      onClose={onClose}
      width={600}
      footer={
        <>
          <button onClick={onClose} style={ghostBtn}>Cancelar</button>
          <button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave({
                  first_name: firstName || null,
                  last_name: lastName || null,
                  display_name: [firstName, lastName].filter(Boolean).join(" ") || null,
                  daily_limit: parseInt(dailyLimit) || 50,
                  warmup_enabled: warmup,
                  warmup_limit: parseInt(warmupLimit) || 50,
                  warmup_increment: parseInt(warmupInc) || 2,
                  tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
                });
              } finally { setSaving(false); }
            }}
            style={brandBtn}
          >
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Nombre"><input value={firstName} onChange={(e) => setFirstName(e.target.value)} style={inputStyle} /></Field>
          <Field label="Apellido"><input value={lastName} onChange={(e) => setLastName(e.target.value)} style={inputStyle} /></Field>
        </div>
        <Field label="Tags (separados por comas)">
          <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} style={inputStyle} placeholder="fintech, es, warmup-on" />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <Field label="Daily limit"><input value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} style={inputStyle} /></Field>
          <Field label="Warmup limit"><input value={warmupLimit} onChange={(e) => setWarmupLimit(e.target.value)} style={inputStyle} /></Field>
          <Field label="Warmup +/día"><input value={warmupInc} onChange={(e) => setWarmupInc(e.target.value)} style={inputStyle} /></Field>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: INK_2, cursor: "pointer" }}>
          <input type="checkbox" checked={warmup} onChange={(e) => setWarmup(e.target.checked)} />
          Warmup activado
        </label>
      </div>
    </ModalShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: INK_3, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      {children}
    </label>
  );
}

/* ── Icons ──────────────────────────────────────────────────────────── */
function IconMail(p: any) { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22,6 12,13 2,6"/></svg>; }
function IconSignal()     { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>; }
function IconGlobe()      { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>; }
function IconUpload()     { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>; }
function IconPlus()       { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>; }
function IconTag(p: any)  { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>; }
function IconEdit()       { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>; }
function IconRefresh(p: any) { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>; }
function IconTrash()      { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>; }
function IconCheckCircle(){ return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>; }
function IconAlertCircle(){ return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>; }
function IconXCircle()    { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>; }

/* ── Styles ──────────────────────────────────────────────────────────── */
const inputStyle: React.CSSProperties = {
  width: "100%", height: 42, padding: "0 12px",
  background: "#fff", border: `1px solid ${LINE2}`, borderRadius: 10,
  color: INK, fontSize: 14, outline: "none", boxSizing: "border-box",
  fontFamily: FONT_UI,
};
const brandBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 7,
  height: 40, padding: "0 18px",
  borderRadius: 10, border: 0,
  background: BRAND_G, color: "#fff",
  fontWeight: 600, fontSize: 13.5, fontFamily: FONT_UI,
  cursor: "pointer",
  boxShadow: "0 1px 0 rgba(255,255,255,0.2) inset, 0 8px 24px rgba(209,92,254,0.28)",
};
const ghostBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 7,
  height: 40, padding: "0 14px",
  borderRadius: 10, border: `1px solid ${LINE2}`,
  background: PAPER, color: INK_2,
  fontWeight: 600, fontSize: 13.5, fontFamily: FONT_UI,
  cursor: "pointer",
  transition: "background .15s, border-color .15s",
};
const textBtn: React.CSSProperties = {
  background: "transparent", border: 0,
  color: INK_3, fontSize: 14, fontWeight: 500,
  fontFamily: FONT_UI, cursor: "pointer",
  padding: "0 6px",
};
const tagChip: React.CSSProperties = {
  display: "inline-flex", alignItems: "center",
  padding: "2px 10px", borderRadius: 999,
  background: SURF, color: INK_2,
  fontSize: 11.5, fontWeight: 500,
  fontFamily: FONT_UI,
  border: `1px solid ${LINE}`,
};
const tagPill = (on: boolean): React.CSSProperties => ({
  height: 30, padding: "0 14px",
  borderRadius: 999, border: 0,
  background: on ? INK : SURF,
  color: on ? "#fff" : INK_2,
  fontWeight: 600, fontSize: 12.5, fontFamily: FONT_UI,
  cursor: "pointer",
});
const iconBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 5,
  height: 32, padding: "0 11px",
  borderRadius: 8, border: `1px solid ${LINE2}`,
  background: "#fff", color: INK_2,
  fontWeight: 500, fontSize: 12.5, fontFamily: FONT_UI,
  cursor: "pointer",
};
const eyebrow: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8,
  padding: "6px 12px 6px 8px",
  background: PAPER, border: `1px solid ${LINE}`, borderRadius: 999,
  fontSize: 12.5, fontWeight: 600, color: INK_2,
  fontFamily: FONT_UI,
};
const eyebrowSm: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "5px 10px 5px 8px",
  background: PAPER, border: `1px solid ${LINE}`, borderRadius: 999,
  fontSize: 11.5, fontWeight: 600, color: INK_3,
  fontFamily: FONT_UI,
};
const dot: React.CSSProperties = {
  width: 6, height: 6, borderRadius: "50%", background: GREEN,
  boxShadow: "0 0 0 4px rgba(31,138,91,0.18)",
};
const dotPulse: React.CSSProperties = {
  width: 6, height: 6, borderRadius: "50%", background: GREEN,
  boxShadow: "0 0 0 3px rgba(31,138,91,0.16)",
};
const miniLabel: React.CSSProperties = {
  fontSize: 10.5, color: INK_4, fontWeight: 600,
  textTransform: "uppercase", letterSpacing: "0.06em",
  fontFamily: FONT_UI,
};
const th: React.CSSProperties = {
  textAlign: "left", padding: "10px 12px",
  fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.06em",
  color: INK_4, fontWeight: 700, fontFamily: FONT_UI,
};
const td: React.CSSProperties = { padding: "10px 12px", verticalAlign: "top", color: INK_2 };
const codeChip: React.CSSProperties = {
  fontFamily: FONT_MONO, fontSize: 11,
  background: "#fff", border: `1px solid ${LINE}`,
  padding: "1px 6px", borderRadius: 5, color: INK_2,
};
