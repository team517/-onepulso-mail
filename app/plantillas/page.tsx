"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BG, INK, INK_2, INK_3, INK_4, INK_5, LINE, LINE2, PAPER, SURF, SURF_2,
  BRAND_G, GREEN, ORANGE, PURPLE, PURPLE_DEEP,
  FONT_SANS, FONT_UI, FONT_MONO, FONT_SERIF,
  TopNav, BrandFonts, useToast, Eyebrow,
  brandBtn, ghostBtn, inputStyle,
} from "../email-campaigns/_shell";

type Template = {
  id: string;
  name: string;
  category?: string;
  subject: string;
  body: string;
  tags?: string[];
  created_at: string;
  updated_at: string;
  used_count: number;
  last_used_at?: string | null;
};

export default function PlantillasPage() {
  const router = useRouter();
  const { show: showToast, ToastNode } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Template | null>(null);
  const [editing, setEditing] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/email-templates");
      const j = await r.json();
      setTemplates(j.templates || []);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    const r = await fetch("/api/email-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Nueva plantilla", subject: "", body: "" }),
    });
    const j = await r.json();
    if (j.ok) {
      setTemplates((arr) => [j.template, ...arr]);
      setSelected(j.template);
      setEditing(true);
    }
  }

  async function save(patch: Partial<Template>) {
    if (!selected) return;
    const r = await fetch(`/api/email-templates/${selected.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const j = await r.json();
    if (j.ok) {
      setTemplates((arr) => arr.map((t) => t.id === j.template.id ? j.template : t));
      setSelected(j.template);
    }
  }

  async function remove(id: string) {
    if (!confirm("¿Eliminar esta plantilla?")) return;
    setTemplates((arr) => arr.filter((t) => t.id !== id));
    if (selected?.id === id) setSelected(null);
    await fetch(`/api/email-templates/${id}`, { method: "DELETE" });
    showToast("✓ Plantilla eliminada");
  }

  async function duplicate(t: Template) {
    const r = await fetch("/api/email-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${t.name} (copia)`, category: t.category,
        subject: t.subject, body: t.body, tags: t.tags,
      }),
    });
    const j = await r.json();
    if (j.ok) {
      setTemplates((arr) => [j.template, ...arr]);
      showToast("✓ Plantilla duplicada");
    }
  }

  const filtered = useMemo(() => {
    if (!search) return templates;
    const q = search.toLowerCase();
    return templates.filter((t) =>
      t.name.toLowerCase().includes(q) ||
      t.subject.toLowerCase().includes(q) ||
      t.body.toLowerCase().includes(q) ||
      (t.category || "").toLowerCase().includes(q)
    );
  }, [templates, search]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/landing");
  }

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: FONT_UI, color: INK_2 }}>
      <BrandFonts />
      <TopNav activeKey="plantillas" onLogout={logout} toast={showToast} />

      {/* HERO */}
      <section style={{ position: "relative", overflow: "hidden", padding: "56px 0 24px" }}>
        <div style={{
          position: "absolute", top: -100, right: -120, width: 460, height: 460, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(249,166,3,0.14), transparent 60%)", filter: "blur(80px)", pointerEvents: "none",
        }} />
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "0 28px", position: "relative", zIndex: 1 }}>
          <Eyebrow color={ORANGE}>{templates.length} plantilla{templates.length === 1 ? "" : "s"}</Eyebrow>
          <h1 style={{
            margin: "20px 0 0",
            fontFamily: FONT_SANS, fontWeight: 800,
            fontSize: "clamp(36px, 4.5vw, 56px)", letterSpacing: "-0.035em",
            lineHeight: 1.02, color: INK,
          }}>
            Plantillas <span style={{ fontFamily: FONT_SERIF, fontWeight: 400, fontStyle: "italic" }}>que</span>{" "}
            <span style={{ background: BRAND_G, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>reutilizas.</span>
          </h1>
          <p style={{ margin: "16px 0 0", maxWidth: 620, fontSize: 16, lineHeight: 1.55, color: INK_3 }}>
            Asunto + cuerpo guardados con variables (<code style={{ fontFamily: FONT_MONO, background: SURF, padding: "1px 6px", borderRadius: 4 }}>{"{{first_name}}"}</code>) y spintax. Aplícalas a cualquier paso de campaña con un click.
          </p>
        </div>
      </section>

      <section style={{ maxWidth: 1240, margin: "0 auto", padding: "12px 28px 0" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          background: PAPER, border: `1px solid ${LINE}`, borderRadius: 16,
          padding: "12px 16px", boxShadow: "0 1px 2px rgba(10,13,20,0.04)",
        }}>
          <div style={{ position: "relative", flex: 1, minWidth: 220, maxWidth: 360 }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nombre, asunto, cuerpo o categoría…" style={{ ...inputStyle, paddingLeft: 36 }} />
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={INK_4} strokeWidth="2" style={{ position: "absolute", left: 11, top: 14 }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <button onClick={create} style={brandBtn}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Nueva plantilla
            </button>
          </div>
        </div>
      </section>

      <section style={{
        maxWidth: 1240, margin: "0 auto", padding: "20px 28px 80px",
        display: "grid", gridTemplateColumns: "minmax(360px, 420px) 1fr", gap: 18,
        alignItems: "start",
      }}>
        {/* LIST */}
        <div style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: 14, overflow: "hidden", minHeight: 400 }}>
          {loading ? (
            <div style={{ padding: 40, color: INK_4 }}>Cargando…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "60px 24px", textAlign: "center" }}>
              <div style={{ width: 56, height: 56, borderRadius: 16, background: SURF, margin: "0 auto 16px", display: "grid", placeItems: "center", color: ORANGE }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              </div>
              <div style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 18, color: INK, marginBottom: 6 }}>
                {templates.length === 0 ? "Sin plantillas todavía" : "Sin resultados"}
              </div>
              <p style={{ fontSize: 13.5, color: INK_3, margin: "0 0 18px" }}>
                {templates.length === 0
                  ? "Crea tu primera plantilla y reutilízala en cualquier campaña."
                  : "Cambia la búsqueda."}
              </p>
              {templates.length === 0 && (
                <button onClick={create} style={brandBtn}>+ Nueva plantilla</button>
              )}
            </div>
          ) : (
            <div style={{ maxHeight: "calc(100vh - 320px)", overflow: "auto" }}>
              {filtered.map((t) => {
                const isActive = selected?.id === t.id;
                return (
                  <div
                    key={t.id}
                    onClick={() => { setSelected(t); setEditing(false); }}
                    style={{
                      padding: "14px 18px",
                      borderBottom: `1px solid ${LINE}`,
                      cursor: "pointer",
                      background: isActive ? "rgba(154,105,245,0.06)" : "#fff",
                      borderLeft: isActive ? `3px solid ${PURPLE}` : "3px solid transparent",
                      transition: "background .12s",
                    }}
                    onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = SURF; }}
                    onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "#fff"; }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 14, color: INK, letterSpacing: "-0.01em", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t.name}
                      </div>
                      {t.category && (
                        <span style={{
                          padding: "2px 8px", borderRadius: 999,
                          background: SURF, color: PURPLE_DEEP, fontSize: 10.5, fontWeight: 600, fontFamily: FONT_UI,
                        }}>{t.category}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12.5, color: INK_2, marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.subject || <span style={{ color: INK_5, fontStyle: "italic" }}>(sin asunto)</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: INK_4, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.body.replace(/\s+/g, " ").slice(0, 100) || <span style={{ fontStyle: "italic" }}>(sin cuerpo)</span>}
                    </div>
                    <div style={{ fontSize: 10.5, color: INK_5, marginTop: 6, fontFamily: FONT_MONO, display: "flex", gap: 10 }}>
                      <span>{t.used_count} usos</span>
                      <span>· editada {new Date(t.updated_at).toLocaleDateString("es-ES")}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* DETAIL / EDITOR */}
        <div style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: 14, padding: 24, minHeight: 400 }}>
          {!selected ? (
            <div style={{ textAlign: "center", padding: "80px 20px", color: INK_4 }}>
              <div style={{ width: 56, height: 56, borderRadius: 16, background: SURF, margin: "0 auto 16px", display: "grid", placeItems: "center", color: ORANGE }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              </div>
              <div style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 18, color: INK, marginBottom: 6 }}>
                Selecciona una plantilla
              </div>
              <p style={{ fontSize: 13.5, color: INK_3, margin: 0 }}>
                O crea una nueva con el botón arriba a la derecha.
              </p>
            </div>
          ) : (
            <TemplateEditor
              template={selected}
              editing={editing}
              setEditing={setEditing}
              onSave={save}
              onDelete={() => remove(selected.id)}
              onDuplicate={() => duplicate(selected)}
              toast={showToast}
            />
          )}
        </div>
      </section>

      {ToastNode}
    </div>
  );
}

