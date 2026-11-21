import { NextResponse } from "next/server";
import { api } from "@/lib/server/api";
import { withCtx } from "@/lib/server/db";
import { audit } from "@/lib/server/audit";
import { toCsv, toXlsx } from "@/lib/server/parse-sheet";
import { NC_STATUS_LABEL, type NcStatus } from "@/lib/server/services/nonconformities";

export const GET = api({ permission: "export" }, async (req, s) => {
  const format = new URL(req.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const rows = await withCtx(s, async (tx) => {
    const r = await tx`select n.code, n.title, n.status, sv.name as severity, u.full_name as owner, n.detected_at, n.due_on, n.closed_at, n.description, n.containment, n.root_cause, n.corrective_action, n.preventive_action, n.verification_notes,
      (select string_agg(distinct coalesce(a.code, pp.code), ', ') from nc_links l left join assets a on a.id = l.asset_id left join plan_points pp on pp.id = l.plan_point_id where l.nc_id = n.id) as targets
      from nonconformities n left join nc_severities sv on sv.id = n.severity_id left join users u on u.id = n.owner_user_id order by n.code`;
    await audit(tx, s, { action: "export", entityType: "nonconformity", summary: `Exportación de NC (${r.length})` });
    return r;
  });
  const h = ["Código", "Título", "Estado", "Gravedad", "Responsable", "Detectada", "Límite", "Cierre", "Elementos", "Descripción", "Contención", "Causa", "Correctiva", "Preventiva", "Verificación"];
  const d = rows.map((r) => [r.code, r.title, NC_STATUS_LABEL[r.status as NcStatus], r.severity, r.owner, r.detected_at?.toISOString(), r.due_on, r.closed_at?.toISOString() ?? "", r.targets, r.description, r.containment, r.root_cause, r.corrective_action, r.preventive_action, r.verification_notes]);
  if (format === "csv") return new NextResponse(toCsv(h, d), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="no-conformidades.csv"' } });
  return new NextResponse(new Uint8Array(await toXlsx("NC", h, d, [`${s.org.name} — No conformidades`])), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="no-conformidades.xlsx"' } });
});
