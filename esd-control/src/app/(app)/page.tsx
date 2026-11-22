import Link from "@/components/link";
import { Boxes, CalendarCheck2, CalendarClock, ShieldAlert, Gauge, CheckCircle2, XCircle, Percent, CalendarRange, AlertTriangle, ScanLine } from "lucide-react";
import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { loadDashboard } from "@/lib/server/queries/dashboard";
import { categoryOptions, dateOrUndef, locationOptions, uuidOrUndef } from "@/lib/server/queries/common";
import { ButtonLink, Card, CardHeader, EmptyState, Kpi, PageHeader, ResultBadge, Badge } from "@/components/ui/core";
import { FilterBar, FilterInput, FilterSelect } from "@/components/filters";
import { TrendChart, CategoryChart } from "@/components/charts/charts";
import { DashboardCustomizer, Widget } from "@/components/dashboard-widgets";
import { fmtDate, fmtRelative } from "@/lib/format";

export const metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requirePermission("read");
  const sp = await searchParams;
  const today = new Date();
  const defFrom = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2, 1)).toISOString().slice(0, 10);
  const f = {
    from: dateOrUndef(sp.from) ?? defFrom,
    to: dateOrUndef(sp.to) ?? today.toISOString().slice(0, 10),
    locationId: uuidOrUndef(sp.location),
    categoryId: uuidOrUndef(sp.category),
    campaignId: uuidOrUndef(sp.campaign),
  };
  const st = s.org.settings;
  const { d, locations, categories, campaigns } = await withCtx(s, async (tx) => ({
    d: await loadDashboard(tx, f, st.dueLeadDays, st.calibrationLeadDays),
    locations: (await locationOptions(tx)).filter((l) => l.kind !== "spot"),
    categories: await categoryOptions(tx),
    campaigns: (await tx`select id, code || ' · ' || name as label from campaigns where status not in ('cancelled') order by starts_on desc limit 50`).map((r) => ({ id: r.id as string, label: r.label as string })),
  }));
  const q = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (f.locationId) p.set("location", f.locationId);
    if (f.categoryId) p.set("category", f.categoryId);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return p.toString();
  };
  const period = q({ from: f.from, to: f.to, ...(f.campaignId ? { campaign: f.campaignId } : {}) });

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Estado del programa de control ESD de ${s.org.name}.`}
        actions={s.permissions.has("measure") ? <ButtonLink href="/medicion" icon={ScanLine}>Medición rápida</ButtonLink> : null}
      />
      <FilterBar>
        <FilterSelect name="location" label="Planta / zona" options={locations} defaultValue={f.locationId} allLabel="Todas" />
        <FilterSelect name="category" label="Categoría" options={categories} defaultValue={f.categoryId} allLabel="Todas" />
        <FilterSelect name="campaign" label="Campaña" options={campaigns} defaultValue={f.campaignId} allLabel="Todas" />
        <FilterInput name="from" label="Desde" type="date" defaultValue={f.from} />
        <FilterInput name="to" label="Hasta" type="date" defaultValue={f.to} />
      </FilterBar>

      <DashboardCustomizer>
        <Widget id="kpis">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Activos" value={d.assets.total} icon={Boxes} href={`/inventario?${q({})}`} hint={d.assets.blocked ? `${d.assets.blocked} bloqueados` : "En servicio"} />
            <Kpi label="Planificadas" value={d.assets.planned_in_period} icon={CalendarClock} href={`/inventario?${q({ due: "period", from: f.from, to: f.to })}`} hint="Vencen en el periodo" />
            <Kpi label="Realizadas" value={d.meas.total} icon={CalendarCheck2} tone="primary" href={`/historial?${period}`} hint={`${fmtDate(f.from)} – ${fmtDate(f.to)}`} />
            <Kpi label="Vencidas" value={d.assets.overdue} icon={AlertTriangle} tone={d.assets.overdue ? "bad" : "ok"} href={`/inventario?${q({ due: "overdue" })}`} hint={`${d.assets.due_soon} próximas (${st.dueLeadDays} d) · ${d.assets.never_measured} sin medir`} />
            <Kpi label="Conformes" value={d.meas.pass} icon={CheckCircle2} tone="ok" href={`/historial?${q({ from: f.from, to: f.to, result: "pass" })}`} hint={`${d.meas.review} revisión/incompletas`} />
            <Kpi label="No conformes" value={d.meas.fail} icon={XCircle} tone={d.meas.fail ? "bad" : "neutral"} href={`/historial?${q({ from: f.from, to: f.to, result: "fail" })}`} />
            <Kpi
              label="Cumplimiento"
              value={d.compliancePct === null ? "—" : `${d.compliancePct.toLocaleString("es-ES")} %`}
              icon={Percent}
              tone={d.compliancePct === null ? "neutral" : d.compliancePct >= 95 ? "ok" : d.compliancePct >= 80 ? "warn" : "bad"}
              href={`/inventario?${q({ due: "overdue" })}`}
              hint="Activos programados conformes y al día"
            />
            <Kpi label="Campañas en curso" value={d.campaigns.active} icon={CalendarRange} href="/campanas?status=in_progress" hint={d.campaigns.late ? `${d.campaigns.late} atrasadas` : "Sin retrasos"} tone={d.campaigns.late ? "warn" : undefined} />
            <Kpi label="NC abiertas" value={d.ncs.open} icon={ShieldAlert} tone={d.ncs.overdue ? "bad" : d.ncs.open ? "warn" : "ok"} href="/no-conformidades?status=all_open" hint={d.ncs.overdue ? `${d.ncs.overdue} fuera de plazo` : "En plazo"} />
            <Kpi label="Calibración" value={d.instruments.expired + d.instruments.due_soon} icon={Gauge} tone={d.instruments.expired ? "bad" : d.instruments.due_soon ? "warn" : "ok"} href="/instrumentos?cal=due" hint={`${d.instruments.expired} vencidas · ${d.instruments.due_soon} próximas`} />
          </div>
        </Widget>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Widget id="trend">
            <Card>
              <CardHeader title="Tendencia de mediciones" description="Mediciones válidas por semana en el periodo filtrado" />
              <div className="p-4">{d.trend.length ? <TrendChart data={d.trend as never} /> : <EmptyState title="Sin mediciones en el periodo" description="Ajuste los filtros o registre mediciones desde Medición rápida." />}</div>
            </Card>
          </Widget>
          <Widget id="categories">
            <Card>
              <CardHeader title="Último resultado por categoría" description="Estado actual de los activos" />
              <div className="p-4">{d.byCategory.length ? <CategoryChart data={d.byCategory as never} /> : <EmptyState title="Sin activos" />}</div>
            </Card>
          </Widget>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Widget id="upcoming">
            <Card>
              <CardHeader title="Próximas tareas" description="Mediciones, calibraciones, NC y campañas próximas o vencidas" actions={<Link href="/alertas" className="text-xs font-medium text-primary hover:underline">Ver alertas</Link>} />
              {d.upcoming.length === 0 ? (
                <EmptyState title="Nada pendiente" description="No hay tareas próximas en el horizonte de aviso." />
              ) : (
                <ul className="divide-y divide-line">
                  {d.upcoming.map((u) => {
                    const overdue = u.due && new Date(u.due) < new Date();
                    const href = { asset: `/inventario/${u.id}`, instrument: `/instrumentos/${u.id}`, nc: `/no-conformidades/${u.id}`, campaign: `/campanas/${u.id}` }[u.kind as string] ?? "/";
                    return (
                      <li key={u.kind + u.id}>
                        <Link href={href} className="flex items-center gap-3 px-5 py-2.5 hover:bg-surface-2/60">
                          <Badge tone={overdue ? "bad" : "warn"}>{overdue ? "Vencida" : "Próxima"}</Badge>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{u.title}</span>
                            <span className="text-xs text-muted">{u.what}</span>
                          </span>
                          <span className="text-xs text-muted tabular">{fmtDate(u.due)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </Widget>
          <Widget id="recent">
            <Card>
              <CardHeader title="Últimas actividades" description="Mediciones registradas recientemente" actions={<Link href="/historial" className="text-xs font-medium text-primary hover:underline">Historial</Link>} />
              {d.recent.length === 0 ? (
                <EmptyState title="Aún no hay mediciones" description="Las mediciones aparecerán aquí al registrarlas." />
              ) : (
                <ul className="divide-y divide-line">
                  {d.recent.map((m) => (
                    <li key={m.id}>
                      <Link href={`/historial/${m.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-surface-2/60">
                        <ResultBadge result={m.result} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{m.target}</span>
                          <span className="text-xs text-muted">{m.by_name}</span>
                        </span>
                        <span className="text-xs text-muted" title={new Date(m.recorded_at).toISOString()}>{fmtRelative(m.recorded_at)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </Widget>
        </div>
      </DashboardCustomizer>
    </>
  );
}
