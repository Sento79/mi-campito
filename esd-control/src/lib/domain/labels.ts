/**
 * Etiquetas: modelo de diseño, tamaños predefinidos y generación ZPL (Zebra).
 * El QR solo codifica un enlace con el código del activo (/a/<código>):
 * la ficha exige sesión iniciada, así que no se expone información sensible.
 */
import { z } from "zod";

export const LABEL_SIZES = [
  { key: "50x30", label: "50 × 30 mm", width: 50, height: 30 },
  { key: "60x40", label: "60 × 40 mm", width: 60, height: 40 },
  { key: "70x50", label: "70 × 50 mm", width: 70, height: 50 },
  { key: "100x50", label: "100 × 50 mm", width: 100, height: 50 },
] as const;

export const labelLayoutSchema = z.object({
  code: z.enum(["qr", "barcode", "both", "none"]).default("qr"),
  showLogo: z.boolean().default(false),
  showName: z.boolean().default(true),
  showCode: z.boolean().default(true),
  showLocation: z.boolean().default(true),
  showCategory: z.boolean().default(true),
  showLastMeasured: z.boolean().default(false),
  showNextDue: z.boolean().default(true),
  showStatus: z.boolean().default(false),
  customText: z.string().max(80).default(""),
  /** Tamaño de fuente base en pt */
  fontSize: z.number().min(4).max(20).default(7),
  /** Fracción del alto ocupada por el QR (0.3–1) */
  qrSize: z.number().min(0.3).max(1).default(0.8),
  marginMm: z.number().min(0).max(10).default(2),
  /** Hoja para impresión masiva */
  sheet: z.object({
    paper: z.enum(["A4", "Letter", "roll"]).default("A4"),
    gapMm: z.number().min(0).max(20).default(2),
    marginMm: z.number().min(0).max(30).default(8),
  }).default({ paper: "A4", gapMm: 2, marginMm: 8 }),
  /** Impresora térmica */
  thermal: z.object({ dpi: z.union([z.literal(203), z.literal(300), z.literal(600)]).default(203), darkness: z.number().int().min(0).max(30).default(15) }).default({ dpi: 203, darkness: 15 }),
});
export type LabelLayout = z.infer<typeof labelLayoutSchema>;

export const DEFAULT_LABEL_LAYOUT: LabelLayout = labelLayoutSchema.parse({});

export interface LabelData {
  code: string;
  name: string;
  scanCode: string;
  url: string;
  location?: string | null;
  category?: string | null;
  lastMeasured?: string | null;
  nextDue?: string | null;
  status?: string | null;
}

export function labelLines(d: LabelData, l: LabelLayout): string[] {
  const out: string[] = [];
  if (l.showName) out.push(d.name);
  if (l.showCode) out.push(d.code);
  if (l.showCategory && d.category) out.push(d.category);
  if (l.showLocation && d.location) out.push(d.location);
  if (l.showLastMeasured) out.push(`Últ.: ${d.lastMeasured ?? "—"}`);
  if (l.showNextDue) out.push(`Próx.: ${d.nextDue ?? "—"}`);
  if (l.showStatus && d.status) out.push(`Estado: ${d.status}`);
  if (l.customText) out.push(l.customText);
  return out;
}

/** Cuántas etiquetas caben en una hoja. */
export function sheetGrid(widthMm: number, heightMm: number, l: LabelLayout): { cols: number; rows: number; pageW: number; pageH: number } {
  const page = l.sheet.paper === "Letter" ? { w: 215.9, h: 279.4 } : { w: 210, h: 297 };
  if (l.sheet.paper === "roll") return { cols: 1, rows: 1, pageW: widthMm, pageH: heightMm };
  const m = l.sheet.marginMm, g = l.sheet.gapMm;
  const cols = Math.max(1, Math.floor((page.w - 2 * m + g) / (widthMm + g)));
  const rows = Math.max(1, Math.floor((page.h - 2 * m + g) / (heightMm + g)));
  return { cols, rows, pageW: page.w, pageH: page.h };
}

/** Escapa texto para ZPL: ^ y ~ son caracteres de control; usamos ^FH con hex. */
export function zplText(s: string): string {
  return Array.from(s.normalize("NFC"))
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      if (ch === "^" || ch === "~" || ch === "_" || code < 32 || code > 126) {
        return Array.from(new TextEncoder().encode(ch))
          .map((b) => "_" + b.toString(16).toUpperCase().padStart(2, "0"))
          .join("");
      }
      return ch;
    })
    .join("");
}

const mmToDots = (mm: number, dpi: number) => Math.round((mm / 25.4) * dpi);

/** Genera ZPL II para una etiqueta (codificación UTF-8 con ^CI28). */
export function toZpl(d: LabelData, widthMm: number, heightMm: number, l: LabelLayout): string {
  const dpi = l.thermal.dpi;
  const W = mmToDots(widthMm, dpi);
  const H = mmToDots(heightMm, dpi);
  const m = mmToDots(l.marginMm, dpi);
  const lines = labelLines(d, l);
  const parts: string[] = ["^XA", "^CI28", `^PW${W}`, `^LL${H}`, `^MD${l.thermal.darkness - 15}`, "^LH0,0"];
  let textX = m;
  const inner = H - 2 * m;
  if (l.code === "qr" || l.code === "both") {
    // Tamaño de módulo aproximado para que el QR ocupe qrSize del alto (enlace ~40 caracteres => ~33 módulos)
    const target = Math.floor(inner * l.qrSize);
    const mag = Math.max(1, Math.min(10, Math.floor(target / 37)));
    parts.push(`^FO${m},${m}^BQN,2,${mag}^FH^FDLA,${zplText(d.url)}^FS`);
    textX = m + mag * 37 + m;
  }
  const fontH = Math.max(12, Math.round((l.fontSize / 72) * dpi));
  let y = m;
  const textW = W - textX - m;
  for (const line of lines) {
    if (y + fontH > H - m - (l.code === "barcode" || l.code === "both" ? Math.round(inner * 0.35) : 0)) break;
    parts.push(`^FO${textX},${y}^A0N,${fontH},${fontH}^FB${Math.max(10, textW)},1,0,L^FH^FD${zplText(line)}^FS`);
    y += Math.round(fontH * 1.2);
  }
  if (l.code === "barcode" || l.code === "both") {
    const bh = Math.max(20, Math.round(inner * 0.3));
    // Code 128: ~11 módulos por carácter + arranque/parada/control y zonas mudas (~35)
    const avail = l.code === "both" ? W - textX - m : W - 2 * m;
    const modules = 11 * d.scanCode.length + 35;
    const by = Math.min(3, Math.floor(avail / modules));
    if (by >= 1) {
      parts.push(`^FO${l.code === "both" ? textX : m},${H - m - bh}^BY${by}^BCN,${bh},N,N,N^FH^FD${zplText(d.scanCode).replace(/>/g, ">0")}^FS`);
    } else {
      // No cabe un código legible: se indica en lugar de imprimir barras ilegibles
      parts.push(`^FO${m},${H - m - fontH}^A0N,${fontH},${fontH}^FH^FD${zplText("Código demasiado largo para el ancho")}^FS`);
    }
  }
  parts.push("^PQ1", "^XZ");
  return parts.join("\n");
}
