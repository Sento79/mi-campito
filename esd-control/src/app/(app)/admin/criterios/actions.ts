"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/server/action";
import { audit, diff } from "@/lib/server/audit";
import { AppError } from "@/lib/server/errors";
import { saveDocument } from "@/lib/server/storage";
import { criterionRulesSchema } from "@/lib/domain/criteria";

export const createCriterionAction = defineAction(
  { permission: "criteria.manage", schema: z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_.-]{1,40}$/, "Código no válido"), name: z.string().trim().min(1).max(200), description: z.string().trim().max(2000).nullable() }) },
  async (i, { tx, session }) => {
    const [c] = await tx`insert into criteria(org_id, code, name, description) values (${session.orgId}, ${i.code}, ${i.name}, ${i.description}) returning id`;
    await audit(tx, session, { action: "create", entityType: "criterion", entityId: c.id, summary: `Criterio ${i.code} creado` });
    revalidatePath("/admin/criterios");
    return { id: c.id as string };
  },
);

/** Crea una versión en BORRADOR. Las reglas se validan con el mismo esquema que usa el motor. */
export const createVersionAction = defineAction(
  { permission: "criteria.manage", schema: z.object({ criterionId: z.string().uuid(), rules: z.unknown(), procedureId: z.string().uuid().nullable(), normReference: z.string().trim().max(300).nullable(), changeReason: z.string().trim().min(3, "Indique el motivo del cambio").max(2000) }) },
  async (i, { tx, session }) => {
    const rules = criterionRulesSchema.safeParse(i.rules);
    if (!rules.success) throw new AppError("Reglas no válidas: " + rules.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).slice(0, 3).join("; "), 422);
    const [{ v }] = await tx`select coalesce(max(version), 0) + 1 as v from criterion_versions where criterion_id = ${i.criterionId}`;
    const [proc] = i.procedureId ? await tx`select revision from procedures where id = ${i.procedureId}` : [null];
    const unit = rules.data.kind === "numeric" ? rules.data.unit : rules.data.kind === "multipoint" ? rules.data.point.unit : null;
    const [cv] = await tx`insert into criterion_versions(org_id, criterion_id, version, status, rules, unit, procedure_id, procedure_revision, norm_reference, change_reason, created_by)
      values (${session.orgId}, ${i.criterionId}, ${v}, 'draft', ${tx.json(rules.data as never)}, ${unit}, ${i.procedureId}, ${proc?.revision ?? null}, ${i.normReference}, ${i.changeReason}, ${session.userId}) returning id`;
    await audit(tx, session, { action: "create_version", entityType: "criterion", entityId: i.criterionId, summary: `Borrador v${v} creado`, after: rules.data, reason: i.changeReason });
    revalidatePath(`/admin/criterios/${i.criterionId}`);
    return { id: cv.id as string, version: v as number };
  },
);

/** Publica (activa) un borrador. La versión activa anterior pasa a «sustituida». */
export const activateVersionAction = defineAction({ permission: "criteria.manage", schema: z.object({ versionId: z.string().uuid() }) }, async (i, { tx, session }) => {
  const [v] = await tx`select id, criterion_id, version, status, rules from criterion_versions where id = ${i.versionId} for update`;
  if (!v) throw new AppError("Versión no encontrada", 404);
  if (v.status !== "draft") throw new AppError("Solo se pueden publicar borradores");
  const [prev] = await tx`update criterion_versions set status = 'superseded' where criterion_id = ${v.criterion_id} and status = 'active' returning version, rules`;
  await tx`update criterion_versions set status = 'active', approved_by = ${session.userId}, approved_at = now(), valid_from = now() where id = ${i.versionId}`;
  await audit(tx, session, { action: "activate_version", entityType: "criterion", entityId: v.criterion_id, summary: `Versión v${v.version} publicada${prev ? ` (sustituye a v${prev.version})` : ""}`, before: prev?.rules ?? null, after: v.rules });
  revalidatePath(`/admin/criterios/${v.criterion_id}`);
  return { id: i.versionId };
});

