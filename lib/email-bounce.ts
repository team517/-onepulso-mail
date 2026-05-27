/**
 * Detección de mensajes de bounce / delivery failure / mailer-daemon.
 * Extraído del Unibox legacy multi-tenant para que la plataforma de cold email
 * sea autónoma.
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

  // Direcciones típicas de bounce
  if (
    /(mailer-?daemon|postmaster|noreply|no-?reply|bounce|deliver(y|able)|failure|abuse@)/i.test(from) ||
    /mailer-?daemon|postmaster/i.test(fromName)
  ) {
    return true;
  }

  // Subjects típicos de bounce/failure/auto-reply
  if (
    /^(undelivered|undeliverable|failure notice|delivery (status notification|failure|incomplete)|mail delivery (failed|failure)|returned mail|message not delivered|no se ha podido entregar|no entregado|devuelto|fallo de entrega|automatic reply|out of office)/i.test(subject) ||
    /delivery has failed/i.test(subject)
  ) {
    return true;
  }

  // Mails de chequeo automático de estado de cuenta (Instantly / Smartlead /
  // proveedores de cold email): "Test email to check account status",
  // "Test email - account status check", etc.
  if (
    /test\s*email.*(check|verify|confirm).*account\s*status/i.test(subject) ||
    /test\s*email.*account\s*status/i.test(subject) ||
    /account\s*status.*test\s*email/i.test(subject) ||
    /^test\s*email\b.*\bstatus\b/i.test(subject)
  ) {
    return true;
  }

  // Contenido: combinación de palabras clave que indican bounce
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
