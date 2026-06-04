/**
 * Detección de mensajes de bounce / delivery failure / mailer-daemon.
 *
 * IMPORTANTE: las respuestas automáticas (out-of-office, vacation, baja médica,
 * "Fuera de la oficina") NO son bounces — el email LLEGÓ correctamente, solo
 * que el destinatario respondió automáticamente. Estas DEBEN aparecer en la
 * bandeja de entrada (las gestiona `isAutoReply`, no esta función).
 *
 * Solo cuenta como bounce si:
 *   - Viene de mailer-daemon / postmaster / etc.
 *   - Subject indica entrega fallida ("Undelivered", "Failure Notice", etc.)
 *   - El cuerpo tiene indicadores claros de "address not found" + similar.
 */
export function isBounceOrFailure(m: {
  from?: string;
  fromAddress?: string;
  fromName?: string;
  subject?: string;
  text?: string;
}): boolean {
  const from = (m.fromAddress || m.from || "").toLowerCase();
  const fromName = (m.fromName || "").toLowerCase();
  const subject = (m.subject || "").toLowerCase();
  const text = (m.text || "").slice(0, 2000).toLowerCase();

  // Direcciones típicas de bounce — SOLO mailer-daemon / postmaster.
  // Quitamos noreply, no-reply, bounce@ — los noreply de empresas legítimas
  // (LinkedIn, Stripe, etc.) son emails reales, no bounces.
  if (
    /mailer-?daemon|postmaster/i.test(from) ||
    /mailer-?daemon|postmaster/i.test(fromName)
  ) {
    return true;
  }

  // Subjects típicos de bounce/failure de delivery.
  // QUITADO "automatic reply" y "out of office" — esas son auto-replies, NO bounces.
  if (
    /^(undelivered|undeliverable|failure notice|delivery (status notification|failure|incomplete)|mail delivery (failed|failure)|returned mail|message not delivered|no se ha podido entregar|no entregado|devuelto|fallo de entrega)/i.test(subject) ||
    /delivery has failed/i.test(subject)
  ) {
    return true;
  }

  // Mails de chequeo automático de estado de cuenta (Instantly / Smartlead /
  // proveedores de cold email): "Test email to check account status".
  if (
    /test\s*email.*(check|verify|confirm).*account\s*status/i.test(subject) ||
    /test\s*email.*account\s*status/i.test(subject) ||
    /account\s*status.*test\s*email/i.test(subject) ||
    /^test\s*email\b.*\bstatus\b/i.test(subject)
  ) {
    return true;
  }

  // Contenido: combinación de palabras clave que indican bounce real
  const indicators = [
    "address not found", "user unknown", "user does not exist", "no such user",
    "mailbox unavailable", "mailbox is full", "mailbox full",
    "550 5.1.1", "550-5.1.1", "552 5.2.2", "554 5.4.6",
    "could not be delivered", "permanent error", "permanently rejected",
    "domain not found",
    "no encontramos a esta dirección", "no se ha podido entregar",
    "destinatario desconocido", "el correo no existe",
  ];
  let matches = 0;
  for (const ind of indicators) {
    if (text.includes(ind)) matches++;
    if (matches >= 1 && /^(mail delivery|delivery|failure|undelivered)/i.test(subject)) return true;
    if (matches >= 2) return true;
  }
  return false;
}

/**
 * Detecta si un mensaje es una respuesta automática (out-of-office, vacation,
 * baja médica, etc.). NO es bounce — el email se entregó correctamente, solo
 * que el destinatario tiene una respuesta automática configurada.
 *
 * Estos mensajes SÍ aparecen en la bandeja de entrada. El worker puede
 * usar esta función para aplicar la opción "stop_on_auto_reply" si el
 * usuario quiere que un auto-reply pare la secuencia.
 *
 * Detección por:
 *   - Headers RFC: Auto-Submitted, X-Auto-Response-Suppress, X-Autoreply
 *   - Subject patterns en EN, ES, FR, DE, IT, PT, NL
 *   - Body patterns ("estoy de baja", "out of office", etc.)
 */
export function isAutoReply(m: {
  from?: string;
  fromAddress?: string;
  fromName?: string;
  subject?: string;
  text?: string;
  headers?: Record<string, string>;
}): boolean {
  const subject = (m.subject || "").toLowerCase();
  const text = (m.text || "").slice(0, 2000).toLowerCase();
  const headers = m.headers || {};

  // 1. Headers RFC oficiales (lo más fiable)
  const autoSubmitted = (headers["auto-submitted"] || headers["Auto-Submitted"] || "").toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;
  if (headers["x-autoreply"] || headers["X-Autoreply"]) return true;
  if (headers["x-auto-response-suppress"] || headers["X-Auto-Response-Suppress"]) return true;

  // 2. Subject patterns (varios idiomas)
  const autoReplyPatterns = [
    // Inglés
    /\b(out of office|out-of-office|ooo|away from office|on vacation|on leave|on holiday|automatic reply|auto[\s-]?reply|away from my email|currently away)\b/i,
    // Español
    /\b(fuera de (la )?oficina|de vacaciones|estoy de baja|baja médica|baja por enfermedad|respuesta automática|ausencia temporal)\b/i,
    // Francés
    /\b(absent du bureau|en vacances|en congé|réponse automatique|absence du bureau)\b/i,
    // Alemán
    /\b(abwesenheit|außer haus|im urlaub|automatische antwort|abwesenheitsnotiz)\b/i,
    // Italiano
    /\b(fuori sede|in vacanza|in ferie|risposta automatica|assenza dall'ufficio)\b/i,
    // Portugués
    /\b(fora do escritório|de férias|resposta automática|ausência temporária)\b/i,
    // Holandés
    /\b(buiten kantoor|met vakantie|automatisch antwoord|afwezigheid)\b/i,
  ];
  for (const re of autoReplyPatterns) {
    if (re.test(subject)) return true;
  }

  // 3. Body patterns — para casos donde el subject es "Re: ..." pero el cuerpo es OOO
  const bodyAutoReplyPatterns = [
    /\b(i am (currently )?(out of office|on vacation|on leave|away))\b/i,
    /\b(currently out of (the )?office)\b/i,
    /\b(estoy (de baja|de vacaciones|fuera de la oficina|ausente))\b/i,
    /\bme encuentro de baja\b/i,
    /\b(je suis (absent|en vacances|en congé))\b/i,
    /\b(ich bin (abwesend|im urlaub|außer haus))\b/i,
  ];
  for (const re of bodyAutoReplyPatterns) {
    if (re.test(text)) return true;
  }

  return false;
}
