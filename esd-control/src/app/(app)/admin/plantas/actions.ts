"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/server/action";
import { audit, diff } from "@/lib/server/audit";
import { AppError } from "@/lib/server/errors";

const schema = z.object({
  id: z.string().uuid().nullable(),
  parentId: z.string().uuid().nullable(),
  kind: z.enum(["company", "plant", "building", "floor", "area", "zone", "line", "spot", "other"]),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_.\-/]{0,39}$/, "Código no válido"),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable(),
  isActive: z.boolean(),
});

export const saveLocationAction = defineAction({ permission: ["settings.manage", "create", "edit"], schema }, async (i, { tx, session }) => {
  const row = { parent_id: i.parentId, kind: i.kind, code: i.code, name: i.name, description: i.description || null, is_active: i.isActive };
  if (i.id) {
    if (i.parentId) {
      const [cyc] = await tx`select 1 from app_location_subtree(${i.id}) as t(id) where t.id = ${i.parentId}`;
      if (cyc) throw new AppError("Una ubicación no puede colgar de sí misma ni de sus descendientes", 422);
    }
    if (!i.isActive) {
      const [{ n }] = await tx`select count(*)::int as n from assets where location_id in (select app_location_subtree(${i.id})) and archived_at is null`;
      if (n > 0) throw new AppError(`No se puede desactivar: contiene ${n} activo(s). Muévalos antes.`, 422);
    }
    const [before] = await tx`select * from locations where id = ${i.id}`;
    const upd = await tx`update locations set ${tx(row)} where id = ${i.id} returning id`;
    if (!upd.length) throw new AppError("No tiene permiso para editar ubicaciones", 403);
    const d = diff(before, row);
    if (d) await audit(tx, session, { action: "update", entityType: "location", entityId: i.id, summary: `Ubicación ${i.code} modificada`, before: d.before, after: d.after });
  } else {
    const [l] = await tx`insert into locations ${tx({ ...row, org_id: session.orgId })} returning id`;
    await audit(tx, session, { action: "create", entityType: "location", entityId: l.id, summary: `Ubicación creada: ${i.code} · ${i.name}`, after: row });
  }
  revalidatePath("/admin/plantas");
  revalidatePath("/inventario/ubicaciones");
  return { ok: true };
});
