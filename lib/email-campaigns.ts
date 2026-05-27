/**
 * Plataforma de Email — Campañas (modelo tipo Instantly).
 *
 * Una "Campaign" es una secuencia de N pasos. Cada paso tiene 1..N variantes
 * (A/B/C/…). Las variantes se rotan en los envíos. Los leads se almacenan
 * aparte para escalar. Las cuentas asignadas se rotan según `account_rotation`.
 *
 * Sticky sender: si una cuenta envía el step 1 a un lead, todos los pasos
 * siguientes a ese lead usarán la misma cuenta (lead.sticky_account_id se fija
 * en el primer envío). Esto preserva el threading de email.
 *
 * Storage keys (kv_store):
 *   email-campaigns/index           → string[] (lista de IDs)
 *   email-campaigns/{id}            → Campaign
 *   email-campaigns/{id}/leads      → Lead[]
 */
import crypto from "crypto";
import { readJson, writeJson, deleteJson } from "./storage";

const IDX_KEY = "email-campaigns/index";
const KEY = (id: string) => `email-campaigns/${id}`;
const LEADS_KEY = (id: string) => `email-campaigns/${id}/leads`;

/* ── Tipos ────────────────────────────────────────────────────────────── */

export type Variant = {
  id: string;
  label: string;          // "A", "B", "C"…
  subject: string;        // soporta {{vars}} y {spin|tax}
  body: string;           // HTML/text con {{vars}} y {spin|tax}
  weight: number;         // 1 por defecto; rotación weighted opcional
};

export type Step = {
  id: string;
  /** Días de espera DESPUÉS del step anterior. Step 0 = 0 (envío inmediato cuando el lead entra). */
  delay_days: number;
  /** Horas adicionales (opcional). */
  delay_hours: number;
  variants: Variant[];
};

export type CampaignSchedule = {
  /** IANA timezone, ej "Europe/Madrid" */
  timezone: string;
  /** Días permitidos: 0=domingo … 6=sábado */
  days: number[];
  /** Hora de inicio (0-23) y fin (0-23). Por defecto 9–18. */
  start_hour: number;
  end_hour: number;
};

export type CampaignOptions = {
  stop_on_reply: boolean;
  stop_on_auto_reply: boolean;
  stop_company_on_reply: boolean;
  track_opens: boolean;
  track_clicks: boolean;
  text_only_first: boolean;       // primer email como text-only
  text_only_all: boolean;         // todos los emails text-only
  insert_unsubscribe_header: boolean;
  daily_limit_per_account: number;     // emails / día / cuenta
  max_new_leads_per_day: number;       // step-1 / día (todas las cuentas)
  /** Minutos mínimos entre envíos por cuenta. */
  min_gap_minutes: number;
  /** Aleatoriedad extra (0–N min añadidos al gap mínimo). */
  random_gap_minutes: number;
  /** Sticky sender: same account sends all follow-ups to a lead. */
  sticky_sender: boolean;
  /** Rotación de cuentas. */
  account_rotation: "round-robin" | "random" | "weighted";
  cc?: string;
  bcc?: string;
};

export type Campaign = {
  id: string;
  name: string;
  status: "draft" | "active" | "paused" | "completed";
  created_at: string;
  updated_at: string;

  /** Pasos en orden. */
  steps: Step[];

  /** IDs de cuentas de /api/email-accounts asignadas explícitamente. */
  account_ids: string[];
  /**
   * Tags de cuentas: TODAS las cuentas conectadas que tengan AL MENOS uno de
   * estos tags se consideran asignadas (sumado a account_ids).
   * Atajo para no marcar 20 cuentas una a una.
   */
  account_tags?: string[];

  schedule: CampaignSchedule;
  options: CampaignOptions;

  /** Variables disponibles (auto-detectadas desde columnas del CSV de leads). */
  variables: string[];

  /** Tags libres del usuario para organizar campañas. */
  tags?: string[];

  /** Métricas en caché (actualizadas por el worker / al cargar). */
  metrics?: CampaignMetrics;
};

export type CampaignMetrics = {
  total_leads: number;
  active_leads: number;
  contacted: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  completed: number;
};

