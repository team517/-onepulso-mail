"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState("7");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res  = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, remember: parseInt(remember) }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push("/connect-accounts");
      } else {
        setError(data.hint ? `${data.error} — ${data.hint}` : (data.error || "Credenciales incorrectas"));
      }
    } catch {
      setError("Error de conexión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#fafbfc",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      WebkitFontSmoothing: "antialiased",
      position: "relative",
      overflow: "hidden",
      padding: "32px 20px",
    }}>
      {/* Google Fonts */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet" />

      {/* Decorative gradient orbs (match landing hero) */}
      <div style={{
        position: "absolute",
        top: -120, right: -160,
        width: 520, height: 520,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(249,166,3,0.22), transparent 60%)",
        filter: "blur(80px)",
        pointerEvents: "none",
        zIndex: 0,
      }} />
      <div style={{
        position: "absolute",
        bottom: -200, left: -160,
        width: 560, height: 560,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(209,92,254,0.18), transparent 60%)",
        filter: "blur(80px)",
        pointerEvents: "none",
        zIndex: 0,
      }} />

      <div style={{
        width: "100%",
        maxWidth: 420,
        position: "relative",
        zIndex: 1,
      }}>

        {/* Brand mark — matches landing nav */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <a href="/landing" style={{
            display: "inline-flex",
            alignItems: "baseline",
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            fontWeight: 800,
            fontSize: 32,
            letterSpacing: "-0.04em",
            color: "#0a0d14",
            textDecoration: "none",
            marginBottom: 12,
          }}>
            onepulso
            <span style={{ display: "inline-flex", gap: 3, marginLeft: 6, alignSelf: "flex-start", marginTop: 3 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#848689" }} />
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#0a0d14" }} />
            </span>
          </a>

          <h1 style={{
            margin: "18px 0 8px",
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            fontWeight: 800,
            fontSize: 36,
            letterSpacing: "-0.035em",
            lineHeight: 1.05,
            color: "#0a0d14",
          }}>
            Bienvenido <span style={{
              fontFamily: "'Instrument Serif', serif",
              fontStyle: "italic",
              fontWeight: 400,
              letterSpacing: "-0.02em",
              background: "linear-gradient(112deg, #f9a603 0%, #f59e3a 22%, #ea7fd3 55%, #b18bf8 78%, #9a69f5 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}>de vuelta</span>
          </h1>

          <p style={{
            color: "#54565b",
            fontSize: 15,
            margin: 0,
            lineHeight: 1.5,
          }}>
            Inicia sesión para conectar tus cuentas y lanzar tu próxima campaña.
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: "#ffffff",
          border: "1px solid #ececef",
          borderRadius: 20,
          padding: "32px 30px",
          boxShadow: "0 18px 48px rgba(10,13,20,0.08), 0 0 0 1px rgba(10,13,20,0.04)",
        }}>
          <form onSubmit={handleSubmit}>

            {/* Email */}
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="team@onepulso.online"
                required
                style={inputStyle}
                onFocus={e => {
                  e.target.style.borderColor = "#0a0d14";
                  e.target.style.boxShadow   = "0 0 0 3px rgba(10,13,20,0.06)";
                }}
                onBlur={e => {
                  e.target.style.borderColor = "#e0e0e3";
                  e.target.style.boxShadow   = "none";
                }}
              />
            </div>

            {/* Password */}
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={inputStyle}
                onFocus={e => {
                  e.target.style.borderColor = "#0a0d14";
                  e.target.style.boxShadow   = "0 0 0 3px rgba(10,13,20,0.06)";
                }}
                onBlur={e => {
                  e.target.style.borderColor = "#e0e0e3";
                  e.target.style.boxShadow   = "none";
                }}
              />
            </div>

            {/* Remember */}
            <div style={{ marginBottom: 26 }}>
              <label style={labelStyle}>Mantener sesión</label>
              <select
                value={remember}
                onChange={e => setRemember(e.target.value)}
                style={{
                  ...inputStyle,
                  cursor: "pointer",
                  backgroundImage:
                    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2354565b' d='M6 8L1 3h10z'/%3E%3C/svg%3E\")",
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 14px center",
                  paddingRight: 36,
                }}
              >
                <option value="1">1 día</option>
                <option value="7">7 días</option>
                <option value="30">30 días</option>
                <option value="90">3 meses</option>
              </select>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                background: "#ffe9eb",
                border: "1px solid rgba(255,51,68,0.2)",
                borderRadius: 10,
                padding: "10px 14px",
                color: "#c12530",
                fontSize: 13.5,
                marginBottom: 18,
                lineHeight: 1.45,
              }}>
                {error}
              </div>
            )}

            {/* Submit — brand gradient button */}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                height: 48,
                padding: "0 22px",
                background: loading
                  ? "linear-gradient(112deg, #f9a603 0%, #f59e3a 22%, #ea7fd3 55%, #b18bf8 78%, #9a69f5 100%)"
                  : "linear-gradient(112deg, #f9a603 0%, #f59e3a 22%, #ea7fd3 55%, #b18bf8 78%, #9a69f5 100%)",
                border: 0,
                borderRadius: 12,
                color: "#ffffff",
                fontSize: 15,
                fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
                letterSpacing: "-0.005em",
                fontFamily: "'Inter', system-ui, sans-serif",
                transition: "filter 0.15s ease, transform 0.06s ease",
                boxShadow: "0 1px 0 rgba(255,255,255,0.2) inset, 0 8px 24px rgba(209,92,254,0.28)",
                opacity: loading ? 0.75 : 1,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
              onMouseEnter={e => {
                if (!loading) (e.currentTarget as HTMLButtonElement).style.filter = "brightness(1.04)";
              }}
              onMouseLeave={e => {
                if (!loading) (e.currentTarget as HTMLButtonElement).style.filter = "none";
              }}
            >
              {loading ? "Iniciando sesión…" : (
                <>
                  Iniciar sesión
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </>
              )}
            </button>

          </form>
        </div>

        {/* Footer */}
        <p style={{
          textAlign: "center",
          color: "#848689",
          fontSize: 12.5,
          marginTop: 28,
          letterSpacing: "0.02em",
        }}>
          <a href="/landing" style={{ color: "#848689", textDecoration: "none", borderBottom: "1px solid #ececef", paddingBottom: 1 }}>
            ← Volver a la web
          </a>
          {" · "}
          OnePulso © 2026
        </p>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 44,
  padding: "0 14px",
  background: "#ffffff",
  border: "1px solid #e0e0e3",
  borderRadius: 10,
  color: "#0a0d14",
  fontSize: 14.5,
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
  transition: "border-color 0.18s ease, box-shadow 0.18s ease",
  WebkitAppearance: "none",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  color: "#54565b",
  fontSize: 11.5,
  fontWeight: 600,
  marginBottom: 7,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
};
