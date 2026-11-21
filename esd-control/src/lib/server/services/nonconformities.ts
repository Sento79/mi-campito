import "server-only";
import type { Tx, Ctx } from "../db";
import { audit } from "../audit";
import { AppError, NotFoundError } from "../errors";

export const NC_STATUSES = ["open", "containment", "analysis", "action", "verification", "closed", "reopened"] as const;
export type NcStatus = (typeof NC_STATUSES)[number];

export const NC_STATUS_LABEL: Record<NcStatus, string> = {
  open: "Abierta",
  containment: "Contención",
  analysis: "En análisis",
  action: "Acción en curso",
  verification: "Pendiente de verificación",
  closed: "Cerrada",
  reopened: "Reabierta",
};

/** Transiciones permitidas del flujo de NC. */
export const NC_TRANSITIONS: Record<NcStatus, NcStatus[]> = {
  open: ["containment", "analysis", "action", "verification"],
  reopened: ["containment", "analysis", "action", "verification"],
  containment: ["analysis", "action", "verification"],
  analysis: ["action", "verification", "containment"],
  action: ["verification", "analysis"],
  verification: ["closed", "action", "analysis"],
  closed: ["reopened"],
};

export async function createNonconformity(
  tx: Tx,
  ctx: Ctx,
  i: {
    title: string;
    description?: string | null;
    severityKey?: string;
    severityId?: string | null;
    ownerUserId?: string | null;
    dueOn?: string | null;
    containment?: string | null;
    campaignId?: string | null;
    links: { measurementId?: string | null; assetId?: string | null; planPointId?: string | null }[];
  },
) {
  let severityId = i.severityId ?? null;
  let dueDays: number | null = null;
  if (severityId) {
    const [s] = await tx`select id, due_days from nc_severities where id = ${severityId}`;
    if (!s) throw new AppError("Gravedad no válida");
    dueDays = s.due_days;
  } else if (i.severityKey) {
    const [s] = await tx`select id, due_days from nc_severities where key = ${i.severityKey}`;
    severityId = s?.id ?? null;
    dueDays = s?.due_days ?? null;
  }
  const year = new Date().getUTCFullYear();
  const [{ n }] = await tx`select app_next_counter(${"nc-" + year}) as n`;
  const code = `NC-${year}-${String(n).padStart(4, "0")}`;
  const dueOn = i.dueOn ?? (dueDays ? new Date(Date.now() + dueDays * 86400000).toISOString().slice(0, 10) : null);
  const [nc] = await tx`
    insert into nonconformities(org_id, code, title, description, severity_id, owner_user_id, due_on, containment, campaign_id, created_by,
      status)
    values (${ctx.orgId}, ${code}, ${i.title.slice(0, 300)}, ${i.description ?? null}, ${severityId}, ${i.ownerUserId ?? null}, ${dueOn},
      ${i.containment ?? null}, ${i.campaignId ?? null}, ${ctx.userId}, ${i.containment ? "containment" : "open"})
    returning id, code`;
  for (const l of i.links) {
    if (!l.measurementId && !l.assetId && !l.planPointId) continue;
    await tx`insert into nc_links(org_id, nc_id, measurement_id, asset_id, plan_point_id) values (${ctx.orgId}, ${nc.id}, ${l.measurementId ?? null}, ${l.assetId ?? null}, ${l.planPointId ?? null})`;
  }
  await tx`insert into nc_status_history(org_id, nc_id, from_status, to_status, changed_by, comment) values (${ctx.orgId}, ${nc.id}, null, ${i.containment ? "containment" : "open"}, ${ctx.userId}, 'Creación')`;
  if (i.ownerUserId && i.ownerUserId !== ctx.userId) {
    await tx`insert into notifications(org_id, user_id, kind, title, body, link, dedupe_key)
             values (${ctx.orgId}, ${i.ownerUserId}, 'nc_assigned', ${"Se le ha asignado " + code}, ${i.title.slice(0, 300)}, ${"/no-conformidades/" + nc.id}, ${"nc_assigned:" + nc.id})
             on conflict do nothing`;
  }
  await audit(tx, ctx, { action: "create", entityType: "nonconformity", entityId: nc.id, summary: `${code} creada: ${i.title}`.slice(0, 500) });
  return { id: nc.id as string, code: nc.code as string };
}

export async function transitionNonconformity(
  tx: Tx,
  ctx: Ctx,
  perms: Set<string>,
  id: string,
  to: NcStatus,
  data: { comment?: string | null; verificationNotes?: string | null },
) {
  const [exists] = await tx`select id from nonconformities where id = ${id}`;
  if (!exists) throw new NotFoundError("No conformidad no encontrada");
  if (to === "closed" && !perms.has("validate")) throw new AppError("Cerrar una no conformidad requiere el permiso de validación", 403);
  if (!perms.has("edit") && !perms.has("validate")) throw new AppError("No tiene permiso para modificar no conformidades", 403);
  const [nc] = await tx`select * from nonconformities where id = ${id} for update`;
  if (!nc) throw new AppError("No tiene permiso para modificar esta no conformidad", 403);
  const from = nc.status as NcStatus;
  if (!NC_TRANSITIONS[from].includes(to)) throw new AppError(`Transición no permitida: ${NC_STATUS_LABEL[from]} → ${NC_STATUS_LABEL[to]}`);

  if (to === "closed") {
    const notes = (data.verificationNotes ?? "").trim();
    if (notes.length < 3) throw new AppError("Registre la verificación de eficacia antes de cerrar", 422, { verificationNotes: "Obligatorio para cerrar" });
    if (!nc.corrective_action && !nc.containment) throw new AppError("Registre al menos la contención o la acción correctiva antes de cerrar", 422);
    const [open] = await tx`select count(*)::int as n from nc_actions where nc_id = ${id} and status = 'open'`;
    if (open.n > 0) throw new AppError(`Hay ${open.n} acción(es) abiertas. Complételas o cancélelas antes de cerrar.`, 422);
    await tx`update nonconformities set status = 'closed', verification_notes = ${notes}, verified_by = ${ctx.userId}, verified_at = now(),
             closed_by = ${ctx.userId}, closed_at = now() where id = ${id}`;
  } else if (to === "reopened") {
    if (!(data.comment ?? "").trim()) throw new AppError("Indique el motivo de la reapertura", 422, { comment: "Obligatorio" });
    await tx`update nonconformities set status = 'reopened', reopen_count = reopen_count + 1, closed_at = null, closed_by = null,
             verified_at = null, verified_by = null where id = ${id}`;
  } else {
    await tx`update nonconformities set status = ${to} where id = ${id}`;
  }
  await tx`insert into nc_status_history(org_id, nc_id, from_status, to_status, comment, changed_by) values (${ctx.orgId}, ${id}, ${from}, ${to}, ${data.comment ?? data.verificationNotes ?? null}, ${ctx.userId})`;
  await audit(tx, ctx, {
    action: "status",
    entityType: "nonconformity",
    entityId: id,
    summary: `${nc.code}: ${NC_STATUS_LABEL[from]} → ${NC_STATUS_LABEL[to]}`,
    before: { status: from },
    after: { status: to },
    reason: data.comment ?? null,
  });
}
