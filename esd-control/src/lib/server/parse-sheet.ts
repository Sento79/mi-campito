import "server-only";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import { AppError } from "./errors";

/** Convierte un CSV o XLSX subido en filas de texto. Limita tamaño y número de filas. */
export async function parseSheet(fileName: string, data: Buffer): Promise<string[][]> {
  if (data.length > 5 * 1024 * 1024) throw new AppError("El archivo supera 5 MB");
  const lower = fileName.toLowerCase();
  const isZip = data.length > 4 && data[0] === 0x50 && data[1] === 0x4b;
  if (lower.endsWith(".xlsx") || isZip) {
    if (!isZip) throw new AppError("El archivo .xlsx no es válido");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new AppError("El libro no tiene hojas");
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = (row.values as unknown[]).slice(1).map((v) => cellText(v));
      rows.push(vals);
    });
    if (rows.length > 5001) throw new AppError("Máximo 5000 filas");
    return rows;
  }
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    let text = data.toString("utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const r = Papa.parse<string[]>(text, { skipEmptyLines: "greedy", delimitersToGuess: [",", ";", "\t"] });
    if (r.data.length > 5001) throw new AppError("Máximo 5000 filas");
    return r.data.map((row) => row.map((c) => String(c ?? "")));
  }
  throw new AppError("Formato no admitido. Use .csv o .xlsx");
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if (o.text) return String(o.text);
    if (o.result !== undefined) return cellText(o.result);
    return "";
  }
  return String(v);
}

/** Escapa celdas para CSV evitando inyección de fórmulas en hojas de cálculo. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return "﻿" + [headers.map(csvCell).join(";"), ...rows.map((r) => r.map(csvCell).join(";"))].join("\r\n");
}

export async function toXlsx(sheet: string, headers: string[], rows: unknown[][], meta?: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ESD Control";
  wb.created = new Date();
  const ws = wb.addWorksheet(sheet.slice(0, 31));
  let start = 1;
  if (meta?.length) {
    for (const m of meta) ws.addRow([m]).font = { italic: true, color: { argb: "FF5A6475" } };
    ws.addRow([]);
    start = meta.length + 2;
  }
  const hr = ws.addRow(headers);
  hr.font = { bold: true };
  hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE3F0F5" } };
  for (const r of rows) ws.addRow(r.map((c) => (typeof c === "string" && /^[=+\-@]/.test(c) ? "'" + c : c)));
  ws.views = [{ state: "frozen", ySplit: start }];
  headers.forEach((h, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.min(50, Math.max(10, h.length + 2, ...rows.slice(0, 200).map((r) => String(r[i] ?? "").length + 2)));
  });
  ws.autoFilter = { from: { row: start, column: 1 }, to: { row: start, column: headers.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
