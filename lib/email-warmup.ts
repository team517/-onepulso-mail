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

/** Señal DÉBIL: el remitente usa solo un nombre de pila genérico.
 *  Ya NO marca por sí sola — devuelve true solo como una señal a sumar. */
function looksLikeWarmupSender(fromName?: string, fromEmail?: string): boolean {
  if (!fromName) return false;
  const name = fromName.trim().toLowerCase();
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length !== 1) return false;
  const first = tokens[0].replace(/[^a-z]/g, "");
  if (first.length < 2 || first.length > 12) return false;
  return WARMUP_FIRST_NAMES.has(first);
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

/**
 * Detecta si un mensaje es warmup. CONSERVADOR por diseño:
 * el coste de ocultar una respuesta real es MUCHO mayor que el de mostrar
 * un warmup ocasional. Por eso:
 *   1. Firma explícita de servicio warmup → SIEMPRE warmup (definitivo).
 *   2. Resto de señales → necesitan 2+ para marcar (sistema de puntos).
 *   3. PROTECCIÓN: si parece una respuesta humana real (Re: + cuerpo con
 *      frases de verdad), NUNCA se marca como warmup.
 */
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

  /* ════ DEFINITIVO: firma explícita de servicio warmup ════ */
  if (/\b(lemwarm|mailwarm|warmup\s*inbox|warmupinbox|smartlead\.ai|instantly\.ai|mailreach|folderly|warmbox|warmup\.app|inboxally|warmy|plusvibe|plus\s*vibe)\b/i.test(subjAndBody)) {
    return true;
  }
  // Checks explícitos de deliverability (SPF/DKIM/DMARC) — patrón muy típico
  if (/\b(spf|dkim|dmarc)\b.*\b(check|test|verify|status)\b/i.test(s)) return true;
  if (/\b(inbox\s*placement|email\s*warm[\s-]*up\b)/i.test(s)) return true;

  /* ════ PROTECCIÓN: ¿parece una respuesta humana real? ════
     Un email con "Re:" en el subject Y un cuerpo con frases de verdad
     (≥30 chars de texto que no es solo códigos) → es casi seguro una
     respuesta legítima. NUNCA la marcamos como warmup. */
  const looksLikeReply = /^re\s*:/i.test(s);
  const cleanBody = bodyText.replace(/\s+/g, " ").trim();
  const hasRealProse = cleanBody.length >= 30 && /[a-zà-ÿ]{4,}\s+[a-zà-ÿ]{3,}\s+[a-zà-ÿ]{3,}/i.test(cleanBody);
  if (looksLikeReply && hasRealProse) {
    return false; // respuesta humana → siempre visible
  }

  /* ════ SISTEMA DE PUNTOS — necesita ≥2 para marcar warmup ════ */
  let score = 0;

  // Señal 1: token alfanumérico random en subject (hash/UUID/tracking ID)
  const subjectTokens = s.match(/\b[A-Za-z0-9]{6,64}\b/g) || [];
  if (subjectTokens.some(isRandomCodeToken)) score++;

  // Señal 2: snake_case sospechoso en subject
  if (hasSuspiciousSnakeCase(s)) score++;

  // Señal 3: cadena hifenada larga en subject (3+ palabras: "ought-care-sing")
  if (/\b[a-z]{3,}(?:-[a-z]{3,}){2,}\b/.test(s)) score++;

  // Señal 4: nombre de pila genérico solo (Kim, Mark, etc.)
  if (looksLikeWarmupSender(input.fromName, input.from)) score++;

  // Señal 5: subject con separador final + cola con código
  const tailMatch = s.match(/\s[|\-–—]\s+([^|]+?)\s*$/);
  if (tailMatch) {
    const tail = tailMatch[1].trim();
    const tailTokens = tail.split(/[\s_]+/).filter(Boolean);
    if (tailTokens.some(isRandomCodeToken) || /^[a-z]+(?:-[a-z]+){1,}$/.test(tail) || hasSuspiciousSnakeCase(tail)) {
      score++;
    }
  }

  // Señal 6: footer <p>código</p> al final del HTML (muy típico de warmup)
  if (/<p[^>]*>\s*[a-z]+(?:-[a-z]+){1,}\s+[A-Za-z0-9]{4,}\s*<\/p>\s*(<\/body>|$)/i.test(html)) score++;
  if (/<p[^>]*>\s*[A-Za-z0-9]{6,16}(?:\s+[A-Za-z0-9]{6,16}){1,3}\s*<\/p>\s*(<\/body>|$)/i.test(html)) score++;

  // Señal 7: hash hex largo (≥20 chars) aislado en el body — SOLO si no es
  // un reply real (ya filtrado arriba). Subimos el umbral de 16 a 20 para
  // evitar falsos positivos con números de pedido o referencias.
  if ((bodyText.match(/\b[a-fA-F0-9]{20,}\b/g) || []).length >= 1) score++;

  return score >= 2;
}
