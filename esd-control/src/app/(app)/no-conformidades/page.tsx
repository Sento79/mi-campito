import Link from "@/components/link";
import { Plus, ShieldAlert } from "lucide-react";
import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { str, userOptions } from "@/lib/server/queries/common";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui/core";
import { FilterBar, FilterSelect } from "@/components/filters";
import { NC_STATUSES, NC_STATUS_LABEL } from "@/lib/server/services/nonconformities";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "No conformidades" };

export default async function Ncs({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requirePermission("read");
  const sp = await searchParams;
  const status = str(sp.status);
  const owner = str(sp.owner);
  const d = await withCtx(s, async (tx) => ({
    rows: await tx`
      select n.id, n.code, n.title, n.status, n.due_on, n.detected_at, sv.name as severity, sv.rank, u.full_name as owner_name,
        (select string_agg(distinct coalesce(a.code, pp.code), ', ') from nc_links l left join assets a on a.id = l.asset_id left join plan_points pp on pp.id = l.plan_point_id where l.nc_id = n.id) as targets,
        (select count(*)::int from nc_actions x where x.nc_id = n.id and x.status = 'open') as open_actions
      from nonconformities n left join nc_severities sv on sv.id = n.severity_id left join users u on u.id = n.owner_user_id
      where true
      ${status === "all_open" ? tx`and n.status <> 'closed'` : status && (NC_STATUSES as readonly string[]).includes(status) ? tx`and n.status = ${status}` : tx``}
      ${status === "overdue" ? tx`and n.status <> 'closed' and n.due_on < current_date` : tx``}
      ${owner && /^[0-9a-f-]{36}$/.test(owner) ? tx`and n.owner_user_id = ${owner}` : tx``}
      order by (n.status = 'closed'), n.due_on nulls last, n.code desc limit 300`,
    users: await userOptions(tx),
  }));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="No conformidades" description="Contención, análisis de causa, acciones y verificación. No se cierran sin verificación autorizada." actions={s.permissions.has("create") || s.permissions.has("measure") ? <ButtonLink href="/no-conformidades/nueva" icon={Plus}>Nueva NC</ButtonLink> : null} />
      <FilterBar storageKey="ncs">
        <FilterSelect name="status" label="Estado" options={[{ id: "all_open", label: "Abiertas (todas)" }, { id: "overdue", label: "Fuera de plazo" }, ...NC_STATUSES.map((k) => ({ id: k, label: NC_STATUS_LABEL[k] }))]} defaultValue={status} />
        <FilterSelect name="owner" label="Responsable" options={d.users} defaultValue={owner} />
      </FilterBar>
      <Card>
        {d.rows.length === 0 ? <EmptyState icon={ShieldAlert} title="Sin no conformidades" description="No hay NC con estos filtros." /> : (
          <Table>
            <thead><tr><Th>Código</Th><Th>Título</Th><Th>Gravedad</Th><Th>Estado</Th><Th>Elementos</Th><Th>Responsable</Th><Th>Fecha límite</Th></tr></thead>
            <tbody>
              {d.rows.map((n) => (
                <tr key={n.id} className="hover:bg-surface-2/50">
                  <Td className="font-mono text-xs whitespace-nowrap"><Link href={`/no-conformidades/${n.id}`} className="font-medium text-primary hover:underline">{n.code}</Link></Td>
                  <Td className="max-w-80 truncate">{n.title}</Td>
                  <Td>{n.severity ? <Badge tone={n.rank >= 3 ? "bad" : n.rank === 2 ? "warn" : "neutral"}>{n.severity}</Badge> : "—"}</Td>
                  <Td className="whitespace-nowrap"><Badge tone={n.status === "closed" ? "ok" : n.status === "verification" ? "info" : "warn"}>{NC_STATUS_LABEL[n.status as keyof typeof NC_STATUS_LABEL]}</Badge>{n.open_actions ? <span className="ml-1 text-xs text-muted">{n.open_actions} acc.</span> : null}</Td>
                  <Td className="max-w-40 truncate font-mono text-xs text-muted">{n.targets ?? "—"}</Td>
                  <Td className="text-xs text-muted">{n.owner_name ?? "—"}</Td>
                  <Td className="whitespace-nowrap">{n.due_on ? (n.status !== "closed" && n.due_on < today ? <Badge tone="bad">Vencida {fmtDate(n.due_on)}</Badge> : <span className="text-xs text-muted">{fmtDate(n.due_on)}</span>) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
