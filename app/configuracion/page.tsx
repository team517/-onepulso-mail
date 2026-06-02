"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BG, INK, INK_2, INK_3, INK_4, INK_5, LINE, LINE2, PAPER, SURF, SURF_2,
  BRAND_G, GREEN, ORANGE, PURPLE, PURPLE_DEEP,
  FONT_SANS, FONT_UI, FONT_MONO, FONT_SERIF,
  TopNav, BrandFonts, useToast, Eyebrow,
  brandBtn, ghostBtn, inputStyle,
} from "../email-campaigns/_shell";

type SafeUser = {
  id: string;
  email: string;
  name?: string;
  role: "admin" | "user";
  created_at: string;
  last_login_at?: string | null;
  has_password: true;
};

type Settings = {
  default_session_days: number;
  max_session_days: number;
};

type Tab = "session" | "users";

export default function ConfiguracionPage() {
  const router = useRouter();
  const { show: showToast, ToastNode } = useToast();
  const [tab, setTab] = useState<Tab>("session");

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/landing");
  }

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: FONT_UI, color: INK_2 }}>
      <BrandFonts />
      <TopNav activeKey="config" onLogout={logout} toast={showToast} />

      {/* HERO */}
      <section style={{ position: "relative", overflow: "hidden", padding: "56px 0 24px" }}>
        <div style={{
          position: "absolute", top: -100, right: -120, width: 460, height: 460, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(154,105,245,0.10), transparent 60%)", filter: "blur(80px)", pointerEvents: "none",
        }} />
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 28px", position: "relative", zIndex: 1 }}>
          <Eyebrow color={PURPLE}>Ajustes de la plataforma</Eyebrow>
          <h1 style={{
            margin: "20px 0 0",
            fontFamily: FONT_SANS, fontWeight: 800,
            fontSize: "clamp(36px, 4.5vw, 56px)", letterSpacing: "-0.035em",
            lineHeight: 1.02, color: INK,
          }}>
            Configuración <span style={{ fontFamily: FONT_SERIF, fontWeight: 400, fontStyle: "italic" }}>de</span>{" "}
            <span style={{ background: BRAND_G, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>tu cuenta.</span>
          </h1>
        </div>
      </section>

      {/* Tabs */}
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: "0 28px" }}>
        <div style={{ display: "flex", gap: 2, borderBottom: `1px solid ${LINE}`, marginBottom: 24 }}>
          <TabBtn id="session" active={tab === "session"} onClick={() => setTab("session")} label="Sesión" icon={<IconClock />} />
          <TabBtn id="users" active={tab === "users"} onClick={() => setTab("users")} label="Usuarios" icon={<IconUsers />} />
        </div>
      </section>

      <section style={{ maxWidth: 1100, margin: "0 auto", padding: "0 28px 80px" }}>
        {tab === "session" && <SessionTab toast={showToast} />}
        {tab === "users" && <UsersTab toast={showToast} />}
      </section>

      {ToastNode}
    </div>
  );
}

function TabBtn({ active, onClick, label, icon }: { id: string; active: boolean; onClick: () => void; label: string; icon: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      padding: "12px 18px", marginBottom: -1,
      border: 0, background: "transparent",
      borderBottom: active ? `2.5px solid ${INK}` : "2.5px solid transparent",
      color: active ? INK : INK_3,
      fontFamily: FONT_UI, fontWeight: 600, fontSize: 14,
      cursor: "pointer",
    }}>
      {icon}
      {label}
    </button>
  );
}

/* ── Tab: SESIÓN ──────────────────────────────────────────────────────── */
function SessionTab({ toast }: { toast: (s: string) => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [defaultDays, setDefaultDays] = useState(7);
  const [maxDays, setMaxDays] = useState(90);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((j) => {
        setSettings(j.settings);
        setDefaultDays(j.settings.default_session_days);
        setMaxDays(j.settings.max_session_days);
      })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const r = await fetch("/api/settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default_session_days: defaultDays, max_session_days: maxDays }),
      });
      const j = await r.json();
      if (j.ok) {
        setSettings(j.settings);
        toast("✓ Ajustes guardados");
      }
    } finally { setSaving(false); }
  }

  if (loading) return <div style={{ color: INK_4 }}>Cargando…</div>;
  const dirty = settings && (defaultDays !== settings.default_session_days || maxDays !== settings.max_session_days);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Default session days */}
      <div style={cardStyle}>
        <h3 style={cardTitle}>Duración de la sesión por defecto</h3>
        <p style={{ fontSize: 13.5, color: INK_3, margin: "0 0 14px" }}>
          Cuántos días dura el login antes de pedirte iniciar sesión otra vez. El usuario puede elegir un valor distinto en el login, hasta el máximo de abajo.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <label>
            <div style={miniLabel}>Por defecto (días)</div>
            <select value={defaultDays} onChange={(e) => setDefaultDays(parseInt(e.target.value))} style={inputStyle}>
              <option value="1">1 día</option>
              <option value="3">3 días</option>
              <option value="7">7 días</option>
              <option value="14">14 días</option>
              <option value="30">30 días</option>
              <option value="60">60 días</option>
              <option value="90">90 días (3 meses)</option>
              <option value="180">180 días (6 meses)</option>
              <option value="365">365 días (1 año)</option>
            </select>
          </label>
          <label>
            <div style={miniLabel}>Máximo permitido</div>
            <select value={maxDays} onChange={(e) => setMaxDays(parseInt(e.target.value))} style={inputStyle}>
              <option value="7">7 días</option>
              <option value="30">30 días</option>
              <option value="90">90 días</option>
              <option value="180">180 días</option>
              <option value="365">365 días</option>
            </select>
          </label>
        </div>
        <div style={{ marginTop: 12, fontSize: 11.5, color: INK_4, fontFamily: FONT_MONO }}>
          Actual: {settings!.default_session_days}d default · {settings!.max_session_days}d máx
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={save} disabled={saving || !dirty} style={{ ...brandBtn, opacity: saving || !dirty ? 0.55 : 1 }}>
          {saving ? "Guardando…" : "Guardar ajustes"}
        </button>
      </div>

      {/* Cambiar tu propia contraseña */}
      <ChangeMyPasswordCard toast={toast} />
    </div>
  );
}

