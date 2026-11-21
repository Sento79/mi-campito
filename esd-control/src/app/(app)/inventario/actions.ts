"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/server/action";
import { archiveAssets, assetInputSchema, commitImport, createAsset, moveAssets, previewImport, reactivateAsset, updateAsset } from "@/lib/server/services/assets";
import { parseSheet } from "@/lib/server/parse-sheet";
import { saveDocument } from "@/lib/server/storage";
import { audit } from "@/lib/server/audit";
import { AppError } from "@/lib/server/errors";

const ids = z.array(z.string().uuid()).min(1).max(1000);

export const createAssetAction = defineAction({ permission: "create", schema: assetInputSchema }, async (i, { tx, session }) => {
  const id = await createAsset(tx, session, i);
  revalidatePath("/inventario");
  return { id };
});

export const updateAssetAction = defineAction({ permission: "edit", schema: z.object({ id: z.string().uuid(), data: assetInputSchema }) }, async ({ id, data }, { tx, session }) => {
  await updateAsset(tx, session, id, data);
  revalidatePath(`/inventario/${id}`);
  return { id };
});

export const moveAssetsAction = defineAction({ permission: "edit", schema: z.object({ ids, locationId: z.string().uuid().nullable(), reason: z.string().max(500).nullable() }) }, async (i, { tx, session }) => {
  await moveAssets(tx, session, i.ids, i.locationId, i.reason);
  revalidatePath("/inventario");
  return { count: i.ids.length };
});

export const archiveAssetsAction = defineAction({ permission: "edit", schema: z.object({ ids, reason: z.string().trim().min(3, "Indique el motivo").max(500) }) }, async (i, { tx, session }) => {
  const n = await archiveAssets(tx, session, i.ids, i.reason);
  revalidatePath("/inventario");
  return { count: n };
});

export const reactivateAssetAction = defineAction({ permission: "edit", schema: z.object({ id: z.string().uuid(), reason: z.string().max(500).nullable() }) }, async (i, { tx, session }) => {
  await reactivateAsset(tx, session, i.id, i.reason);
  revalidatePath(`/inventario/${i.id}`);
  return { id: i.id };
});

const fileSchema = z.instanceof(FormData);

async function readFile(fd: FormData, key = "file") {
  const f = fd.get(key);
  if (!(f instanceof File) || f.size === 0) throw new AppError("Seleccione un archivo");
  return { name: f.name, data: Buffer.from(await f.arrayBuffer()) };
}

export const previewImportAction = defineAction({ permission: "create", schema: fileSchema }, async (fd, { tx }) => {
  const f = await readFile(fd);
  const rows = await parseSheet(f.name, f.data);
  const p = await previewImport(tx, rows);
  return { ...p, valid: p.valid.slice(0, 200), validCount: p.valid.length };
});

export const commitImportAction = defineAction({ permission: "create", schema: fileSchema }, async (fd, { tx, session }) => {
  const f = await readFile(fd);
  const rows = await parseSheet(f.name, f.data);
  const n = await commitImport(tx, session, rows, f.name);
  revalidatePath("/inventario");
  return { count: n };
});

export const uploadAssetDocumentAction = defineAction({ permission: "edit", schema: fileSchema }, async (fd, { tx, session }) => {
  const assetId = z.string().uuid().parse(fd.get("assetId"));
  const kind = z.enum(["attachment", "photo"]).parse(fd.get("kind") ?? "attachment");
  const f = await readFile(fd);
  const [a] = await tx`select code from assets where id = ${assetId}`;
  if (!a) throw new AppError("Activo no encontrado", 404);
  const doc = await saveDocument(tx, session, { entityType: "asset", entityId: assetId, kind, fileName: f.name, data: f.data });
  await audit(tx, session, { action: "attach", entityType: "asset", entityId: assetId, summary: `Documento adjuntado a ${a.code}: ${f.name}`.slice(0, 500) });
  revalidatePath(`/inventario/${assetId}`);
  return { id: doc.id };
});
