import "server-only";
import PDFDocument from "pdfkit";
import path from "node:path";
import { readFileSync } from "node:fs";

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
let fonts: { regular: Buffer; bold: Buffer } | null = null;
function loadFonts() {
  fonts ??= { regular: readFileSync(path.join(FONT_DIR, "DejaVuSans.ttf")), bold: readFileSync(path.join(FONT_DIR, "DejaVuSans-Bold.ttf")) };
  return fonts;
}

export const COLORS = { text: "#111827", muted: "#5a6475", line: "#d6dbe2", primary: "#0b5f7f", ok: "#18794e", bad: "#c22a2a", warn: "#b45309", neutral: "#616b7a", soft: "#f0f3f6" };

export interface ReportMeta {
  title: string;
  orgName: string;
  subtitle?: string;
  filters?: [string, string][];
  generatedBy: string;
  footer?: string;
  logo?: Buffer | null;
  isDemo?: boolean;
  landscape?: boolean;
}

export type Doc = PDFKit.PDFDocument;

/** Crea un informe A4 con cabecera, filtros y pie con «página X de Y». */
export function createReport(meta: ReportMeta): { doc: Doc; done: () => Promise<Buffer> } {
  const f = loadFonts();
  const doc = new PDFDocument({ size: "A4", layout: meta.landscape ? "landscape" : "portrait", margins: { top: 50, bottom: 60, left: 45, right: 45 }, bufferPages: true, info: { Title: meta.title, Author: meta.orgName, Creator: "ESD Control" } });
  doc.registerFont("R", f.regular);
  doc.registerFont("B", f.bold);
  doc.font("R");
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));

  // Cabecera de la primera página
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  if (meta.logo) {
    try {
      doc.image(meta.logo, left, 40, { fit: [120, 40] });
    } catch {
      /* logo no válido: se omite */
    }
  }
  doc.font("B").fontSize(9).fillColor(COLORS.muted).text(meta.orgName, left, 44, { width, align: "right" });
  doc.moveDown(2.2);
  doc.font("B").fontSize(18).fillColor(COLORS.text).text(meta.title, left, 92, { width });
  if (meta.subtitle) doc.font("R").fontSize(10).fillColor(COLORS.muted).text(meta.subtitle, { width });
  if (meta.isDemo) {
    doc.moveDown(0.3).font("B").fontSize(9).fillColor(COLORS.warn).text("DATOS DE DEMOSTRACIÓN: ficticios y con criterios ilustrativos, no válidos para decisiones de calidad.", { width });
  }
  doc.moveDown(0.6);
  const rows: [string, string][] = [["Fecha de generación", new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" })], ["Generado por", meta.generatedBy], ...(meta.filters ?? [])];
  for (const [k, v] of rows) {
    doc.font("B").fontSize(8.5).fillColor(COLORS.muted).text(`${k}: `, { continued: true }).font("R").fillColor(COLORS.text).text(v || "—");
  }
  doc.moveDown(0.8);
  hr(doc);

  const done = async () => {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.height - 38;
      const oldBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font("R").fontSize(7.5).fillColor(COLORS.muted);
      doc.text(`${meta.orgName} · ${meta.title}${meta.footer ? ` · ${meta.footer}` : ""}`, left, bottom, { width: width - 80, lineBreak: false, ellipsis: true });
      doc.text(`Página ${i + 1} de ${range.count}`, left + width - 80, bottom, { width: 80, align: "right", lineBreak: false });
      doc.page.margins.bottom = oldBottom;
    }
    doc.end();
    return finished;
  };
  return { doc, done };
}

export function hr(doc: Doc) {
  const y = doc.y;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).lineWidth(0.5).strokeColor(COLORS.line).stroke();
  doc.moveDown(0.6);
}

export function heading(doc: Doc, text: string) {
  ensureSpace(doc, 90); // evita títulos huérfanos al final de página
  doc.moveDown(0.4).font("B").fontSize(12).fillColor(COLORS.text).text(text, doc.page.margins.left);
  doc.moveDown(0.3);
}

