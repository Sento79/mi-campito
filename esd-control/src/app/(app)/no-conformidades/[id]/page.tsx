import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { userOptions } from "@/lib/server/queries/common";
import { Alert, Badge, Card, CardHeader, PageHeader, ResultBadge } from "@/components/ui/core";
import { NC_STATUS_LABEL, NC_TRANSITIONS, type NcStatus } from "@/lib/server/services/nonconformities";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { DocumentsList } from "@/components/documents-list";
import { UploadButton } from "@/components/upload";
import { uploadNcDocumentAction } from "../actions";
import { NcEditor, NcWorkflow, NcActions } from "./nc-client";

export default async function NcPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePermission("read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await withCtx(s, async (tx) => {
    const [n] = await tx`select n.*, sv.name as severity, u.full_name as owner_name, vb.full_name as verified_by_name, cb.full_name as created_by_name, c.code as campaign_code
      from nonconformities n left join nc_severities sv on sv.id = n.severity_id left join users u on u.id = n.owner_user_id
      left join users vb on vb.id = n.verified_by left join users cb on cb.id = n.created_by left join campaigns c on c.id = n.campaign_id where n.id = ${id}`;
    if (!n) return null;
    const links = await tx`select l.id, l.measurement_id, m.result, m.recorded_at, a.id as asset_id, a.code as asset_code, a.name as asset_name, pp.code as point_code, pp.plan_id
      from nc_links l left join measurements m on m.id = l.measurement_id left join assets a on a.id = l.asset_id left join plan_points pp on pp.id = l.plan_point_id where l.nc_id = ${id}`;
    const actions = await tx`select x.*, u.full_name as owner_name from nc_actions x left join users u on u.id = x.owner_user_id where x.nc_id = ${id} order by x.created_at`;
    const history = await tx`select h.*, u.full_name from nc_status_history h left join users u on u.id = h.changed_by where h.nc_id = ${id} order by h.changed_at`;
    const docs = await tx`select id, file_name, mime_type, size_bytes, created_at, kind from documents where entity_type = 'nonconformity' and entity_id = ${id} order by created_at desc`;
    const severities = (await tx`select id, name as label from nc_severities order by rank`).map((r) => ({ id: r.id as string, label: r.label as string }));
    return { n, links, actions, history, docs, severities, users: await userOptions(tx) };
  });
  if (!d) notFound();
  const { n } = d;
  const canEdit = (s.permissions.has("edit") || s.permissions.has("validate")) && n.status !== "closed";
  const overdue = n.status !== "closed" && n.due_on && n.due_on < new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3"><span className="font-mono text-lg text-muted">{n.code}</span>{n.title}</span>}
        meta={<><Badge tone={n.status === "closed" ? "ok" : "warn"}>{NC_STATUS_LABEL[n.status as NcStatus]}</Badge>{n.severity ? <Badge>{n.severity}</Badge> : null}{n.due_on ? <Badge tone={overdue ? "bad" : "neutral"}>Límite {fmtDate(n.due_on)}</Badge> : null}{n.reopen_count ? <Badge tone="info">Reabierta {n.reopen_count}×</Badge> : null}</>}
        actions={<NcWorkflow id={n.id} status={n.status} allowed={NC_TRANSITIONS[n.status as NcStatus]} canEdit={s.permissions.has("edit") || s.permissions.has("validate")} canValidate={s.permissions.has("validate")} />}
      />
      {n.status === "closed" ? <div className="mb-4"><Alert tone="ok" title={`Cerrada el ${fmtDateTime(n.closed_at)} · verificada por ${n.verified_by_name}`}>{n.verification_notes}</Alert></div> : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <NcEditor nc={{ id: n.id, title: n.title, description: n.description ?? "", severityId: n.severity_id ?? "", ownerUserId: n.owner_user_id ?? "", dueOn: n.due_on ?? "", containment: n.containment ?? "", rootCause: n.root_cause ?? "", correctiveAction: n.corrective_action ?? "", preventiveAction: n.preventive_action ?? "" }} readOnly={!canEdit} users={d.users} severities={d.severities} />
          <NcActions ncId={n.id} actions={d.actions.map((a) => ({ id: a.id, kind: a.kind, description: a.description, owner: a.owner_name, dueOn: a.due_on, status: a.status }))} users={d.users} canEdit={canEdit} />
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Elementos y mediciones vinculadas" />
            <ul className="divide-y divide-line">
              {d.links.length === 0 ? <li className="px-5 py-3 text-sm text-muted">Sin vínculos.</li> : d.links.map((l) => (
                <li key={l.id} className="px-5 py-2.5 text-sm">
                  {l.asset_id ? <Link className="font-mono text-xs font-medium text-primary hover:underline" href={`/inventario/${l.asset_id}`}>{l.asset_code}</Link> : l.point_code ? <Link className="font-mono text-xs text-primary hover:underline" href={`/planos/${l.plan_id}`}>Punto {l.point_code}</Link> : null}
                  {l.asset_name ? <span className="ml-1 text-muted">{l.asset_name}</span> : null}
                  {l.measurement_id ? <div className="mt-1 flex items-center gap-2"><Link href={`/historial/${l.measurement_id}`}><ResultBadge result={l.result} /></Link><span className="text-xs text-muted">{fmtDateTime(l.recorded_at)}</span></div> : null}
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Historial de estados" />
            <ol className="divide-y divide-line">
              {d.history.map((h) => (
                <li key={h.id} className="px-5 py-2 text-sm">
                  <span className="font-medium">{h.from_status ? `${NC_STATUS_LABEL[h.from_status as NcStatus]} → ` : ""}{NC_STATUS_LABEL[h.to_status as NcStatus]}</span>
                  <span className="block text-xs text-muted">{fmtDateTime(h.changed_at)} · {h.full_name}</span>
                  {h.comment ? <span className="block text-xs">{h.comment}</span> : null}
                </li>
              ))}
            </ol>
          </Card>
          <Card>
            <CardHeader title="Adjuntos" actions={n.status !== "closed" ? <UploadButton action={uploadNcDocumentAction} fields={{ ncId: n.id }} /> : null} />
            <DocumentsList docs={d.docs as never} />
          </Card>
          <Card className="p-5 text-xs text-muted">Detectada {fmtDateTime(n.detected_at)} por {n.created_by_name ?? "—"}{n.campaign_code ? ` · campaña ${n.campaign_code}` : ""}</Card>
        </div>
      </div>
    </>
  );
}