export const discardDraftAction = defineAction({ permission: "criteria.manage", schema: z.object({ versionId: z.string().uuid() }) }, async (i, { tx, session }) => {
  const [v] = await tx`delete from criterion_versions where id = ${i.versionId} and status = 'draft' returning criterion_id, version`;
  if (!v) throw new AppError("Solo se pueden descartar borradores");
  await audit(tx, session, { action: "discard_version", entityType: "criterion", entityId: v.criterion_id, summary: `Borrador v${v.version} descartado` });
  revalidatePath(`/admin/criterios/${v.criterion_id}`);
  return { id: i.versionId };
});

export const retireCriterionAction = defineAction({ permission: "criteria.manage", schema: z.object({ criterionId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }) }, async (i, { tx, session }) => {
  await tx`update criterion_versions set status = 'retired' where criterion_id = ${i.criterionId} and status = 'active'`;
  await tx`update criteria set is_active = false where id = ${i.criterionId}`;
  await audit(tx, session, { action: "retire", entityType: "criterion", entityId: i.criterionId, summary: "Criterio retirado: las mediciones nuevas quedarán en revisión", reason: i.reason });
  revalidatePath(`/admin/criterios/${i.criterionId}`);
  return { id: i.criterionId };
});

const procSchema = z.object({ id: z.string().uuid().nullable(), code: z.string().trim().min(1).max(40), title: z.string().trim().min(1).max(200), revision: z.string().trim().min(1).max(20), normReference: z.string().trim().max(300).nullable(), description: z.string().trim().max(4000).nullable(), isActive: z.boolean(), reason: z.string().trim().max(500).nullable() });

export const saveProcedureAction = defineAction({ permission: "criteria.manage", schema: procSchema }, async (i, { tx, session }) => {
  const row = { code: i.code, title: i.title, revision: i.revision, norm_reference: i.normReference || null, description: i.description || null, is_active: i.isActive };
  if (!i.id) {
    const [p] = await tx`insert into procedures ${tx({ ...row, org_id: session.orgId, created_by: session.userId })} returning id`;
    await audit(tx, session, { action: "create", entityType: "procedure", entityId: p.id, summary: `Procedimiento ${i.code} rev. ${i.revision} creado` });
    revalidatePath("/admin/criterios/procedimientos");
    return { id: p.id as string };
  }
  const [before] = await tx`select * from procedures where id = ${i.id}`;
  const d = diff(before, row);
  if (d && "revision" in d.after && !i.reason) throw new AppError("Indique el motivo del cambio de revisión", 422, { reason: "Obligatorio" });
  if (d) {
    await tx`update procedures set ${tx(row)} where id = ${i.id}`;
    await audit(tx, session, { action: "update", entityType: "procedure", entityId: i.id, summary: `Procedimiento ${i.code} modificado`, before: d.before, after: d.after, reason: i.reason });
  }
  revalidatePath("/admin/criterios/procedimientos");
  return { id: i.id };
});

export const uploadProcedureDocAction = defineAction({ permission: "criteria.manage", schema: z.instanceof(FormData) }, async (fd, { tx, session }) => {
  const id = z.string().uuid().parse(fd.get("procedureId"));
  const f = fd.get("file");
  if (!(f instanceof File) || f.size === 0) throw new AppError("Seleccione un archivo");
  const doc = await saveDocument(tx, session, { entityType: "procedure", entityId: id, kind: "procedure", fileName: f.name, data: Buffer.from(await f.arrayBuffer()), allowed: ["application/pdf"] });
  await tx`update procedures set document_id = ${doc.id} where id = ${id}`;
  await audit(tx, session, { action: "attach", entityType: "procedure", entityId: id, summary: `Documento del procedimiento: ${f.name}`.slice(0, 500) });
  revalidatePath("/admin/criterios/procedimientos");
  return { id: doc.id };
});
