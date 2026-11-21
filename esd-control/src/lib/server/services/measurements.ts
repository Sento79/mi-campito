import "server-only";
import type { Row as DbRow } from "postgres";
import { z } from "zod";
import type { Tx, Ctx } from "../db";
import { audit } from "../audit";
import { AppError, NotFoundError } from "../errors";
import {
  evaluate,
  measurementInputSchema,
  parseRules,
  type CriterionRules,
  type ExpectedPoint,
  type Evaluation,
  type NumericRule,
} from "@/lib/domain/criteria";
import type { OrgSettings } from "@/lib/domain/settings";
import { createNonconformity } from "./nonconformities";

export interface CriterionVersionRow {
  id: string;
  criterion_id: string;
  criterion_code: string;
  criterion_name: string;
  version: number;
  rules: unknown;
  unit: string | null;
  procedure_id: string | null;
  procedure_revision: string | null;
  norm_reference: string | null;
  approved_at: Date | null;
}

export async function activeCriterionVersion(tx: Tx, criterionId: string | null): Promise<CriterionVersionRow | null> {
  if (!criterionId) return null;
  const [v] = await tx<CriterionVersionRow[]>`
    select cv.id, cv.criterion_id, c.code as criterion_code, c.name as criterion_name, cv.version, cv.rules, cv.unit,
           cv.procedure_id, cv.procedure_revision, cv.norm_reference, cv.approved_at
      from criterion_versions cv join criteria c on c.id = cv.criterion_id
     where cv.criterion_id = ${criterionId} and cv.status = 'active' and c.is_active`;
  return v ?? null;
}

export interface MeasurementTarget {
  asset: DbRow | null;
  point: DbRow | null;
  category: DbRow | null;
  criterion: CriterionVersionRow | null;
  rules: CriterionRules | null;
  expectedPoints: ExpectedPoint[];
  procedure: DbRow | null;
  instrumentRequired: boolean;
  instrumentTypes: string[];
  lastMeasurements: DbRow[];
}

/** Reúne todo lo necesario para medir un activo o un punto de plano. */
export async function loadTarget(tx: Tx, ref: { assetId?: string | null; planPointId?: string | null }): Promise<MeasurementTarget> {
  let point: DbRow | null = null;
  let assetId = ref.assetId ?? null;
  if (ref.planPointId) {
    point = (await tx`select pp.*, fp.title as plan_title from plan_points pp join floor_plans fp on fp.id = pp.plan_id where pp.id = ${ref.planPointId}`)[0] ?? null;
    if (!point) throw new NotFoundError("Punto de plano no encontrado");
    if (point.archived_at) throw new AppError("El punto está archivado y no admite mediciones");
    if (point.point_type === "reference") throw new AppError("Los puntos de referencia no se miden");
    if (point.asset_id && assetId && assetId !== point.asset_id) {
      throw new AppError("El activo indicado no corresponde al punto del plano", 422);
    }
    if (point.asset_id) assetId = assetId ?? point.asset_id;
  }
  let asset: DbRow | null = null;
  if (assetId) {
    asset = (await tx`
      select a.*, l.name as location_name, l.code as location_code, app_location_path(a.location_id) as location_path
        from assets a left join locations l on l.id = a.location_id where a.id = ${assetId}`)[0] ?? null;
    if (!asset) throw new NotFoundError("Activo no encontrado");
  }
  if (!asset && !point) throw new AppError("Indique un activo o un punto de plano");
  const categoryId = asset?.category_id ?? point?.category_id ?? null;
  const [category] = categoryId ? await tx`select * from categories where id = ${categoryId}` : [null];

  const criterionId = point?.criterion_id ?? asset?.criterion_id ?? category?.criterion_id ?? null;
  const criterion = await activeCriterionVersion(tx, criterionId);
  const rules = criterion ? parseRules(criterion.rules) : null;

  // Plantilla multipunto: la del activo o, si no, la activa de la categoría
  let expectedPoints: ExpectedPoint[] = [];
  if (rules?.kind === "multipoint") {
    let templateId: string | null = asset?.point_template_id ?? null;
    if (!templateId && category) {
      const [t] = await tx`select id from point_templates where category_id = ${category.id} and is_active order by created_at limit 1`;
      templateId = t?.id ?? null;
    }
    if (templateId) {
      const items = await tx`select * from point_template_items where template_id = ${templateId} order by sort_order, code`;
      expectedPoints = [];
      for (const it of items) {
        let rule: NumericRule | undefined;
        if (it.criterion_id) {
          const pv = await activeCriterionVersion(tx, it.criterion_id);
          const pr = pv ? parseRules(pv.rules) : null;
          if (pr?.kind === "numeric") rule = pr;
        }
        expectedPoints.push({ code: it.code, name: it.name, required: it.required, rule });
      }
    }
  }
  const procedureId = criterion?.procedure_id ?? category?.procedure_id ?? null;
  const [procedure] = procedureId ? await tx`select id, code, title, revision, norm_reference from procedures where id = ${procedureId}` : [null];

  const lastMeasurements = await tx`
    select m.id, m.result, m.recorded_at, m.status, u.full_name as measured_by_name,
           (select string_agg(coalesce(mv.raw_input,'') || ' ' || coalesce(mv.raw_unit,''), ' · ' order by mv.sort_order) from measurement_values mv where mv.measurement_id = m.id and mv.value_kind = 'numeric') as values_text
      from measurements m join users u on u.id = m.measured_by
     where ${asset ? tx`m.asset_id = ${asset.id}` : tx`m.plan_point_id = ${point!.id}`}
     order by m.recorded_at desc limit 5`;

  return {
    asset,
    point,
    category: category ?? null,
    criterion,
    rules,
    expectedPoints,
    procedure: procedure ?? null,
    instrumentRequired: category?.instrument_required ?? true,
    instrumentTypes: category?.instrument_types ?? [],
    lastMeasurements,
  };
}

