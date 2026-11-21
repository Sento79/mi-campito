import Link from "@/components/link";
import { Plus, AlertTriangle } from "lucide-react";
import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { Badge, ButtonLink, Card, PageHeader, Table, Td, Th } from "@/components/ui/core";
import { describePeriod, type PeriodUnit } from "@/lib/domain/periodicity";
import { RECORD_METHOD_LABEL } from "@/lib/format";

export const metadata = { title: "Categorías" };

export default async function Categories() {
  const s = await requirePermission("read");
  const rows = await withCtx(s, (tx) => tx`
    select c.*, cr.code as criterion_code, cv.version as criterion_version, p.code as procedure_code,
      (select count(*)::int from assets a where a.category_id = c.id and a.archived_at is null) as asset_count
    from categories c left join criteria cr on cr.id = c.criterion_id
    left join criterion_versions cv on cv.criterion_id = c.criterion_id and cv.status = 'active'
    left join procedures p on p.id = c.procedure_id order by c.is_active desc, c.name`);
  const manage = s.permissions.has("criteria.manage");
  return (
    <>
      <PageHeader title="Categorías" description="Tipos de elemento ESD con su método de registro, periodicidad, procedimiento y criterio de aceptación." actions={manage ? <ButtonLink href="/inventario/categorias/nueva" icon={Plus}>Nueva categoría</ButtonLink> : null} />
      <Card>
        <Table>
          <thead><tr><Th>Código</Th><Th>Nombre</Th><Th>Método</Th><Th>Magnitud</Th><Th>Periodicidad</Th><Th>Procedimiento</Th><Th>Criterio vigente</Th><Th>Activos</Th><Th>Estado</Th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-surface-2/50">
                <Td className="font-mono text-xs"><Link className="font-medium text-primary hover:underline" href={`/inventario/categorias/${c.id}`}>{c.code}</Link></Td>
                <Td>{c.name}</Td>
                <Td className="text-muted">{RECORD_METHOD_LABEL[c.record_method]}</Td>
                <Td className="text-muted">{c.quantity ?? "—"}{c.unit ? ` (${c.unit})` : ""}</Td>
                <Td className="text-muted">{describePeriod(c.period_unit as PeriodUnit, c.period_count)}</Td>
                <Td className="text-muted">{c.procedure_code ?? "—"}</Td>
                <Td>{c.criterion_version ? <Badge tone="primary">{c.criterion_code} v{c.criterion_version}</Badge> : <Badge tone="warn" icon={AlertTriangle}>Sin criterio</Badge>}</Td>
                <Td className="tabular"><Link className="hover:underline" href={`/inventario?category=${c.id}`}>{c.asset_count}</Link></Td>
                <Td>{c.is_active ? <Badge tone="ok">Activa</Badge> : <Badge>Inactiva</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
