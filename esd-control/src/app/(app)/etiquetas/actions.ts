"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/server/action";
import { audit } from "@/lib/server/audit";
import { labelLayoutSchema } from "@/lib/domain/labels";

export const saveLabelTemplateAction = defineAction(
  { permission: ["create", "edit"], schema: z.object({ id: z.string().uuid().nullable(), name: z.string().trim().min(1).max(120), widthMm: z.number().min(10).max(300), heightMm: z.number().min(10).max(300), layout: labelLayoutSchema, isDefault: z.boolean() }) },
  async (i, { tx, session }) => {
    if (i.isDefault) await tx`update label_templates set is_default = false where is_default`;
    let id = i.id;
    if (id) await tx`update label_templates set name = ${i.name}, width_mm = ${i.widthMm}, height_mm = ${i.heightMm}, layout = ${tx.json(i.layout as never)}, is_default = ${i.isDefault} where id = ${id}`;
    else id = (await tx`insert into label_templates(org_id, name, width_mm, height_mm, layout, is_default, created_by) values (${session.orgId}, ${i.name}, ${i.widthMm}, ${i.heightMm}, ${tx.json(i.layout as never)}, ${i.isDefault}, ${session.userId}) returning id`)[0].id;
    await audit(tx, session, { action: i.id ? "update" : "create", entityType: "label_template", entityId: id, summary: `Plantilla de etiqueta «${i.name}» guardada` });
    revalidatePath("/etiquetas");
    return { id: id! };
  },
);

export const searchAssetsForLabelsAction = defineAction(
  { permission: "read", schema: z.object({ q: z.string().max(80).default(""), categoryId: z.string().uuid().nullable(), locationId: z.string().uuid().nullable() }) },
  async (i, { tx }) => {
    const like = `%${i.q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    return tx`select id, code, name from assets a where a.archived_at is null
      ${i.q ? tx`and (a.code ilike ${like} or a.name ilike ${like})` : tx``}
      ${i.categoryId ? tx`and a.category_id = ${i.categoryId}` : tx``}
      ${i.locationId ? tx`and a.location_id in (select app_location_subtree(${i.locationId}))` : tx``}
      order by a.code limit 500` as unknown as Promise<{ id: string; code: string; name: string }[]>;
  },
);
