import "server-only";
import { z } from "zod";
import type { Tx, Ctx } from "../db";
import { audit, diff } from "../audit";
import { AppError, NotFoundError } from "../errors";
import { saveDocument, sniffMime } from "../storage";
import { imageSize } from "../image-size";

export interface PlanUpload {
  original: { name: string; data: Buffer };
  /** Para PDF: páginas renderizadas en el cliente (PNG). Para imágenes: vacío. */
  pages: { name: string; data: Buffer }[];
}

const MAX_PAGES = 30;

/** Guarda una versión de plano (original + imágenes de página) y devuelve su id. */
async function storeVersion(tx: Tx, ctx: Ctx, planId: string, version: number, up: PlanUpload, meta: { label: string | null; effectiveOn: string; notes: string | null }) {
  const mime = sniffMime(up.original.data);
  if (!mime) throw new AppError("Tipo de archivo no permitido (PDF, PNG o JPG)");
  const orig = await saveDocument(tx, ctx, { entityType: "floor_plan", entityId: planId, kind: "plan_original", fileName: up.original.name, data: up.original.data });
  const pages: { docId: string; w: number; h: number }[] = [];
  if (mime === "application/pdf") {
    if (up.pages.length === 0) throw new AppError("El PDF debe procesarse en el navegador antes de subirlo (no se recibieron páginas)");
    if (up.pages.length > MAX_PAGES) throw new AppError(`Máximo ${MAX_PAGES} páginas por plano`);
    for (const [i, p] of up.pages.entries()) {
      const size = imageSize(p.data);
      if (!size || sniffMime(p.data) !== "image/png") throw new AppError(`La página ${i + 1} no es una imagen PNG válida`);
      if (size.width > 12000 || size.height > 12000) throw new AppError("Resolución de página excesiva");
      const d = await saveDocument(tx, ctx, { entityType: "floor_plan", entityId: planId, kind: "plan_page", fileName: `${up.original.name}-p${i + 1}.png`, data: p.data, allowed: ["image/png"] });
      pages.push({ docId: d.id, w: size.width, h: size.height });
    }
  } else {
    const size = imageSize(up.original.data);
    if (!size) throw new AppError("No se pudieron leer las dimensiones de la imagen");
    if (size.width > 16000 || size.height > 16000) throw new AppError("Resolución de imagen excesiva (máx. 16000 px)");
    pages.push({ docId: orig.id, w: size.width, h: size.height });
  }
  const [v] = await tx`insert into floor_plan_versions(org_id, plan_id, version, label, effective_on, original_document_id, page_count, notes, created_by)
    values (${ctx.orgId}, ${planId}, ${version}, ${meta.label}, ${meta.effectiveOn}, ${orig.id}, ${pages.length}, ${meta.notes}, ${ctx.userId}) returning id`;
  for (const [i, p] of pages.entries()) {
    await tx`insert into floor_plan_pages(org_id, version_id, page_number, image_document_id, width_px, height_px) values (${ctx.orgId}, ${v.id}, ${i + 1}, ${p.docId}, ${p.w}, ${p.h})`;
  }
  return { versionId: v.id as string, pages };
}

export const planMetaSchema = z.object({
  title: z.string().trim().min(1, "Obligatorio").max(200),
  locationId: z.string().uuid().nullable(),
  ownerUserId: z.string().uuid().nullable(),
  effectiveOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string().trim().max(120).nullable(),
  notes: z.string().trim().max(2000).nullable(),
});

export async function createPlan(tx: Tx, ctx: Ctx, meta: z.infer<typeof planMetaSchema>, up: PlanUpload) {
  const [p] = await tx`insert into floor_plans(org_id, title, location_id, owner_user_id, created_by) values (${ctx.orgId}, ${meta.title}, ${meta.locationId}, ${meta.ownerUserId}, ${ctx.userId}) returning id`;
  const v = await storeVersion(tx, ctx, p.id, 1, up, meta);
  await tx`update floor_plans set current_version_id = ${v.versionId} where id = ${p.id}`;
  await audit(tx, ctx, { action: "create", entityType: "floor_plan", entityId: p.id, summary: `Plano creado: ${meta.title} (${v.pages.length} página/s)` });
  return p.id as string;
}

