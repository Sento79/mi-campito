/**
 * Validación de filas de importación de activos (CSV/XLSX).
 * Se valida todo antes de escribir; la escritura se hace en una única transacción.
 */
import { z } from "zod";
import { PERIOD_UNITS } from "./periodicity";

export const IMPORT_COLUMNS = [
  { key: "code", label: "codigo", required: true, help: "ID legible único (A-Z, 0-9, _ . - /)" },
  { key: "name", label: "nombre", required: true, help: "Nombre del activo" },
  { key: "category_code", label: "categoria", required: true, help: "Código de categoría existente" },
  { key: "location_code", label: "ubicacion", required: false, help: "Código de ubicación existente" },
  { key: "scan_code", label: "codigo_escaneo", required: false, help: "Valor del QR/código de barras (por defecto = codigo)" },
  { key: "manufacturer", label: "fabricante", required: false, help: "" },
  { key: "model", label: "modelo", required: false, help: "" },
  { key: "serial_number", label: "numero_serie", required: false, help: "" },
  { key: "status", label: "estado", required: false, help: "active, repair, blocked, review, retired" },
  { key: "commissioned_on", label: "fecha_alta", required: false, help: "AAAA-MM-DD" },
  { key: "period_unit", label: "periodo_unidad", required: false, help: "week, month, quarter, semester, year, day" },
  { key: "period_count", label: "periodo_cantidad", required: false, help: "Entero positivo" },
  { key: "notes", label: "observaciones", required: false, help: "" },
] as const;

/** AAAA-MM-DD que existe en el calendario (rechaza 2025-02-30). */
export function isCalendarDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export const ASSET_STATUSES = ["active", "retired", "repair", "blocked", "review"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];
export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  active: "Activo",
  retired: "Retirado",
  repair: "En reparación",
  blocked: "Bloqueado",
  review: "En revisión",
};

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const assetCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.\-/]{0,39}$/, "ID no válido (máx. 40; letras, números, _ . - /)");

export const importRowSchema = z
  .object({
    code: assetCodeSchema,
    name: z.string().trim().min(1, "Nombre obligatorio").max(200),
    category_code: z.string().trim().min(1, "Categoría obligatoria").max(40),
    location_code: opt(40),
    scan_code: opt(120),
    manufacturer: opt(120),
    model: opt(120),
    serial_number: opt(120),
    status: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : "active"))
      .pipe(z.enum(ASSET_STATUSES, { message: "Estado no válido" })),
    commissioned_on: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : undefined))
      .refine((v) => !v || isCalendarDate(v), "Fecha no válida (AAAA-MM-DD)"),
    period_unit: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : undefined))
      .refine((v) => !v || (PERIOD_UNITS as readonly string[]).includes(v), "Unidad de periodo no válida"),
    period_count: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : undefined))
      .refine((v) => !v || /^[1-9]\d{0,3}$/.test(v), "Cantidad de periodo no válida")
      .transform((v) => (v ? parseInt(v, 10) : undefined)),
    notes: opt(2000),
  })
  .refine((r) => (r.period_unit === undefined) === (r.period_count === undefined), {
    message: "Indique unidad y cantidad de periodo juntas",
    path: ["period_count"],
  });
export type ImportRow = z.infer<typeof importRowSchema>;

export interface RowIssue {
  row: number; // 1-based, contando cabecera como fila 1
  field?: string;
  message: string;
}

export interface ImportPreview {
  valid: (ImportRow & { row: number })[];
  issues: RowIssue[];
  total: number;
}

/** Mapea cabeceras (es/en, sin acentos ni mayúsculas) a claves internas. */
export function mapHeaders(headers: string[]): Record<number, string> {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, "_");
  const out: Record<number, string> = {};
  headers.forEach((h, i) => {
    const n = norm(h);
    const col = IMPORT_COLUMNS.find((c) => c.label === n || c.key === n);
    if (col) out[i] = col.key;
  });
  return out;
}

export interface ImportLookups {
  /** Códigos en MAYÚSCULAS sin ambigüedad */
  categoryCodes: Set<string>;
  locationCodes: Set<string>;
  /** Códigos que existen en varias variantes de mayúsculas (no se pueden resolver) */
  ambiguousCodes?: Set<string>;
  /** IDs y códigos de escaneo existentes (en MAYÚSCULAS) */
  existingCodes: Set<string>;
  existingScanCodes: Set<string>;
}

