import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { Alert, Badge, Card, CardHeader, DefinitionList, PageHeader, ResultBadge, Table, Td, Th } from "@/components/ui/core";
import { describeRules, parseRules } from "@/lib/domain/criteria";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { DocumentsList } from "@/components/documents-list";
import { InvalidateButton } from "./invalidate-button";
import { ButtonLink } from "@/components/ui/core";

export const metadata = { title: "Medición" };

export default async function MeasurementDetail({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePermission("read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await withCtx(s, async (tx) => {
    const [m] = await tx`
      select m.*, u.full_name as by_name, iu.full_name as invalidated_by_name, i.code as instrument_code, i.type as instrument_type,
             c.code as crit_code, c.name as crit_name, cv.version as crit_version, cv.approved_at as crit_approved_at,
             p.code as proc_code, p.title as proc_title, cmp.code as campaign_code, cmp.name as campaign_name,
             a.code as asset_code, a.name as asset_name, pp.code as point_code, pp.name as point_name, pp.plan_id, cat.name as category_name
        from measurements m join users u on u.id = m.measured_by left join users iu on iu.id = m.invalidated_by
        left join instruments i on i.id = m.instrument_id left join criterion_versions cv on cv.id = m.criterion_version_id
        left join criteria c on c.id = cv.criterion_id left join procedures p on p.id = m.procedure_id
        left join campaigns cmp on cmp.id = m.campaign_id left join assets a on a.id = m.asset_id
        left join plan_points pp on pp.id = m.plan_point_id left join categories cat on cat.id = m.category_id
       where m.id = ${id}`;
    if (!m) return null;
    const values = await tx`select * from measurement_values where measurement_id = ${id} order by sort_order`;
    const attempts = await tx`select id, attempt_number, result, status, recorded_at from measurements where (repeats_measurement_id = ${id} or id = ${m.repeats_measurement_id ?? id}) and id <> ${id} order by recorded_at`;
    const ncs = await tx`select n.id, n.code, n.title, n.status from nc_links l join nonconformities n on n.id = l.nc_id where l.measurement_id = ${id}`;
    const docs = await tx`select id, file_name, mime_type, size_bytes, created_at, kind from documents where entity_type = 'measurement' and entity_id = ${id}`;
    return { m, values, attempts, ncs, docs };
  });
  if (!d) notFound();
  const { m } = d;
  const rules = m.rules_snapshot ? parseRules(m.rules_snapshot) : null;
  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">Medición <span className="font-mono text-lg text-muted">{m.asset_code ?? m.point_code}</span></span>}
        meta={<>{m.status === "invalidated" ? <Badge>Invalidada</Badge> : <ResultBadge result={m.result} size="lg" />}{m.attempt_number > 1 ? <Badge tone="info">Intento {m.attempt_number}</Badge> : null}{m.synced_from_offline ? <Badge tone="info">Sincronizada desde offline</Badge> : null}</>}
        actions={
          <>
            {s.permissions.has("measure") && m.status === "final" ? <ButtonLink variant="outline" href={m.asset_code ? `/medicion?asset=${encodeURIComponent(m.asset_code)}` : `/medicion?point=${m.plan_point_id}`}>Nueva medición</ButtonLink> : null}
            {m.result === "fail" && m.status === "final" && d.ncs.length === 0 && (s.permissions.has("create") || s.permissions.has("measure")) ? <ButtonLink variant="outline" href={`/no-conformidades/nueva?measurement=${m.id}`}>Crear NC</ButtonLink> : null}
            {s.permissions.has("validate") && m.status === "final" ? <InvalidateButton id={m.id} /> : null}
          </>
        }
      />
      {m.status === "invalidated" ? <div className="mb-4"><Alert tone="warn" title={`Invalidada el ${fmtDateTime(m.invalidated_at)} por ${m.invalidated_by_name}`}>Motivo: {m.invalidation_reason}. El registro original se conserva sin cambios.</Alert></div> : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Resultado y explicación" description="Evaluación reproducible con las reglas guardadas en el momento del registro" />
            <div className="p-5">
              <ul className="list-disc space-y-1 pl-5 text-sm">{(m.result_explanation as string[]).map((r, i) => <li key={i}>{r}</li>)}</ul>
              {m.not_measurable_reason ? <p className="mt-2 text-sm">Motivo: {m.not_measurable_reason}</p> : null}
              {m.comment ? <p className="mt-3 rounded-md bg-surface-2 p-3 text-sm whitespace-pre-line">{m.comment}</p> : null}
            </div>
          </Card>
          {d.values.length ? (
            <Card>
              <CardHeader title="Valores registrados" description="Valor original introducido, unidad y valor normalizado utilizado en la comparación" />
              <Table>
                <thead><tr><Th>Punto / parte</Th><Th>Introducido</Th><Th>Normalizado</Th><Th>Resultado</Th><Th>Explicación</Th></tr></thead>
                <tbody>
                  {d.values.map((v) => (
                    <tr key={v.id}>
                      <Td className="text-xs">{[v.part_code, v.point_code].filter(Boolean).join(" · ") || "—"}{v.point_name ? <span className="block text-muted">{v.point_name}</span> : null}</Td>
                      <Td className="font-mono text-sm">{v.raw_input ?? v.option_value ?? (v.checked === true ? "OK" : v.checked === false ? "NO OK" : "—")} {v.raw_unit ?? ""}</Td>
                      <Td className="font-mono text-xs text-muted">{v.normalized_value ? `${v.normalized_value} ${v.normalized_unit}` : "—"}</Td>
                      <Td><ResultBadge result={v.result} /></Td>
                      <Td className="text-xs text-muted">{v.explanation}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Fotos y adjuntos" />
            <DocumentsList docs={d.docs as never} />
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Trazabilidad" />
            <div className="p-5">
              <DefinitionList cols={1} items={[
                ["Elemento", m.asset_code ? <Link key="a" className="text-primary hover:underline" href={`/inventario/${m.asset_id}`}>{m.asset_code} · {m.asset_name}</Link> : <Link key="p" className="text-primary hover:underline" href={`/planos/${m.plan_id}`}>Punto {m.point_code} · {m.point_name}</Link>],
                ["Categoría", m.category_name],
                ["Técnico", m.by_name],
                ["Fecha/hora del servidor", fmtDateTime(m.recorded_at)],
                ["Fecha/hora del dispositivo", m.measured_at_local ? `${fmtDateTime(m.measured_at_local)}${m.device_timezone ? ` (${m.device_timezone})` : ""}` : null],
                ["Criterio aplicado", m.crit_code ? `${m.crit_code} · ${m.crit_name} · versión ${m.crit_version}` : "Sin criterio vigente"],
                ["Regla", rules ? describeRules(rules) : null],
                ["Procedimiento", m.proc_code ? `${m.proc_code} · ${m.proc_title} (rev. ${m.procedure_revision ?? "—"})` : null],
                ["Instrumento", m.instrument_not_required ? "No requerido (declarado)" : m.instrument_code ? `${m.instrument_code} · ${m.instrument_type}` : null],
                ["Calibración en el momento", m.instrument_snapshot ? `${m.instrument_snapshot.calibration_valid ? "Válida" : "NO válida"} (vence ${fmtDate(m.instrument_snapshot.calibration_due_on)})` : null],
                ["Campaña", m.campaign_code ? <Link key="c" className="text-primary hover:underline" href={`/campanas/${m.campaign_id}`}>{m.campaign_code} · {m.campaign_name}</Link> : null],
                ["Confirmación del técnico", m.signature_confirmed ? "Sí" : "No requerida / no registrada"],
                ["ID de idempotencia", <span key="id" className="font-mono text-xs">{m.client_id}</span>],
              ]} />
            </div>
          </Card>
          {d.attempts.length ? (
            <Card>
              <CardHeader title="Otros intentos" />
              <ul className="divide-y divide-line">{d.attempts.map((a) => <li key={a.id} className="flex items-center gap-2 px-5 py-2 text-sm"><Link href={`/historial/${a.id}`} className="text-primary hover:underline">Intento {a.attempt_number}</Link><ResultBadge result={a.result} />{a.status === "invalidated" ? <Badge>Invalidada</Badge> : null}<span className="ml-auto text-xs text-muted">{fmtDateTime(a.recorded_at)}</span></li>)}</ul>
            </Card>
          ) : null}
          {d.ncs.length ? (
            <Card>
              <CardHeader title="No conformidades" />
              <ul className="divide-y divide-line">{d.ncs.map((n) => <li key={n.id} className="px-5 py-2 text-sm"><Link href={`/no-conformidades/${n.id}`} className="font-medium text-primary hover:underline">{n.code}</Link> {n.title}</li>)}</ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