export type LeadStatus =
  | "new"        // recién añadido, todavía no contactado
  | "active"     // en secuencia
  | "paused"     // pausado manualmente
  | "completed"  // terminó la secuencia
  | "bounced"
  | "replied"
  | "unsubscribed";

export type Lead = {
  id: string;
  email: string;
  /** Variables auto-detectadas del CSV. ej { first_name: "Xavi", company: "Evadan" } */
  variables: Record<string, string>;
  status: LeadStatus;
  /** 0-indexed: índice del próximo paso a enviar. */
  current_step: number;
  /** Cuenta pegajosa: la que envió el step 1 (preserve threading). */
  sticky_account_id?: string;
  added_at: string;
  last_contacted_at?: string | null;
  last_event?: string | null;        // "sent step 2", "opened", "replied"
  /** Razón por la que se completó/paró. */
  finished_reason?: string | null;
};

/* ── Defaults ─────────────────────────────────────────────────────────── */

export function defaultSchedule(): CampaignSchedule {
  return {
    timezone: "Europe/Madrid",
    days: [1, 2, 3, 4, 5], // L–V
    start_hour: 9,
    end_hour: 18,
  };
}

export function defaultOptions(): CampaignOptions {
  return {
    stop_on_reply: true,
    stop_on_auto_reply: true,
    stop_company_on_reply: false,
    track_opens: true,
    track_clicks: true,
    text_only_first: false,
    text_only_all: false,
    insert_unsubscribe_header: true,
    daily_limit_per_account: 30,
    max_new_leads_per_day: 100,
    min_gap_minutes: 9,
    random_gap_minutes: 5,
    sticky_sender: true,
    account_rotation: "round-robin",
  };
}

export function newVariant(label = "A"): Variant {
  return {
    id: crypto.randomUUID(),
    label,
    subject: "",
    body: "",
    weight: 1,
  };
}

export function newStep(delay_days = 0): Step {
  return {
    id: crypto.randomUUID(),
    delay_days,
    delay_hours: 0,
    variants: [newVariant("A")],
  };
}

export function newCampaign(name: string): Campaign {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    status: "draft",
    created_at: now,
    updated_at: now,
    steps: [newStep(0)],
    account_ids: [],
    schedule: defaultSchedule(),
    options: defaultOptions(),
    // Empieza sin variables — se llenan automáticamente al subir el CSV.
    // Así no hay ruido (`company` vacío) ni colisiones con las vars reales del usuario.
    variables: [],
    tags: [],
    metrics: {
      total_leads: 0, active_leads: 0, contacted: 0,
      opened: 0, clicked: 0, replied: 0,
      bounced: 0, unsubscribed: 0, completed: 0,
    },
  };
}

/* ── Persistencia ─────────────────────────────────────────────────────── */

async function readIndex(): Promise<string[]> {
  const arr = await readJson<string[]>(IDX_KEY);
  return Array.isArray(arr) ? arr : [];
}
async function writeIndex(ids: string[]) {
  await writeJson(IDX_KEY, ids);
}

export async function listCampaigns(): Promise<Campaign[]> {
  const ids = await readIndex();
  const out: Campaign[] = [];
  for (const id of ids) {
    const c = await readJson<Campaign>(KEY(id));
    if (c) out.push(c);
  }
  // Más recientes primero
  out.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  return out;
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  return await readJson<Campaign>(KEY(id));
}

export async function saveCampaign(c: Campaign): Promise<Campaign> {
  c.updated_at = new Date().toISOString();
  await writeJson(KEY(c.id), c);
  const ids = await readIndex();
  if (!ids.includes(c.id)) {
    ids.push(c.id);
    await writeIndex(ids);
  }
  return c;
}

export async function deleteCampaign(id: string): Promise<boolean> {
  const ids = await readIndex();
  const next = ids.filter((i) => i !== id);
  if (next.length === ids.length) return false;
  await writeIndex(next);
  await deleteJson(KEY(id));
  await deleteJson(LEADS_KEY(id));
  return true;
}

