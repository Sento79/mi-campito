import "server-only";
import { z } from "zod";
import type { Tx, Ctx } from "../db";
import { audit } from "../audit";
import { AppError, NotFoundError } from "../errors";

export const CAMPAIGN_STATUSES = ["draft", "planned", "in_progress", "in_review", "completed", "closed", "cancelled"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** Transiciones permitidas. El cierre y la cancelación son definitivos. */
export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ["planned", "in_progress", "cancelled"],
  planned: ["in_progress", "draft", "cancelled"],
  in_progress: ["in_review", "completed", "cancelled"],
  in_review: ["in_progress", "completed"],
  completed: ["closed", "in_review"],
  closed: [],
  cancelled: [],
};

export const campaignSchema = z.object({
  name: z.string().trim().min(1, "Obligatorio").max(200),
  description: z.string().trim().max(2000).nullable(),
  locationId: z.string().uuid().nullable(),
  planId: z.string().uuid().nullable(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ownerUserId: z.string().uuid().nullable(),
  technicianIds: z.array(z.string().uuid()).max(100),
  categoryIds: z.array(z.string().uuid()).max(100),
  mode: z.enum(["manual", "category", "location", "plan", "due", "selection"]),
  assetIds: z.array(z.string().uuid()).max(10000).default([]),
  pointIds: z.array(z.string().uuid()).max(10000).default([]),
}).refine((v) => v.endsOn >= v.startsOn, { message: "La fecha de fin no puede ser anterior al inicio", path: ["endsOn"] });
export type CampaignInput = z.infer<typeof campaignSchema>;

/** Resuelve los elementos de la campaña según el modo de creación. */
export async function resolveItems(tx: Tx, i: CampaignInput): Promise<{ assets: string[]; points: string[] }> {
  const cats = i.categoryIds.length ? i.categoryIds : null;
  const assetBase = tx`a.archived_at is null and a.status not in ('retired') ${cats ? tx`and a.category_id = any(${cats})` : tx``}`;
  switch (i.mode) {
    case "manual":
    case "selection":
      if (!i.assetIds.length && !i.pointIds.length) throw new AppError("Seleccione al menos un activo o punto", 422);
      return { assets: (await tx`select a.id from assets a where a.id = any(${i.assetIds}) and ${assetBase} order by a.code`).map((r) => r.id), points: (await tx`select id from plan_points where id = any(${i.pointIds}) and archived_at is null and point_type <> 'reference'`).map((r) => r.id) };
    case "category":
      if (!cats) throw new AppError("Seleccione al menos una categoría", 422);
      return { assets: (await tx`select a.id from assets a where ${assetBase} ${i.locationId ? tx`and a.location_id in (select app_location_subtree(${i.locationId}))` : tx``} order by a.code`).map((r) => r.id), points: [] };
    case "location":
      if (!i.locationId) throw new AppError("Seleccione la ubicación", 422);
      return {
        assets: (await tx`select a.id from assets a where ${assetBase} and a.location_id in (select app_location_subtree(${i.locationId})) order by a.code`).map((r) => r.id),
        points: (await tx`select id from plan_points where archived_at is null and point_type = 'measurement' and location_id in (select app_location_subtree(${i.locationId})) ${cats ? tx`and category_id = any(${cats})` : tx``} order by coalesce(route_order, 100000), code`).map((r) => r.id),
      };
    case "plan": {
      if (!i.planId) throw new AppError("Seleccione el plano", 422);
      const pts = i.pointIds.length
        ? await tx`select id from plan_points where plan_id = ${i.planId} and id = any(${i.pointIds}) and archived_at is null and point_type <> 'reference' order by coalesce(route_order, 100000), code`
        : await tx`select id from plan_points where plan_id = ${i.planId} and archived_at is null and point_type <> 'reference' ${cats ? tx`and category_id = any(${cats})` : tx``} order by coalesce(route_order, 100000), code`;
      return { assets: [], points: pts.map((r) => r.id) };
    }
    case "due":
      return {
        assets: (await tx`select a.id from assets a join categories c on c.id = a.category_id where ${assetBase}
          and coalesce(a.period_unit, c.period_unit) is not null and (a.next_due_at is null or a.next_due_at < (${i.endsOn}::date + 1))
          ${i.locationId ? tx`and a.location_id in (select app_location_subtree(${i.locationId}))` : tx``} order by a.next_due_at nulls first, a.code`).map((r) => r.id),
        points: [],
      };
  }
}

export async function createCampaign(tx: Tx, ctx: Ctx, i: CampaignInput) {
  const items = await resolveItems(tx, i);
  if (items.assets.length + items.points.length === 0) throw new AppError("La selección no contiene elementos que medir", 422);
  const [{ n }] = await tx`select app_next_counter('campaign') as n`;
  const code = `CMP-${String(n).padStart(4, "0")}`;
  const [c] = await tx`insert into campaigns(org_id, code, name, description, location_id, plan_id, starts_on, ends_on, owner_user_id, status, creation_mode, created_by)
    values (${ctx.orgId}, ${code}, ${i.name}, ${i.description}, ${i.locationId}, ${i.planId}, ${i.startsOn}, ${i.endsOn}, ${i.ownerUserId}, 'draft', ${i.mode}, ${ctx.userId}) returning id`;
  let k = 0;
  for (const a of items.assets) await tx`insert into campaign_items(org_id, campaign_id, asset_id, sort_order) values (${ctx.orgId}, ${c.id}, ${a}, ${k++})`;
  for (const p of items.points) await tx`insert into campaign_items(org_id, campaign_id, plan_point_id, sort_order) values (${ctx.orgId}, ${c.id}, ${p}, ${k++})`;
  for (const t of i.technicianIds) await tx`insert into campaign_technicians(org_id, campaign_id, user_id) values (${ctx.orgId}, ${c.id}, ${t}) on conflict do nothing`;
  for (const cat of i.categoryIds) await tx`insert into campaign_categories(org_id, campaign_id, category_id) values (${ctx.orgId}, ${c.id}, ${cat}) on conflict do nothing`;
  for (const t of i.technicianIds) {
    if (t === ctx.userId) continue;
    await tx`insert into notifications(org_id, user_id, kind, title, body, link, dedupe_key) values (${ctx.orgId}, ${t}, 'campaign_assigned', ${`Asignado a la campaña ${code}`}, ${i.name}, ${"/campanas/" + c.id}, ${"campaign_assigned:" + c.id}) on conflict do nothing`;
  }
  await audit(tx, ctx, { action: "create", entityType: "campaign", entityId: c.id, summary: `Campaña ${code} creada: ${i.name} (${items.assets.length} activos, ${items.points.length} puntos, modo ${i.mode})` });
  return { id: c.id as string, code };
}

export interface CampaignSum { total: number; done: number; pending: number; skipped: number; pass: number; fail: number; incomplete: number; nm: number; openNcs: number }

export async function campaignSummary(tx: Tx, id: string): Promise<CampaignSum> {
  const [s] = await tx<Omit<CampaignSum, "openNcs">[]>`
    select count(*)::int as total,
      count(*) filter (where status = 'done')::int as done,
      count(*) filter (where status = 'pending')::int as pending,
      count(*) filter (where status = 'skipped')::int as skipped,
      count(*) filter (where result = 'pass')::int as pass,
      count(*) filter (where result = 'fail')::int as fail,
      count(*) filter (where result in ('incomplete','review'))::int as incomplete,
      count(*) filter (where result in ('not_measurable','not_applicable'))::int as nm
    from campaign_items where campaign_id = ${id}`;
  const [nc] = await tx`select count(*)::int as open from nonconformities n where n.status <> 'closed' and (n.campaign_id = ${id} or exists (select 1 from nc_links l join measurements m on m.id = l.measurement_id where l.nc_id = n.id and m.campaign_id = ${id}))`;
  return { ...s, openNcs: nc.open as number };
}

export async function transitionCampaign(tx: Tx, ctx: Ctx, perms: Set<string>, id: string, to: CampaignStatus | "pause" | "resume", data: { notes?: string | null; acknowledge?: boolean }) {
  const [c] = await tx`select * from campaigns where id = ${id}`;
  if (!c) throw new NotFoundError("Campaña no encontrada");
  if (to === "pause" || to === "resume") {
    if (c.status !== "in_progress") throw new AppError("Solo se pueden pausar/reanudar campañas en curso");
    const upd = await tx`update campaigns set is_paused = ${to === "pause"} where id = ${id} returning id`;
    if (!upd.length) throw new AppError("No tiene permiso para modificar la campaña", 403);
    await audit(tx, ctx, { action: to, entityType: "campaign", entityId: id, summary: `Campaña ${c.code} ${to === "pause" ? "pausada" : "reanudada"}`, reason: data.notes ?? null });
    return;
  }
  const from = c.status as CampaignStatus;
  if (!CAMPAIGN_TRANSITIONS[from].includes(to)) throw new AppError(`Transición no permitida: ${from} → ${to}`);
  const sum = await campaignSummary(tx, id);
  if (to === "closed") {
    if (!perms.has("campaign.close")) throw new AppError("Se requiere el permiso de cierre de campaña", 403);
    // El cierre nunca oculta pendientes ni NC: se exige reconocerlos y quedan registrados.
    if ((sum.pending > 0 || sum.openNcs > 0 || sum.fail > 0) && !data.acknowledge) {
      throw new AppError(`Hay ${sum.pending} elemento(s) pendientes, ${sum.fail} no conforme(s) y ${sum.openNcs} NC abiertas. Confirme expresamente el cierre.`, 422);
    }
    const auto = `Cierre: ${sum.done}/${sum.total} realizados, ${sum.pending} pendientes (no realizados), ${sum.skipped} omitidos, ${sum.pass} conformes, ${sum.fail} no conformes, ${sum.incomplete} incompletos/revisión, ${sum.openNcs} NC abiertas.`;
    await tx`update campaigns set status = 'closed', is_paused = false, closed_by = ${ctx.userId}, closed_at = now(), close_notes = ${[auto, data.notes].filter(Boolean).join("\n")} where id = ${id}`;
  } else {
    if (to === "cancelled" && !(data.notes && data.notes.trim().length >= 3)) throw new AppError("Indique el motivo de la cancelación", 422);
    if (to === "in_progress" && sum.total === 0) throw new AppError("La campaña no tiene elementos");
    const upd = await tx`update campaigns set status = ${to}, is_paused = false where id = ${id} returning id`;
    if (!upd.length) throw new AppError("No tiene permiso para modificar la campaña", 403);
    if (to === "in_progress") {
      const techs = await tx`select user_id from campaign_technicians where campaign_id = ${id}`;
      for (const t of techs) {
        await tx`insert into notifications(org_id, user_id, kind, title, body, link, dedupe_key) values (${ctx.orgId}, ${t.user_id}, 'campaign_started', ${`Campaña ${c.code} en curso`}, ${c.name}, ${"/campanas/" + id}, ${"campaign_started:" + id}) on conflict do nothing`;
      }
    }
  }
  await audit(tx, ctx, { action: "status", entityType: "campaign", entityId: id, summary: `Campaña ${c.code}: ${from} → ${to}`, before: { status: from }, after: { status: to, summary: sum }, reason: data.notes ?? null });
}

export async function skipItem(tx: Tx, ctx: Ctx, itemId: string, reason: string) {
  const [it] = await tx`select ci.id, ci.status, c.code, c.status as cstatus from campaign_items ci join campaigns c on c.id = ci.campaign_id where ci.id = ${itemId}`;
  if (!it) throw new NotFoundError("Elemento no encontrado");
  if (["closed", "cancelled"].includes(it.cstatus)) throw new AppError("La campaña no admite cambios");
  if (it.status !== "pending") throw new AppError("Solo se pueden omitir elementos pendientes");
  const upd = await tx`update campaign_items set status = 'skipped', skip_reason = ${reason} where id = ${itemId} returning id`;
  if (!upd.length) throw new AppError("No tiene permiso", 403);
  await audit(tx, ctx, { action: "skip", entityType: "campaign_item", entityId: itemId, summary: `Elemento omitido en ${it.code}`, reason });
}
