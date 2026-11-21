import { NextResponse } from "next/server";
import { api } from "@/lib/server/api";
import { IMPORT_COLUMNS } from "@/lib/domain/asset-import";
import { toCsv, toXlsx } from "@/lib/server/parse-sheet";

export const GET = api({ permission: "create" }, async (req) => {
  const format = new URL(req.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const headers = IMPORT_COLUMNS.map((c) => c.label);
  const example = [["TAP-0100", "Tapete línea 5", "TAP", "L-A1", "", "Fabricante", "Modelo", "SN123", "active", "2026-01-15", "month", "3", "Fila de ejemplo: bórrela"]];
  if (format === "csv") {
    return new NextResponse(toCsv(headers, example), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="plantilla-activos.csv"' } });
  }
  const buf = await toXlsx("Activos", headers, example, IMPORT_COLUMNS.map((c) => `${c.label}${c.required ? " (obligatoria)" : ""}: ${c.help}`));
  return new NextResponse(new Uint8Array(buf), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="plantilla-activos.xlsx"' } });
});
