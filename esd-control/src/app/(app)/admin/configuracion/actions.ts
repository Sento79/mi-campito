"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/server/action";
import { audit, diff } from "@/lib/server/audit";
import { AppError } from "@/lib/server/errors";
import { saveDocument } from "@/lib/server/storage";
import { orgSettingsSchema } from "@/lib/domain/settings";

export const saveSettingsAction = defineAction({ permission: "settings.manage", schema: orgSettingsSchema }, async (i, { tx, session }) => {
  const [o] = await tx`select settings from organizations where id = ${session.orgId} for update`;
  const next = { ...i, company: { ...i.company, logoDocumentId: o.settings?.company?.logoDocumentId ?? null } };
  const d = diff(o.settings ?? {}, next as Record<string, unknown>);
  await tx`update organizations set settings = ${tx.json(next as never)} where id = ${session.orgId}`;
  if (d) await audit(tx, session, { action: "update", entityType: "organization", entityId: session.orgId, summary: "Configuración de la organización modificada", before: d.before, after: d.after });
  revalidatePath("/", "layout");
  return { ok: true };
});

export const uploadLogoAction = defineAction({ permission: "settings.manage", schema: z.instanceof(FormData) }, async (fd, { tx, session }) => {
  const f = fd.get("file");
  if (!(f instanceof File) || f.size === 0) throw new AppError("Seleccione una imagen");
  if (f.size > 1024 * 1024) throw new AppError("El logo no puede superar 1 MB");
  const doc = await saveDocument(tx, session, { entityType: "organization", entityId: session.orgId, kind: "logo", fileName: f.name, data: Buffer.from(await f.arrayBuffer()), allowed: ["image/png", "image/jpeg"] });
  await tx`update organizations set settings = jsonb_set(coalesce(settings, '{}'), '{company,logoDocumentId}', ${tx.json(doc.id as never)}, true) where id = ${session.orgId}`;
  await audit(tx, session, { action: "update", entityType: "organization", entityId: session.orgId, summary: "Logo de la organización actualizado" });
  revalidatePath("/", "layout");
  return { id: doc.id };
});

export const saveSeveritiesAction = defineAction(
  { permission: "settings.manage", schema: z.array(z.object({ id: z.string().uuid().nullable(), key: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/), name: z.string().trim().min(1).max(60), rank: z.number().int().min(1).max(20), dueDays: z.number().int().positive().max(3650).nullable() })).min(1).max(10) },
  async (rows, { tx, session }) => {
    for (const r of rows) {
      if (r.id) await tx`update nc_severities set name = ${r.name}, rank = ${r.rank}, due_days = ${r.dueDays} where id = ${r.id}`;
      else await tx`insert into nc_severities(org_id, key, name, rank, due_days) values (${session.orgId}, ${r.key}, ${r.name}, ${r.rank}, ${r.dueDays})`;
    }
    await audit(tx, session, { action: "update", entityType: "organization", entityId: session.orgId, summary: "Gravedades de NC actualizadas", after: rows });
    revalidatePath("/admin/configuracion");
    return { ok: true };
  },
);
