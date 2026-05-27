/**
 * Detección de mensajes warmup / tracking-injected (Mailwarm, Lemwarm,
 * Smartlead, Instantly...). Ejemplos que debe cazar:
 *   "Oliver, let's chat! | 7Y8KN0M CHBV6J7"
 *   "average donation amounts | ought-care-sing CHBV6J7"
 *   bodies con "<p>ought-care-sing CHBV6J7</p>"
 */
export function isWarmupMessage(input: {
  subject?: string;
  text?: string;
  html?: string;
  from?: string;
}): boolean {
  const s = (input.subject || "").trim();
  const bodyText = ((input.text || "") + " " + (input.html || "").replace(/<[^>]+>/g, " ")).slice(0, 10000);

  const isCodeToken = (t: string): boolean => {
    if (!t || t.length < 5 || t.length > 20) return false;
    if (!/[A-Za-z]/.test(t) || !/[0-9]/.test(t)) return false;
    if (/^v\d/i.test(t) && t.length <= 6) return false;
    return true;
  };

  // 1) Subject: separator " | " or " - " + tail with code/hyphen-list
  const tailMatch = s.match(/\s[|\-–—]\s+([^|]+?)\s*$/);
  if (tailMatch) {
    const tail = tailMatch[1].trim();
    const tailTokens = tail.split(/[\s_]+/).filter(Boolean);
    if (tailTokens.some(isCodeToken)) return true;
    if (/^[a-z]+(?:-[a-z]+){1,}/.test(tail)) return true;
    if (tail.length >= 8 && bodyText.includes(tail)) return true;
  }

  // 2) Hyphenated 3+ lowercase wordlist anywhere in subject
  if (/\b[a-z]{3,}(?:-[a-z]{3,}){2,}\b/.test(s)) return true;

  // 3) 2+ alphanumeric code tokens in subject
  const subjectCodes = (s.match(/\b[A-Za-z0-9]{5,16}\b/g) || []).filter(isCodeToken);
  if (subjectCodes.length >= 2) return true;

  // 4) Hyphenated wordlist + alphanumeric code in body
  if (/\b[a-z]{3,}(?:-[a-z]{3,}){2,}\b/.test(bodyText)) {
    const bodyCodes = (bodyText.match(/\b[A-Za-z0-9]{5,16}\b/g) || []).filter(isCodeToken);
    if (bodyCodes.length >= 1) return true;
  }

  // 5) <p>code</p> footer patterns
  const html = input.html || "";
  if (/<p[^>]*>\s*[a-z]+(?:-[a-z]+){1,}\s+[A-Za-z0-9]{4,}\s*<\/p>/i.test(html)) return true;
  if (/<p[^>]*>\s*[A-Za-z0-9]{5,16}(?:\s+[A-Za-z0-9]{5,16}){1,3}\s*<\/p>/.test(html)) {
    const bodyCodes = (bodyText.match(/\b[A-Za-z0-9]{5,16}\b/g) || []).filter(isCodeToken);
    if (bodyCodes.length >= 1) return true;
  }

  // 6) Known warmup service signatures
  if (/\b(lemwarm|mailwarm|warmup\s*inbox|warmupinbox|smartlead|instantly\.ai|mailreach|folderly)\b/i.test(bodyText)) return true;

  return false;
}
