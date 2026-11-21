import Link from "@/components/link";
import { Plus, Gauge } from "lucide-react";
import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { str } from "@/lib/server/queries/common";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui/core";
import { FilterBar, FilterSelect } from "@/components/filters";
import { INSTRUMENT_STATUS_LABEL } from "@/lib/format";
import { CalBadge } from "./cal-badge";

export const metadata = { title: "Instrumentos" };

export default async function Instruments({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requirePermission("read");
  const sp = await searchParams;
  const cal = str(sp.cal);
  const lead = s.org.settings.calibrationLeadDays;
  const rows = await withCtx(s, (tx) => tx`
    select i.*, u.full_name as owner_name, l.name as location_name from instruments i left join users u on u.id = i.owner_user_id left join locations l on l.id = i.location_id
    where ${str(sp.archived) === "1" ? tx`i.archived_at is not null` : tx`i.archived_at is null`}
    ${cal === "due" ? tx`and (i.calibration_due_on is null or i.calibration_due_on <= current_date + ${lead}::int)` : cal === "expired" ? tx`and (i.calibration_due_on is null or i.calibration_due_on < current_date)` : tx``}
    order by i.code`);
  return (
    <>
      <PageHeader title="Instrumentos" description={`Equipos de medida y su calibración. Aviso con ${lead} días de antelación. Política de uso fuera de calibración: ${s.org.settings.instrumentPolicy === "block" ? "bloquear" : s.org.settings.instrumentPolicy === "review" ? "resultado en revisión" : "solo aviso"}.`} actions={s.permissions.has("instruments.manage") ? <ButtonLink href="/instrumentos/nuevo" icon={Plus}>Nuevo instrumento</ButtonLink> : null} />
      <FilterBar>
        <FilterSelect name="cal" label="Calibración" options={[{ id: "due", label: "Vencidas o próximas" }, { id: "expired", label: "Vencidas" }]} defaultValue={cal} />
        <FilterSelect name="archived" label="Archivo" options={[{ id: "1", label: "Retirados" }]} defaultValue={str(sp.archived)} allLabel="En uso" />
      </FilterBar>
      <Card>
        {rows.length === 0 ? <EmptyState icon={Gauge} title="Sin instrumentos" /> : (
          <Table>
            <thead><tr><Th>Código</Th><Th>Tipo</Th><Th>Fabricante / modelo</Th><Th>Nº serie</Th><Th>Estado</Th><Th>Calibración</Th><Th>Responsable</Th></tr></thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className="hover:bg-surface-2/50">
                  <Td className="font-mono text-xs"><Link className="font-medium text-primary hover:underline" href={`/instrumentos/${i.id}`}>{i.code}</Link></Td>
                  <Td>{i.type}</Td>
                  <Td className="text-muted">{[i.manufacturer, i.model].filter(Boolean).join(" · ") || "—"}</Td>
                  <Td className="font-mono text-xs text-muted">{i.serial_number ?? "—"}</Td>
                  <Td><Badge tone={i.status === "active" ? "ok" : i.status === "in_calibration" ? "info" : "neutral"}>{INSTRUMENT_STATUS_LABEL[i.status]}</Badge></Td>
                  <Td><CalBadge due={i.calibration_due_on} last={i.last_calibrated_on} lead={lead} /></Td>
                  <Td className="text-xs text-muted">{i.owner_name ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
