import "server-only";
import type { Tx } from "../db";

export interface Option {
  id: string;
  label: string;
  hint?: string;
}

export async function locationOptions(tx: Tx): Promise<(Option & { kind: string; depth: number; parent_id: string | null; code: string })[]> {
  const rows = await tx`
    with recursive t as (
      select id, parent_id, code, name, kind, 0 as depth, name::text as sort_path from locations where parent_id is null and is_active
      union all
      select l.id, l.parent_id, l.code, l.name, l.kind, t.depth + 1, t.sort_path || '/' || l.name from locations l join t on l.parent_id = t.id where l.is_active and t.depth < 12
    ) select * from t order by sort_path`;
  return rows.map((r) => ({ id: r.id, label: `${"  ".repeat(r.depth)}${r.name}`, hint: r.code, kind: r.kind, depth: r.depth, parent_id: r.parent_id, code: r.code }));
}

export async function categoryOptions(tx: Tx, includeInactive = false): Promise<(Option & { code: string })[]> {
  const rows = includeInactive ? await tx`select id, code, name from categories order by name` : await tx`select id, code, name from categories where is_active order by name`;
  return rows.map((r) => ({ id: r.id, label: r.name, hint: r.code, code: r.code }));
}

export async function userOptions(tx: Tx): Promise<Option[]> {
  const rows = await tx`select u.id, u.full_name, r.name as role from users u join memberships m on m.user_id = u.id and m.org_id = app_current_org() join roles r on r.id = m.role_id where m.is_active and u.is_active order by u.full_name`;
  return rows.map((r) => ({ id: r.id, label: r.full_name, hint: r.role }));
}

export async function instrumentOptions(tx: Tx): Promise<(Option & { valid: boolean; type: string; status: string; due: string | null })[]> {
  const rows = await tx`select id, code, type, status, model, calibration_due_on, last_calibrated_on from instruments where archived_at is null and status <> 'retired' order by code`;
  const today = new Date().toISOString().slice(0, 10);
  return rows.map((r) => ({
    id: r.id,
    label: `${r.code} · ${r.type}${r.model ? ` (${r.model})` : ""}`,
    type: r.type,
    status: r.status,
    due: r.calibration_due_on,
    valid: !!r.last_calibrated_on && !!r.calibration_due_on && r.calibration_due_on >= today && r.status === "active",
  }));
}

/** Paginación desde searchParams. */
export function pageParams(sp: Record<string, string | string[] | undefined>, size = 25) {
  const page = Math.max(1, Math.min(10_000, parseInt(String(sp.page ?? "1"), 10) || 1));
  return { page, limit: size, offset: (page - 1) * size };
}

export function str(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim().slice(0, 200) : undefined;
}

export function uuidOrUndef(v: string | string[] | undefined): string | undefined {
  const s = str(v);
  return s && /^[0-9a-f-]{36}$/i.test(s) ? s : undefined;
}

export function dateOrUndef(v: string | string[] | undefined): string | undefined {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : undefined;
}

export function likePattern(q: string) {
  return `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
}
