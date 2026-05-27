/**
 * Parser CSV robusto + slugify de cabeceras con aliases para campos comunes.
 * Usado tanto por el endpoint server-side como por el cliente (preview en el modal).
 *
 * Reglas de slugify:
 *   - Trim, BOM out.
 *   - Inserta `_` entre minúscula+mayúscula (camelCase → snake_case).
 *   - Espacios/guiones/puntuación → `_`.
 *   - Colapsa underscores múltiples y trim de underscores.
 *   - Si empieza por dígito, prefija con `v_`.
 *
 * Aliases canónicos: mapeamos variantes muy comunes a una clave estable
 * para que el usuario pueda usar `{{first_name}}` independientemente de cómo
 * venga el header en el CSV (FirstName, First Name, Nombre, etc).
 */

export type ParsedRow = {
  /** Email del lead (siempre presente; sin él la fila es __error). */
  email: string;
  /** Variables del lead, ya con claves slugificadas. NO incluye email. */
  variables: Record<string, string>;
  /** Línea original (1-indexed, sin contar header). */
  line: number;
  /** Si la fila no se puede importar, motivo. */
  __error?: string;
};

export type ParsedCsv = {
  /** Header original tal como venía. */
  rawHeaders: string[];
  /** Map header crudo → clave slug (sin el email, ya resuelto). */
  variableKeys: string[];
  /** Header crudo que corresponde al email. */
  emailHeader: string | null;
  rows: ParsedRow[];
  /** Filas vacías (solo whitespace) saltadas. */
  blankRowsSkipped: number;
};

/** Aliases conocidos: variantes de header → clave canónica que usaremos como variable. */
const ALIASES: Record<string, string> = {
  // Email — detectado aparte, pero por si acaso
  "email": "email", "e-mail": "email", "emailaddress": "email", "email_address": "email",
  "correo": "email", "correo_electronico": "email",

  // Names
  "firstname": "first_name", "first_name": "first_name", "first name": "first_name",
  "nombre": "first_name", "primer_nombre": "first_name",
  "lastname": "last_name", "last_name": "last_name", "last name": "last_name",
  "apellido": "last_name", "apellidos": "last_name", "surname": "last_name",
  "fullname": "full_name", "full_name": "full_name", "full name": "full_name",
  "nombre_completo": "full_name",

  // Company
  "company": "company_name", "companyname": "company_name", "company_name": "company_name",
  "company name": "company_name", "empresa": "company_name",
  "organization": "company_name", "organisation": "company_name",
  "company short description": "company_short_description",
  "companyshortdescription": "company_short_description",
  "company_short_description": "company_short_description",
  "company_description": "company_description", "company description": "company_description",
  "companydescription": "company_description", "description": "company_description",
  "industry": "industry", "sector": "industry",
  "website": "website", "url": "website", "domain": "website",

  // Location
  "city": "city", "ciudad": "city",
  "state": "state", "region": "state", "provincia": "state",
  "country": "country", "pais": "country", "país": "country",
  "zipcode": "zip", "zip": "zip", "postal_code": "zip", "postal code": "zip", "codigo_postal": "zip",

  // Job
  "title": "job_title", "jobtitle": "job_title", "job_title": "job_title", "job title": "job_title",
  "puesto": "job_title", "cargo": "job_title", "position": "job_title", "role": "job_title",
  "seniority": "seniority", "department": "department",

  // Phone / LinkedIn
  "phone": "phone", "phone_number": "phone", "telefono": "phone", "teléfono": "phone", "mobile": "phone",
  "linkedin": "linkedin", "linkedin_url": "linkedin", "linkedinurl": "linkedin",
};

/** Slug genérico (sin aliases): "FirstName" → "first_name". */
export function slugify(s: string): string {
  const cleaned = s
    .replace(/^﻿/, "")            // BOM
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")  // camelCase → camel_Case
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2") // HTTPRequest → HTTP_Request
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned ? (/^\d/.test(cleaned) ? `v_${cleaned}` : cleaned) : "";
}

/** Header → clave (aplica aliases si reconoce el header, si no usa slug). */
export function headerToKey(h: string): string {
  const normalized = h.trim().toLowerCase().replace(/^﻿/, "");
  const collapsed = normalized.replace(/[\s\-]+/g, " ").trim(); // "First   Name " → "first name"
  // Alias por nombre normalizado (con espacios)
  if (ALIASES[collapsed]) return ALIASES[collapsed];
  // Alias por nombre sin separadores ("firstname")
  const compact = collapsed.replace(/\s+/g, "");
  if (ALIASES[compact]) return ALIASES[compact];
  // Fallback: slug general
  return slugify(h);
}

