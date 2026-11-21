import "server-only";
import { z } from "zod";
import type { Tx, Ctx } from "../db";
import { audit, diff } from "../audit";
import { AppError, NotFoundError } from "../errors";
import { ASSET_STATUSES, assetCodeSchema, validateImport, type ImportPreview } from "@/lib/domain/asset-import";
import { PERIOD_UNITS } from "@/lib/domain/periodicity";

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const optUuid = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .pipe(z.string().uuid().nullable());

export const assetInputSchema = z
  .object({
    code: assetCodeSchema,
    scanCode: optText(120),
    name: z.string().trim().min(1, "Obligatorio").max(200),
    categoryId: z.string().uuid("Seleccione una categoría"),
    manufacturer: optText(120),
    model: optText(120),
    serialNumber: optText(120),
    locationId: optUuid,
    commissionedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida"),
    status: z.enum(ASSET_STATUSES),
    ownerUserId: optUuid,
    periodUnit: z
      .string()
      .optional()
      .nullable()
      .transform((v) => (v ? v : null))
      .pipe(z.enum(PERIOD_UNITS).nullable()),
    periodCount: z.coerce.number().int().positive().max(9999).optional().nullable().or(z.literal("").transform(() => null)),
    criterionId: optUuid,
    pointTemplateId: optUuid,
    notes: optText(4000),
    reason: optText(500),
  })
  .refine((v) => (v.periodUnit === null) === (v.periodCount === null || v.periodCount === undefined), {
    message: "Indique unidad y cantidad juntas (o ninguna para usar la de la categoría)",
    path: ["periodCount"],
  });
export type AssetInput = z.infer<typeof assetInputSchema>;

function toRow(i: AssetInput) {
  return {
    code: i.code,
    scan_code: i.scanCode ?? i.code,
    name: i.name,
    category_id: i.categoryId,
    manufacturer: i.manufacturer,
    model: i.model,
    serial_number: i.serialNumber,
    location_id: i.locationId,
    commissioned_on: i.commissionedOn,
    status: i.status,
    owner_user_id: i.ownerUserId,
    period_unit: i.periodUnit,
    period_count: i.periodUnit ? (i.periodCount ?? null) : null,
    criterion_id: i.criterionId,
    point_template_id: i.pointTemplateId,
    notes: i.notes,
  };
}

async function lockIdentifiers(tx: Tx) {
  // Sin restricción que compare code con scan_code: se serializan las altas/ediciones de la organización
  await tx`select pg_advisory_xact_lock(hashtext('asset-ids:' || app_current_org()::text))`;
}

async function assertUnique(tx: Tx, code: string, scan: string, exceptId?: string) {
  await lockIdentifiers(tx);
  // Espacio de nombres único: ni el ID ni el código de escaneo pueden coincidir con el ID o
  // el código de escaneo de OTRO activo (la búsqueda por escaneo acepta ambos).
  const [dup] = await tx`select code, scan_code from assets
    where (upper(code) = upper(${code}) or upper(code) = upper(${scan}) or scan_code = ${scan} or upper(scan_code) = upper(${code}))
    ${exceptId ? tx`and id <> ${exceptId}` : tx``} limit 1`;
  if (dup) {
    const codeClash = dup.code.toUpperCase() === code.toUpperCase() || dup.scan_code.toUpperCase() === code.toUpperCase();
    throw new AppError("Identificador duplicado", 409, codeClash ? { code: dup.code.toUpperCase() === code.toUpperCase() ? `El ID ${code} ya existe` : `El ID ${code} coincide con el código de escaneo del activo ${dup.code}` } : { scanCode: `El código de escaneo ${scan} ya lo usa el activo ${dup.code}` });
  }
}

export async function createAsset(tx: Tx, ctx: Ctx, i: AssetInput) {
  const row = toRow(i);
  await assertUnique(tx, row.code, row.scan_code);
  const [a] = await tx`insert into assets ${tx({ ...row, org_id: ctx.orgId, created_by: ctx.userId })} returning id`;
  await audit(tx, ctx, { action: "create", entityType: "asset", entityId: a.id, summary: `Alta de activo ${row.code} · ${row.name}`, after: row });
  return a.id as string;
}

export async function updateAsset(tx: Tx, ctx: Ctx, id: string, i: AssetInput) {
  const [before] = await tx`select * from assets where id = ${id}`;
  if (!before) throw new NotFoundError("Activo no encontrado");
  const row = toRow(i);
  await assertUnique(tx, row.code, row.scan_code, id);
  const d = diff(before, row);
  if (!d) return;
  const statusChange = "status" in d.after;
  if (statusChange && ["blocked", "retired"].includes(String(row.status)) && !i.reason) {
    throw new AppError("Indique el motivo del cambio de estado", 422, { reason: "Obligatorio al bloquear o retirar" });
  }
  // Orden de bloqueo categoría → activo, el mismo que al cambiar la periodicidad de una categoría
  // (evita interbloqueos). Se bloquean la categoría anterior y la nueva, en orden de id. Mediante
  // función: un FOR SHARE directo aplicaría la política RLS de UPDATE de categorías (criteria.manage).
  await tx`select app_lock_categories(${[before.category_id, row.category_id].filter(Boolean)}::uuid[])`;
  const upd = await tx`update assets set ${tx(row)} where id = ${id} returning id`;
  if (!upd.length) throw new AppError("No tiene permiso para editar este activo", 403);
  await audit(tx, ctx, { action: "update", entityType: "asset", entityId: id, summary: `Edición de activo ${row.code}`, before: d.before, after: d.after, reason: i.reason });
}

