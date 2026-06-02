/**
 * Plantillas de email reutilizables. El usuario las crea en /plantillas y luego
 * las aplica a variantes de campañas con el botón "Usar plantilla".
 *
 * Storage key: email-templates → Template[]
 */
import crypto from "crypto";
import { readJson, writeJson } from "./storage";
import { scopedKey } from "./workspace";

async function KEY() { return scopedKey("email-templates"); }

export type Template = {
  id: string;
  name: string;
  category?: string;      // "intro", "follow-up", "breakup", etc.
  subject: string;
  body: string;
  tags?: string[];
  created_at: string;
  updated_at: string;
  used_count: number;     // cuántas veces se aplicó a una variante
  last_used_at?: string | null;
};

export async function listTemplates(): Promise<Template[]> {
  const arr = await readJson<Template[]>(await KEY());
  return Array.isArray(arr) ? arr : [];
}

export async function getTemplate(id: string): Promise<Template | null> {
  const all = await listTemplates();
  return all.find((t) => t.id === id) || null;
}

export async function createTemplate(data: Partial<Template>): Promise<Template> {
  const now = new Date().toISOString();
  const t: Template = {
    id: crypto.randomUUID(),
    name: data.name?.trim() || "Plantilla sin nombre",
    category: data.category?.trim() || undefined,
    subject: data.subject || "",
    body: data.body || "",
    tags: data.tags || [],
    created_at: now,
    updated_at: now,
    used_count: 0,
    last_used_at: null,
  };
  const all = await listTemplates();
  all.unshift(t);
  await writeJson(await KEY(),all);
  return t;
}

export async function updateTemplate(id: string, patch: Partial<Template>): Promise<Template | null> {
  const all = await listTemplates();
  const idx = all.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  all[idx] = {
    ...all[idx],
    ...patch,
    id: all[idx].id,                   // ID no editable
    created_at: all[idx].created_at,
    updated_at: new Date().toISOString(),
  };
  await writeJson(await KEY(),all);
  return all[idx];
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const all = await listTemplates();
  const next = all.filter((t) => t.id !== id);
  if (next.length === all.length) return false;
  await writeJson(await KEY(),next);
  return true;
}

/** Incrementa el contador de uso (al aplicar a una variante). */
export async function markTemplateUsed(id: string): Promise<void> {
  const all = await listTemplates();
  const idx = all.findIndex((t) => t.id === id);
  if (idx < 0) return;
  all[idx].used_count = (all[idx].used_count || 0) + 1;
  all[idx].last_used_at = new Date().toISOString();
  await writeJson(await KEY(),all);
}