export async function duplicateCampaign(id: string, newName?: string): Promise<Campaign | null> {
  const orig = await getCampaign(id);
  if (!orig) return null;
  const copy: Campaign = JSON.parse(JSON.stringify(orig));
  copy.id = crypto.randomUUID();
  copy.name = newName || `${orig.name} (copia)`;
  copy.status = "draft";
  copy.created_at = new Date().toISOString();
  copy.updated_at = copy.created_at;
  // Regenerar IDs de pasos / variantes (para que sean independientes)
  copy.steps = copy.steps.map((s) => ({
    ...s,
    id: crypto.randomUUID(),
    variants: s.variants.map((v) => ({ ...v, id: crypto.randomUUID() })),
  }));
  // Reset métricas
  copy.metrics = {
    total_leads: 0, active_leads: 0, contacted: 0,
    opened: 0, clicked: 0, replied: 0,
    bounced: 0, unsubscribed: 0, completed: 0,
  };
  await saveCampaign(copy);
  // No copiamos leads — la copia empieza limpia.
  return copy;
}

/* ── Leads ────────────────────────────────────────────────────────────── */

export async function listLeads(campaignId: string): Promise<Lead[]> {
  const arr = await readJson<Lead[]>(LEADS_KEY(campaignId));
  return Array.isArray(arr) ? arr : [];
}

export async function writeLeads(campaignId: string, leads: Lead[]) {
  await writeJson(LEADS_KEY(campaignId), leads);
}

export function newLead(email: string, variables: Record<string, string> = {}): Lead {
  return {
    id: crypto.randomUUID(),
    email: email.toLowerCase().trim(),
    variables,
    status: "new",
    current_step: 0,
    added_at: new Date().toISOString(),
    last_contacted_at: null,
    last_event: null,
    sticky_account_id: undefined,
    finished_reason: null,
  };
}

/** Mergea leads del CSV en la campaña: deduplica por email, devuelve stats. */
export async function addLeadsBulk(
  campaignId: string,
  rows: { email: string; variables: Record<string, string> }[]
): Promise<{ added: number; updated: number; skipped: number; total: number; variables: string[]; campaign_variables: string[]; metrics: CampaignMetrics }> {
  const existing = await listLeads(campaignId);
  const byEmail = new Map<string, Lead>(existing.map((l) => [l.email.toLowerCase(), l]));

  let added = 0, updated = 0, skipped = 0;
  const allVars = new Set<string>();

  for (const r of rows) {
    const email = (r.email || "").toLowerCase().trim();
    if (!email || !email.includes("@")) { skipped++; continue; }
    Object.keys(r.variables || {}).forEach((k) => allVars.add(k));
    const existingLead = byEmail.get(email);
    if (existingLead) {
      // Mergeamos variables; preservamos status/progress.
      existingLead.variables = { ...existingLead.variables, ...r.variables };
      updated++;
    } else {
      const nl = newLead(email, r.variables);
      byEmail.set(email, nl);
      added++;
    }
  }

  const merged = Array.from(byEmail.values());
  await writeLeads(campaignId, merged);

  // Actualiza la lista de variables en la campaign.
  const camp = await getCampaign(campaignId);
  if (camp) {
    const set = new Set([...(camp.variables || []), ...Array.from(allVars)]);
    camp.variables = Array.from(set);
    camp.metrics = camp.metrics || {
      total_leads: 0, active_leads: 0, contacted: 0, opened: 0, clicked: 0,
      replied: 0, bounced: 0, unsubscribed: 0, completed: 0,
    };
    camp.metrics.total_leads = merged.length;
    camp.metrics.active_leads = merged.filter((l) => l.status === "active" || l.status === "new").length;
    await saveCampaign(camp);
  }

  return {
    added, updated, skipped,
    total: merged.length,
    variables: Array.from(allVars),       // vars detectadas en ESTE chunk
    campaign_variables: camp?.variables || Array.from(allVars), // cumulative en la campaña
    metrics: camp?.metrics || {
      total_leads: merged.length, active_leads: 0, contacted: 0,
      opened: 0, clicked: 0, replied: 0, bounced: 0, unsubscribed: 0, completed: 0,
    },
  };
}