function TemplateEditor({ template, editing, setEditing, onSave, onDelete, onDuplicate, toast }: {
  template: Template; editing: boolean; setEditing: (v: boolean) => void;
  onSave: (p: Partial<Template>) => Promise<void>;
  onDelete: () => Promise<void>;
  onDuplicate: () => Promise<void>;
  toast: (s: string) => void;
}) {
  const [name, setName] = useState(template.name);
  const [category, setCategory] = useState(template.category || "");
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [tagsText, setTagsText] = useState((template.tags || []).join(", "));
  const [saving, setSaving] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [lastFocused, setLastFocused] = useState<"subject" | "body">("subject");

  // Re-sincronizar cuando cambias de plantilla
  useEffect(() => {
    setName(template.name);
    setCategory(template.category || "");
    setSubject(template.subject);
    setBody(template.body);
    setTagsText((template.tags || []).join(", "));
  }, [template.id]);

  const dirty =
    name !== template.name ||
    category !== (template.category || "") ||
    subject !== template.subject ||
    body !== template.body ||
    tagsText !== (template.tags || []).join(", ");

  async function save() {
    setSaving(true);
    try {
      await onSave({
        name, category: category || undefined,
        subject, body,
        tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
      });
      setEditing(false);
      toast("✓ Guardada");
    } finally { setSaving(false); }
  }

  function insertAtCursor(text: string) {
    const ref = lastFocused === "subject" ? subjectRef : bodyRef;
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const v = el.value.slice(0, start) + text + el.value.slice(end);
    if (lastFocused === "subject") setSubject(v); else setBody(v);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + text.length;
      try { el.setSelectionRange(pos, pos); } catch {}
    });
  }

  const commonVars = ["first_name", "last_name", "company_name", "industry", "city", "job_title", "company_short_description"];

  if (!editing) {
    // Vista de solo lectura
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontFamily: FONT_SANS, fontWeight: 700, fontSize: 22, letterSpacing: "-0.025em", color: INK }}>
            {template.name}
          </h2>
          {template.category && (
            <span style={{ padding: "3px 10px", borderRadius: 999, background: SURF, color: PURPLE_DEEP, fontSize: 11, fontWeight: 600 }}>{template.category}</span>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button onClick={() => setEditing(true)} style={brandBtn}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Editar
            </button>
            <button onClick={onDuplicate} style={ghostBtn}>Duplicar</button>
            <button onClick={onDelete} style={{ ...ghostBtn, color: "#c12530", borderColor: "rgba(255,51,68,0.25)" }}>Eliminar</button>
          </div>
        </div>

        <div style={{ padding: "10px 14px", background: SURF, borderRadius: 8, fontSize: 12.5, color: INK_3, marginBottom: 14 }}>
          <strong style={{ color: INK_2 }}>Asunto:</strong> {template.subject || <span style={{ color: INK_5 }}>(vacío)</span>}
        </div>

        <pre style={{
          whiteSpace: "pre-wrap", wordBreak: "break-word",
          fontFamily: FONT_UI, fontSize: 14, lineHeight: 1.55, color: INK_2,
          margin: 0, padding: "14px 16px", background: "#fff", border: `1px solid ${LINE}`, borderRadius: 8,
          minHeight: 160,
        }}>
          {template.body || <span style={{ color: INK_5, fontStyle: "italic" }}>(sin cuerpo)</span>}
        </pre>

        {(template.tags || []).length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
            {(template.tags || []).map((t) => (
              <span key={t} style={{
                padding: "2px 9px", borderRadius: 999, background: SURF, color: INK_2,
                border: `1px solid ${LINE}`, fontSize: 11.5, fontWeight: 500,
              }}>{t}</span>
            ))}
          </div>
        )}

        <div style={{ marginTop: 18, fontSize: 11.5, color: INK_5, fontFamily: FONT_MONO }}>
          {template.used_count} usos · creada {new Date(template.created_at).toLocaleDateString("es-ES")} · editada {new Date(template.updated_at).toLocaleString("es-ES")}
        </div>
      </div>
    );
  }

  // Editor
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontFamily: FONT_SANS, fontWeight: 700, fontSize: 18, letterSpacing: "-0.02em", color: INK }}>
          Editando plantilla
        </h2>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={() => setEditing(false)} style={ghostBtn}>Cancelar</button>
          <button onClick={save} disabled={saving || !dirty} style={{ ...brandBtn, opacity: saving || !dirty ? 0.55 : 1 }}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 12 }}>
        <label>
          <div style={miniLabel}>Nombre</div>
          <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="Ej: Intro · FinTech ES" />
        </label>
        <label>
          <div style={miniLabel}>Categoría (opcional)</div>
          <input value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle} placeholder="intro, follow-up, breakup…" />
        </label>
      </div>

      <label style={{ display: "block", marginBottom: 12 }}>
        <div style={{ ...miniLabel, display: "flex", gap: 6, alignItems: "center" }}>
          Asunto
          {lastFocused === "subject" && <span style={activeBadge}>ACTIVO</span>}
        </div>
        <input
          ref={subjectRef}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onFocus={() => setLastFocused("subject")}
          placeholder="{Hola|Hey} {{first_name}}, sobre {{company_name}}"
          style={{ ...inputStyle, border: lastFocused === "subject" ? `1.5px solid ${PURPLE}` : `1px solid ${LINE2}` }}
        />
      </label>

      <label style={{ display: "block", marginBottom: 12 }}>
        <div style={{ ...miniLabel, display: "flex", gap: 6, alignItems: "center" }}>
          Cuerpo
          {lastFocused === "body" && <span style={activeBadge}>ACTIVO</span>}
        </div>
        <textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onFocus={() => setLastFocused("body")}
          rows={12}
          placeholder={"Hola {{first_name}},\n\nVi que en {{company_name}} sois {{job_title|equipo}}. {Quería|Quería preguntarte} si tendríamos sentido una llamada esta semana.\n\nUn saludo,"}
          style={{
            ...inputStyle, height: "auto", padding: "12px 14px",
            fontFamily: FONT_UI, fontSize: 14, lineHeight: 1.6, resize: "vertical",
            border: lastFocused === "body" ? `1.5px solid ${PURPLE}` : `1px solid ${LINE2}`,
          }}
        />
      </label>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 11.5, color: INK_4, fontWeight: 600, marginRight: 4 }}>
          Insertar en <strong style={{ color: PURPLE_DEEP }}>{lastFocused === "subject" ? "Asunto" : "Cuerpo"}</strong>:
        </span>
        {commonVars.map((v) => (
          <button key={v} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertAtCursor(`{{${v}}}`)} style={chipBtn(SURF, PURPLE_DEEP)}>
            {"{{"}{v}{"}}"}
          </button>
        ))}
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertAtCursor("{Hola|Hey|Buenas}")} style={chipBtn("rgba(249,166,3,0.12)", "#b97500")}>
          {"{spintax}"}
        </button>
      </div>

      <label style={{ display: "block", marginBottom: 12 }}>
        <div style={miniLabel}>Tags (separados por comas)</div>
        <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} style={inputStyle} placeholder="fintech, q2, ronda-a" />
      </label>
    </div>
  );
}

const miniLabel: React.CSSProperties = {
  fontSize: 11, color: INK_3, fontWeight: 600,
  textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6,
};
const activeBadge: React.CSSProperties = {
  background: "rgba(154,105,245,0.12)", color: PURPLE_DEEP,
  padding: "1px 7px", borderRadius: 999, fontSize: 9.5, fontWeight: 700,
};
const chipBtn = (bg: string, fg: string): React.CSSProperties => ({
  padding: "3px 9px", borderRadius: 6,
  background: bg, color: fg,
  border: `1px solid ${LINE}`, fontFamily: FONT_MONO, fontSize: 11.5, fontWeight: 600,
  cursor: "pointer",
});