export function paragraph(doc: Doc, text: string, opts: { color?: string; size?: number } = {}) {
  doc.font("R").fontSize(opts.size ?? 9).fillColor(opts.color ?? COLORS.text).text(text, doc.page.margins.left, undefined, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right });
}

export function ensureSpace(doc: Doc, h: number) {
  if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

export function kpiRow(doc: Doc, items: [string, string, string?][]) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const w = width / items.length;
  ensureSpace(doc, 50);
  const y = doc.y;
  items.forEach(([label, value, color], i) => {
    const x = left + i * w;
    doc.roundedRect(x + 2, y, w - 4, 44, 4).fillColor(COLORS.soft).fill();
    doc.font("R").fontSize(7.5).fillColor(COLORS.muted).text(label.toUpperCase(), x + 8, y + 6, { width: w - 16 });
    doc.font("B").fontSize(15).fillColor(color ?? COLORS.text).text(value, x + 8, y + 20, { width: w - 16 });
  });
  doc.y = y + 52;
  doc.x = left;
}

export interface Column {
  header: string;
  width: number; // fracción
  align?: "left" | "right" | "center";
  color?: (row: string[]) => string | undefined;
}

/** Tabla con cabecera repetida en cada página y filas con alto variable. */
export function table(doc: Doc, cols: Column[], rows: string[][], opts: { fontSize?: number } = {}) {
  const fs = opts.fontSize ?? 8;
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const widths = cols.map((c) => c.width * width);
  const pad = 4;
  const drawHeader = () => {
    const y = doc.y;
    doc.rect(left, y, width, fs + 10).fillColor(COLORS.soft).fill();
    let x = left;
    cols.forEach((c, i) => {
      doc.font("B").fontSize(fs - 0.5).fillColor(COLORS.muted).text(c.header, x + pad, y + 5, { width: widths[i] - 2 * pad, align: c.align ?? "left", lineBreak: false, ellipsis: true });
      x += widths[i];
    });
    doc.y = y + fs + 12;
  };
  ensureSpace(doc, 40);
  drawHeader();
  for (const r of rows) {
    doc.font("R").fontSize(fs);
    // Las celdas extra (más allá de las columnas) solo sirven a las funciones de color
    const cells = r.slice(0, cols.length);
    const h = Math.max(...cells.map((cell, i) => doc.heightOfString(cell ?? "", { width: widths[i] - 2 * pad }))) + 6;
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    let x = left;
    cells.forEach((cell, i) => {
      doc.font("R").fontSize(fs).fillColor(cols[i].color?.(r) ?? COLORS.text).text(cell ?? "", x + pad, y + 3, { width: widths[i] - 2 * pad, align: cols[i].align ?? "left" });
      x += widths[i];
    });
    doc.y = y + h;
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.3).strokeColor(COLORS.line).stroke();
  }
  doc.x = left;
  doc.moveDown(0.5);
}

export function resultColor(label: string): string | undefined {
  if (label === "Conforme") return COLORS.ok;
  if (label === "No conforme") return COLORS.bad;
  if (label === "Requiere revisión" || label === "Incompleto") return COLORS.warn;
  return undefined;
}

export function signatureBlock(doc: Doc, labels: string[]) {
  ensureSpace(doc, 90);
  doc.moveDown(1.5);
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const w = width / labels.length;
  const y = doc.y + 40;
  labels.forEach((l, i) => {
    const x = left + i * w;
    doc.moveTo(x + 10, y).lineTo(x + w - 10, y).lineWidth(0.6).strokeColor(COLORS.muted).stroke();
    doc.font("R").fontSize(8).fillColor(COLORS.muted).text(l, x + 10, y + 4, { width: w - 20, align: "center" });
  });
  doc.y = y + 24;
  doc.x = left;
}
