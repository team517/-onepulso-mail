/**
 * Verificación de emails sin APIs externas.
 *
 * Hace 4 checks que se pueden ejecutar 100% dentro del server (Railway-friendly):
 *   1. Syntax check (regex RFC 5322 simplificado)
 *   2. MX lookup (DNS — confirma que el dominio puede recibir email)
 *   3. Disposable list (10minutemail, mailinator, tempmail, etc.)
 *   4. Role-based check (info@, sales@, support@ — bajo reply rate)
 *
 * No hace SMTP RCPT TO probing porque:
 *   - Railway bloquea puerto 25 saliente
 *   - Gmail/Outlook responden 250 a todo desde 2020 (anti-enumeración)
 *
 * Verdicts:
 *   "valid"   → pasa todos los checks fuertes
 *   "invalid" → syntax o MX falla (NO recibir email = 100% bounce garantizado)
 *   "risky"   → role-based o disposable (puede enviarse pero bajo reply rate)
 *   "unknown" → DNS falló temporalmente (timeout, etc.)
 */
import { promises as dns } from "dns";

export type VerifyVerdict = "valid" | "invalid" | "risky" | "unknown";

export type VerifyResult = {
  email: string;
  verdict: VerifyVerdict;
  reasons: string[];
};

/* ── Lista curada de dominios disposable (top 200 más usados) ─────── */
const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com", "10minutemail.net", "20minutemail.com", "30minutemail.com",
  "mailinator.com", "mailinator.net", "mailinator2.com", "guerrillamail.com",
  "guerrillamail.net", "guerrillamail.org", "guerrillamailblock.com", "sharklasers.com",
  "spam4.me", "tempmail.com", "tempmail.net", "temp-mail.org", "temp-mail.io",
  "tempinbox.com", "throwawaymail.com", "yopmail.com", "yopmail.net", "yopmail.fr",
  "trashmail.com", "trashmail.net", "trashmail.io", "trashmail.de", "trashmail.me",
  "fakemailgenerator.com", "fakeinbox.com", "fake-mail.net", "maildrop.cc",
  "mintemail.com", "moakt.com", "mohmal.com", "mytemp.email", "tempr.email",
  "tmail.ws", "tmail3.com", "dispostable.com", "emailondeck.com", "burnermail.io",
  "emkei.cz", "mail-temp.com", "mailtemp.uk", "mailtemp.info", "instant-mail.de",
  "spambog.com", "spambog.de", "spambog.ru", "spamfree24.org", "spaml.de",
  "anonbox.net", "mytrashmailer.com", "trbvm.com", "drdrb.net", "drdrb.com",
  "haribu.net", "armyspy.com", "cuvox.de", "dayrep.com", "einrot.com",
  "fleckens.hu", "gustr.com", "jourrapide.com", "rhyta.com", "superrito.com",
  "teleworm.com", "teleworm.us", "discard.email", "discardmail.com", "spamgourmet.com",
  "spambox.us", "spamex.com", "33mail.com", "mailcatch.com", "mvrht.com",
  "wegwerfmail.de", "wegwerfemail.de", "wegwerf-email.de", "trash-mail.com",
  "trash-mail.de", "trash-mail.at", "byom.de", "incognitomail.com", "incognitomail.net",
  "incognitomail.org", "amilegit.com", "discposable.com", "mailmoat.com", "mailshell.com",
  "mailtothis.com", "objectmail.com", "proxymail.eu", "rcpt.at", "safersignup.de",
  "secure-mail.biz", "selfdestructingmail.com", "send22u.info", "sendspamhere.com",
  "skeefmail.com", "slopsbox.com", "smellfear.com", "snakemail.com", "sneakemail.com",
  "sofort-mail.de", "sogetthis.com", "sohu.com", "soodonims.com", "spamavert.com",
  "spambob.com", "spambob.net", "spambob.org", "spamcero.com", "spamday.com",
  "spamfree.eu", "spamhole.com", "spaminator.de", "spammotel.com", "spamoff.de",
  "spamslicer.com", "spamspot.com", "spamthis.co.uk", "spamtrail.com", "speed.1s.fr",
  "supergreatmail.com", "supermailer.jp", "tempemail.biz", "tempemail.com", "tempemail.net",
  "tempymail.com", "thanksnospam.info", "thankyou2010.com", "thecloudindex.com",
  "thelimestones.com", "thisisnotmyrealemail.com", "throam.com", "thrott.com",
  "tilien.com", "tinpec.com", "tittbit.in", "tizi.com", "tmail.com",
  "tmail.de", "tmail.org", "tmailservice.com", "tmpnators.com", "toomail.biz",
  "topranklist.de", "toss.pw", "tradermail.info", "trash2009.com", "trash2010.com",
  "trash2011.com", "trashymail.com", "trashymail.net", "trickmail.net", "tyldd.com",
  "uggsrock.com", "umail.net", "upliftnow.com", "uplipht.com", "venompen.com",
  "veryrealemail.com", "vidchart.com", "viralplays.com", "vomoto.com", "vpn.st",
  "vsimcard.com", "vubby.com", "wasteland.rfc822.org", "webm4il.info", "webuser.in",
  "wee.my", "wegwerfaddress.com", "wetrainbayarea.com", "wetrainbayarea.org",
  "wh4f.org", "whatpaas.com", "whyspam.me", "willhackforfood.biz", "willselfdestruct.com",
  "winemaven.info", "wronghead.com", "wuzup.net", "wuzupmail.net", "www.e4ward.com",
  "www.gishpuppy.com", "www.mailinator.com", "wwwnew.eu", "xagloo.com", "xemaps.com",
  "xents.com", "xmaily.com", "xoxy.net", "yapped.net", "yeah.net", "yep.it",
  "ypmail.webarnak.fr.eu.org", "yspend.com", "yuurok.com", "zehnminuten.de",
  "zehnminutenmail.de", "zetmail.com", "zoaxe.com", "zoemail.org", "zomg.info",
  "zxcv.com", "zxcvbnm.com", "zzz.com", "trashmailgenerator.de",
]);

