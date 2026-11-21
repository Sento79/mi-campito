import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { categoryOptions, locationOptions, uuidOrUndef } from "@/lib/server/queries/common";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/core";
import { fmtDate } from "@/lib/format";
import { PlanViewer, type CampaignView, type PlanPoint } from "./plan-viewer";
import { NewVersionButton } from "./new-version";

export default async function PlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requirePermission("read");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await withCtx(s, async (tx) => {
    const [plan] = await tx`select p.*, app_location_path(p.location_id) as location, u.full_name as owner_name from floor_plans p left join users u on u.id = p.owner_user_id where p.id = ${id}`;
    if (!plan) return null;
    const versions = await tx`select v.id, v.version, v.label, v.effective_on, v.created_at, v.notes, u.full_name as by_name, v.original_document_id, v.page_count from floor_plan_versions v left join users u on u.id = v.created_by where v.plan_id = ${id} order by v.version desc`;
    const vId = uuidOrUndef(sp.v) && versions.some((v) => v.id === sp.v) ? sp.v! : plan.current_version_id;
    const pages = await tx`select page_number, image_document_id, width_px, height_px from floor_plan_pages where version_id = ${vId} order by page_number`;
    const points = await tx`
      select pp.id, pp.code, pp.name, pp.x::float8 as x, pp.y::float8 as y, pp.page_number as page, pp.point_type as type, pp.category_id, c.name as category_name,
             pp.location_id, pp.asset_id, a.code as asset_code, pp.criterion_id, pp.route_order, pp.notes,
             coalesce(pp.last_result, case when pp.point_type = 'asset' then a.last_result end) as last_result,
             coalesce(pp.last_measured_at, case when pp.point_type = 'asset' then a.last_measured_at end) as last_measured_at
        from plan_points pp left join categories c on c.id = pp.category_id left join assets a on a.id = pp.asset_id
       where pp.plan_id = ${id} and pp.archived_at is null order by pp.code`;
    const campaigns = await tx`
      select c.id, c.code, c.name, c.status, coalesce(json_object_agg(ci.plan_point_id, json_build_object('status', ci.status, 'result', ci.result)) filter (where ci.plan_point_id is not null), '{}') as items
        from campaigns c left join campaign_items ci on ci.campaign_id = c.id
       where c.plan_id = ${id} or exists (select 1 from campaign_items x join plan_points pp on pp.id = x.plan_point_id where x.campaign_id = c.id and pp.plan_id = ${id})
       group by c.id order by c.starts_on desc`;
    const [lock] = await tx`select code from campaigns where plan_id = ${id} and status = 'in_progress' limit 1`;
    const criteria = await tx`select id, code || ' · ' || name as label from criteria where is_active order by code`;
    const assets = await tx`select id, code || ' · ' || name as label from assets where archived_at is null order by code limit 2000`;
    return { plan, versions, vId, pages, points, campaigns, lock: lock?.code ?? null, categories: await categoryOptions(tx), locations: await locationOptions(tx), criteria, assets };
  });
  if (!d) notFound();
  const current = d.versions.find((v) => v.id === d.vId)!;
  const opt = (r: readonly Record<string, unknown>[]) => r.map((x) => ({ id: x.id as string, label: x.label as string }));
  return (
    <>
      <PageHeader
        title={d.plan.title}
        description={d.plan.location || undefined}
        meta={<><Badge tone="primary">Versión {current.version}{current.label ? ` · ${current.label}` : ""}</Badge><Badge>Vigente desde {fmtDate(current.effective_on)}</Badge>{d.plan.owner_name ? <Badge>Responsable: {d.plan.owner_name}</Badge> : null}</>}
        actions={s.permissions.has("edit") ? <NewVersionButton planId={id} /> : null}
      />
      {d.pages.length === 0 ? <Card className="p-6 text-sm text-muted">Esta versión no tiene páginas.</Card> : (
        <PlanViewer
          planId={id}
          planTitle={d.plan.title}
          versionLabel={`v${current.version}`}
          isCurrentVersion={d.vId === d.plan.current_version_id}
          pages={d.pages.map((p) => ({ page: p.page_number, docId: p.image_document_id, w: p.width_px, h: p.height_px }))}
          points={d.points.map((p) => ({ ...p, last_measured_at: p.last_measured_at ? new Date(p.last_measured_at).toISOString() : null })) as unknown as PlanPoint[]}
          campaigns={d.campaigns as unknown as CampaignView[]}
          canCreate={s.permissions.has("create") || s.permissions.has("edit")}
          canEdit={s.permissions.has("edit")}
          canMeasure={s.permissions.has("measure")}
          lockedBy={d.lock}
          categories={d.categories}
          criteria={opt(d.criteria)}
          assets={opt(d.assets)}
          locations={d.locations}
        />
      )}
      <Card className="mt-4">
        <CardHeader title="Historial de versiones" description="Las coordenadas de los puntos son relativas a la página, por lo que se conservan entre versiones de igual proporción." />
        <ul className="divide-y divide-line">
          {d.versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
              <Badge tone={v.id === d.plan.current_version_id ? "primary" : "neutral"}>v{v.version}</Badge>
              <span className="font-medium">{v.label ?? "Sin etiqueta"}</span>
              <span className="text-muted">{v.page_count} pág. · vigente {fmtDate(v.effective_on)} · subida por {v.by_name ?? "—"}</span>
              {v.notes ? <span className="text-xs text-muted">{v.notes}</span> : null}
              <span className="ml-auto flex gap-3 text-xs">
                <Link className="text-primary hover:underline" href={`/planos/${id}?v=${v.id}`}>Ver</Link>
                <a className="text-primary hover:underline" href={`/api/files/${v.original_document_id}?download=1`}>Original</a>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
