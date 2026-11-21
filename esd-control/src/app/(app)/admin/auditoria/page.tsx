import { Download } from "lucide-react";
import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { dateOrUndef, pageParams, str, userOptions } from "@/lib/server/queries/common";
import { ButtonLink, Card, PageHeader } from "@/components/ui/core";
import { FilterBar, FilterInput, FilterSelect, Pagination } from "@/components/filters";
import { AuditTrail } from "@/components/audit-trail";

export const metadata = { title: "Auditoría" };

const ENTITIES = ["asset", "measurement", "criterion", "category", "procedure", "floor_plan", "plan_point", "campaign", "campaign_item", "nonconformity", "instrument", "user", "role", "organization", "location", "label_template", "report", "point_template"];

export default async function Audit({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requirePermission("audit.read");
  const sp = await searchParams;
  const { page, limit, offset } = pageParams(sp, 50);
  const user = str(sp.user), entity = str(sp.entity), action = str(sp.action), from = dateOrUndef(sp.from), to = dateOrUndef(sp.to), q = str(sp.q);
  const d = await withCtx(s, async (tx) => {
    const where = tx`true
      ${user && /^[0-9a-f-]{36}$/.test(user) ? tx`and l.user_id = ${user}` : tx``}
      ${entity ? tx`and l.entity_type = ${entity}` : tx``}
      ${action ? tx`and l.action = ${action}` : tx``}
      ${from ? tx`and l.at >= ${from}` : tx``}
      ${to ? tx`and l.at < (${to}::date + 1)` : tx``}
      ${q ? tx`and (l.summary ilike ${"%" + q.replace(/[\\%_]/g, "\\$&") + "%"} or l.entity_id = ${q})` : tx``}`;
    return {
      rows: await tx`select l.id::text, l.at, l.action, l.entity_type, l.entity_id, l.summary, l.reason, l.before_data, l.after_data, u.full_name as user_name from audit_log l left join users u on u.id = l.user_id where ${where} order by l.at desc, l.id desc limit ${limit} offset ${offset}`,
      total: (await tx`select count(*)::int as n from audit_log l where ${where}`)[0].n as number,
      actions: (await tx`select distinct action from audit_log order by 1`).map((r) => ({ id: r.action as string, label: r.action as string })),
      users: await userOptions(tx),
    };
  });
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]).toString();
  return (
    <>
      <PageHeader title="Registro de auditoría" description="Solo inserción: ningún usuario (tampoco administradores) puede modificar o borrar eventos desde la aplicación. Los eventos antiguos pueden archivarse (ver README)." actions={s.permissions.has("export") ? <ButtonLink prefetch={false} href={`/api/export/audit?${qs}`} variant="outline" icon={Download}>CSV</ButtonLink> : null} />
      <FilterBar storageKey="audit">
        <FilterInput name="q" label="Texto o ID" defaultValue={q} />
        <FilterSelect name="user" label="Usuario" options={d.users} defaultValue={user} />
        <FilterSelect name="entity" label="Entidad" options={ENTITIES.map((e) => ({ id: e, label: e }))} defaultValue={entity} allLabel="Todas" />
        <FilterSelect name="action" label="Acción" options={d.actions} defaultValue={action} allLabel="Todas" />
        <FilterInput name="from" label="Desde" type="date" defaultValue={from} />
        <FilterInput name="to" label="Hasta" type="date" defaultValue={to} />
      </FilterBar>
      <Card>
        <AuditTrail rows={d.rows.map((r) => ({ ...r, summary: `[${r.entity_type}/${r.action}] ${r.summary}` })) as never} />
        <Pagination page={page} total={d.total} limit={limit} />
      </Card>
    </>
  );
}