export async function deleteLeads(campaignId: string, ids: string[]): Promise<number> {
  const all = await listLeads(campaignId);
  const set = new Set(ids);
  const next = all.filter((l) => !set.has(l.id));
  const removed = all.length - next.length;
  await writeLeads(campaignId, next);
  // Actualizamos métricas
  const camp = await getCampaign(campaignId);
  if (camp) {
    camp.metrics = camp.metrics || {
      total_leads: 0, active_leads: 0, contacted: 0, opened: 0, clicked: 0,
      replied: 0, bounced: 0, unsubscribed: 0, completed: 0,
    };
    camp.metrics.total_leads = next.length;
    camp.metrics.active_leads = next.filter((l) => l.status === "active" || l.status === "new").length;
    await saveCampaign(camp);
  }
  return removed;
}

/* ── Render de variables y spintax ────────────────────────────────────── */

/**
 * Reemplaza {{var_name}} con el valor del lead. Si la variable no existe,
 * deja {{var}} marcado en rojo para que el usuario lo arregle.
 * También resuelve {spin|tax} eligiendo una opción al azar.
 */
export function renderTemplate(
  template: string,
  variables: Record<string, string>,
  opts: { highlightMissing?: boolean; seed?: string } = {}
): string {
  // 1. Variables PRIMERO ({{name}}, {{name|fallback}}) — antes que spintax
  //    para que `{{job_title|equipo}}` no sea capturado por la regex de spintax.
  let out = template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g, (_m, name: string, fb?: string) => {
    const v = variables[name];
    if (v !== undefined && v !== "") return v;
    if (fb !== undefined && fb !== "") return fb;
    if (opts.highlightMissing) return `[${name}?]`;
    return "";
  });

  // 2. Spintax  {opt1|opt2|opt3} (sobre el texto ya con variables sustituidas)
  out = out.replace(/\{([^{}]+\|[^{}]+)\}/g, (_m, group: string) => {
    const opts2 = group.split("|").map((s) => s.trim());
    if (opts.seed) {
      let h = 0; for (let i = 0; i < opts.seed.length; i++) h = (h * 31 + opts.seed.charCodeAt(i)) | 0;
      return opts2[Math.abs(h) % opts2.length];
    }
    return opts2[Math.floor(Math.random() * opts2.length)];
  });

  return out;
}

/** Extrae nombres de variables {{x}} usados en un texto. */
export function extractVariables(text: string): string[] {
  const set = new Set<string>();
  const re = /\{\{\s*([a-zA-Z0-9_]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) set.add(m[1]);
  return Array.from(set);
}

/* ── Selección de variante / cuenta (lógica de envío) ─────────────────── */

/** Elige una variante de un step. Determinista por leadId para que A/B testing sea estable por lead. */
export function pickVariant(step: Step, leadId: string): Variant {
  const variants = step.variants.length ? step.variants : [newVariant("A")];
  const totalWeight = variants.reduce((s, v) => s + Math.max(1, v.weight), 0);
  // Hash determinista por leadId
  let h = 0; for (let i = 0; i < leadId.length; i++) h = (h * 31 + leadId.charCodeAt(i)) | 0;
  const r = (Math.abs(h) % 10000) / 10000 * totalWeight;
  let acc = 0;
  for (const v of variants) {
    acc += Math.max(1, v.weight);
    if (r < acc) return v;
  }
  return variants[variants.length - 1];
}

/**
 * Elige una cuenta para enviar a este lead.
 * Si sticky_sender está activo y el lead ya tiene sticky_account_id, devuelve esa.
 * Si no, aplica la rotación configurada y SETEA sticky_account_id si sticky=true.
 */
export function pickAccount(
  lead: Lead,
  accountIds: string[],
  rotation: "round-robin" | "random" | "weighted",
  sticky: boolean,
  rrCursor: number
): { accountId: string; nextCursor: number; sticky: boolean } {
  if (accountIds.length === 0) return { accountId: "", nextCursor: rrCursor, sticky: false };
  if (sticky && lead.sticky_account_id && accountIds.includes(lead.sticky_account_id)) {
    return { accountId: lead.sticky_account_id, nextCursor: rrCursor, sticky: true };
  }
  let chosen: string;
  let nextCursor = rrCursor;
  if (rotation === "random") {
    chosen = accountIds[Math.floor(Math.random() * accountIds.length)];
  } else {
    // round-robin (weighted no implementado todavía, cae aquí)
    chosen = accountIds[rrCursor % accountIds.length];
    nextCursor = (rrCursor + 1) % accountIds.length;
  }
  return { accountId: chosen, nextCursor, sticky: false };
}