export const recordMeasurementSchema = z.object({
  clientId: z.string().uuid(),
  assetId: z.string().uuid().nullish(),
  planPointId: z.string().uuid().nullish(),
  campaignId: z.string().uuid().nullish(),
  instrumentId: z.string().uuid().nullish(),
  instrumentNotRequired: z.boolean().default(false),
  input: measurementInputSchema,
  comment: z.string().trim().max(2000).optional(),
  measuredAtLocal: z.string().datetime({ offset: true }).optional(),
  deviceTimezone: z.string().max(64).optional(),
  repeatsMeasurementId: z.string().uuid().nullish(),
  repeatReason: z.string().trim().max(500).optional(),
  signatureConfirmed: z.boolean().default(false),
  fromOffline: z.boolean().default(false),
  /** Versión de criterio mostrada al técnico (detecta cambios entre pantalla y guardado) */
  expectedCriterionVersionId: z.string().uuid().nullish(),
  createNc: z.boolean().default(false),
  /** Cola offline: usuario y organización con los que se guardó; deben coincidir con la sesión */
  queuedBy: z.object({ userId: z.string().uuid(), orgId: z.string().uuid() }).optional(),
});
export type RecordMeasurementInput = z.infer<typeof recordMeasurementSchema>;

export interface RecordResult {
  id: string;
  duplicate: boolean;
  result: string;
  reasons: string[];
  warnings: string[];
  ncId: string | null;
  ncCode: string | null;
}

function instrumentValidity(inst: DbRow | null, today: string) {
  if (!inst) return { calibrationValid: null as boolean | null, status: undefined as string | undefined };
  const valid = inst.last_calibrated_on && inst.calibration_due_on ? inst.calibration_due_on >= today : null;
  return { calibrationValid: valid, status: inst.status as string };
}