export async function addPlanVersion(tx: Tx, ctx: Ctx, planId: string, meta: { label: string | null; effectiveOn: string; notes: string | null; reason: string }, up: PlanUpload) {
  const [plan] = await tx`select p.id, p.title, p.current_version_id, (select max(version) from floor_plan_versions where plan_id = p.id) as maxv from floor_plans p where p.id = ${planId} for update`;
  if (!plan) throw new NotFoundError("Plano no encontrado");
  const [active] = await tx`select code from campaigns where plan_id = ${planId} and status = 'in_progress' limit 1`;
  if (active) throw new AppError(`La campaña ${active.code} está en curso sobre este plano. Finalícela o páusela antes de cambiar de versión.`, 409);
  const [old] = await tx`select width_px, height_px from floor_plan_pages where version_id = ${plan.current_version_id} and page_number = 1`;
  const v = await storeVersion(tx, ctx, planId, (plan.maxv ?? 0) + 1, up, meta);
  await tx`update floor_plans set current_version_id = ${v.versionId} where id = ${planId}`;
  let warning: string | null = null;
  if (old) {
    const r0 = old.width_px / old.height_px;
    const r1 = v.pages[0].w / v.pages[0].h;
    if (Math.abs(r0 - r1) / r0 > 0.02) warning = "La proporción de la nueva versión es distinta: revise la posición de los puntos.";
  }
  await audit(tx, ctx, { action: "new_version", entityType: "floor_plan", entityId: planId, summary: `Nueva versión ${(plan.maxv ?? 0) + 1} del plano ${plan.title}`, reason: meta.reason, before: { version_id: plan.current_version_id }, after: { version_id: v.versionId } });
  return { versionId: v.versionId, warning };
}

// ---------------------------------------------------------------------------
// Puntos
// ---------------------------------------------------------------------------
const coord = z.number().min(0).max(1);
export const pointSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_.\-]{0,39}$/, "Código no válido"),
  name: z.string().trim().min(1).max(200),
  pointType: z.enum(["measurement", "asset", "reference"]),
  categoryId: z.string().uuid().nullable(),
  locationId: z.string().uuid().nullable(),
  assetId: z.string().uuid().nullable(),
  criterionId: z.string().uuid().nullable(),
  routeOrder: z.number().int().min(1).max(100000).nullable(),
  notes: z.string().trim().max(1000).nullable(),
});
export type PointInput = z.infer<typeof pointSchema>;

/** Activa la anulación de bloqueo por campaña en curso (solo dentro de esta transacción). */
async function layoutOverride(tx: Tx, planId: string, overrideReason: string | null | undefined) {
  const [active] = await tx`select code from campaigns where plan_id = ${planId} and status = 'in_progress' limit 1`;
  if (!active) return null;
  if (!overrideReason || overrideReason.trim().length < 3) {
    throw new AppError(`LAYOUT_LOCKED:La campaña ${active.code} está en curso sobre este plano. Para modificar la disposición indique un motivo.`, 409);
  }
  await tx`select set_config('app.layout_override', 'on', true)`;
  return active.code as string;
}

function pointRow(p: PointInput) {
  if (p.pointType === "asset" && !p.assetId) throw new AppError("Un punto de tipo activo debe vincular un activo", 422, { assetId: "Obligatorio" });
  return {
    code: p.code, name: p.name, point_type: p.pointType, category_id: p.categoryId, location_id: p.locationId,
    asset_id: p.assetId, criterion_id: p.criterionId, route_order: p.routeOrder, notes: p.notes,
  };
}

