/**
 * Detección de mensajes warmup / tracking-injected (Mailwarm, Lemwarm,
 * Smartlead, Instantly, MailReach, Folderly, Warmbox, etc.).
 *
 * Estrategia: agresiva por defecto — cualquiera de estas señales marca
 * como warmup:
 *   - Firma explícita del servicio en el body (lemwarm, mailreach, etc.)
 *   - Código alfanumérico 6-20 chars en subject (típico hash random)
 *   - Cadena hifenada larga en subject ("ought-care-sing")
 *   - Footer <p>código</p> aislado al final del HTML
 *   - From con nombre típico de warmup (Kim, Mark, Jenny, Sarah, etc.)
 *     SOLO si no tiene apellido y viene de dominio genérico
 *
 * Como los mensajes filtrados se GUARDAN (con flag is_warmup), un falso
 * positivo no se pierde — el usuario puede verlo en la tab "Warmup".
 */

/** Top-200 nombres típicos de warmup (English first names sin apellido). */
const WARMUP_FIRST_NAMES = new Set([
  // Top English first names que servicios warmup usan
  "kim", "mark", "jenny", "sarah", "tom", "john", "mike", "lisa",
  "david", "amy", "chris", "anna", "paul", "emma", "james", "kate",
  "rob", "robert", "ben", "alex", "rachel", "ryan", "alice", "sam",
  "sammy", "dan", "daniel", "matt", "matthew", "luke", "ethan", "max",
  "lucy", "olivia", "sophie", "sophia", "isabella", "emily", "grace",
  "natalie", "claire", "rebecca", "linda", "mary", "patricia", "jennifer",
  "elizabeth", "barbara", "susan", "jessica", "karen", "nancy", "betty",
  "helen", "sandra", "donna", "carol", "ruth", "sharon", "michelle",
  "laura", "amanda", "melissa", "deborah", "stephanie", "dorothy",
  "rebecca", "virginia", "kathleen", "pamela", "martha", "debra",
  "amber", "andrea", "anne", "ashley", "ava", "becky", "brenda", "brian",
  "carolyn", "catherine", "cheryl", "christina", "christopher", "cindy",
  "courtney", "crystal", "cynthia", "denise", "diana", "diane", "doris",
  "edward", "eric", "frank", "gary", "george", "gloria", "harold",
  "heather", "henry", "irene", "jack", "jacob", "janet", "janice",
  "jason", "jean", "jeffrey", "jerry", "jessie", "joan", "joe", "jose",
  "joseph", "joshua", "joyce", "judith", "julia", "julie", "justin",
  "katherine", "kayla", "keith", "kelly", "kenneth", "kevin", "kim",
  "kimberly", "larry", "lawrence", "leah", "leslie", "lori", "louis",
  "madison", "marie", "marilyn", "marjorie", "marvin", "megan",
  "michael", "michelle", "nathan", "nicholas", "nicole", "norma",
  "patrick", "peggy", "peter", "philip", "phyllis", "rachel", "ralph",
  "randy", "raymond", "richard", "ronald", "rose", "roy", "russell",
  "ruth", "samantha", "samuel", "sara", "scott", "sean", "shirley",
  "stephen", "steven", "teresa", "terri", "terry", "theresa", "thomas",
  "tiffany", "timothy", "todd", "tracy", "wanda", "wayne", "william",
]);

function looksLikeWarmupSender(fromName?: string, fromEmail?: string): boolean {
  if (!fromName) return false;
  const name = fromName.trim().toLowerCase();
  // Solo nombre, sin apellido (1 token, ≤ 12 chars).
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length !== 1) return false;
  const first = tokens[0].replace(/[^a-z]/g, "");
  if (first.length < 2 || first.length > 12) return false;
  if (!WARMUP_FIRST_NAMES.has(first)) return false;
  // Si el dominio del email coincide con uno de los tuyos legítimos
  // (custom domain), probablemente no es warmup. Pero si es un dominio
  // genérico-looking (random tldraw, números, etc.) → muy probable warmup.
  if (fromEmail) {
    const dom = fromEmail.split("@")[1]?.toLowerCase() || "";
    // Dominios con random + tld extraña → typical warmup
    if (/^[a-z0-9]{8,}\.[a-z]{2,6}$/.test(dom)) return true;
    if (/[0-9]/.test(dom.split(".")[0] || "")) return true; // dominio con digits
  }
  return true; // single-name match → marca
}