export async function recordMeasurement(tx: Tx, ctx: Ctx, settings: OrgSettings, input: RecordMeasurementInput): Promise<RecordResult> {
  if (input.queuedBy && (input.queuedBy.userId !== ctx.userId || input.queuedBy.orgId !== ctx.orgId)) {
    throw new AppError("La medición se guardó en el dispositivo con otro usuario u organización; inicie sesión con esa cuenta para enviarla", 409);
  }
  // Idempotencia: la cola offline puede reenviar la misma medición
  const [dup] = await tx`select id, result, result_explanation from measurements where org_id = ${ctx.orgId} and client_id = ${input.clientId}`;
  if (dup) {
    const [nc] = await tx`select n.id, n.code from nc_links l join nonconformities n on n.id = l.nc_id where l.measurement_id = ${dup.id} limit 1`;
    return { id: dup.id, duplicate: true, result: dup.result, reasons: dup.result_explanation ?? [], warnings: [], ncId: nc?.id ?? null, ncCode: nc?.code ?? null };
  }

  const target = await loadTarget(tx, { assetId: input.assetId, planPointId: input.planPointId });
  if (target.asset?.archived_at) throw new AppError("El activo está archivado; reactívelo antes de medir");
  if (target.asset?.status === "retired") throw new AppError("El activo está retirado y no admite mediciones");

  const today = new Date().toISOString().slice(0, 10);
  let instrument: DbRow | null = null;
  if (input.instrumentId) {
    instrument = (await tx`select id, code, type, status, last_calibrated_on, calibration_due_on, archived_at from instruments where id = ${input.instrumentId}`)[0] ?? null;
    if (!instrument) throw new NotFoundError("Instrumento no encontrado");
    if (instrument.archived_at || instrument.status === "retired") throw new AppError("El instrumento está retirado");
    if (target.instrumentTypes.length && !target.instrumentTypes.includes(instrument.type)) {
      throw new AppError(`El instrumento ${instrument.code} (${instrument.type}) no es del tipo requerido: ${target.instrumentTypes.join(", ")}`);
    }
  }
  if (input.instrumentNotRequired && target.instrumentRequired) {
    throw new AppError("El procedimiento de esta categoría exige instrumento; no puede marcarse como no requerido");
  }
  const iv = instrumentValidity(instrument, today);
  const isMeasuredValue = input.input.kind !== "not_measurable" && input.input.kind !== "not_applicable";

  // Campaña
  let campaignItemId: string | null = null;
  if (input.campaignId) {
    const [c] = await tx`select id, status, is_paused, name from campaigns where id = ${input.campaignId}`;
    if (!c) throw new NotFoundError("Campaña no encontrada");
    if (c.status !== "in_progress") throw new AppError(`La campaña «${c.name}» no está en curso`);
    if (c.is_paused) throw new AppError(`La campaña «${c.name}» está en pausa`);
    const [item] = input.planPointId
      ? await tx`select id from campaign_items where campaign_id = ${c.id} and plan_point_id = ${input.planPointId}`
      : await tx`select id from campaign_items where campaign_id = ${c.id} and asset_id = ${target.asset!.id} and plan_point_id is null`;
    if (!item) throw new AppError("El elemento no forma parte de la campaña seleccionada");
    campaignItemId = item.id;
  }

  let evaluation: Evaluation = evaluate(target.rules, input.input, {
    expectedPoints: target.expectedPoints,
    instrument: isMeasuredValue
      ? {
          required: target.instrumentRequired,
          declaredNotRequired: input.instrumentNotRequired,
          provided: !!instrument,
          calibrationValid: iv.calibrationValid,
          status: iv.status,
          policy: settings.instrumentPolicy,
        }
      : undefined,
  });
  if (evaluation.blockedReason) throw new AppError(evaluation.blockedReason, 422);

  if (input.expectedCriterionVersionId !== undefined && (input.expectedCriterionVersionId ?? null) !== (target.criterion?.id ?? null)) {
    const reasons = [...evaluation.reasons, "El criterio vigente cambió entre la toma del dato y su registro: requiere revisión"];
    evaluation = { ...evaluation, result: evaluation.result === "pass" ? "review" : evaluation.result, reasons };
  }
  if (settings.requireSignature && !input.signatureConfirmed) {
    throw new AppError("La organización exige la confirmación del técnico para registrar mediciones", 422);
  }

  let attempt = 1;
  if (input.repeatsMeasurementId) {
    const [prev] = await tx`select id, attempt_number, asset_id, plan_point_id from measurements where id = ${input.repeatsMeasurementId}`;
    if (!prev) throw new NotFoundError("Medición repetida no encontrada");
    const sameAsset = !!prev.asset_id && prev.asset_id === (target.asset?.id ?? null);
    const samePoint = !!prev.plan_point_id && prev.plan_point_id === (target.point?.id ?? null);
    if (!sameAsset && !samePoint) {
      throw new AppError("La repetición debe corresponder al mismo activo o punto");
    }
    attempt = prev.attempt_number + 1;
  }

  const method = isMeasuredValue ? input.input.kind : "none";
  const instrumentSnapshot = instrument
    ? { code: instrument.code, type: instrument.type, status: instrument.status, last_calibrated_on: instrument.last_calibrated_on, calibration_due_on: instrument.calibration_due_on, calibration_valid: iv.calibrationValid }
    : null;
  const reasonsForNm = input.input.kind === "not_measurable" || input.input.kind === "not_applicable" ? input.input.reason : null;
  const comment = [input.comment, input.repeatsMeasurementId && input.repeatReason ? `Repetición: ${input.repeatReason}` : null].filter(Boolean).join("\n") || null;

  const [m] = await tx`
    insert into measurements(org_id, client_id, status, asset_id, plan_point_id, category_id, campaign_id, campaign_item_id,
      instrument_id, instrument_not_required, instrument_snapshot, procedure_id, procedure_revision, criterion_version_id, rules_snapshot,
      method, result, result_explanation, not_measurable_reason, comment, measured_by, measured_at_local, device_timezone,
      synced_from_offline, attempt_number, repeats_measurement_id, signature_confirmed, raw_input)
    values (${ctx.orgId}, ${input.clientId}, 'final', ${target.asset?.id ?? null}, ${target.point?.id ?? null}, ${target.category?.id ?? null},
      ${input.campaignId ?? null}, ${campaignItemId}, ${instrument?.id ?? null}, ${input.instrumentNotRequired},
      ${instrumentSnapshot ? tx.json(instrumentSnapshot as never) : null}, ${target.procedure?.id ?? null}, ${target.procedure?.revision ?? target.criterion?.procedure_revision ?? null},
      ${target.criterion?.id ?? null}, ${target.rules ? tx.json(target.rules as never) : null}, ${method}, ${evaluation.result},
      ${tx.json(evaluation.reasons as never)}, ${reasonsForNm}, ${comment}, ${ctx.userId},
      ${input.measuredAtLocal ? new Date(input.measuredAtLocal) : null}, ${input.deviceTimezone ?? null}, ${input.fromOffline},
      ${attempt}, ${input.repeatsMeasurementId ?? null}, ${input.signatureConfirmed}, ${tx.json(input.input as never)})
    returning id, recorded_at`;

  let i = 0;
  for (const v of evaluation.values) {
    await tx`
      insert into measurement_values(org_id, measurement_id, point_code, point_name, part_code, value_kind, raw_input, raw_unit, raw_value,
        normalized_value, normalized_unit, option_value, checked, required, result, explanation, comment, sort_order)
      values (${ctx.orgId}, ${m.id}, ${v.pointCode ?? null}, ${v.pointName ?? null}, ${v.partCode ?? null}, ${v.kind}, ${v.rawInput ?? null},
        ${v.rawUnit ?? null}, ${v.rawValue ?? null}, ${v.normalizedValue ?? null}, ${v.normalizedUnit ?? null}, ${v.optionValue ?? null},
        ${v.checked ?? null}, ${v.required}, ${v.result}, ${v.explanation}, ${v.comment ?? null}, ${i++})`;
  }

  const label = target.asset ? `${target.asset.code} ${target.asset.name}` : `punto ${target.point!.code} (${target.point!.plan_title})`;
  await audit(tx, ctx, {
    action: "measure",
    entityType: "measurement",
    entityId: m.id,
    summary: `Medición de ${label}: ${evaluation.result}${attempt > 1 ? ` (intento ${attempt})` : ""}`,
    after: { result: evaluation.result, criterion_version_id: target.criterion?.id ?? null, values: evaluation.values.map((v) => ({ p: v.pointCode, raw: v.rawInput, unit: v.rawUnit, n: v.normalizedValue, r: v.result })) },
  });

  let ncId: string | null = null;
  let ncCode: string | null = null;
  const wantNc = evaluation.result === "fail" && (settings.autoCreateNc === "always" || (settings.autoCreateNc === "ask" && input.createNc));
  if (wantNc) {
    const nc = await createNonconformity(tx, ctx, {
      title: `No conforme: ${label}`,
      description: evaluation.reasons.join("\n"),
      severityKey: "major",
      links: [{ measurementId: m.id, assetId: target.asset?.id ?? null, planPointId: target.point?.id ?? null }],
      campaignId: input.campaignId ?? null,
      ownerUserId: target.asset?.owner_user_id ?? null,
    });
    ncId = nc.id;
    ncCode = nc.code;
  }

  return { id: m.id, duplicate: false, result: evaluation.result, reasons: evaluation.reasons, warnings: evaluation.warnings, ncId, ncCode };
}