export async function createPoint(tx: Tx, ctx: Ctx, planId: string, page: number, x: number, y: number, p: PointInput, overrideReason?: string | null) {
  coord.parse(x);
  coord.parse(y);
  const camp = await layoutOverride(tx, planId, overrideReason);
  const row = pointRow(p);
  const [dup] = await tx`select 1 from plan_points where plan_id = ${planId} and code = ${p.code} and archived_at is null`;
  if (dup) throw new AppError("Ya existe un punto activo con ese código en el plano", 409, { code: "Duplicado" });
  const [pt] = await tx`insert into plan_points ${tx({ ...row, org_id: ctx.orgId, plan_id: planId, page_number: page, x, y, created_by: ctx.userId })} returning id`;
  await audit(tx, ctx, { action: "create", entityType: "plan_point", entityId: pt.id, summary: `Punto ${p.code} añadido al plano${camp ? ` (campaña ${camp} en curso)` : ""}`, after: { ...row, x, y, page }, reason: overrideReason ?? null });
  return pt.id as string;
}

export async function updatePoint(tx: Tx, ctx: Ctx, id: string, p: PointInput) {
  const [before] = await tx`select * from plan_points where id = ${id}`;
  if (!before) throw new NotFoundError("Punto no encontrado");
  const row = pointRow(p);
  if (row.code !== before.code) {
    const [dup] = await tx`select 1 from plan_points where plan_id = ${before.plan_id} and code = ${p.code} and archived_at is null and id <> ${id}`;
    if (dup) throw new AppError("Ya existe un punto activo con ese código en el plano", 409, { code: "Duplicado" });
  }
  const d = diff(before, row);
  if (!d) return;
  await tx`update plan_points set ${tx(row)} where id = ${id}`;
  await audit(tx, ctx, { action: "update", entityType: "plan_point", entityId: id, summary: `Punto ${row.code} modificado`, before: d.before, after: d.after });
}

export async function movePoint(tx: Tx, ctx: Ctx, id: string, x: number, y: number, overrideReason?: string | null) {
  coord.parse(x);
  coord.parse(y);
  const [before] = await tx`select plan_id, code, x, y from plan_points where id = ${id} and archived_at is null`;
  if (!before) throw new NotFoundError("Punto no encontrado o archivado");
  await layoutOverride(tx, before.plan_id, overrideReason);
  await tx`update plan_points set x = ${x}, y = ${y} where id = ${id}`;
  await audit(tx, ctx, { action: "move", entityType: "plan_point", entityId: id, summary: `Punto ${before.code} reubicado`, before: { x: Number(before.x), y: Number(before.y) }, after: { x, y }, reason: overrideReason ?? null });
}

export async function archivePoint(tx: Tx, ctx: Ctx, id: string, reason: string, overrideReason?: string | null) {
  const [before] = await tx`select plan_id, code from plan_points where id = ${id} and archived_at is null`;
  if (!before) throw new NotFoundError("Punto no encontrado o ya archivado");
  await layoutOverride(tx, before.plan_id, overrideReason ?? reason);
  const [pending] = await tx`select c.code from campaign_items ci join campaigns c on c.id = ci.campaign_id where ci.plan_point_id = ${id} and ci.status = 'pending' and c.status in ('planned','in_progress') limit 1`;
  if (pending) throw new AppError(`El punto está pendiente en la campaña ${pending.code}. Márquelo como omitido allí antes de archivarlo.`, 409);
  await tx`update plan_points set archived_at = now(), archived_reason = ${reason} where id = ${id}`;
  await audit(tx, ctx, { action: "archive", entityType: "plan_point", entityId: id, summary: `Punto ${before.code} archivado`, reason });
}

/** Asigna orden de ruta según la lista de ids recibida. */
export async function setRoute(tx: Tx, ctx: Ctx, planId: string, ids: string[]) {
  const pts = await tx`select id from plan_points where plan_id = ${planId} and archived_at is null`;
  const valid = new Set(pts.map((p) => p.id));
  if (!ids.every((i) => valid.has(i))) throw new AppError("La ruta contiene puntos que no pertenecen al plano");
  await tx`update plan_points set route_order = null where plan_id = ${planId} and archived_at is null`;
  for (const [i, id] of ids.entries()) await tx`update plan_points set route_order = ${i + 1} where id = ${id}`;
  await audit(tx, ctx, { action: "route", entityType: "floor_plan", entityId: planId, summary: `Ruta de medición definida (${ids.length} puntos)` });
}
