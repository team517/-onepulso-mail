"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

/* Brand tokens compartidos por la plataforma de email (light, brand gradient). */
export const INK   = "#0a0d14";
export const INK_2 = "#23252c";
export const INK_3 = "#54565b";
export const INK_4 = "#848689";
export const INK_5 = "#b6b6b9";
export const LINE  = "#ececef";
export const LINE2 = "#e0e0e3";
export const BG    = "#fafbfc";
export const PAPER = "#ffffff";
export const SURF  = "#f5f9fe";
export const SURF_2= "#f3f3f3";
export const GREEN = "#1f8a5b";
export const ORANGE= "#f9a603";
export const PURPLE= "#9a69f5";
export const PURPLE_DEEP = "#7e3eda";
export const BLUE  = "#0566ea";
export const DANGER= "#ff3344";
export const BRAND_G = "linear-gradient(112deg, #f9a603 0%, #f59e3a 22%, #ea7fd3 55%, #b18bf8 78%, #9a69f5 100%)";

export const FONT_SANS  = "'Plus Jakarta Sans', system-ui, sans-serif";
export const FONT_UI    = "'Inter', system-ui, -apple-system, sans-serif";
export const FONT_MONO  = "'JetBrains Mono', ui-monospace, monospace";
export const FONT_SERIF = "'Instrument Serif', serif";

/* Top nav común — idéntico al de /connect-accounts. Plataforma independiente. */
export function TopNav({ activeKey, onLogout, toast: showToast }: {
  activeKey: "cuentas" | "campanas" | "bandejas" | "plantillas" | "logs" | "config";
  onLogout: () => void;
  toast?: (s: string) => void;
}) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const router = useRouter();
  const placeholder = (label: string) => () => {
    if (showToast) showToast(`${label} · próximamente`);
  };

  return (
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
          <NavLink active={activeKey === "cuentas"}    onClick={() => router.push("/connect-accounts")}>Cuentas</NavLink>
          <NavLink active={activeKey === "campanas"}   onClick={() => router.push("/email-campaigns")}>Campañas</NavLink>
          <NavLink active={activeKey === "bandejas"}   onClick={() => router.push("/bandejas")}>Bandejas</NavLink>
          <NavLink active={activeKey === "plantillas"} onClick={placeholder("Plantillas")}>Plantillas</NavLink>
          <NavLink active={activeKey === "logs"}       onClick={placeholder("Logs")}>Logs</NavLink>
          <NavLink active={activeKey === "config"}     onClick={placeholder("Configuración")}>Configuración</NavLink>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={onLogout} style={{
            background: "transparent", border: 0, color: INK_3, fontSize: 14,
            fontWeight: 500, fontFamily: FONT_UI, cursor: "pointer", padding: "0 6px",
          }}>
            Cerrar sesión
          </button>
        </div>
      </div>
    </nav>
  );
}

function NavLink({ children, active, onClick }: { children: React.ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: "8px 14px", borderRadius: 8,
      border: 0, background: "transparent",
      fontSize: 14, fontWeight: 500,
      color: active ? INK : INK_3,
      cursor: "pointer", fontFamily: FONT_UI,
      transition: "color .15s",
      position: "relative",
    }}
    onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = INK; }}
    onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = INK_3; }}
    >
      {children}
      {active && (
        <span style={{
          position: "absolute", left: "50%", bottom: -22, transform: "translateX(-50%)",
          width: 22, height: 2, background: BRAND_G, borderRadius: 2,
        }} />
      )}
    </button>
  );
}

/* Botones reutilizables (idénticos al landing). */
export const brandBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 7,
  height: 40, padding: "0 18px",
  borderRadius: 10, border: 0,
  background: BRAND_G, color: "#fff",
  fontWeight: 600, fontSize: 13.5, fontFamily: FONT_UI,
  cursor: "pointer",
  boxShadow: "0 1px 0 rgba(255,255,255,0.2) inset, 0 8px 24px rgba(209,92,254,0.28)",
};
export const ghostBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 7,
  height: 40, padding: "0 14px",
  borderRadius: 10, border: `1px solid ${LINE2}`,
  background: PAPER, color: INK_2,
  fontWeight: 600, fontSize: 13.5, fontFamily: FONT_UI,
  cursor: "pointer",
  transition: "background .15s, border-color .15s",
};
export const inputStyle: React.CSSProperties = {
  width: "100%", height: 42, padding: "0 12px",
  background: "#fff", border: `1px solid ${LINE2}`, borderRadius: 10,
  color: INK, fontSize: 14, outline: "none", boxSizing: "border-box",
  fontFamily: FONT_UI,
};

/* Toast hook simple. */
export function useToast() {
  const [toast, setToast] = useState<string | null>(null);
  function show(t: string, ms = 2800) {
    setToast(t);
    setTimeout(() => setToast(null), ms);
  }
  const ToastNode = toast ? (
    <div style={{
      position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
      background: INK, color: "#fff",
      padding: "12px 18px", borderRadius: 12,
      fontSize: 13.5, fontWeight: 500,
      boxShadow: "0 18px 48px rgba(10,13,20,0.18)",
      zIndex: 200,
    }}>{toast}</div>
  ) : null;
  return { show, ToastNode };
}

/* Eyebrow pill (matching landing). */
export function Eyebrow({ children, color = GREEN }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      padding: "6px 12px 6px 8px",
      background: PAPER, border: `1px solid ${LINE}`, borderRadius: 999,
      fontSize: 12.5, fontWeight: 600, color: INK_2,
      fontFamily: FONT_UI,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%", background: color,
        boxShadow: `0 0 0 4px ${color === GREEN ? "rgba(31,138,91,0.18)" : color === ORANGE ? "rgba(249,166,3,0.18)" : "rgba(154,105,245,0.18)"}`,
      }} />
      {children}
    </span>
  );
}

/* Inyecta links de fuentes (una vez por página). */
export function BrandFonts() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
    </>
  );
}
