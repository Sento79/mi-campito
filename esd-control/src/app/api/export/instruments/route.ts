import { NextResponse } from "next/server";
import { api } from "@/lib/server/api";
import { withCtx } from "@/lib/server/db";
import { audit } from "@/lib/server/audit";
import { toCsv, toXlsx } from "@/lib/server/parse-sheet";
import { INSTRUMENT_STATUS_LABEL } from "@/lib/format";

export const GET = api({ permission: "export" }, async (req, s) => {
  const format = new URL(req.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const rows = await withCtx(s, async (tx) => {
    const r = await tx`select i.code, i.type, i.manufacturer, i.model, i.serial_number, i.status, i.acquired_on, i.last_calibrated_on, i.calibration_due_on, c.certificate_number, c.provider
      from instruments i left join calibrations c on c.id = i.current_calibration_id order by i.code`;
    await audit(tx, s, { action: "export", entityType: "instrument", summary: `Exportación de instrumentos (${r.length})` });
    return r;
  });
  const h = ["Código", "Tipo", "Fabricante", "Modelo", "Nº serie", "Estado", "Adquisición", "Última calibración", "Vence", "Certificado", "Proveedor"];
  const d = rows.map((r) => [r.code, r.type, r.manufacturer, r.model, r.serial_number, INSTRUMENT_STATUS_LABEL[r.status], r.acquired_on, r.last_calibrated_on, r.calibration_due_on, r.certificate_number, r.provider]);
  if (format === "csv") return new NextResponse(toCsv(h, d), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="instrumentos.csv"' } });
  return new NextResponse(new Uint8Array(await toXlsx("Instrumentos", h, d, [`${s.org.name} — Instrumentos`])), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="instrumentos.xlsx"' } });
});
