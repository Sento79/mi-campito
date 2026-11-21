"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/server/action";
import { AppError } from "@/lib/server/errors";
import { addPlanVersion, archivePoint, createPlan, createPoint, movePoint, planMetaSchema, pointSchema, setRoute, updatePoint, type PlanUpload } from "@/lib/server/services/plans";

async function readUpload(fd: FormData): Promise<PlanUpload> {
  const f = fd.get("file");
  if (!(f instanceof File) || f.size === 0) throw new AppError("Seleccione el archivo del plano");
  const pages: PlanUpload["pages"] = [];
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("page_") && v instanceof File) pages.push({ name: v.name, data: Buffer.from(await v.arrayBuffer()) });
  }
  return { original: { name: f.name, data: Buffer.from(await f.arrayBuffer()) }, pages };
}
const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

export const createPlanAction = defineAction({ permission: "create", schema: z.instanceof(FormData) }, async (fd, { tx, session }) => {
  const meta = planMetaSchema.parse({ title: s(fd, "title") ?? "", locationId: s(fd, "locationId"), ownerUserId: s(fd, "ownerUserId"), effectiveOn: s(fd, "effectiveOn") ?? new Date().toISOString().slice(0, 10), label: s(fd, "label"), notes: s(fd, "notes") });
  const id = await createPlan(tx, session, meta, await readUpload(fd));
  revalidatePath("/planos");
  return { id };
});

export const addPlanVersionAction = defineAction({ permission: "edit", schema: z.instanceof(FormData) }, async (fd, { tx, session }) => {
  const planId = z.string().uuid().parse(fd.get("planId"));
  const reason = s(fd, "reason");
  if (!reason || reason.length < 3) throw new AppError("Indique el motivo de la nueva versión", 422);
  const r = await addPlanVersion(tx, session, planId, { label: s(fd, "label"), effectiveOn: s(fd, "effectiveOn") ?? new Date().toISOString().slice(0, 10), notes: s(fd, "notes"), reason }, await readUpload(fd));
  revalidatePath(`/planos/${planId}`);
  return r;
});

const override = z.string().trim().max(500).nullable().optional();

export const createPointAction = defineAction(
  { permission: ["create", "edit"], schema: z.object({ planId: z.string().uuid(), page: z.number().int().min(1), x: z.number(), y: z.number(), data: pointSchema, overrideReason: override }) },
  async (i, { tx, session }) => ({ id: await createPoint(tx, session, i.planId, i.page, i.x, i.y, i.data, i.overrideReason) }),
);

export const updatePointAction = defineAction({ permission: "edit", schema: z.object({ id: z.string().uuid(), data: pointSchema }) }, async (i, { tx, session }) => {
  await updatePoint(tx, session, i.id, i.data);
  return { id: i.id };
});

export const movePointAction = defineAction({ permission: "edit", schema: z.object({ id: z.string().uuid(), x: z.number(), y: z.number(), overrideReason: override }) }, async (i, { tx, session }) => {
  await movePoint(tx, session, i.id, i.x, i.y, i.overrideReason);
  return { id: i.id };
});

export const archivePointAction = defineAction({ permission: "edit", schema: z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(500), overrideReason: override }) }, async (i, { tx, session }) => {
  await archivePoint(tx, session, i.id, i.reason, i.overrideReason);
  return { id: i.id };
});

export const setRouteAction = defineAction({ permission: "edit", schema: z.object({ planId: z.string().uuid(), ids: z.array(z.string().uuid()).max(5000) }) }, async (i, { tx, session }) => {
  await setRoute(tx, session, i.planId, i.ids);
  return { count: i.ids.length };
});
