/**
 * Detección de warmup / tracking-injected.
 * Servicios cubiertos: Mailwarm, Lemwarm, Smartlead, Instantly, MailReach,
 * Folderly, Warmbox, InboxAlly, Warmy, PlusVibe.
 *
 * Estrategia: agresiva — basta UNA señal para marcar como warmup.
 * Los mensajes filtrados se GUARDAN con flag is_warmup → si algo
 * legítimo cae por error, se ve en la tab "Warmup".
 */

const WARMUP_FIRST_NAMES = new Set([
  "kim", "mark", "jenny", "sarah", "tom", "john", "mike", "lisa",
  "david", "amy", "chris", "anna", "paul", "emma", "james", "kate",
  "rob", "robert", "ben", "alex", "rachel", "ryan", "alice", "sam",
  "sammy", "dan", "daniel", "matt", "matthew", "luke", "ethan", "max",
  "lucy", "olivia", "sophie", "sophia", "isabella", "emily", "grace",
  "natalie", "claire", "rebecca", "linda", "mary", "patricia", "jennifer",
  "elizabeth", "barbara", "susan", "jessica", "karen", "nancy", "betty",
  "helen", "sandra", "donna", "carol", "ruth", "sharon", "michelle",
  "laura", "amanda", "melissa", "deborah", "stephanie", "dorothy",
  "virginia", "kathleen", "pamela", "martha", "debra", "amber", "andrea",
  "anne", "ashley", "ava", "becky", "brenda", "brian", "carolyn",
  "catherine", "cheryl", "christina", "christopher", "cindy", "courtney",
  "crystal", "cynthia", "denise", "diana", "diane", "doris", "edward",
  "eric", "frank", "gary", "george", "gloria", "harold", "heather",
  "henry", "irene", "jack", "jacob", "janet", "janice", "jason", "jean",
  "jeffrey", "jerry", "jessie", "joan", "joe", "jose", "joseph",
  "joshua", "joyce", "judith", "julia", "julie", "justin", "katherine",
  "kayla", "keith", "kelly", "kenneth", "kevin", "kimberly", "larry",
  "lawrence", "leah", "leslie", "lori", "louis", "madison", "marie",
  "marilyn", "marjorie", "marvin", "megan", "michael", "nathan",
  "nicholas", "nicole", "norma", "patrick", "peggy", "peter", "philip",
  "phyllis", "ralph", "randy", "raymond", "richard", "ronald", "rose",
  "roy", "russell", "samantha", "samuel", "sara", "scott", "sean",
  "shirley", "stephen", "steven", "teresa", "terri", "terry", "theresa",
  "thomas", "tiffany", "timothy", "todd", "tracy", "wanda", "wayne",
  "william",
]);

function looksLikeWarmupSender(fromName?: string, fromEmail?: string): boolean {
  if (!fromName) return false;
  const name = fromName.trim().toLowerCase();
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length !== 1) return false;
  const first = tokens[0].replace(/[^a-z]/g, "");
  if (first.length < 2 || first.length > 12) return false;
  if (!WARMUP_FIRST_NAMES.has(first)) return false;
  if (fromEmail) {
    const dom = fromEmail.split("@")[1]?.toLowerCase() || "";
    if (/^[a-z0-9]{8,}\.[a-z]{2,6}$/.test(dom)) return true;
    if (/[0-9]/.test(dom.split(".")[0] || "")) return true;
  }
  return true;
}

/** Es un token "random hash"? — mezcla de letras y dígitos, longitud ≥6. */
function isRandomCodeToken(t: string): boolean {
  if (!t || t.length < 6) return false;
  if (t.length > 64) return false;
  // Versiones tipo v2.1, v10 → NO
  if (/^v\d/i.test(t)) return false;
  // Códigos legítimos tipo BCN2025, MAD2024 → NO
  if (/^[A-Z]{2,4}\d{2,4}$/.test(t)) return false;

  // ── Hex puro (a-f, A-F, 0-9), longitud ≥10 → warmup garantizado
  // (UUIDs, hashes MD5/SHA, message tracking IDs)
  if (t.length >= 10 && /^[a-fA-F0-9]+$/.test(t)) return true;

  // Necesita TENER letras Y dígitos
  if (!/[A-Za-z]/.test(t) || !/[0-9]/.test(t)) return false;

  const letters = (t.match(/[A-Za-z]/g) || []).length;
  const digits = (t.match(/[0-9]/g) || []).length;
  // Umbral más relajado: al menos 15% letras Y 15% dígitos
  if (letters < t.length * 0.15 || digits < t.length * 0.15) return false;
  return true;
}