export async function invalidateMeasurement(tx: Tx, ctx: Ctx, id: string, reason: string) {
  if (reason.trim().length < 3) throw new AppError("Indique el motivo de la invalidación", 422);
  const [m] = await tx`select id, status, result, asset_id, plan_point_id from measurements where id = ${id}`;
  if (!m) throw new NotFoundError("Medición no encontrada");
  if (m.status !== "final") throw new AppError("Solo se pueden invalidar mediciones registradas válidas");
  const upd = await tx`update measurements set status = 'invalidated', invalidated_at = now(), invalidated_by = ${ctx.userId}, invalidation_reason = ${reason} where id = ${id} returning id`;
  // Con RLS, una actualización no autorizada no falla: afecta 0 filas.
  if (upd.length === 0) throw new AppError("No tiene permiso para invalidar mediciones", 403);
  await audit(tx, ctx, { action: "invalidate", entityType: "measurement", entityId: id, summary: `Medición invalidada (resultado original: ${m.result})`, reason, before: { status: "final" }, after: { status: "invalidated" } });
}

export async function findAssetByScan(tx: Tx, value: string) {
  const v = value.trim();
  if (!v) return null;
  const [a] = await tx`
    select id, code, name, archived_at from assets
     where scan_code = ${v} or upper(code) = upper(${v})
     order by (scan_code = ${v}) desc limit 1`;
  return a ?? null;
}
