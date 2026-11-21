import { NextResponse } from "next/server";
import { api } from "@/lib/server/api";
import { withCtx } from "@/lib/server/db";
import { audit } from "@/lib/server/audit";
import { toCsv } from "@/lib/server/parse-sheet";

export const GET = api({ permission: "audit.read" }, async (req, s) => {
  if (!s.permissions.has("export")) return NextResponse.json({ error: "Se requiere el permiso de exportación" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const rows = await withCtx(s, async (tx) => {
    const r = await tx`select l.id, l.at, u.email, l.action, l.entity_type, l.entity_id, l.summary, l.reason, l.before_data, l.after_data from audit_log l left join users u on u.id = l.user_id
      where true ${sp.get("entity") ? tx`and l.entity_type = ${sp.get("entity")}` : tx``} ${/^\d{4}-\d{2}-\d{2}$/.test(sp.get("from") ?? "") ? tx`and l.at >= ${sp.get("from")}` : tx``}
      order by l.at desc limit 100000`;
    await audit(tx, s, { action: "export", entityType: "audit", summary: `Exportación de auditoría (${r.length} eventos)` });
    return r;
  });
  const csv = toCsv(["ID", "Fecha (UTC)", "Usuario", "Acción", "Entidad", "ID entidad", "Resumen", "Motivo", "Antes", "Después"], rows.map((r) => [r.id, r.at.toISOString(), r.email, r.action, r.entity_type, r.entity_id, r.summary, r.reason, r.before_data ? JSON.stringify(r.before_data) : "", r.after_data ? JSON.stringify(r.after_data) : ""]));
  return new NextResponse(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="auditoria-${new Date().toISOString().slice(0, 10)}.csv"` } });
});
