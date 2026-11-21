import { NextResponse } from "next/server";
import { api } from "@/lib/server/api";
import { withCtx } from "@/lib/server/db";
import { measurementWhere } from "@/lib/server/queries/measurements";
import { toCsv, toXlsx } from "@/lib/server/parse-sheet";
import { audit } from "@/lib/server/audit";
import { RESULT_LABEL, type Result } from "@/lib/domain/results";

export const GET = api({ permission: "export" }, async (req, s) => {
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const format = sp.format === "csv" ? "csv" : "xlsx";
  const rows = await withCtx(s, async (tx) => {
    const r = await tx`
      select m.id, m.recorded_at, m.measured_at_local, m.status, m.result, m.attempt_number, m.invalidation_reason, m.comment, m.not_measurable_reason,
             coalesce(a.code, pp.code) as target, coalesce(a.name, pp.name) as target_name, cat.code as category,
             c.code as crit_code, cv.version as crit_version, p.code as proc_code, m.procedure_revision, i.code as instrument, cmp.code as campaign, u.full_name as technician,
             mv.point_code, mv.raw_input, mv.raw_unit, mv.normalized_value, mv.normalized_unit, mv.option_value, mv.checked, mv.result as value_result
        from measurements m join users u on u.id = m.measured_by
        left join measurement_values mv on mv.measurement_id = m.id
        left join assets a on a.id = m.asset_id left join plan_points pp on pp.id = m.plan_point_id left join categories cat on cat.id = m.category_id
        left join criterion_versions cv on cv.id = m.criterion_version_id left join criteria c on c.id = cv.criterion_id
        left join procedures p on p.id = m.procedure_id left join instruments i on i.id = m.instrument_id left join campaigns cmp on cmp.id = m.campaign_id
       where ${measurementWhere(tx, sp)} order by m.recorded_at desc, mv.sort_order limit 50000`;
    await audit(tx, s, { action: "export", entityType: "measurement", summary: `Exportación de historial (${r.length} filas, ${format.toUpperCase()})`, after: { filters: sp } });
    return r;
  });
  const headers = ["ID medición", "Fecha servidor (UTC)", "Fecha dispositivo", "Elemento", "Nombre", "Categoría", "Validez", "Resultado", "Intento", "Punto", "Valor introducido", "Unidad", "Valor normalizado", "Unidad normalizada", "Opción", "Check", "Resultado valor", "Criterio", "Versión", "Procedimiento", "Revisión", "Instrumento", "Campaña", "Técnico", "Comentario", "Motivo no medible", "Motivo invalidación"];
  const data = rows.map((r) => [r.id, r.recorded_at.toISOString(), r.measured_at_local?.toISOString() ?? "", r.target, r.target_name, r.category, r.status === "invalidated" ? "Invalidada" : "Válida", RESULT_LABEL[r.result as Result], r.attempt_number, r.point_code, r.raw_input, r.raw_unit, r.normalized_value, r.normalized_unit, r.option_value, r.checked === null ? "" : r.checked ? "OK" : "NO OK", r.value_result ? RESULT_LABEL[r.value_result as Result] : "", r.crit_code, r.crit_version, r.proc_code, r.procedure_revision, r.instrument, r.campaign, r.technician, r.comment, r.not_measurable_reason, r.invalidation_reason]);
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") return new NextResponse(toCsv(headers, data), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="historial-${stamp}.csv"` } });
  const buf = await toXlsx("Historial", headers, data, [`${s.org.name} — Historial de mediciones ESD`, `Generado ${new Date().toLocaleString("es-ES")} por ${s.user.fullName}`]);
  return new NextResponse(new Uint8Array(buf), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="historial-${stamp}.xlsx"` } });
});
