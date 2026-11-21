/**
 * Catálogo controlado de unidades. Solo se convierten unidades de la misma
 * magnitud y únicamente mediante potencias de 10 (conversión exacta).
 * Las magnitudes sin conversión (°C, %HR) solo admiten su propia unidad.
 */
import { Decimal, shift } from "./decimal";

export type Dimension = "resistance" | "voltage" | "time" | "length" | "current" | "humidity" | "temperature" | "percent" | "count";

export interface UnitDef {
  symbol: string;
  dimension: Dimension;
  /** valor_en_base = valor × 10^pow10 */
  pow10: number;
  aliases: string[];
  label: string;
}

export const UNITS: UnitDef[] = [
  { symbol: "mΩ", dimension: "resistance", pow10: -3, aliases: ["mohm"], label: "miliohmio" },
  { symbol: "Ω", dimension: "resistance", pow10: 0, aliases: ["ohm", "ohms", "ohmio", "ohmios", "Ohm"], label: "ohmio" },
  { symbol: "kΩ", dimension: "resistance", pow10: 3, aliases: ["kohm", "kohms", "KΩ", "Kohm"], label: "kiloohmio" },
  { symbol: "MΩ", dimension: "resistance", pow10: 6, aliases: ["Mohm", "Mohms", "megaohm", "megohm"], label: "megaohmio" },
  { symbol: "GΩ", dimension: "resistance", pow10: 9, aliases: ["Gohm", "Gohms", "gigaohm"], label: "gigaohmio" },
  { symbol: "TΩ", dimension: "resistance", pow10: 12, aliases: ["Tohm", "Tohms", "teraohm"], label: "teraohmio" },
  { symbol: "mV", dimension: "voltage", pow10: -3, aliases: [], label: "milivoltio" },
  { symbol: "V", dimension: "voltage", pow10: 0, aliases: ["v", "volt", "voltios"], label: "voltio" },
  { symbol: "kV", dimension: "voltage", pow10: 3, aliases: ["KV", "kv"], label: "kilovoltio" },
  { symbol: "ms", dimension: "time", pow10: -3, aliases: [], label: "milisegundo" },
  { symbol: "s", dimension: "time", pow10: 0, aliases: ["seg", "sec"], label: "segundo" },
  { symbol: "mm", dimension: "length", pow10: -3, aliases: [], label: "milímetro" },
  { symbol: "cm", dimension: "length", pow10: -2, aliases: [], label: "centímetro" },
  { symbol: "m", dimension: "length", pow10: 0, aliases: [], label: "metro" },
  { symbol: "µA", dimension: "current", pow10: -6, aliases: ["uA", "μA"], label: "microamperio" },
  { symbol: "mA", dimension: "current", pow10: -3, aliases: [], label: "miliamperio" },
  { symbol: "A", dimension: "current", pow10: 0, aliases: [], label: "amperio" },
  { symbol: "%HR", dimension: "humidity", pow10: 0, aliases: ["%RH", "HR", "RH"], label: "humedad relativa" },
  { symbol: "°C", dimension: "temperature", pow10: 0, aliases: ["ºC", "C", "degC"], label: "grado Celsius" },
  { symbol: "%", dimension: "percent", pow10: 0, aliases: [], label: "porcentaje" },
  { symbol: "ud", dimension: "count", pow10: 0, aliases: ["u", "uds"], label: "unidades" },
];

const BY_KEY = new Map<string, UnitDef>();
for (const u of UNITS) {
  BY_KEY.set(u.symbol, u);
  for (const a of u.aliases) BY_KEY.set(a, u);
}

export function findUnit(symbol: string | null | undefined): UnitDef | undefined {
  if (!symbol) return undefined;
  return BY_KEY.get(symbol.trim());
}

export function unitsOfDimension(dim: Dimension): UnitDef[] {
  return UNITS.filter((u) => u.dimension === dim);
}

export function compatibleUnits(symbol: string): UnitDef[] {
  const u = findUnit(symbol);
  return u ? unitsOfDimension(u.dimension) : [];
}

export type ConvertResult = { ok: true; value: Decimal; unit: string } | { ok: false; error: string };

/** Convierte `value` expresado en `from` a la unidad `to`, de forma exacta. */
export function convert(value: Decimal, from: string, to: string): ConvertResult {
  const f = findUnit(from);
  const t = findUnit(to);
  if (!f) return { ok: false, error: `Unidad desconocida: ${from}` };
  if (!t) return { ok: false, error: `Unidad desconocida: ${to}` };
  if (f.dimension !== t.dimension) {
    return { ok: false, error: `No se puede convertir ${f.symbol} (${f.label}) a ${t.symbol} (${t.label})` };
  }
  return { ok: true, value: shift(value, f.pow10 - t.pow10), unit: t.symbol };
}
