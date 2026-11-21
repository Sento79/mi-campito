import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { locationOptions, userOptions } from "@/lib/server/queries/common";
import { Badge, Card, CardHeader, PageHeader, Table, Td, Th } from "@/components/ui/core";
import { fmtDate } from "@/lib/format";
import { DocumentsList } from "@/components/documents-list";
import { AuditTrail } from "@/components/audit-trail";
import { UploadButton } from "@/components/upload";
import { CalBadge } from "../cal-badge";
import { InstrumentForm, CalibrationForm } from "./instrument-client";
import { uploadInstrumentDocAction } from "../actions";

export default async function InstrumentPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePermission("read");
  const { id } = await params;
  const isNew = id === "nuevo";
  if (!isNew && !/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await withCtx(s, async (tx) => {
    const [i] = isNew ? [null] : await tx`select * from instruments where id = ${id}`;
    const cals = isNew ? [] : await tx`select c.*, u.full_name as by_name from calibrations c left join users u on u.id = c.created_by where c.instrument_id = ${id} order by c.calibrated_on desc`;
    const docs = isNew ? [] : await tx`select id, file_name, mime_type, size_bytes, created_at, kind from documents where entity_type = 'instrument' and entity_id = ${id} order by created_at desc`;
    const [usage] = isNew ? [{ n: 0 }] : await tx`select count(*)::int as n, max(recorded_at) as last from measurements where instrument_id = ${id}`;
    const auditRows = !isNew && s.permissions.has("audit.read") ? await tx`select l.id::text, l.at, l.action, l.summary, l.reason, l.before_data, l.after_data, u.full_name as user_name from audit_log l left join users u on u.id = l.user_id where l.entity_type = 'instrument' and l.entity_id = ${id} order by l.at desc limit 20` : [];
    return { i, cals, docs, usage, auditRows, users: await userOptions(tx), locations: await locationOptions(tx) };
  });
  if (!isNew && !d.i) notFound();
  const manage = s.permissions.has("instruments.manage");
  const i = d.i;
  return (
    <>
      <PageHeader title={isNew ? "Nuevo instrumento" : `${i!.code} · ${i!.type}`} meta={i ? <><CalBadge due={i.calibration_due_on} last={i.last_calibrated_on} lead={s.org.settings.calibrationLeadDays} /><Badge>{d.usage.n} mediciones</Badge></> : undefined} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <InstrumentForm readOnly={!manage} users={d.users} locations={d.locations} v={i ? { id: i.id, code: i.code, type: i.type, manufacturer: i.manufacturer ?? "", model: i.model ?? "", serialNumber: i.serial_number ?? "", acquiredOn: i.acquired_on ?? "", status: i.status, ownerUserId: i.owner_user_id ?? "", locationId: i.location_id ?? "", notes: i.notes ?? "", reason: "" } : null} />
          {!isNew ? (
            <Card>
              <CardHeader title="Historial de calibraciones" />
              {d.cals.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Sin calibraciones registradas. El instrumento se considera no calibrado.</p> : (
                <Table>
                  <thead><tr><Th>Calibrado</Th><Th>Vence</Th><Th>Resultado</Th><Th>Proveedor</Th><Th>Certificado</Th><Th>Registrado por</Th></tr></thead>
                  <tbody>{d.cals.map((c) => (
                    <tr key={c.id}><Td>{fmtDate(c.calibrated_on)}</Td><Td>{fmtDate(c.due_on)}</Td><Td><Badge tone={c.outcome === "fail" ? "bad" : "ok"}>{c.outcome === "pass" ? "Apto" : c.outcome === "adjusted" ? "Ajustado" : "No apto"}</Badge></Td><Td className="text-muted">{c.provider ?? "—"}</Td>
                      <Td>{c.document_id ? <a className="text-primary hover:underline" href={`/api/files/${c.document_id}`} target="_blank" rel="noopener">{c.certificate_number ?? "Ver"}</a> : c.certificate_number ?? "—"}</Td><Td className="text-xs text-muted">{c.by_name}</Td></tr>
                  ))}</tbody>
                </Table>
              )}
            </Card>
          ) : null}
          {d.auditRows.length ? <Card><CardHeader title="Trazabilidad" /><AuditTrail rows={d.auditRows as never} /></Card> : null}
        </div>
        {!isNew ? (
          <div className="space-y-4">
            {manage ? <CalibrationForm instrumentId={i!.id} /> : null}
            <Card>
              <CardHeader title="Documentos" actions={manage ? <UploadButton action={uploadInstrumentDocAction} fields={{ instrumentId: i!.id }} /> : null} />
              <DocumentsList docs={d.docs as never} />
            </Card>
          </div>
        ) : null}
      </div>
    </>
  );
}
