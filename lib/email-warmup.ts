/**
 * Detección conservadora de mensajes warmup / tracking-injected
 * (Mailwarm, Lemwarm, Smartlead, Instantly, MailReach, Folderly...).
 *
 * Filosofía: prefiero un falso negativo (un warmup que se cuela) que un
 * falso positivo (un email legítimo descartado). Por eso requiere
 * **múltiples señales** para marcar como warmup, salvo:
 *   - firma explícita del servicio en el body (lemwarm, mailreach, etc.)
 *   - footer típico `<p>code</p>` con código alfanumérico aislado
 *
 * Casos clásicos que SÍ debe cazar:
 *   "Oliver, let's chat! | 7Y8KN0M CHBV6J7"
 *   "average donation amounts | ought-care-sing CHBV6J7"
 *   bodies con "<p>ought-care-sing CHBV6J7</p>"
 *   "Powered by lemwarm" en footer
 *
 * Casos que NO debe cazar (falsos positivos a evitar):
 *   "Apple-Pay-Confirmation - your receipt"
 *   "Visita-guiada-Bilbao 2025"
 *   "Re: tu-propuesta-comercial"
 */
export function isWarmupMessage(input: {
  subject?: string;
  text?: string;
  html?: string;
  from?: string;
}): boolean {
  const s = (input.subject || "").trim();
  const bodyText = ((input.text || "") + " " + (input.html || "").replace(/<[^>]+>/g, " ")).slice(0, 10000);
  const html = input.html || "";

  /* ── Señal 1: firma explícita de servicio warmup en el body ──
     Esto es definitivo — ningún email legítimo menciona estos servicios. */
  if (/\b(lemwarm|mailwarm|warmup\s*inbox|warmupinbox|smartlead\.ai|instantly\.ai|mailreach|folderly|warmbox|warmup\.app)\b/i.test(bodyText)) {
    return true;
  }

  /* ── Señal 2: footer <p>código</p> aislado al final del HTML ──
     Patrón muy específico, baja probabilidad de falso positivo. */
  if (/<p[^>]*>\s*[a-z]+(?:-[a-z]+){2,}\s+[A-Za-z0-9]{6,16}\s*<\/p>\s*(<\/body>|$)/i.test(html)) return true;
  if (/<p[^>]*>\s*[A-Za-z0-9]{6,16}(?:\s+[A-Za-z0-9]{6,16}){1,3}\s*<\/p>\s*(<\/body>|$)/i.test(html)) return true;

  /* ── Señal 3: subject con TAIL + body que contiene tokens warmup ── */
  // Requerimos AL MENOS 2 señales para evitar falsos positivos.
  let score = 0;

  // Token code: letras + números mezclados, longitud 6-16, no es versión tipo "v2.1"
  const isCodeToken = (t: string): boolean => {
    if (!t || t.length < 6 || t.length > 16) return false;
    if (!/[A-Za-z]/.test(t) || !/[0-9]/.test(t)) return false;
    if (/^v\d/i.test(t)) return false;       // v2.0, v3
    if (/^[A-Z]{2,3}\d{2,4}$/.test(t)) return false;  // BCN2024, MAD2025 (códigos legítimos)
    // Distribución MUY irregular de letras y números: típico de hash random
    const letters = (t.match(/[A-Za-z]/g) || []).length;
    const digits = (t.match(/[0-9]/g) || []).length;
    // Requiere mezcla: al menos 30% de cada
    if (letters < t.length * 0.3 || digits < t.length * 0.2) return false;
    return true;
  };

  // 3.a) Subject con separador final " | " o " — " + cola sospechosa
  const tailMatch = s.match(/\s[|\-–—]\s+([^|]+?)\s*$/);
  if (tailMatch) {
    const tail = tailMatch[1].trim();
    const tailTokens = tail.split(/[\s_]+/).filter(Boolean);
    if (tailTokens.some(isCodeToken)) score += 2; // tail con code-token → fuerte
    // Cadena hifenada muy larga (4+ palabras): "ought-care-sing-blue" — muy sospechoso
    if (/^[a-z]+(?:-[a-z]+){3,}$/.test(tail)) score += 2;
    // Cadena hifenada 3 palabras EN LA COLA (no en el medio): menos sospechoso
    else if (/^[a-z]+(?:-[a-z]+){2}$/.test(tail)) score += 1;
  }

  // 3.b) 2+ code tokens en el subject (no en la cola, sueltos)
  const subjectCodes = (s.match(/\b[A-Za-z0-9]{6,16}\b/g) || []).filter(isCodeToken);
  if (subjectCodes.length >= 2) score += 2;
  else if (subjectCodes.length === 1) score += 1;

  // 3.c) Cadena hifenada larga (4+ palabras) DENTRO del subject (no en la cola)
  if (/\b[a-z]{3,}(?:-[a-z]{3,}){3,}\b/.test(s)) score += 1;

  // 3.d) Body con cadena hifenada larga + code token
  if (/\b[a-z]{3,}(?:-[a-z]{3,}){2,}\b/.test(bodyText)) {
    const bodyCodes = (bodyText.match(/\b[A-Za-z0-9]{6,16}\b/g) || []).filter(isCodeToken);
    if (bodyCodes.length >= 1) score += 1;
  }

  // Necesita ≥2 señales para clasificar como warmup
  return score >= 2;
}
