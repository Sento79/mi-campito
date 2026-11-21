"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/server/action";
import { audit, diff } from "@/lib/server/audit";
import { AppError } from "@/lib/server/errors";
import { saveDocument } from "@/lib/server/storage";
import { createNonconformity, transitionNonconformity, NC_STATUSES } from "@/lib/server/services/nonconformities";

const nul = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === "" || v === undefined ? null : v), s.nullable());

export const createNcAction = defineAction(
  {
    permission: ["create", "measure"],
    schema: z.object({
      title: z.string().trim().min(3).max(300),
      description: nul(z.string().max(4000)),
      severityId: nul(z.string().uuid()),
      ownerUserId: nul(z.string().uuid()),
      dueOn: nul(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
      containment: nul(z.string().max(4000)),
      measurementIds: z.array(z.string().uuid()).max(100).default([]),
      assetIds: z.array(z.string().uuid()).max(100).default([]),
    }),
  },
  async (i, { tx, session }) => {
    const links: { measurementId?: string; assetId?: string | null; planPointId?: string | null }[] = [];
    for (const m of i.measurementIds) {
      const [row] = await tx`select id, asset_id, plan_point_id, campaign_id from measurements where id = ${m}`;
      if (!row) throw new AppError("Medición no encontrada", 404);
      links.push({ measurementId: row.id, assetId: row.asset_id, planPointId: row.plan_point_id });
    }
    for (const a of i.assetIds) {
      const [asset] = await tx`select id from assets where id = ${a}`;
      if (!asset) throw new AppError("Activo no encontrado", 404);
      if (!links.some((l) => l.assetId === a)) links.push({ assetId: a });
    }
    const nc = await createNonconformity(tx, session, { ...i, links });
    revalidatePath("/no-conformidades");
    return nc;
  },
);

export const updateNcAction = defineAction(
  {
    permission: ["edit", "validate"],
    schema: z.object({
      id: z.string().uuid(),
      title: z.string().trim().min(3).max(300),
      description: nul(z.string().max(4000)),
      severityId: nul(z.string().uuid()),
      ownerUserId: nul(z.string().uuid()),
      dueOn: nul(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
      containment: nul(z.string().max(4000)),
      rootCause: nul(z.string().max(4000)),
      correctiveAction: nul(z.string().max(4000)),
      preventiveAction: nul(z.string().max(4000)),
    }),
  },
  async (i, { tx, session }) => {
    const [before] = await tx`select * from nonconformities where id = ${i.id}`;
    if (!before) throw new AppError("No encontrada", 404);
    if (before.status === "closed") throw new AppError("La NC está cerrada; reábrala para modificarla");
    const row = { title: i.title, description: i.description, severity_id: i.severityId, owner_user_id: i.ownerUserId, due_on: i.dueOn, containment: i.containment, root_cause: i.rootCause, corrective_action: i.correctiveAction, preventive_action: i.preventiveAction };
    const d = diff(before, row);
    if (!d) return { id: i.id };
    const upd = await tx`update nonconformities set ${tx(row)} where id = ${i.id} returning id`;
    if (!upd.length) throw new AppError("No tiene permiso", 403);
    if (i.ownerUserId && i.ownerUserId !== before.owner_user_id && i.ownerUserId !== session.userId) {
      await tx`insert into notifications(org_id, user_id, kind, title, body, link, dedupe_key) values (${session.orgId}, ${i.ownerUserId}, 'nc_assigned', ${"Se le ha asignado " + before.code}, ${i.title}, ${"/no-conformidades/" + i.id}, ${"nc_assigned:" + i.id + ":" + i.ownerUserId}) on conflict do nothing`;
    }
    await audit(tx, session, { action: "update", entityType: "nonconformity", entityId: i.id, summary: `${before.code} actualizada`, before: d.before, after: d.after });
    revalidatePath(`/no-conformidades/${i.id}`);
    return { id: i.id };
  },
);

export const transitionNcAction = defineAction(
  { permission: ["edit", "validate"], schema: z.object({ id: z.string().uuid(), to: z.enum(NC_STATUSES), comment: z.string().trim().max(2000).nullable(), verificationNotes: z.string().trim().max(4000).nullable() }) },
  async (i, { tx, session }) => {
    await transitionNonconformity(tx, session, session.permissions, i.id, i.to, { comment: i.comment, verificationNotes: i.verificationNotes });
    revalidatePath(`/no-conformidades/${i.id}`);
    return { id: i.id };
  },
);

export const addNcActionAction = defineAction(
  { permission: ["edit", "validate", "create"], schema: z.object({ ncId: z.string().uuid(), kind: z.enum(["containment", "corrective", "preventive"]), description: z.string().trim().min(3).max(4000), ownerUserId: nul(z.string().uuid()), dueOn: nul(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)) }) },
  async (i, { tx, session }) => {
    const [visible] = await tx`select id from nonconformities where id = ${i.ncId}`;
    if (!visible) throw new AppError("No encontrada", 404);
    // Mismo bloqueo que el cierre: o se ve la acción abierta al cerrar, o aquí se ve la NC cerrada
    const [nc] = await tx`select code, status from nonconformities where id = ${i.ncId} for update`;
    if (!nc) throw new AppError("No tiene permiso para modificar esta no conformidad", 403);
    if (nc.status === "closed") throw new AppError("La NC está cerrada");
    const [a] = await tx`insert into nc_actions(org_id, nc_id, kind, description, owner_user_id, due_on, created_by) values (${session.orgId}, ${i.ncId}, ${i.kind}, ${i.description}, ${i.ownerUserId}, ${i.dueOn}, ${session.userId}) returning id`;
    if (i.ownerUserId && i.ownerUserId !== session.userId) {
      await tx`insert into notifications(org_id, user_id, kind, title, body, link, dedupe_key) values (${session.orgId}, ${i.ownerUserId}, 'nc_action', ${`Acción asignada en ${nc.code}`}, ${i.description.slice(0, 200)}, ${"/no-conformidades/" + i.ncId}, ${"nc_action:" + a.id}) on conflict do nothing`;
    }
    await audit(tx, session, { action: "add_action", entityType: "nonconformity", entityId: i.ncId, summary: `${nc.code}: acción ${i.kind} añadida`, after: i });
    revalidatePath(`/no-conformidades/${i.ncId}`);
    return { id: a.id };
  },
);

export const completeNcActionAction = defineAction(
  { permission: ["edit", "validate"], schema: z.object({ id: z.string().uuid(), status: z.enum(["done", "cancelled"]) }) },
  async (i, { tx, session }) => {
    const [a] = await tx`update nc_actions set status = ${i.status}, completed_at = now() where id = ${i.id} and status = 'open' returning nc_id, kind`;
    if (!a) throw new AppError("Acción no encontrada o ya cerrada");
    await audit(tx, session, { action: "action_" + i.status, entityType: "nonconformity", entityId: a.nc_id, summary: `Acción ${a.kind} ${i.status === "done" ? "completada" : "cancelada"}` });
    revalidatePath(`/no-conformidades/${a.nc_id}`);
    return { id: i.id };
  },
);

export const uploadNcDocumentAction = defineAction({ permission: ["edit", "validate", "create"], schema: z.instanceof(FormData) }, async (fd, { tx, session }) => {
  const id = z.string().uuid().parse(fd.get("ncId"));
  const f = fd.get("file");
  if (!(f instanceof File) || f.size === 0) throw new AppError("Seleccione un archivo");
  const [nc] = await tx`select code from nonconformities where id = ${id}`;
  if (!nc) throw new AppError("No encontrada", 404);
  const doc = await saveDocument(tx, session, { entityType: "nonconformity", entityId: id, kind: "attachment", fileName: f.name, data: Buffer.from(await f.arrayBuffer()) });
  await audit(tx, session, { action: "attach", entityType: "nonconformity", entityId: id, summary: `${nc.code}: adjunto ${f.name}`.slice(0, 500) });
  revalidatePath(`/no-conformidades/${id}`);
  return { id: doc.id };
});
