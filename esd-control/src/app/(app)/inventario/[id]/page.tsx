import Link from "@/components/link";
import { notFound } from "next/navigation";
import { Pencil, Copy, Tags, ScanLine, ShieldAlert, FileDown } from "lucide-react";
import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { Badge, ButtonLink, Card, CardHeader, DefinitionList, EmptyState, PageHeader, ResultBadge, Table, Td, Th, Alert } from "@/components/ui/core";
import { ASSET_STATUS_LABEL } from "@/lib/domain/asset-import";
import { describePeriod, type PeriodUnit } from "@/lib/domain/periodicity";
import { describeRules, parseRules } from "@/lib/domain/criteria";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { DocumentsList } from "@/components/documents-list";
import { AuditTrail } from "@/components/audit-trail";
import { UploadButton } from "@/components/upload";
import { activeCriterionVersion } from "@/lib/server/services/measurements";
import { uploadAssetDocumentAction } from "../actions";
import { DueBadge, STATUS_TONE } from "../asset-table";
import { ArchiveToggle } from "./archive-toggle";

export default async function AssetDetail({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePermission("read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await withCtx(s, async (tx) => {
    const [a] = await tx`
      select a.*, c.name as category_name, c.code as category_code, c.criterion_id as cat_criterion, c.period_unit as cat_pu, c.period_count as cat_pc,
             c.instructions, c.precautions, c.record_method, app_location_path(a.location_id) as location_path,
             u.full_name as owner_name, pt.name as template_name
        from assets a join categories c on c.id = a.category_id left join users u on u.id = a.owner_user_id
        left join point_templates pt on pt.id = a.point_template_id where a.id = ${id}`;
    if (!a) return null;
    const criterion = await activeCriterionVersion(tx, a.criterion_id ?? a.cat_criterion);
    const measurements = await tx`
      select m.id, m.recorded_at, m.result, m.status, m.attempt_number, m.invalidation_reason, u.full_name as by_name, i.code as instrument_code, c.code as crit_code, cv.version as crit_version,
        (select string_agg(coalesce(mv.point_code || ': ', '') || coalesce(mv.raw_input, mv.option_value, case when mv.checked then 'OK' when mv.checked = false then 'NO OK' end, '—') || coalesce(' ' || mv.raw_unit, ''), ' · ' order by mv.sort_order) from measurement_values mv where mv.measurement_id = m.id) as values_text
      from measurements m join users u on u.id = m.measured_by left join instruments i on i.id = m.instrument_id
      left join criterion_versions cv on cv.id = m.criterion_version_id left join criteria c on c.id = cv.criterion_id
      where m.asset_id = ${id} order by m.recorded_at desc limit 50`;
    const docs = await tx`select id, file_name, mime_type, size_bytes, created_at, kind from documents where entity_type = 'asset' and entity_id = ${id} and archived_at is null order by created_at desc`;
    const ncs = await tx`select distinct n.id, n.code, n.title, n.status from nc_links l join nonconformities n on n.id = l.nc_id where l.asset_id = ${id} order by n.code desc`;
    const auditRows = s.permissions.has("audit.read")
      ? await tx`select l.id::text, l.at, l.action, l.summary, l.reason, l.before_data, l.after_data, u.full_name as user_name from audit_log l left join users u on u.id = l.user_id where l.entity_type = 'asset' and l.entity_id = ${id} order by l.at desc limit 30`
      : [];
    return { a, criterion, measurements, docs, ncs, auditRows };
  });
  if (!d) notFound();
  const { a, criterion } = d;
  const rules = criterion ? parseRules(criterion.rules) : null;
  const pu = (a.period_unit ?? a.cat_pu) as PeriodUnit | null;
  const pc = a.period_count ?? a.cat_pc;
  const canEdit = s.permissions.has("edit");
  const measurable = !a.archived_at && a.status !== "retired";

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{a.code}</span>
            <span className="font-normal text-muted">{a.name}</span>
          </span>
        }
        meta={
          <>
            {a.archived_at ? <Badge tone="neutral">Archivado {fmtDate(a.archived_at)}</Badge> : <Badge tone={STATUS_TONE[a.status as keyof typeof STATUS_TONE]}>{ASSET_STATUS_LABEL[a.status as keyof typeof ASSET_STATUS_LABEL]}</Badge>}
            <ResultBadge result={a.last_result} />
            <DueBadge next={a.next_due_at} last={a.last_measured_at} lead={s.org.settings.dueLeadDays} hasPeriod={!!pu} />
          </>
        }
        actions={
          <>
            {s.permissions.has("measure") && measurable ? <ButtonLink href={`/medicion?asset=${encodeURIComponent(a.code)}`} icon={ScanLine}>Medir</ButtonLink> : null}
            <ButtonLink href={`/etiquetas?assets=${a.id}`} variant="outline" icon={Tags}>Etiqueta</ButtonLink>
            {s.permissions.has("reports") ? <ButtonLink prefetch={false} href={`/api/reports/asset/${a.id}`} variant="outline" icon={FileDown}>Informe</ButtonLink> : null}
            {canEdit ? <ButtonLink href={`/inventario/${a.id}/editar`} variant="outline" icon={Pencil}>Editar</ButtonLink> : null}
            {s.permissions.has("create") ? <ButtonLink href={`/inventario/nuevo?duplicar=${a.id}`} variant="outline" icon={Copy}>Duplicar</ButtonLink> : null}
            {canEdit ? <ArchiveToggle id={a.id} archived={!!a.archived_at} /> : null}
          </>
        }
      />
      {a.status === "blocked" ? <div className="mb-4"><Alert tone="bad" icon={ShieldAlert} title="Activo bloqueado">No debe utilizarse hasta resolver la incidencia.</Alert></div> : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Datos del activo" />
            <div className="p-5">
              <DefinitionList
                cols={3}
                items={[
                  ["Categoría", `${a.category_name} (${a.category_code})`],
                  ["Ubicación", a.location_path || null],
                  ["Código de escaneo", <span key="s" className="font-mono">{a.scan_code}</span>],
                  ["Fabricante / modelo", [a.manufacturer, a.model].filter(Boolean).join(" · ") || null],
                  ["Número de serie", a.serial_number],
                  ["Fecha de alta", fmtDate(a.commissioned_on)],
                  ["Responsable", a.owner_name],
                  ["Última medición", a.last_measured_at ? fmtDateTime(a.last_measured_at) : "Nunca"],
                  ["Próxima prevista", a.next_due_at ? fmtDate(a.next_due_at) : "—"],
                ]}
              />
              {a.notes ? <p className="mt-4 rounded-md bg-surface-2 p-3 text-sm whitespace-pre-line">{a.notes}</p> : null}
            </div>
          </Card>
          <Card>
            <CardHeader title="Historial de mediciones" description="Registro inalterable: las mediciones invalidadas se conservan con su motivo" />
            {d.measurements.length === 0 ? (
              <EmptyState title="Sin mediciones" description="Este activo aún no se ha medido." />
            ) : (
              <Table>
                <thead>
                  <tr><Th>Fecha</Th><Th>Resultado</Th><Th>Valores</Th><Th>Criterio</Th><Th>Instrumento</Th><Th>Técnico</Th></tr>
                </thead>
                <tbody>
                  {d.measurements.map((m) => (
                    <tr key={m.id} className={m.status === "invalidated" ? "opacity-60" : "hover:bg-surface-2/50"}>
                      <Td className="whitespace-nowrap"><Link href={`/historial/${m.id}`} className="text-primary hover:underline">{fmtDateTime(m.recorded_at)}</Link>{m.attempt_number > 1 ? <span className="ml-1 text-xs text-muted">(intento {m.attempt_number})</span> : null}</Td>
                      <Td className="whitespace-nowrap">{m.status === "invalidated" ? <Badge tone="neutral" title={m.invalidation_reason}>Invalidada</Badge> : <ResultBadge result={m.result} />}</Td>
                      <Td className="max-w-72 truncate font-mono text-xs" title={m.values_text ?? ""}>{m.values_text ?? "—"}</Td>
                      <Td className="text-xs text-muted whitespace-nowrap">{m.crit_code ? `${m.crit_code} v${m.crit_version}` : "Sin criterio"}</Td>
                      <Td className="text-xs text-muted">{m.instrument_code ?? "—"}</Td>
                      <Td className="text-xs text-muted whitespace-nowrap">{m.by_name}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          {s.permissions.has("audit.read") ? (
            <Card>
              <CardHeader title="Trazabilidad del activo" description="Altas, ediciones, movimientos y archivados" />
              <AuditTrail rows={d.auditRows as never} />
            </Card>
          ) : null}
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Inspección" />
            <div className="space-y-3 p-5 text-sm">
              <DefinitionList
                cols={1}
                items={[
                  ["Periodicidad", `${describePeriod(pu, pc)}${a.period_unit ? " (excepción del activo)" : ""}`],
                  ["Criterio vigente", criterion ? `${criterion.criterion_code} · versión ${criterion.version}` : null],
                  ["Regla", rules ? describeRules(rules) : null],
                  ["Plantilla multipunto", a.record_method === "multipoint" ? (a.template_name ?? "La de la categoría") : "No aplica"],
                ]}
              />
              {!criterion ? <Alert tone="warn" title="Sin criterio vigente">Las mediciones quedarán como «Requiere revisión» hasta que un responsable publique un criterio.</Alert> : null}
              {a.instructions ? <p className="text-muted"><strong className="text-fg">Instrucciones:</strong> {a.instructions}</p> : null}
            </div>
          </Card>
          <Card>
            <CardHeader title="No conformidades" />
            {d.ncs.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">Ninguna.</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.ncs.map((n) => (
                  <li key={n.id} className="px-5 py-2.5 text-sm">
                    <Link href={`/no-conformidades/${n.id}`} className="font-medium text-primary hover:underline">{n.code}</Link> <span className="text-muted">{n.title}</span>
                    <Badge tone={n.status === "closed" ? "ok" : "warn"} className="ml-2">{n.status === "closed" ? "Cerrada" : "Abierta"}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Fotos y documentos" actions={canEdit ? <UploadButton action={uploadAssetDocumentAction} fields={{ assetId: a.id, kind: "attachment" }} /> : null} />
            <DocumentsList docs={d.docs as never} />
          </Card>
        </div>
      </div>
    </>
  );
}