export function validateImport(rows: string[][], lookups: ImportLookups): ImportPreview {
  const issues: RowIssue[] = [];
  const valid: (ImportRow & { row: number })[] = [];
  if (rows.length === 0) return { valid, issues: [{ row: 1, message: "El archivo está vacío" }], total: 0 };
  const headerMap = mapHeaders(rows[0]);
  const present = new Set(Object.values(headerMap));
  const counts = new Map<string, number>();
  for (const k of Object.values(headerMap)) counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const [k, n] of counts) {
    if (n > 1) issues.push({ row: 1, field: k, message: `La columna «${IMPORT_COLUMNS.find((c) => c.key === k)?.label ?? k}» aparece ${n} veces` });
  }
  for (const c of IMPORT_COLUMNS) {
    if (c.required && !present.has(c.key)) issues.push({ row: 1, field: c.label, message: `Falta la columna obligatoria "${c.label}"` });
  }
  if (issues.length) return { valid, issues, total: rows.length - 1 };

  const seenCodes = new Map<string, number>();
  const seenScan = new Map<string, number>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.every((c) => !c || !String(c).trim())) continue; // fila vacía
    const obj: Record<string, string> = {};
    Object.entries(headerMap).forEach(([idx, key]) => {
      const v = r[Number(idx)];
      obj[key] = v === undefined || v === null ? "" : String(v);
    });
    const rowNo = i + 1;
    const parsed = importRowSchema.safeParse(obj);
    if (!parsed.success) {
      for (const iss of parsed.error.issues) issues.push({ row: rowNo, field: String(iss.path[0] ?? ""), message: iss.message });
      continue;
    }
    const d = parsed.data;
    const codeKey = d.code.toUpperCase();
    const scan = d.scan_code ?? d.code;
    const scanKey = scan.toUpperCase();
    let ok = true;
    if (seenCodes.has(codeKey)) {
      issues.push({ row: rowNo, field: "codigo", message: `ID duplicado en el archivo (también en fila ${seenCodes.get(codeKey)})` });
      ok = false;
    }
    if (lookups.existingCodes.has(codeKey)) {
      issues.push({ row: rowNo, field: "codigo", message: `El ID ${d.code} ya existe en el inventario` });
      ok = false;
    }
    if (seenScan.has(scanKey) || (seenCodes.has(scanKey) && scanKey !== codeKey)) {
      issues.push({ row: rowNo, field: "codigo_escaneo", message: `Código de escaneo duplicado en el archivo (fila ${seenScan.get(scanKey) ?? seenCodes.get(scanKey)})` });
      ok = false;
    }
    if (scanKey !== codeKey && lookups.existingScanCodes.has(scanKey)) {
      issues.push({ row: rowNo, field: "codigo_escaneo", message: `El código de escaneo ${scan} ya está asignado` });
      ok = false;
    }
    if (lookups.ambiguousCodes?.has(d.category_code.toUpperCase())) {
      issues.push({ row: rowNo, field: "categoria", message: `Categoría "${d.category_code}" ambigua (existen códigos que solo difieren en mayúsculas)` });
      ok = false;
    } else if (!lookups.categoryCodes.has(d.category_code.toUpperCase())) {
      issues.push({ row: rowNo, field: "categoria", message: `Categoría "${d.category_code}" no existe` });
      ok = false;
    }
    if (d.location_code && lookups.ambiguousCodes?.has(d.location_code.toUpperCase())) {
      issues.push({ row: rowNo, field: "ubicacion", message: `Ubicación "${d.location_code}" ambigua (existen códigos que solo difieren en mayúsculas)` });
      ok = false;
    } else if (d.location_code && !lookups.locationCodes.has(d.location_code.toUpperCase())) {
      issues.push({ row: rowNo, field: "ubicacion", message: `Ubicación "${d.location_code}" no existe` });
      ok = false;
    }
    seenCodes.set(codeKey, rowNo);
    seenScan.set(scanKey, rowNo);
    if (ok) valid.push({ ...d, scan_code: scan, row: rowNo });
  }
  return { valid, issues, total: rows.length - 1 };
}
