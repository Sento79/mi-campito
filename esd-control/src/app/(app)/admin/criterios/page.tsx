import Link from "@/components/link";
import { BookOpen, AlertTriangle } from "lucide-react";
import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { Alert, Badge, ButtonLink, Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui/core";
import { describeRules, parseRules } from "@/lib/domain/criteria";
import { fmtDate } from "@/lib/format";
import { NewCriterionButton } from "./new-criterion";

export const metadata = { title: "Criterios y procedimientos" };

export default async function Criteria() {
  const s = await requirePermission("read");
  const rows = await withCtx(s, (tx) => tx`
    select c.*, cv.version, cv.rules, cv.approved_at, u.full_name as approver,
      (select count(*)::int from criterion_versions d where d.criterion_id = c.id and d.status = 'draft') as drafts,
      (select string_agg(cat.name, ', ') from categories cat where cat.criterion_id = c.id) as categories
    from criteria c left join criterion_versions cv on cv.criterion_id = c.id and cv.status = 'active' left join users u on u.id = cv.approved_by
    order by c.is_active desc, c.code`);
  const manage = s.permissions.has("criteria.manage");
  return (
    <>
      <PageHeader title="Criterios de aceptación" description="Límites definidos y aprobados por personal autorizado. Cada cambio crea una versión nueva; las mediciones conservan la versión aplicada." actions={<><ButtonLink href="/admin/criterios/procedimientos" variant="outline" icon={BookOpen}>Procedimientos</ButtonLink>{manage ? <NewCriterionButton /> : null}</>} />
      <div className="mb-4"><Alert tone="info" title="La aplicación no incluye límites normativos predefinidos">Configure cada criterio según sus procedimientos y la revisión aplicable de la norma de referencia de su organización. Sin criterio vigente, las mediciones quedan como «Requiere revisión».</Alert></div>
      <Card>
        {rows.length === 0 ? <EmptyState title="Sin criterios" description="Cree el primer criterio y publique su versión 1." /> : (
          <Table>
            <thead><tr><Th>Código</Th><Th>Nombre</Th><Th>Versión vigente</Th><Th>Regla</Th><Th>Categorías</Th><Th>Aprobado</Th></tr></thead>
            <tbody>
              {rows.map((c) => {
                const r = c.rules ? parseRules(c.rules) : null;
                return (
                  <tr key={c.id} className="hover:bg-surface-2/50">
                    <Td className="font-mono text-xs"><Link className="font-medium text-primary hover:underline" href={`/admin/criterios/${c.id}`}>{c.code}</Link></Td>
                    <Td>{c.name}{!c.is_active ? <Badge className="ml-2">Retirado</Badge> : null}</Td>
                    <Td>{c.version ? <Badge tone="primary">v{c.version}</Badge> : <Badge tone="warn" icon={AlertTriangle}>Sin versión activa</Badge>}{c.drafts ? <Badge className="ml-1" tone="info">{c.drafts} borrador</Badge> : null}</Td>
                    <Td className="max-w-96 text-xs text-muted">{r ? describeRules(r) : "—"}</Td>
                    <Td className="text-xs text-muted">{c.categories ?? "—"}</Td>
                    <Td className="text-xs whitespace-nowrap text-muted">{c.approved_at ? `${fmtDate(c.approved_at)} · ${c.approver}` : "—"}</Td>
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
