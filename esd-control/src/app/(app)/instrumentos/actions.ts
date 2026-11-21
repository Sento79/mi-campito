"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/server/action";
import { audit, diff } from "@/lib/server/audit";
import { AppError } from "@/lib/server/errors";
import { saveDocument } from "@/lib/server/storage";

const nul = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === "" || v === undefined ? null : v), s.nullable());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const instrumentSchema = z.object({
  id: z.string().uuid().nullable(),
  code: z.string().trim().min(1).max(40),
  type: z.string().trim().min(1).max(100),
  manufacturer: nul(z.string().max(120)),
  model: nul(z.string().max(120)),
  serialNumber: nul(z.string().max(120)),
  acquiredOn: nul(date),
  status: z.enum(["active", "in_calibration", "out_of_service", "retired"]),
  ownerUserId: nul(z.string().uuid()),
  locationId: nul(z.string().uuid()),
  notes: nul(z.string().max(2000)),
  reason: nul(z.string().max(500)),
});

export const saveInstrumentAction = defineAction({ permission: "instruments.manage", schema: instrumentSchema }, async (i, { tx, session }) => {
  const row = { code: i.code, type: i.type, manufacturer: i.manufacturer, model: i.model, serial_number: i.serialNumber, acquired_on: i.acquiredOn, status: i.status, owner_user_id: i.ownerUserId, location_id: i.locationId, notes: i.notes };
  if (!i.id) {
    const [x] = await tx`insert into instruments ${tx({ ...row, org_id: session.orgId, archived_at: i.status === "retired" ? new Date() : null })} returning id`;
    await audit(tx, session, { action: "create", entityType: "instrument", entityId: x.id, summary: `Instrumento ${i.code} dado de alta`, after: row });
    revalidatePath("/instrumentos");
    return { id: x.id as string };
  }
  const [before] = await tx`select * from instruments where id = ${i.id}`;
  if (!before) throw new AppError("No encontrado", 404);
  const d = diff(before, row);
  if (d) {
    if ("status" in d.after && ["out_of_service", "retired"].includes(i.status) && !i.reason) throw new AppError("Indique el motivo del cambio de estado", 422, { reason: "Obligatorio" });
    await tx`update instruments set ${tx({ ...row, archived_at: i.status === "retired" ? (before.archived_at ?? new Date()) : null })} where id = ${i.id}`;
    await audit(tx, session, { action: "update", entityType: "instrument", entityId: i.id, summary: `Instrumento ${i.code} modificado`, before: d.before, after: d.after, reason: i.reason });
  }
  revalidatePath(`/instrumentos/${i.id}`);
  return { id: i.id };
});

/** Registra una calibración (con certificado opcional) y actualiza la vigencia del instrumento. */
export const addCalibrationAction = defineAction({ permission: "instruments.manage", schema: z.instanceof(FormData) }, async (fd, { tx, session }) => {
  const g = (k: string) => (typeof fd.get(k) === "string" && (fd.get(k) as string).trim() ? (fd.get(k) as string).trim() : null);
  const v = z.object({
    instrumentId: z.string().uuid(), calibratedOn: date, dueOn: date, provider: z.string().max(200).nullable(), certificateNumber: z.string().max(120).nullable(),
    outcome: z.enum(["pass", "fail", "adjusted"]), notes: z.string().max(2000).nullable(),
  }).refine((x) => x.dueOn > x.calibratedOn, { message: "La fecha de vencimiento debe ser posterior", path: ["dueOn"] })
    .parse({ instrumentId: g("instrumentId"), calibratedOn: g("calibratedOn"), dueOn: g("dueOn"), provider: g("provider"), certificateNumber: g("certificateNumber"), outcome: g("outcome") ?? "pass", notes: g("notes") });
  const [inst] = await tx`select code from instruments where id = ${v.instrumentId} for update`;
  if (!inst) throw new AppError("Instrumento no encontrado", 404);
  const [cal] = await tx`insert into calibrations(org_id, instrument_id, calibrated_on, due_on, provider, certificate_number, outcome, notes, created_by)
    values (${session.orgId}, ${v.instrumentId}, ${v.calibratedOn}, ${v.dueOn}, ${v.provider}, ${v.certificateNumber}, ${v.outcome}, ${v.notes}, ${session.userId}) returning id`;
  const f = fd.get("file");
  if (f instanceof File && f.size > 0) {
    const doc = await saveDocument(tx, session, { entityType: "calibration", entityId: cal.id, kind: "certificate", fileName: f.name, data: Buffer.from(await f.arrayBuffer()), allowed: ["application/pdf", "image/png", "image/jpeg"] });
    await tx`update calibrations set document_id = ${doc.id} where id = ${cal.id}`;
  }
  // La vigencia la marca la calibración más reciente; un resultado "fail" deja el instrumento fuera de servicio.
  const [latest] = await tx`select id, calibrated_on, due_on, outcome from calibrations where instrument_id = ${v.instrumentId} order by calibrated_on desc, created_at desc limit 1`;
  await tx`update instruments set last_calibrated_on = ${latest.calibrated_on}, calibration_due_on = ${latest.outcome === "fail" ? latest.calibrated_on : latest.due_on},
           current_calibration_id = ${latest.id}, status = case when ${latest.outcome} = 'fail' then 'out_of_service' when status = 'in_calibration' then 'active' else status end where id = ${v.instrumentId}`;
  await audit(tx, session, { action: "calibrate", entityType: "instrument", entityId: v.instrumentId, summary: `Calibración de ${inst.code} registrada (${v.calibratedOn} → ${v.dueOn}, ${v.outcome})`, after: v });
  revalidatePath(`/instrumentos/${v.instrumentId}`);
  return { id: cal.id as string };
});

export const uploadInstrumentDocAction = defineAction({ permission: "instruments.manage", schema: z.instanceof(FormData) }, async (fd, { tx, session }) => {
  const id = z.string().uuid().parse(fd.get("instrumentId"));
  const f = fd.get("file");
  if (!(f instanceof File) || f.size === 0) throw new AppError("Seleccione un archivo");
  const doc = await saveDocument(tx, session, { entityType: "instrument", entityId: id, kind: "attachment", fileName: f.name, data: Buffer.from(await f.arrayBuffer()) });
  await audit(tx, session, { action: "attach", entityType: "instrument", entityId: id, summary: `Documento adjuntado: ${f.name}`.slice(0, 500) });
  revalidatePath(`/instrumentos/${id}`);
  return { id: doc.id };
});