export function isWarmupMessage(input: {
  subject?: string;
  text?: string;
  html?: string;
  from?: string;
  fromName?: string;
}): boolean {
  const s = (input.subject || "").trim();
  const bodyText = ((input.text || "") + " " + (input.html || "").replace(/<[^>]+>/g, " ")).slice(0, 10000);
  const html = input.html || "";

  /* ── Señal A: firma explícita de servicio warmup en el body ─────────
     Definitivo — ningún email legítimo menciona estos servicios. */
  if (/\b(lemwarm|mailwarm|warmup\s*inbox|warmupinbox|smartlead\.ai|instantly\.ai|mailreach|folderly|warmbox|warmup\.app|inboxally|warmy)\b/i.test(bodyText)) {
    return true;
  }

  /* ── Señal B: from con nombre típico warmup ───────────────────────── */
  if (looksLikeWarmupSender(input.fromName, input.from)) {
    return true;
  }

  /* ── Señal C: código alfanumérico aislado en subject ───────────────
     Token de 6-16 chars con letras Y dígitos mezclados (no versiones
     ni códigos legítimos tipo BCN2025). */
  const isCodeToken = (t: string): boolean => {
    if (!t || t.length < 6 || t.length > 20) return false;
    if (!/[A-Za-z]/.test(t) || !/[0-9]/.test(t)) return false;
    if (/^v\d/i.test(t)) return false; // v2.0
    // Códigos legítimos: 2-3 letras seguidas de año tipo BCN2025, MAD24
    if (/^[A-Z]{2,4}\d{2,4}$/.test(t)) return false;
    // Hash random: 30%+ letras Y 20%+ dígitos
    const letters = (t.match(/[A-Za-z]/g) || []).length;
    const digits = (t.match(/[0-9]/g) || []).length;
    if (letters < t.length * 0.3 || digits < t.length * 0.2) return false;
    return true;
  };

  const subjectTokens = (s.match(/\b[A-Za-z0-9]{6,20}\b/g) || []);
  const subjectCodes = subjectTokens.filter(isCodeToken);
  if (subjectCodes.length >= 1) return true;  // 1 token random ya es suficiente

  /* ── Señal D: cadena hifenada en subject ──────────────────────────── */
  if (/\b[a-z]{3,}(?:-[a-z]{3,}){2,}\b/.test(s)) return true;

  /* ── Señal E: subject con separador final + cola sospechosa ──────── */
  const tailMatch = s.match(/\s[|\-–—]\s+([^|]+?)\s*$/);
  if (tailMatch) {
    const tail = tailMatch[1].trim();
    const tailTokens = tail.split(/[\s_]+/).filter(Boolean);
    if (tailTokens.some(isCodeToken)) return true;
    if (/^[a-z]+(?:-[a-z]+){1,}$/.test(tail)) return true;
  }

  /* ── Señal F: footer <p>código</p> al final del HTML ───────────── */
  if (/<p[^>]*>\s*[a-z]+(?:-[a-z]+){1,}\s+[A-Za-z0-9]{4,}\s*<\/p>\s*(<\/body>|$)/i.test(html)) return true;
  if (/<p[^>]*>\s*[A-Za-z0-9]{6,16}(?:\s+[A-Za-z0-9]{6,16}){1,3}\s*<\/p>\s*(<\/body>|$)/i.test(html)) return true;

  /* ── Señal G: cadena hifenada + code token en body ─────────────── */
  if (/\b[a-z]{3,}(?:-[a-z]{3,}){2,}\b/.test(bodyText)) {
    const bodyCodes = (bodyText.match(/\b[A-Za-z0-9]{6,16}\b/g) || []).filter(isCodeToken);
    if (bodyCodes.length >= 1) return true;
  }

  return false;
}
