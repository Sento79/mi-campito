import { Plus, Upload, Download } from "lucide-react";
import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { categoryOptions, dateOrUndef, locationOptions, pageParams, str, uuidOrUndef } from "@/lib/server/queries/common";
import { assetWhere } from "@/lib/server/queries/assets";
import { ButtonLink, Card, PageHeader } from "@/components/ui/core";
import { FilterBar, FilterInput, FilterSelect, Pagination } from "@/components/filters";
import { ASSET_STATUSES, ASSET_STATUS_LABEL } from "@/lib/domain/asset-import";
import { AssetTable } from "./asset-table";

export const metadata = { title: "Inventario" };

const SORTS: Record<string, string> = {
  code: "a.code",
  name: "a.name",
  due: "a.next_due_at nulls last",
  last: "a.last_measured_at desc nulls last",
  category: "c.name",
};

export default async function Inventory({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requirePermission("read");
  const sp = await searchParams;
  const q = str(sp.q);
  const category = uuidOrUndef(sp.category);
  const location = uuidOrUndef(sp.location);
  const status = str(sp.status);
  const due = str(sp.due);
  const result = str(sp.result);
  const archived = str(sp.archived) === "1";
  const from = dateOrUndef(sp.from);
  const to = dateOrUndef(sp.to);
  const sort = SORTS[str(sp.sort) ?? "code"] ?? SORTS.code;
  const { page, limit, offset } = pageParams(sp, 30);
  const lead = s.org.settings.dueLeadDays;

  const data = await withCtx(s, async (tx) => {
    const where = assetWhere(tx, sp, lead);
    const rows = await tx`
      select a.id, a.code, a.name, a.status, a.scan_code, a.serial_number, a.last_result, a.last_measured_at, a.next_due_at, a.archived_at,
             c.name as category_name, l.name as location_name, coalesce(a.period_unit, c.period_unit) as period_unit
        from assets a join categories c on c.id = a.category_id left join locations l on l.id = a.location_id
       where ${where} order by ${tx.unsafe(sort)}, a.code limit ${limit} offset ${offset}`;
    const [{ n }] = await tx`select count(*)::int as n from assets a where ${where}`;
    return { rows, total: n, categories: await categoryOptions(tx), locations: await locationOptions(tx) };
  });

  const exportQs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString();
  return (
    <>
      <PageHeader
        title="Inventario de activos"
        description="Elementos ESD bajo control. Los activos con historial no se borran: se archivan."
        actions={
          <>
            {s.permissions.has("export") ? (
              <>
                <ButtonLink href={`/api/export/assets?format=xlsx&${exportQs}`} variant="outline" icon={Download} prefetch={false}>XLSX</ButtonLink>
                <ButtonLink href={`/api/export/assets?format=csv&${exportQs}`} variant="outline" icon={Download} prefetch={false}>CSV</ButtonLink>
              </>
            ) : null}
            {s.permissions.has("create") ? <ButtonLink href="/inventario/importar" variant="outline" icon={Upload}>Importar</ButtonLink> : null}
            {s.permissions.has("create") ? <ButtonLink href="/inventario/nuevo" icon={Plus}>Nuevo activo</ButtonLink> : null}
          </>
        }
      />
      <FilterBar storageKey="inventory">
        <FilterInput name="q" label="Buscar" defaultValue={q} placeholder="ID, nombre, serie, QR" />
        <FilterSelect name="category" label="Categoría" options={data.categories} defaultValue={category} allLabel="Todas" />
        <FilterSelect name="location" label="Ubicación" options={data.locations} defaultValue={location} allLabel="Todas" />
        <FilterSelect name="status" label="Estado" options={ASSET_STATUSES.map((k) => ({ id: k, label: ASSET_STATUS_LABEL[k] }))} defaultValue={status} />
        <FilterSelect
          name="due"
          label="Vencimiento"
          options={[
            { id: "overdue", label: "Vencidas" },
            { id: "soon", label: `Próximas (${lead} días)` },
            { id: "never", label: "Nunca medidos" },
          ]}
          defaultValue={due === "period" ? undefined : due}
        />
        <FilterSelect
          name="result"
          label="Último resultado"
          options={[
            { id: "pass", label: "Conforme" },
            { id: "fail", label: "No conforme" },
            { id: "review", label: "Requiere revisión" },
            { id: "incomplete", label: "Incompleto" },
            { id: "none", label: "Sin medir" },
          ]}
          defaultValue={result}
        />
        <FilterSelect name="sort" label="Orden" options={[{ id: "name", label: "Nombre" }, { id: "due", label: "Próxima medición" }, { id: "last", label: "Última medición" }, { id: "category", label: "Categoría" }]} defaultValue={str(sp.sort)} allLabel="ID" />
        <FilterSelect name="archived" label="Archivo" options={[{ id: "1", label: "Archivados" }]} defaultValue={archived ? "1" : undefined} allLabel="Activos" />
        {due === "period" && from && to ? (
          <>
            <input type="hidden" name="due" value="period" />
            <input type="hidden" name="from" value={from} />
            <input type="hidden" name="to" value={to} />
          </>
        ) : null}
      </FilterBar>
      {due === "period" && from && to ? <p className="mb-3 text-sm text-muted">Mostrando activos con medición prevista entre {from} y {to}.</p> : null}
      <Card>
        <AssetTable
          rows={data.rows as never}
          canEdit={s.permissions.has("edit")}
          canMeasure={s.permissions.has("measure")}
          locations={data.locations}
          leadDays={lead}
        />
        <Pagination page={page} total={data.total} limit={limit} />
      </Card>
    </>
  );
}
