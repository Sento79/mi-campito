import "server-only";
import bwipjs from "bwip-js";
import type { Tx } from "./db";
import { labelLines, sheetGrid, type LabelData, type LabelLayout } from "@/lib/domain/labels";
import { ASSET_STATUS_LABEL, type AssetStatus } from "@/lib/domain/asset-import";
import PDFDocument from "pdfkit";
import path from "node:path";
import { readFileSync } from "node:fs";

export function appUrl() {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** El QR solo contiene un enlace con el código de escaneo (sin datos sensibles). */
export function qrUrl(scanCode: string) {
  return `${appUrl()}/a/${encodeURIComponent(scanCode)}`;
}

export async function labelData(tx: Tx, assetIds: string[]): Promise<LabelData[]> {
  const rows = await tx`
    select a.id, a.code, a.name, a.scan_code, a.status, a.last_measured_at, a.next_due_at, c.name as category, l.name as location
      from assets a join categories c on c.id = a.category_id left join locations l on l.id = a.location_id
     where a.id = any(${assetIds}) order by a.code`;
  const d = (x: Date | null) => (x ? new Date(x).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" }) : null);
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    scanCode: r.scan_code,
    url: qrUrl(r.scan_code),
    category: r.category,
    location: r.location,
    lastMeasured: d(r.last_measured_at),
    nextDue: d(r.next_due_at),
    status: ASSET_STATUS_LABEL[r.status as AssetStatus] ?? r.status,
  }));
}

export async function qrPng(text: string): Promise<Buffer> {
  return bwipjs.toBuffer({ bcid: "qrcode", text, scale: 4, eclevel: "M", padding: 0 } as never);
}
export async function barcodePng(text: string): Promise<Buffer> {
  return bwipjs.toBuffer({ bcid: "code128", text, scale: 3, height: 10, includetext: false } as never);
}
export function svgCode(kind: "qr" | "barcode", text: string): string {
  return bwipjs.toSVG(kind === "qr" ? ({ bcid: "qrcode", text, eclevel: "M" } as never) : ({ bcid: "code128", text, height: 10, includetext: false } as never));
}

const MM = 72 / 25.4;

/** PDF de etiquetas: hoja con varias por página o rollo (una por página). */
export async function labelsPdf(items: LabelData[], widthMm: number, heightMm: number, l: LabelLayout, logo: Buffer | null): Promise<Buffer> {
  const grid = sheetGrid(widthMm, heightMm, l);
  const roll = l.sheet.paper === "roll";
  const doc = new PDFDocument({ size: roll ? [widthMm * MM, heightMm * MM] : [grid.pageW * MM, grid.pageH * MM], margin: 0, autoFirstPage: false, info: { Title: "Etiquetas ESD", Creator: "ESD Control" } });
  const fontDir = path.join(process.cwd(), "assets", "fonts");
  doc.registerFont("R", readFileSync(path.join(fontDir, "DejaVuSans.ttf")));
  doc.registerFont("B", readFileSync(path.join(fontDir, "DejaVuSans-Bold.ttf")));
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const end = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  const perPage = roll ? 1 : grid.cols * grid.rows;
  const W = widthMm * MM, H = heightMm * MM, m = l.marginMm * MM;
  for (let i = 0; i < items.length; i++) {
    if (i % perPage === 0) doc.addPage();
    const k = i % perPage;
    const x0 = roll ? 0 : (l.sheet.marginMm + (k % grid.cols) * (widthMm + l.sheet.gapMm)) * MM;
    const y0 = roll ? 0 : (l.sheet.marginMm + Math.floor(k / grid.cols) * (heightMm + l.sheet.gapMm)) * MM;
    const it = items[i];
    if (!roll) doc.rect(x0, y0, W, H).lineWidth(0.3).dash(2, { space: 2 }).strokeColor("#b0b8c4").stroke().undash();
    let tx = x0 + m;
    const innerH = H - 2 * m;
    const barH = l.code === "barcode" || l.code === "both" ? innerH * 0.28 : 0;
    if (l.code === "qr" || l.code === "both") {
      const q = (innerH - (l.code === "both" ? 0 : 0)) * l.qrSize;
      doc.image(await qrPng(it.url), x0 + m, y0 + m, { width: q, height: q });
      tx = x0 + m + q + m;
    }
    let ty = y0 + m;
    if (l.showLogo && logo) {
      try {
        doc.image(logo, tx, ty, { fit: [W - (tx - x0) - m, innerH * 0.18] });
        ty += innerH * 0.2;
      } catch {
        /* logo no válido */
      }
    }
    const tw = x0 + W - m - tx;
    const lines = labelLines(it, l);
    lines.forEach((line, idx) => {
      if (ty + l.fontSize > y0 + H - m - barH) return;
      doc.font(idx === 0 && l.showName ? "B" : "R").fontSize(l.fontSize).fillColor("#000").text(line, tx, ty, { width: tw, height: l.fontSize * 1.25, lineBreak: false, ellipsis: true });
      ty += l.fontSize * 1.25;
    });
    if (barH) {
      doc.image(await barcodePng(it.scanCode), tx, y0 + H - m - barH, { width: tw, height: barH });
    }
  }
  if (items.length === 0) doc.addPage();
  doc.end();
  return end;
}

