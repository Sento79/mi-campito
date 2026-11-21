import { NextResponse } from "next/server";
import { api } from "@/lib/server/api";
import { withCtx } from "@/lib/server/db";
import { assetWhere } from "@/lib/server/queries/assets";
import { toCsv, toXlsx } from "@/lib/server/parse-sheet";
import { audit } from "@/lib/server/audit";
import { RESULT_LABEL, type Result } from "@/lib/domain/results";
import { ASSET_STATUS_LABEL, type AssetStatus } from "@/lib/domain/asset-import";

export const GET = api({ permission: "export" }, async (req, s) => {
  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams.entries());
  const format = sp.format === "csv" ? "csv" : "xlsx";
  const rows = await withCtx(s, async (tx) => {
    const r = await tx`
      select a.code, a.scan_code, a.name, c.code as category, app_location_path(a.location_id) as location, a.manufacturer, a.model, a.serial_number,
             a.status, a.commissioned_on, a.last_result, a.last_measured_at, a.next_due_at, a.notes
        from assets a join categories c on c.id = a.category_id where ${assetWhere(tx, sp, s.org.settings.dueLeadDays)} order by a.code limit 20001`;
    if (r.length > 20000) return null;
    await audit(tx, s, { action: "export", entityType: "asset", summary: `Exportación de ${r.length} activos (${format.toUpperCase()})`, after: { filters: sp } });
    return r;
  });
  if (!rows) return NextResponse.json({ error: "Más de 20 000 activos coinciden con los filtros. Acote la búsqueda y exporte por partes." }, { status: 413 });
  const headers = ["ID", "Código escaneo", "Nombre", "Categoría", "Ubicación", "Fabricante", "Modelo", "Nº serie", "Estado", "Fecha alta", "Último resultado", "Última medición", "Próxima medición", "Observaciones"];
  const data = rows.map((r) => [r.code, r.scan_code, r.name, r.category, r.location, r.manufacturer, r.model, r.serial_number, ASSET_STATUS_LABEL[r.status as AssetStatus] ?? r.status, r.commissioned_on, r.last_result ? RESULT_LABEL[r.last_result as Result] : "Sin medir", r.last_measured_at?.toISOString() ?? "", r.next_due_at?.toISOString() ?? "", r.notes]);
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    return new NextResponse(toCsv(headers, data), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="activos-${stamp}.csv"` } });
  }
  const buf = await toXlsx("Activos", headers, data, [`${s.org.name} — Inventario de activos ESD`, `Generado ${new Date().toLocaleString("es-ES")} por ${s.user.fullName}`]);
  return new NextResponse(new Uint8Array(buf), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="activos-${stamp}.xlsx"` } });
});
