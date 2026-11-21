import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/core";
import { describeRules, parseRules } from "@/lib/domain/criteria";
import { fmtDateTime } from "@/lib/format";
import { RulesEditor, VersionActions } from "./rules-editor";
import { AuditTrail } from "@/components/audit-trail";

export default async function CriterionPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePermission("read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await withCtx(s, async (tx) => {
    const [c] = await tx`select * from criteria where id = ${id}`;
    if (!c) return null;
    const versions = await tx`select cv.*, u.full_name as approver, cb.full_name as creator, p.code as proc_code, (select count(*)::int from measurements m where m.criterion_version_id = cv.id) as uses
      from criterion_versions cv left join users u on u.id = cv.approved_by left join users cb on cb.id = cv.created_by left join procedures p on p.id = cv.procedure_id where cv.criterion_id = ${id} order by cv.version desc`;
    const procedures = (await tx`select id, code || ' · ' || title || ' (rev. ' || revision || ')' as label from procedures where is_active order by code`).map((r) => ({ id: r.id as string, label: r.label as string }));
    const auditRows = s.permissions.has("audit.read") ? await tx`select l.id::text, l.at, l.action, l.summary, l.reason, l.before_data, l.after_data, u.full_name as user_name from audit_log l left join users u on u.id = l.user_id where l.entity_type = 'criterion' and l.entity_id = ${id} order by l.at desc limit 30` : [];
    return { c, versions, procedures, auditRows };
  });
  if (!d) notFound();
  const manage = s.permissions.has("criteria.manage");
  const active = d.versions.find((v) => v.status === "active");
  return (
    <>
      <PageHeader title={`${d.c.code} · ${d.c.name}`} description={d.c.description ?? undefined} meta={active ? <Badge tone="primary">Vigente v{active.version}</Badge> : <Badge tone="warn">Sin versión vigente</Badge>} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-4">
          {manage && d.c.is_active ? <RulesEditor criterionId={d.c.id} procedures={d.procedures} initial={active ? (active.rules as never) : null} /> : null}
          {d.auditRows.length ? <Card><CardHeader title="Historial de cambios" /><AuditTrail rows={d.auditRows as never} /></Card> : null}
        </div>
        <Card className="h-fit">
          <CardHeader title="Versiones" description="Las versiones publicadas son inmutables" />
          <ul className="divide-y divide-line">
            {d.versions.length === 0 ? <li className="px-5 py-4 text-sm text-muted">Sin versiones.</li> : d.versions.map((v) => {
              const r = parseRules(v.rules);
              return (
                <li key={v.id} className="space-y-1 px-5 py-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">v{v.version}</span>
                    <Badge tone={v.status === "active" ? "primary" : v.status === "draft" ? "info" : "neutral"}>{{ active: "Vigente", draft: "Borrador", superseded: "Sustituida", retired: "Retirada" }[v.status as string]}</Badge>
                    <span className="ml-auto text-xs text-muted">{v.uses} mediciones</span>
                  </div>
                  <p className="text-xs">{r ? describeRules(r) : "Reglas no válidas"}</p>
                  <p className="text-xs text-muted">Motivo: {v.change_reason}</p>
                  <p className="text-xs text-muted">Creada {fmtDateTime(v.created_at)} por {v.creator ?? "—"}{v.approved_at ? ` · publicada ${fmtDateTime(v.approved_at)} por ${v.approver}` : ""}{v.proc_code ? ` · ${v.proc_code} rev. ${v.procedure_revision}` : ""}{v.norm_reference ? ` · ${v.norm_reference}` : ""}</p>
                  {manage && v.status === "draft" ? <VersionActions versionId={v.id} /> : null}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </>
  );
}