/** Detecta qué header del CSV es el email. */
export function detectEmailHeader(headers: string[]): number {
  // Prioridad 1: header que slugifica exactamente a "email"
  for (let i = 0; i < headers.length; i++) {
    if (headerToKey(headers[i]) === "email") return i;
  }
  // Prioridad 2: contiene "email" en cualquier forma
  for (let i = 0; i < headers.length; i++) {
    if (/email/i.test(headers[i]) || /correo/i.test(headers[i])) return i;
  }
  return -1;
}

/** Parser CSV robusto: detecta delimitador (`,` `;` `\t`), respeta quotes y multilinea. */
export function parseCsvText(text: string): { headers: string[]; rows: string[][] } {
  // Quita BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const firstLine = text.split(/\r?\n/)[0] || "";
  const counts: Record<string, number> = {
    ",": (firstLine.match(/,/g) || []).length,
    ";": (firstLine.match(/;/g) || []).length,
    "\t": (firstLine.match(/\t/g) || []).length,
  };
  let delim = ",";
  let max = counts[","];
  for (const d of [";", "\t"]) { if (counts[d] > max) { max = counts[d]; delim = d; } }

  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  const flushField = () => { cur.push(field); field = ""; };
  const flushRow = () => { rows.push(cur); cur = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;            // dentro de comillas: incluso \n y \r van al field
    } else {
      if (c === '"') inQuotes = true;
      else if (c === delim) flushField();
      else if (c === "\n") { flushField(); flushRow(); }
      else if (c === "\r") { /* ignora — el \n vendrá */ }
      else field += c;
    }
  }
  // Última fila si no terminó en \n
  if (field.length || cur.length) { flushField(); flushRow(); }

  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => h.replace(/^﻿/, "").trim());
  return { headers, rows: rows.slice(1) };
}

/** Parser completo: parsea, detecta email, slugifica vars, valida. */
export function parseLeadsCsv(text: string): ParsedCsv {
  const { headers: rawHeaders, rows } = parseCsvText(text);
  if (rawHeaders.length === 0) {
    return { rawHeaders: [], variableKeys: [], emailHeader: null, rows: [], blankRowsSkipped: 0 };
  }

  const emailIdx = detectEmailHeader(rawHeaders);
  const emailHeader = emailIdx >= 0 ? rawHeaders[emailIdx] : null;

  // Map de columnas que NO son email
  const varCols: { rawHeader: string; key: string; index: number }[] = [];
  const seenKeys = new Set<string>();
  for (let i = 0; i < rawHeaders.length; i++) {
    if (i === emailIdx) continue;
    let key = headerToKey(rawHeaders[i]);
    if (!key) continue;
    // De-duplica claves: "Name" y "First Name" no deben colisionar
    let unique = key;
    let n = 2;
    while (seenKeys.has(unique)) unique = `${key}_${n++}`;
    seenKeys.add(unique);
    varCols.push({ rawHeader: rawHeaders[i], key: unique, index: i });
  }
  const variableKeys = varCols.map((c) => c.key);

  let blank = 0;
  const out: ParsedRow[] = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    // Si la fila está vacía (todos los campos vacíos) la saltamos sin marcarla como error
    if (!row.some((c) => (c ?? "").trim() !== "")) { blank++; continue; }

    const lineNum = r + 1; // 1-indexed
    const get = (i: number) => (i >= 0 && i < row.length ? (row[i] ?? "").trim() : "");

    const email = emailIdx >= 0 ? get(emailIdx).toLowerCase() : "";
    const variables: Record<string, string> = {};
    for (const c of varCols) {
      const v = get(c.index);
      if (v !== "") variables[c.key] = v;
    }

    let __error: string | undefined;
    if (emailIdx < 0) __error = "El CSV no tiene columna de email";
    else if (!email) __error = "Email vacío";
    else if (!email.includes("@") || !/\.[a-z]{2,}$/i.test(email)) __error = `Email inválido (${email})`;

    out.push({ email, variables, line: lineNum, __error });
  }

  return { rawHeaders, variableKeys, emailHeader, rows: out, blankRowsSkipped: blank };
}