export async function moveAssets(tx: Tx, ctx: Ctx, ids: string[], locationId: string | null, reason: string | null) {
  const rows = await tx`select id, code, location_id from assets where id = any(${ids})`;
  const upd = await tx`update assets set location_id = ${locationId} where id = any(${ids}) returning id`;
  if (upd.length !== ids.length) throw new AppError("No tiene permiso para mover algunos activos", 403);
  for (const r of rows) {
    await audit(tx, ctx, { action: "move", entityType: "asset", entityId: r.id, summary: `Activo ${r.code} movido`, before: { location_id: r.location_id }, after: { location_id: locationId }, reason });
  }
}

export async function archiveAssets(tx: Tx, ctx: Ctx, ids: string[], reason: string) {
  const rows = await tx`select id, code from assets where id = any(${ids}) and archived_at is null`;
  const upd = await tx`update assets set archived_at = now() where id = any(${ids}) and archived_at is null returning id`;
  if (upd.length !== rows.length) throw new AppError("No tiene permiso para archivar algunos activos", 403);
  for (const r of rows) await audit(tx, ctx, { action: "archive", entityType: "asset", entityId: r.id, summary: `Activo ${r.code} archivado`, reason });
  return rows.length;
}

export async function reactivateAsset(tx: Tx, ctx: Ctx, id: string, reason: string | null) {
  const [r] = await tx`update assets set archived_at = null where id = ${id} and archived_at is not null returning code`;
  if (!r) throw new AppError("El activo no está archivado o no tiene permiso", 403);
  await audit(tx, ctx, { action: "reactivate", entityType: "asset", entityId: id, summary: `Activo ${r.code} reactivado`, reason });
}

/** Valida un archivo de importación (filas ya parseadas). */
export async function previewImport(tx: Tx, rows: string[][]): Promise<ImportPreview> {
  const [cats, locs, codes] = await Promise.all([
    tx`select upper(code) as code from categories where is_active`,
    tx`select upper(code) as code from locations where is_active`,
    tx`select upper(code) as code, upper(scan_code) as scan_code from assets`,
  ]);
  const uniq = (rows: readonly { code?: unknown }[]) => {
    const seen = new Map<string, number>();
    for (const r of rows) seen.set(String(r.code), (seen.get(String(r.code)) ?? 0) + 1);
    return { ok: new Set([...seen].filter(([, n]) => n === 1).map(([k]) => k)), ambiguous: new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k)) };
  };
  const c = uniq(cats);
  const l = uniq(locs);
  return validateImport(rows, {
    categoryCodes: c.ok,
    locationCodes: l.ok,
    ambiguousCategoryCodes: c.ambiguous,
    ambiguousLocationCodes: l.ambiguous,
    existingCodes: new Set(codes.flatMap((x) => [x.code, x.scan_code])),
    existingScanCodes: new Set(codes.flatMap((x) => [x.code, x.scan_code])),
  });
}

/**
 * Importa en una única transacción: si cualquier fila falla (incluida una
 * colisión concurrente), no se importa ninguna.
 */
export async function commitImport(tx: Tx, ctx: Ctx, rows: string[][], fileName: string) {
  await lockIdentifiers(tx);
  const preview = await previewImport(tx, rows);
  if (preview.issues.length) throw new AppError(`El archivo tiene ${preview.issues.length} error(es). Corríjalos antes de importar.`, 422);
  if (preview.valid.length === 0) throw new AppError("No hay filas válidas que importar", 422);
  if (preview.valid.length > 5000) throw new AppError("Máximo 5000 filas por importación", 422);
  // Solo registros activos; la previsualización ya rechazó códigos ambiguos (que difieren solo en mayúsculas)
  const cats = new Map((await tx`select id, upper(code) as code from categories where is_active`).map((c) => [c.code as string, c.id as string]));
  const locs = new Map((await tx`select id, upper(code) as code from locations where is_active`).map((c) => [c.code as string, c.id as string]));
  for (const r of preview.valid) {
    await tx`insert into assets ${tx({
      org_id: ctx.orgId,
      code: r.code,
      scan_code: r.scan_code ?? r.code,
      name: r.name,
      category_id: cats.get(r.category_code.toUpperCase())!,
      location_id: r.location_code ? locs.get(r.location_code.toUpperCase())! : null,
      manufacturer: r.manufacturer ?? null,
      model: r.model ?? null,
      serial_number: r.serial_number ?? null,
      status: r.status,
      commissioned_on: r.commissioned_on ?? new Date().toISOString().slice(0, 10),
      period_unit: r.period_unit ?? null,
      period_count: r.period_count ?? null,
      notes: r.notes ?? null,
      created_by: ctx.userId,
    })}`;
  }
  await audit(tx, ctx, { action: "import", entityType: "asset", summary: `Importación de ${preview.valid.length} activos desde ${fileName}`.slice(0, 500), after: { count: preview.valid.length, codes: preview.valid.slice(0, 50).map((v) => v.code) } });
  return preview.valid.length;
}
