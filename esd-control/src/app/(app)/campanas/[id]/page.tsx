import Link from "next/link";
import { notFound } from "next/navigation";
import { Route, FileDown } from "lucide-react";
import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { Alert, Badge, ButtonLink, Card, CardHeader, Kpi, PageHeader, ResultBadge, Table, Td, Th } from "@/components/ui/core";
import { CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUS_TONE, fmtDate, fmtDateTime, fmtRelative } from "@/lib/format";
import { campaignSummary } from "@/lib/server/services/campaigns";
import { CampaignActions, SkipButton } from "./campaign-actions";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePermission("read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await withCtx(s, async (tx) => {
    const [c] = await tx`select c.*, app_location_path(c.location_id) as location, u.full_name as owner_name, cb.full_name as closed_by_name, fp.title as plan_title from campaigns c left join users u on u.id = c.owner_user_id left join users cb on cb.id = c.closed_by left join floor_plans fp on fp.id = c.plan_id where c.id = ${id}`;
    if (!c) return null;
    const sum = await campaignSummary(tx, id);
    const items = await tx`
      select ci.id, ci.status, ci.result, ci.measured_at, ci.skip_reason, ci.last_measurement_id, ci.asset_id, ci.plan_point_id,
             coalesce(a.code, pp.code) as code, coalesce(a.name, pp.name) as name, coalesce(cat.name, pcat.name) as category, pp.route_order, pp.plan_id
        from campaign_items ci left join assets a on a.id = ci.asset_id left join categories cat on cat.id = a.category_id
        left join plan_points pp on pp.id = ci.plan_point_id left join categories pcat on pcat.id = pp.category_id
       where ci.campaign_id = ${id} order by case ci.status when 'pending' then 0 else 1 end, coalesce(pp.route_order, ci.sort_order), ci.sort_order`;
    const techs = await tx`select u.full_name, (select count(*)::int from measurements m where m.campaign_id = ${id} and m.measured_by = u.id and m.status = 'final') as n from campaign_technicians ct join users u on u.id = ct.user_id where ct.campaign_id = ${id} order by u.full_name`;
    const recent = await tx`select m.id, m.result, m.recorded_at, u.full_name, coalesce(a.code, pp.code) as code from measurements m join users u on u.id = m.measured_by left join assets a on a.id = m.asset_id left join plan_points pp on pp.id = m.plan_point_id where m.campaign_id = ${id} order by m.recorded_at desc limit 10`;
    const cats = await tx`select c.name from campaign_categories cc join categories c on c.id = cc.category_id where cc.campaign_id = ${id}`;
    return { c, sum, items, techs, recent, cats };
  });
  if (!d) notFound();
  const { c, sum } = d;
  const pct = sum.total ? Math.round(((sum.done + sum.skipped) / sum.total) * 100) : 0;
  const late = c.status === "in_progress" && c.ends_on < new Date().toISOString().slice(0, 10);
  const canMeasure = s.permissions.has("measure") && c.status === "in_progress" && !c.is_paused;
  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3"><span className="font-mono text-lg text-muted">{c.code}</span>{c.name}</span>}
        description={[c.location, c.plan_title && `Plano: ${c.plan_title}`, d.cats.length ? `Categorías: ${d.cats.map((x) => x.name).join(", ")}` : null].filter(Boolean).join(" · ") || undefined}
        meta={<><Badge tone={CAMPAIGN_STATUS_TONE[c.status]}>{CAMPAIGN_STATUS_LABEL[c.status]}</Badge>{c.is_paused ? <Badge tone="warn">En pausa</Badge> : null}{late ? <Badge tone="bad">Atrasada</Badge> : null}<Badge>{fmtDate(c.starts_on)} – {fmtDate(c.ends_on)}</Badge>{c.owner_name ? <Badge>Responsable: {c.owner_name}</Badge> : null}</>}
        actions={
          <>
            {canMeasure ? <ButtonLink href={`/medicion?campaign=${c.id}`} icon={Route}>Iniciar ruta de medición</ButtonLink> : null}
            {c.plan_id ? <ButtonLink href={`/planos/${c.plan_id}`} variant="outline">Ver plano</ButtonLink> : null}
            {s.permissions.has("reports") ? <ButtonLink prefetch={false} href={`/api/reports/campaign/${c.id}`} variant="outline" icon={FileDown}>Informe PDF</ButtonLink> : null}
            <CampaignActions id={c.id} status={c.status} paused={c.is_paused} canEdit={s.permissions.has("edit")} canClose={s.permissions.has("campaign.close")} summary={sum} />
          </>
        }
      />
      {c.status === "closed" ? <div className="mb-4"><Alert tone="info" title={`Cerrada el ${fmtDateTime(c.closed_at)} por ${c.closed_by_name}`}><span className="whitespace-pre-line">{c.close_notes}</span></Alert></div> : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Kpi label="Total" value={sum.total} />
        <Kpi label="Completados" value={sum.done} tone="primary" hint={`${pct}% de progreso`} />
        <Kpi label="Pendientes" value={sum.pending} tone={sum.pending ? "warn" : "ok"} />
        <Kpi label="Conformes" value={sum.pass} tone="ok" />
        <Kpi label="No conformes" value={sum.fail} tone={sum.fail ? "bad" : "neutral"} href={sum.fail ? `/historial?campaign=${c.id}&result=fail` : undefined} />
        <Kpi label="Incompletos / revisión" value={sum.incomplete} tone={sum.incomplete ? "warn" : "neutral"} />
        <Kpi label="NC abiertas" value={sum.openNcs} tone={sum.openNcs ? "bad" : "neutral"} />
      </div>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progreso de la campaña"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0">
          <CardHeader title={`Elementos (${d.items.length})`} description="Los pendientes aparecen primero; al cerrar quedan registrados como no realizados" />
          <Table>
            <thead><tr><Th>Elemento</Th><Th>Categoría</Th><Th>Estado</Th><Th>Resultado</Th><Th>Fecha</Th><Th><span className="sr-only">Acciones</span></Th></tr></thead>
            <tbody>
              {d.items.map((it) => (
                <tr key={it.id} className="hover:bg-surface-2/50">
                  <Td><Link href={it.asset_id ? `/inventario/${it.asset_id}` : `/planos/${it.plan_id}`} className="font-mono text-xs font-medium text-primary hover:underline">{it.code}</Link>{it.route_order ? <span className="ml-1 text-xs text-muted">#{it.route_order}</span> : null}<span className="block text-xs text-muted">{it.name}</span></Td>
                  <Td className="text-xs text-muted">{it.category ?? "—"}</Td>
                  <Td>{it.status === "pending" ? <Badge tone="neutral">Pendiente</Badge> : it.status === "skipped" ? <Badge tone="warn" title={it.skip_reason}>Omitido</Badge> : <Badge tone="primary">Registrado</Badge>}</Td>
                  <Td>{it.result ? <Link href={`/historial/${it.last_measurement_id}`}><ResultBadge result={it.result} /></Link> : "—"}</Td>
                  <Td className="text-xs text-muted">{it.measured_at ? fmtDateTime(it.measured_at) : "—"}</Td>
                  <Td className="whitespace-nowrap text-right">
                    {canMeasure && it.status !== "skipped" ? <Link href={it.plan_point_id ? `/medicion?point=${it.plan_point_id}&campaign=${c.id}` : `/medicion?asset=${encodeURIComponent(it.code)}&campaign=${c.id}`} className="text-xs font-medium text-primary hover:underline">Medir</Link> : null}
                    {s.permissions.has("edit") && it.status === "pending" && !["closed", "cancelled"].includes(c.status) ? <SkipButton itemId={it.id} code={it.code} /> : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Técnicos" />
            {d.techs.length === 0 ? <p className="px-5 py-3 text-sm text-muted">Sin técnicos asignados.</p> : <ul className="divide-y divide-line">{d.techs.map((t) => <li key={t.full_name} className="flex justify-between px-5 py-2 text-sm"><span>{t.full_name}</span><span className="text-muted">{t.n} mediciones</span></li>)}</ul>}
          </Card>
          <Card>
            <CardHeader title="Actividad reciente" />
            {d.recent.length === 0 ? <p className="px-5 py-3 text-sm text-muted">Sin mediciones todavía.</p> : <ul className="divide-y divide-line">{d.recent.map((m) => <li key={m.id}><Link href={`/historial/${m.id}`} className="flex items-center gap-2 px-5 py-2 text-sm hover:bg-surface-2/50"><ResultBadge result={m.result} /><span className="font-mono text-xs">{m.code}</span><span className="ml-auto text-xs text-muted">{m.full_name} · {fmtRelative(m.recorded_at)}</span></Link></li>)}</ul>}
          </Card>
          {c.description ? <Card className="p-5 text-sm whitespace-pre-line">{c.description}</Card> : null}
        </div>
      </div>
    </>
  );
}
