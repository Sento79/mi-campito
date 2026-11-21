"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/server/action";
import { audit, diff } from "@/lib/server/audit";
import { AppError } from "@/lib/server/errors";
import { PERIOD_UNITS } from "@/lib/domain/periodicity";

const nul = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === "" || v === undefined ? null : v), s.nullable());

const categorySchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,40}$/, "Código no válido"),
  name: z.string().trim().min(1).max(200),
  description: nul(z.string().max(2000)),
  inspectionType: nul(z.string().max(120)),
  quantity: nul(z.string().max(120)),
  unit: nul(z.string().max(10)),
  recordMethod: z.enum(["numeric", "select", "multipoint", "checklist", "combined"]),
  procedureId: nul(z.string().uuid()),
  criterionId: nul(z.string().uuid()),
  periodUnit: nul(z.enum(PERIOD_UNITS)),
  periodCount: nul(z.coerce.number().int().positive().max(9999)),
  instrumentRequired: z.boolean(),
  instrumentTypes: z.string().max(500).transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  requiredFields: z.array(z.enum(["comment", "photo", "instrument"])).default([]),
  instructions: nul(z.string().max(4000)),
  precautions: nul(z.string().max(4000)),
  isActive: z.boolean(),
});

function toRow(i: z.infer<typeof categorySchema>) {
  return {
    code: i.code, name: i.name, description: i.description, inspection_type: i.inspectionType, quantity: i.quantity, unit: i.unit,
    record_method: i.recordMethod, procedure_id: i.procedureId, criterion_id: i.criterionId,
    period_unit: i.periodUnit, period_count: i.periodUnit ? i.periodCount : null,
    instrument_required: i.instrumentRequired, instrument_types: i.instrumentTypes, required_fields: i.requiredFields,
    instructions: i.instructions, precautions: i.precautions, is_active: i.isActive,
  };
}

export const saveCategoryAction = defineAction(
  { permission: "criteria.manage", schema: z.object({ id: z.string().uuid().nullable(), data: categorySchema }) },
  async ({ id, data }, { tx, session }) => {
    if (data.periodUnit && !data.periodCount) throw new AppError("Indique cada cuánto", 422, { "data.periodCount": "Obligatorio con unidad" });
    const row = toRow(data);
    if (!id) {
      const [c] = await tx`insert into categories ${tx({ ...row, org_id: session.orgId })} returning id`;
      await audit(tx, session, { action: "create", entityType: "category", entityId: c.id, summary: `Categoría creada: ${row.code} · ${row.name}`, after: row });
      revalidatePath("/inventario/categorias");
      return { id: c.id as string };
    }
    const [before] = await tx`select * from categories where id = ${id}`;
    if (!before) throw new AppError("Categoría no encontrada", 404);
    const d = diff(before, row);
    if (d) {
      await tx`update categories set ${tx(row)} where id = ${id}`;
      await audit(tx, session, { action: "update", entityType: "category", entityId: id, summary: `Categoría ${row.code} modificada`, before: d.before, after: d.after });
    }
    revalidatePath(`/inventario/categorias/${id}`);
    return { id };
  },
);

const itemSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9_.-]{1,20}$/, "Código de punto no válido"),
  name: z.string().trim().min(1).max(120),
  instructions: z.string().max(500).nullable().optional(),
  required: z.boolean(),
  criterionId: z.string().uuid().nullable().optional(),
});

export const saveTemplateAction = defineAction(
  { permission: "criteria.manage", schema: z.object({ categoryId: z.string().uuid(), templateId: z.string().uuid().nullable(), name: z.string().trim().min(1).max(120), items: z.array(itemSchema).min(1, "Añada al menos un punto").max(200) }) },
  async (i, { tx, session }) => {
    const codes = new Set<string>();
    for (const it of i.items) {
      if (codes.has(it.code.toUpperCase())) throw new AppError(`Código de punto repetido: ${it.code}`, 422);
      codes.add(it.code.toUpperCase());
    }
    let templateId = i.templateId;
    let before: unknown = null;
    if (templateId) {
      before = await tx`select code, name, required, criterion_id from point_template_items where template_id = ${templateId} order by sort_order`;
      await tx`update point_templates set name = ${i.name} where id = ${templateId}`;
      await tx`delete from point_template_items where template_id = ${templateId}`;
    } else {
      const [t] = await tx`insert into point_templates(org_id, category_id, name) values (${session.orgId}, ${i.categoryId}, ${i.name}) returning id`;
      templateId = t.id;
    }
    for (const [k, it] of i.items.entries()) {
      await tx`insert into point_template_items(org_id, template_id, code, name, sort_order, instructions, required, criterion_id)
               values (${session.orgId}, ${templateId}, ${it.code}, ${it.name}, ${k}, ${it.instructions ?? null}, ${it.required}, ${it.criterionId ?? null})`;
    }
    await audit(tx, session, { action: i.templateId ? "update" : "create", entityType: "point_template", entityId: templateId, summary: `Plantilla multipunto «${i.name}» guardada (${i.items.length} puntos)`, before, after: i.items });
    revalidatePath(`/inventario/categorias/${i.categoryId}`);
    return { id: templateId! };
  },
);
