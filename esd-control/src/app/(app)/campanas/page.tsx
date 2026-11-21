import Link from "next/link";
import { Plus, CalendarRange } from "lucide-react";
import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { str } from "@/lib/server/queries/common";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui/core";
import { FilterBar, FilterSelect } from "@/components/filters";
import { CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUS_TONE as STATUS_TONE, fmtDate } from "@/lib/format";
import { CAMPAIGN_STATUSES } from "@/lib/server/services/campaigns";

export const metadata = { title: "Campañas" };

export default async function Campaigns({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requirePermission("read");
  const sp = await searchParams;
  const status = str(sp.status);
  const rows = await withCtx(s, (tx) => tx`
    select c.*, app_location_path(c.location_id) as location, u.full_name as owner_name,
      (select count(*)::int from campaign_items ci where ci.campaign_id = c.id) as total,
      (select count(*)::int from campaign_items ci where ci.campaign_id = c.id and ci.status <> 'pending') as done,
      (select count(*)::int from campaign_items ci where ci.campaign_id = c.id and ci.result = 'fail') as fail
    from campaigns c left join users u on u.id = c.owner_user_id
    ${status && (CAMPAIGN_STATUSES as readonly string[]).includes(status) ? tx`where c.status = ${status}` : tx``}
    order by case c.status when 'in_progress' then 0 when 'planned' then 1 when 'in_review' then 2 when 'draft' then 3 else 4 end, c.starts_on desc limit 200`);
  return (
    <>
      <PageHeader title="Campañas" description="Planificación y seguimiento de inspecciones por lotes." actions={s.permissions.has("create") ? <ButtonLink href="/campanas/nueva" icon={Plus}>Nueva campaña</ButtonLink> : null} />
      <FilterBar>
        <FilterSelect name="status" label="Estado" options={CAMPAIGN_STATUSES.map((k) => ({ id: k, label: CAMPAIGN_STATUS_LABEL[k] }))} defaultValue={status} />
      </FilterBar>
      <Card>
        {rows.length === 0 ? <EmptyState icon={CalendarRange} title="No hay campañas" description="Cree una campaña por categoría, ubicación, plano, vencimientos o selección." /> : (
          <Table>
            <thead><tr><Th>Código</Th><Th>Nombre</Th><Th>Estado</Th><Th>Periodo</Th><Th>Ámbito</Th><Th>Responsable</Th><Th className="w-56">Progreso</Th></tr></thead>
            <tbody>
              {rows.map((c) => {
                const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
                const late = c.status === "in_progress" && c.ends_on < new Date().toISOString().slice(0, 10);
                return (
                  <tr key={c.id} className="hover:bg-surface-2/50">
                    <Td className="font-mono text-xs"><Link className="font-medium text-primary hover:underline" href={`/campanas/${c.id}`}>{c.code}</Link></Td>
                    <Td>{c.name}</Td>
                    <Td className="whitespace-nowrap"><Badge tone={STATUS_TONE[c.status]}>{CAMPAIGN_STATUS_LABEL[c.status]}</Badge>{c.is_paused ? <Badge className="ml-1" tone="warn">En pausa</Badge> : null}{late ? <Badge className="ml-1" tone="bad">Atrasada</Badge> : null}</Td>
                    <Td className="text-xs whitespace-nowrap text-muted">{fmtDate(c.starts_on)} – {fmtDate(c.ends_on)}</Td>
                    <Td className="max-w-52 truncate text-xs text-muted">{c.location || "—"}</Td>
                    <Td className="text-xs text-muted">{c.owner_name ?? "—"}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Progreso ${pct}%`}><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
                        <span className="w-24 text-right text-xs tabular text-muted">{c.done}/{c.total}{c.fail ? <span className="text-bad"> · {c.fail} NC</span> : null}</span>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
