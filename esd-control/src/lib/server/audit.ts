import type { Tx, Ctx } from "./db";

export interface AuditEvent {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/** Inserta un evento de auditoría dentro de la misma transacción que el cambio. */
export async function audit(tx: Tx, ctx: Ctx, e: AuditEvent) {
  await tx`
    insert into audit_log(org_id, user_id, action, entity_type, entity_id, summary, before_data, after_data, reason)
    values (${ctx.orgId}, ${ctx.userId}, ${e.action}, ${e.entityType}, ${e.entityId ?? null}, ${e.summary.slice(0, 500)},
            ${e.before === undefined ? null : tx.json(e.before as never)}, ${e.after === undefined ? null : tx.json(e.after as never)}, ${e.reason ?? null})`;
}

/** Devuelve solo los campos que cambian, para guardar antes/después compactos. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>): { before: Partial<T>; after: Partial<T> } | null {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const k of Object.keys(after) as (keyof T)[]) {
    const nv = after[k];
    const ov = before[k];
    const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v === undefined ? null : JSON.stringify(v));
    if (norm(nv) !== norm(ov)) {
      b[k] = ov;
      a[k] = nv;
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}
