import { FileBarChart, FileSpreadsheet, Map } from "lucide-react";
import Link from "@/components/link";
import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { categoryOptions, locationOptions } from "@/lib/server/queries/common";
import { Card, CardHeader, PageHeader } from "@/components/ui/core";
import { ReportForm } from "./report-form";

export const metadata = { title: "Informes" };

export default async function Reports() {
  const s = await requirePermission("reports");
  const d = await withCtx(s, async (tx) => ({
    locations: await locationOptions(tx),
    categories: await categoryOptions(tx),
    campaigns: (await tx`select id, code || ' · ' || name as label from campaigns order by starts_on desc limit 200`).map((r) => ({ id: r.id as string, label: r.label as string })),
    plans: await tx`select id, title from floor_plans where archived_at is null order by title`,
  }));
  const canExport = s.permissions.has("export");
  return (
    <>
      <PageHeader title="Informes" description="Informes PDF aptos para revisión y auditoría: empresa, logo, filtros, fecha de generación, responsable, criterios aplicados y versión, numeración de páginas. Exportaciones XLSX/CSV para análisis." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <ReportForm {...d} canExport={canExport} />
        <div className="space-y-4">
          <Card>
            <CardHeader title="Informes por elemento" />
            <ul className="space-y-2 p-5 text-sm">
              <li className="flex gap-2"><FileBarChart className="size-4 text-muted" />Campaña: desde la ficha de la campaña (botón «Informe PDF»).</li>
              <li className="flex gap-2"><FileBarChart className="size-4 text-muted" />Activo: <span className="text-muted">/api/reports/asset/&lt;id&gt; o desde la ficha del activo.</span></li>
              <li className="flex gap-2"><Map className="size-4 text-muted" />Plano con puntos y leyenda:</li>
              {d.plans.map((p) => <li key={p.id} className="pl-6"><a className="text-primary hover:underline" href={`/api/plans/${p.id}/pdf`}>{p.title}</a></li>)}
            </ul>
          </Card>
          {canExport ? (
            <Card>
              <CardHeader title="Exportaciones" />
              <ul className="space-y-2 p-5 text-sm">
                {[["Inventario de activos", "/api/export/assets"], ["Historial de mediciones", "/api/export/measurements?status=all"], ["Instrumentos y calibración", "/api/export/instruments"], ["No conformidades", "/api/export/nonconformities"]].map(([l, h]) => (
                  <li key={h} className="flex items-center gap-2"><FileSpreadsheet className="size-4 text-muted" />{l}: <a className="text-primary hover:underline" href={`${h}${h.includes("?") ? "&" : "?"}format=xlsx`}>XLSX</a><a className="text-primary hover:underline" href={`${h}${h.includes("?") ? "&" : "?"}format=csv`}>CSV</a></li>
                ))}
              </ul>
              <p className="border-t border-line px-5 py-3 text-xs text-muted">Las exportaciones quedan registradas en auditoría. Los CSV usan «;» y UTF-8 con BOM (compatibles con Excel en español) y neutralizan fórmulas.</p>
            </Card>
          ) : null}
          <Card className="p-5 text-xs text-muted"><Link href="/admin/configuracion" className="text-primary hover:underline">Configure el logo, el nombre de empresa y el pie de página</Link> de los informes.</Card>
        </div>
      </div>
    </>
  );
}
