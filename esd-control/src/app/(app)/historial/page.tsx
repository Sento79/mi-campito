import Link from "next/link";
import { Download } from "lucide-react";
import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { categoryOptions, locationOptions, pageParams, str, userOptions } from "@/lib/server/queries/common";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, ResultBadge, Table, Td, Th } from "@/components/ui/core";
import { FilterBar, FilterInput, FilterSelect, Pagination } from "@/components/filters";
import { RESULTS, RESULT_LABEL } from "@/lib/domain/results";
import { fmtDateTime } from "@/lib/format";
import { measurementWhere } from "@/lib/server/queries/measurements";

export const metadata = { title: "Historial" };

type SP = Record<string, string | string[] | undefined>;

export default async function HistoryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await requirePermission("read");
  const sp = await searchParams;
  const { page, limit, offset } = pageParams(sp, 40);
  const d = await withCtx(s, async (tx) => {
    const where = measurementWhere(tx, sp);
    const rows = await tx`
      select m.id, m.recorded_at, m.result, m.status, m.attempt_number, m.synced_from_offline, u.full_name as by_name, i.code as instrument_code,
             c.code as crit_code, cv.version as crit_version, cmp.code as campaign_code,
             coalesce(a.code, pp.code) as target_code, coalesce(a.name, pp.name) as target_name, a.id as asset_id, pp.plan_id,
             (select string_agg(coalesce(mv.point_code || ': ', '') || coalesce(mv.raw_input, mv.option_value, case when mv.checked then 'OK' when mv.checked = false then 'NO OK' end, '—') || coalesce(' ' || mv.raw_unit, ''), ' · ' order by mv.sort_order) from measurement_values mv where mv.measurement_id = m.id) as values_text
        from measurements m join users u on u.id = m.measured_by
        left join assets a on a.id = m.asset_id left join plan_points pp on pp.id = m.plan_point_id
        left join instruments i on i.id = m.instrument_id left join campaigns cmp on cmp.id = m.campaign_id
        left join criterion_versions cv on cv.id = m.criterion_version_id left join criteria c on c.id = cv.criterion_id
       where ${where} order by m.recorded_at desc limit ${limit} offset ${offset}`;
    const [{ n }] = await tx`select count(*)::int as n from measurements m left join assets a on a.id = m.asset_id left join plan_points pp on pp.id = m.plan_point_id where ${where}`;
    const campaigns = await tx`select id, code || ' · ' || name as label from campaigns order by starts_on desc limit 100`;
    return { rows, n, categories: await categoryOptions(tx), locations: await locationOptions(tx), users: await userOptions(tx), campaigns: campaigns.map((c) => ({ id: c.id as string, label: c.label as string })) };
  });
  const qs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && k !== "page" ? [[k, v]] : []))).toString();
  return (
    <>
      <PageHeader
        title="Historial de mediciones"
        description="Registro inalterable. Las correcciones se hacen repitiendo o invalidando (con motivo), nunca sobrescribiendo."
        actions={s.permissions.has("export") ? <><ButtonLink prefetch={false} href={`/api/export/measurements?format=xlsx&${qs}`} variant="outline" icon={Download}>XLSX</ButtonLink><ButtonLink prefetch={false} href={`/api/export/measurements?format=csv&${qs}`} variant="outline" icon={Download}>CSV</ButtonLink></> : null}
      />
      <FilterBar storageKey="history">
        <FilterInput name="q" label="Activo / punto" defaultValue={str(sp.q)} placeholder="ID o nombre" />
        <FilterSelect name="result" label="Resultado" options={RESULTS.map((r) => ({ id: r, label: RESULT_LABEL[r] }))} defaultValue={str(sp.result)} />
        <FilterSelect name="category" label="Categoría" options={d.categories} defaultValue={str(sp.category)} allLabel="Todas" />
        <FilterSelect name="location" label="Ubicación" options={d.locations} defaultValue={str(sp.location)} allLabel="Todas" />
        <FilterSelect name="campaign" label="Campaña" options={d.campaigns} defaultValue={str(sp.campaign)} allLabel="Todas" />
        <FilterSelect name="user" label="Técnico" options={d.users} defaultValue={str(sp.user)} />
        <FilterSelect name="status" label="Validez" options={[{ id: "invalidated", label: "Invalidadas" }, { id: "all", label: "Todas" }]} defaultValue={str(sp.status)} allLabel="Válidas" />
        <FilterInput name="from" label="Desde" type="date" defaultValue={str(sp.from)} />
        <FilterInput name="to" label="Hasta" type="date" defaultValue={str(sp.to)} />
      </FilterBar>
      <Card>
        {d.rows.length === 0 ? <EmptyState title="Sin mediciones" description="No hay mediciones con estos filtros." /> : (
          <Table>
            <thead><tr><Th>Fecha (servidor)</Th><Th>Elemento</Th><Th>Resultado</Th><Th>Valores</Th><Th>Criterio</Th><Th>Instrumento</Th><Th>Campaña</Th><Th>Técnico</Th></tr></thead>
            <tbody>
              {d.rows.map((m) => (
                <tr key={m.id} className={m.status === "invalidated" ? "opacity-60" : "hover:bg-surface-2/50"}>
                  <Td className="whitespace-nowrap"><Link href={`/historial/${m.id}`} className="text-primary hover:underline">{fmtDateTime(m.recorded_at)}</Link>{m.synced_from_offline ? <Badge className="ml-1" tone="info" title="Registrada desde la cola offline">offline</Badge> : null}</Td>
                  <Td className="max-w-60"><Link href={m.asset_id ? `/inventario/${m.asset_id}` : `/planos/${m.plan_id}`} className="font-mono text-xs font-medium hover:underline">{m.target_code}</Link><span className="block truncate text-xs text-muted">{m.target_name}</span></Td>
                  <Td className="whitespace-nowrap">{m.status === "invalidated" ? <Badge>Invalidada</Badge> : <ResultBadge result={m.result} />}{m.attempt_number > 1 ? <span className="ml-1 text-xs text-muted">#{m.attempt_number}</span> : null}</Td>
                  <Td className="max-w-64 truncate font-mono text-xs" title={m.values_text ?? ""}>{m.values_text ?? "—"}</Td>
                  <Td className="text-xs whitespace-nowrap text-muted">{m.crit_code ? `${m.crit_code} v${m.crit_version}` : "—"}</Td>
                  <Td className="text-xs text-muted">{m.instrument_code ?? "—"}</Td>
                  <Td className="text-xs text-muted">{m.campaign_code ?? "—"}</Td>
                  <Td className="text-xs whitespace-nowrap text-muted">{m.by_name}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={page} total={d.n} limit={limit} />
      </Card>
    </>
  );
}