/** Detecta snake_case típico de warmup ("community_customs_st"). */
function hasSuspiciousSnakeCase(s: string): boolean {
  // 2+ underscores entre palabras lowercase → muy raro en emails legítimos
  return /\b[a-z]{3,}(?:_[a-z]{2,}){2,}\b/.test(s);
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
  const subjAndBody = `${s} ${bodyText}`;

  /* ── A: firma explícita de servicio warmup ───────────────────────── */
  if (/\b(lemwarm|mailwarm|warmup\s*inbox|warmupinbox|smartlead\.ai|instantly\.ai|mailreach|folderly|warmbox|warmup\.app|inboxally|warmy|plusvibe|plus\s*vibe)\b/i.test(subjAndBody)) {
    return true;
  }

  /* ── B: subject típico de warmup-check ─────────────────────────────
     "SPF DKIM DMARC Check", "Email deliverability check", etc. */
  if (/\b(spf|dkim|dmarc).*\b(check|test|verify)/i.test(s)) return true;
  if (/\b(deliverability|inbox\s*placement|email\s*warm[\s-]*up)\b/i.test(s)) return true;

  /* ── C: sender con nombre genérico solo de pila ───────────────────── */
  if (looksLikeWarmupSender(input.fromName, input.from)) return true;

  /* ── D: token alfanumérico random en subject ───────────────────── */
  const subjectTokens = s.match(/\b[A-Za-z0-9]{6,64}\b/g) || [];
  if (subjectTokens.some(isRandomCodeToken)) return true;

  /* ── E: snake_case sospechoso en subject ───────────────────────── */
  if (hasSuspiciousSnakeCase(s)) return true;

  /* ── F: cadena hifenada larga ─────────────────────────────────── */
  if (/\b[a-z]{3,}(?:-[a-z]{3,}){2,}\b/.test(s)) return true;

  /* ── G: subject con separador final + cola sospechosa ─────────── */
  const tailMatch = s.match(/\s[|\-–—]\s+([^|]+?)\s*$/);
  if (tailMatch) {
    const tail = tailMatch[1].trim();
    const tailTokens = tail.split(/[\s_]+/).filter(Boolean);
    if (tailTokens.some(isRandomCodeToken)) return true;
    if (/^[a-z]+(?:-[a-z]+){1,}$/.test(tail)) return true;
    if (hasSuspiciousSnakeCase(tail)) return true;
  }

  /* ── H: footer <p>código</p> al final del HTML ───────────────── */
  if (/<p[^>]*>\s*[a-z]+(?:-[a-z]+){1,}\s+[A-Za-z0-9]{4,}\s*<\/p>\s*(<\/body>|$)/i.test(html)) return true;
  if (/<p[^>]*>\s*[A-Za-z0-9]{6,16}(?:\s+[A-Za-z0-9]{6,16}){1,3}\s*<\/p>\s*(<\/body>|$)/i.test(html)) return true;

  /* ── I: cualquier hash hex aislado en el body (UUID, MD5, SHA) ── */
  // Si el body contiene un token hex ≥16 chars sin contexto → warmup
  const bodyHashes = (bodyText.match(/\b[a-fA-F0-9]{16,}\b/g) || []);
  if (bodyHashes.length >= 1) return true;

  /* ── J: cadena hifenada + code en body ──────────────────────── */
  if (/\b[a-z]{3,}(?:-[a-z]{3,}){2,}\b/.test(bodyText)) {
    const bodyCodes = (bodyText.match(/\b[A-Za-z0-9]{6,20}\b/g) || []).filter(isRandomCodeToken);
    if (bodyCodes.length >= 1) return true;
  }

  return false;
}
