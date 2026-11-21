"use server";
import { z } from "zod";
import { defineAction } from "@/lib/server/action";
import { AppError } from "@/lib/server/errors";
import { findAssetByScan, loadTarget } from "@/lib/server/services/measurements";
import { describeRules } from "@/lib/domain/criteria";
import { describePeriod, type PeriodUnit } from "@/lib/domain/periodicity";
import type { Tx } from "@/lib/server/db";

export interface TargetDTO {
  kind: "asset" | "point";
  assetId: string | null;
  pointId: string | null;
  code: string;
  scanCode: string | null;
  name: string;
  status: string | null;
  archived: boolean;
  location: string | null;
  categoryName: string | null;
  categoryCode: string | null;
  recordMethod: string | null;
  instructions: string | null;
  precautions: string | null;
  requiredFields: string[];
  periodText: string;
  nextDueAt: string | null;
  lastResult: string | null;
  lastMeasuredAt: string | null;
  criterion: { id: string; code: string; name: string; version: number; description: string; rules: unknown } | null;
  procedure: { code: string; title: string; revision: string } | null;
  expectedPoints: { code: string; name: string; required: boolean; rule?: unknown }[];
  instrumentRequired: boolean;
  instrumentTypes: string[];
  lastMeasurements: { id: string; result: string; recorded_at: string; by: string; values: string | null; status: string }[];
  campaigns: { id: string; code: string; name: string; itemStatus: string }[];
  planTitle: string | null;
}

async function buildDTO(tx: Tx, ref: { assetId?: string; planPointId?: string }): Promise<TargetDTO> {
  const t = await loadTarget(tx, ref);
  const a = t.asset;
  const p = t.point;
  const campaigns = await tx`
    select c.id, c.code, c.name, ci.status as item_status from campaign_items ci join campaigns c on c.id = ci.campaign_id
     where c.status = 'in_progress' and not c.is_paused
       and ${p ? tx`ci.plan_point_id = ${p.id}` : tx`ci.asset_id = ${a!.id} and ci.plan_point_id is null`}
     order by c.ends_on`;
  const pu = (a?.period_unit ?? t.category?.period_unit ?? null) as PeriodUnit | null;
  const pc = a?.period_count ?? t.category?.period_count ?? null;
  const [loc] = await tx`select app_location_path(${a?.location_id ?? p?.location_id ?? null}) as path`;
  return {
    kind: p ? "point" : "asset",
    assetId: a?.id ?? null,
    pointId: p?.id ?? null,
    code: p ? p.code : a!.code,
    scanCode: a?.scan_code ?? null,
    name: p ? `${p.name}${a ? ` · ${a.name}` : ""}` : a!.name,
    status: a?.status ?? null,
    archived: !!(a?.archived_at ?? p?.archived_at),
    location: loc?.path || null,
    categoryName: t.category?.name ?? null,
    categoryCode: t.category?.code ?? null,
    recordMethod: t.category?.record_method ?? null,
    instructions: t.category?.instructions ?? null,
    precautions: t.category?.precautions ?? null,
    requiredFields: t.category?.required_fields ?? [],
    periodText: describePeriod(pu, pc),
    nextDueAt: a?.next_due_at ? new Date(a.next_due_at).toISOString() : null,
    lastResult: (p ? p.last_result : a?.last_result) ?? null,
    lastMeasuredAt: (p ? p.last_measured_at : a?.last_measured_at) ? new Date(p ? p.last_measured_at : a!.last_measured_at).toISOString() : null,
    criterion: t.criterion && t.rules
      ? { id: t.criterion.id, code: t.criterion.criterion_code, name: t.criterion.criterion_name, version: t.criterion.version, description: describeRules(t.rules), rules: t.rules }
      : null,
    procedure: t.procedure ? { code: t.procedure.code, title: t.procedure.title, revision: t.procedure.revision } : null,
    expectedPoints: t.expectedPoints.map((e) => ({ code: e.code, name: e.name, required: e.required, rule: e.rule })),
    instrumentRequired: t.instrumentRequired,
    instrumentTypes: t.instrumentTypes,
    lastMeasurements: t.lastMeasurements.map((m) => ({ id: m.id, result: m.result, recorded_at: new Date(m.recorded_at).toISOString(), by: m.measured_by_name, values: m.values_text, status: m.status })),
    campaigns: campaigns.map((c) => ({ id: c.id, code: c.code, name: c.name, itemStatus: c.item_status })),
    planTitle: p?.plan_title ?? null,
  };
}

export const lookupTargetAction = defineAction(
  {
    permission: "read",
    schema: z.object({ scan: z.string().trim().max(200).optional(), assetId: z.string().uuid().optional(), pointId: z.string().uuid().optional() }),
  },
  async (i, { tx }) => {
    if (i.pointId) return buildDTO(tx, { planPointId: i.pointId });
    if (i.assetId) return buildDTO(tx, { assetId: i.assetId });
    if (!i.scan) throw new AppError("Indique un código");
    const a = await findAssetByScan(tx, i.scan);
    if (!a) throw new AppError(`No se encontró ningún activo con el código «${i.scan}»`, 404);
    return buildDTO(tx, { assetId: a.id });
  },
);

/** Siguiente elemento pendiente de una campaña (ruta de medición). */
export const nextCampaignItemAction = defineAction(
  { permission: "measure", schema: z.object({ campaignId: z.string().uuid(), afterItemOrder: z.number().int().optional() }) },
  async (i, { tx }) => {
    const [c] = await tx`select status, is_paused, name from campaigns where id = ${i.campaignId}`;
    if (!c) throw new AppError("Campaña no encontrada", 404);
    if (c.status !== "in_progress" || c.is_paused) throw new AppError(`La campaña «${c.name}» no está en curso`);
    const items = await tx`
      select ci.id, ci.asset_id, ci.plan_point_id, ci.sort_order, coalesce(pp.route_order, ci.sort_order) as route
        from campaign_items ci left join plan_points pp on pp.id = ci.plan_point_id
       where ci.campaign_id = ${i.campaignId} and ci.status = 'pending'
       order by route, ci.sort_order`;
    const [{ total, done }] = await tx`select count(*)::int as total, count(*) filter (where status <> 'pending')::int as done from campaign_items where campaign_id = ${i.campaignId}`;
    const next = items.find((x) => i.afterItemOrder === undefined || x.route > i.afterItemOrder) ?? items[0];
    if (!next) return { done: true as const, total, completed: done };
    const dto = await buildDTO(tx, next.plan_point_id ? { planPointId: next.plan_point_id } : { assetId: next.asset_id });
    return { done: false as const, target: dto, route: next.route as number, total, completed: done, remaining: items.length };
  },
);