/* ── Prefijos role-based ──────────────────────────────────────────── */
const ROLE_PREFIXES = new Set([
  "info", "sales", "support", "admin", "contact", "hello", "help",
  "noreply", "no-reply", "postmaster", "webmaster", "abuse", "marketing",
  "hr", "jobs", "careers", "billing", "accounts", "office", "team",
  "mail", "feedback", "press", "media", "service", "customer", "customerservice",
  "enquiries", "inquiry", "general", "all", "everyone", "staff", "members",
  "moderator", "moderators", "admin", "administrator", "root", "security",
  "privacy", "legal", "compliance", "abuse", "fraud", "complaints",
]);

/* ── Cache de MX lookups por dominio (24h, en memoria) ──────────── */
type MxCacheEntry = { hasMx: boolean; checkedAt: number };
const mxCache = new Map<string, MxCacheEntry>();
const MX_CACHE_TTL = 24 * 60 * 60 * 1000;

async function hasMxRecord(domain: string): Promise<boolean | null> {
  const cached = mxCache.get(domain);
  if (cached && Date.now() - cached.checkedAt < MX_CACHE_TTL) return cached.hasMx;

  try {
    const records = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("DNS timeout")), 3000)),
    ]);
    const hasMx = Array.isArray(records) && records.length > 0;
    mxCache.set(domain, { hasMx, checkedAt: Date.now() });
    return hasMx;
  } catch (e: any) {
    if (e.code === "ENOTFOUND" || e.code === "ENODATA") {
      // Domain doesn't have MX — pero comprueba A record por si acaso (RFC 5321)
      try {
        await dns.resolve4(domain);
        mxCache.set(domain, { hasMx: true, checkedAt: Date.now() });
        return true;
      } catch {
        mxCache.set(domain, { hasMx: false, checkedAt: Date.now() });
        return false;
      }
    }
    // Timeout u otro fallo temporal → null (unknown)
    return null;
  }
}

/* ── Regex syntax check ───────────────────────────────────────────── */
const EMAIL_REGEX = /^[a-zA-Z0-9._+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}$/;

export async function verifyEmail(email: string): Promise<VerifyResult> {
  const reasons: string[] = [];
  const e = email.trim().toLowerCase();

  // 1. Syntax
  if (!EMAIL_REGEX.test(e)) {
    return { email: e, verdict: "invalid", reasons: ["sintaxis inválida"] };
  }

  const [localPart, domain] = e.split("@");

  // 2. Disposable check
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { email: e, verdict: "invalid", reasons: ["dominio temporal/disposable"] };
  }

  // 3. Role-based check
  const isRole = ROLE_PREFIXES.has(localPart);
  if (isRole) reasons.push("dirección genérica (role-based)");

  // 4. MX lookup
  const hasMx = await hasMxRecord(domain);
  if (hasMx === false) {
    return { email: e, verdict: "invalid", reasons: [...reasons, "dominio sin servidor de correo (MX)"] };
  }
  if (hasMx === null) {
    return { email: e, verdict: "unknown", reasons: [...reasons, "DNS no respondió a tiempo"] };
  }

  // Si llegamos aquí: dominio existe + sintaxis ok + no disposable
  // Si era role-based, sigue marcado como risky
  if (isRole) return { email: e, verdict: "risky", reasons };
  return { email: e, verdict: "valid", reasons: [] };
}

/** Verifica un batch con concurrencia controlada. */
export async function verifyEmailBatch(
  emails: string[],
  concurrency = 20,
): Promise<VerifyResult[]> {
  const results: VerifyResult[] = new Array(emails.length);
  let i = 0;
  async function worker() {
    while (i < emails.length) {
      const idx = i++;
      results[idx] = await verifyEmail(emails[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, emails.length) }, worker));
  return results;
}