function ChangeMyPasswordCard({ toast }: { toast: (s: string) => void }) {
  const [email, setEmail] = useState("");
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!email) { toast("Pon el email del usuario"); return; }
    if (newPwd.length < 6) { toast("Mínimo 6 caracteres"); return; }
    if (newPwd !== confirmPwd) { toast("Las contraseñas no coinciden"); return; }
    setSaving(true);
    try {
      // 1. Buscar el usuario por email
      const ulist = await (await fetch("/api/users")).json();
      const u = (ulist.users || []).find((x: SafeUser) => x.email.toLowerCase() === email.trim().toLowerCase());
      if (!u) { toast("No hay un usuario con ese email — créalo en la tab Usuarios"); setSaving(false); return; }
      // 2. Validar contraseña actual mediante intento de login
      const verify = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: currentPwd, remember: 1 }) });
      if (!verify.ok) { toast("Contraseña actual incorrecta"); setSaving(false); return; }
      // 3. Cambiar password
      const r = await fetch(`/api/users/${u.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: newPwd }) });
      const j = await r.json();
      if (j.ok) {
        toast("✓ Contraseña cambiada");
        setCurrentPwd(""); setNewPwd(""); setConfirmPwd("");
      } else {
        toast(j.error || "Error");
      }
    } finally { setSaving(false); }
  }

  return (
    <div style={cardStyle}>
      <h3 style={cardTitle}>Cambiar contraseña</h3>
      <p style={{ fontSize: 13.5, color: INK_3, margin: "0 0 14px" }}>
        Cambia la contraseña de tu cuenta. Requiere la actual para confirmar.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <label>
          <div style={miniLabel}>Tu email</div>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="tu@email.com" style={inputStyle} />
        </label>
        <label>
          <div style={miniLabel}>Contraseña actual</div>
          <input value={currentPwd} onChange={(e) => setCurrentPwd(e.target.value)} type="password" style={inputStyle} />
        </label>
        <label>
          <div style={miniLabel}>Nueva contraseña</div>
          <input value={newPwd} onChange={(e) => setNewPwd(e.target.value)} type="password" placeholder="mínimo 6 caracteres" style={inputStyle} />
        </label>
        <label>
          <div style={miniLabel}>Confirma la nueva</div>
          <input value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} type="password" style={inputStyle} />
        </label>
      </div>
      <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
        <button onClick={save} disabled={saving} style={{ ...brandBtn, opacity: saving ? 0.55 : 1 }}>
          {saving ? "Cambiando…" : "Cambiar contraseña"}
        </button>
      </div>
    </div>
  );
}

/* ── Tab: USUARIOS ────────────────────────────────────────────────────── */
function UsersTab({ toast }: { toast: (s: string) => void }) {
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/users");
      const j = await r.json();
      setUsers(j.users || []);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function remove(u: SafeUser) {
    if (!confirm(`¿Eliminar el usuario ${u.email}? No podrá volver a iniciar sesión.`)) return;
    await fetch(`/api/users/${u.id}`, { method: "DELETE" });
    setUsers((arr) => arr.filter((x) => x.id !== u.id));
    toast("✓ Usuario eliminado");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h3 style={{ ...cardTitle, margin: 0 }}>Usuarios de la plataforma</h3>
          <p style={{ fontSize: 13, color: INK_3, margin: "4px 0 0" }}>
            Cada usuario tiene su propio login pero todos comparten los mismos datos (cuentas, campañas, bandejas).
            El admin original viene de las env vars <code style={{ background: SURF, padding: "1px 5px", borderRadius: 4, fontFamily: FONT_MONO, fontSize: 11.5 }}>AUTH_EMAIL</code> / <code style={{ background: SURF, padding: "1px 5px", borderRadius: 4, fontFamily: FONT_MONO, fontSize: 11.5 }}>AUTH_PASSWORD</code>.
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} style={brandBtn}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nuevo usuario
        </button>
      </div>

      {loading ? (
        <div style={{ color: INK_4 }}>Cargando…</div>
      ) : users.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", padding: "40px 24px" }}>
          <p style={{ fontSize: 14, color: INK_3, margin: "0 0 14px" }}>
            Aún no has creado ningún usuario. El admin original puede entrar con AUTH_EMAIL/AUTH_PASSWORD.
          </p>
          <button onClick={() => setShowCreate(true)} style={brandBtn}>+ Crear primer usuario</button>
        </div>
      ) : (
        <div style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: 14, overflow: "hidden" }}>
          {users.map((u, i) => (
            <div key={u.id} style={{
              display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 14, alignItems: "center",
              padding: "14px 18px", borderTop: i === 0 ? "none" : `1px solid ${LINE}`,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: BRAND_G, color: "#fff",
                display: "grid", placeItems: "center",
                fontFamily: FONT_SANS, fontWeight: 700, fontSize: 13,
              }}>{u.email.slice(0, 2).toUpperCase()}</div>
              <div>
                <div style={{ fontWeight: 600, color: INK, fontSize: 14 }}>{u.name || u.email}</div>
                <div style={{ fontSize: 12, color: INK_4, marginTop: 2, fontFamily: FONT_MONO }}>
                  {u.email}{u.last_login_at && ` · último login ${new Date(u.last_login_at).toLocaleDateString("es-ES")}`}
                </div>
              </div>
              <span style={{
                padding: "3px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                background: u.role === "admin" ? "rgba(154,105,245,0.12)" : SURF_2,
                color: u.role === "admin" ? PURPLE_DEEP : INK_3,
                textTransform: "uppercase", letterSpacing: "0.05em",
              }}>{u.role}</span>
              <button onClick={() => remove(u)} style={{ ...ghostBtn, height: 32, fontSize: 12, color: "#c12530", borderColor: "rgba(255,51,68,0.25)" }}>
                Eliminar
              </button>
            </div>
          ))}
        </div>
      )}

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} onCreated={(u) => { setUsers((arr) => [u, ...arr]); toast(`✓ Usuario ${u.email} creado`); }} />}
    </div>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: (u: SafeUser) => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setError("");
    setSaving(true);
    try {
      const r = await fetch("/api/users", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name: name || undefined, role }),
      });
      const j = await r.json();
      if (j.ok) {
        onCreated(j.user);
        onClose();
      } else {
        setError(j.error || "Error");
      }
    } finally { setSaving(false); }
  }

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(10,13,20,0.42)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 24,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: PAPER, borderRadius: 18, width: "100%", maxWidth: 480,
        boxShadow: "0 30px 90px rgba(10,13,20,0.22)", overflow: "hidden",
      }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${LINE}` }}>
          <h2 style={{ margin: 0, fontFamily: FONT_SANS, fontWeight: 700, fontSize: 20, letterSpacing: "-0.02em", color: INK }}>
            Crear usuario
          </h2>
        </div>
        <div style={{ padding: 24, display: "grid", gap: 12 }}>
          <label>
            <div style={miniLabel}>Email</div>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="usuario@dominio.com" style={inputStyle} autoFocus />
          </label>
          <label>
            <div style={miniLabel}>Nombre (opcional)</div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Juan García" style={inputStyle} />
          </label>
          <label>
            <div style={miniLabel}>Contraseña</div>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="mínimo 6 caracteres" style={inputStyle} />
          </label>
          <label>
            <div style={miniLabel}>Rol</div>
            <select value={role} onChange={(e) => setRole(e.target.value as any)} style={inputStyle}>
              <option value="user">User (puede usar la plataforma)</option>
              <option value="admin">Admin (también puede crear/eliminar usuarios)</option>
            </select>
          </label>
          {error && <div style={{ color: "#c12530", fontSize: 13 }}>{error}</div>}
        </div>
        <div style={{ padding: "14px 24px", borderTop: `1px solid ${LINE}`, display: "flex", gap: 10, justifyContent: "flex-end", background: SURF }}>
          <button onClick={onClose} style={ghostBtn}>Cancelar</button>
          <button onClick={submit} disabled={saving || !email || password.length < 6} style={{ ...brandBtn, opacity: saving || !email || password.length < 6 ? 0.55 : 1 }}>
            {saving ? "Creando…" : "Crear usuario"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Icons + styles ──────────────────────────────────────────────────── */
function IconClock() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>; }
function IconUsers() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>; }

const cardStyle: React.CSSProperties = {
  background: PAPER, border: `1px solid ${LINE}`, borderRadius: 14,
  padding: 20, boxShadow: "0 1px 2px rgba(10,13,20,0.04)",
};
const cardTitle: React.CSSProperties = {
  margin: 0, fontFamily: FONT_SANS, fontWeight: 700, fontSize: 16,
  letterSpacing: "-0.015em", color: INK,
};
const miniLabel: React.CSSProperties = {
  fontSize: 11, color: INK_3, fontWeight: 600,
  textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6,
};
