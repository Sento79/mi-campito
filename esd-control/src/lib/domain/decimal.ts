/**
 * Aritmética decimal exacta para comparar mediciones con límites sin errores
 * de coma flotante. Un valor se representa como coef × 10^(-scale), con coef BigInt.
 *
 * Formatos aceptados (el texto original se guarda siempre tal cual):
 *   "1500000", "1.5e6", "1,5E+6", "-0.25", "1.5x10^6", "1,5·10^6", "1.5×10^6", "1.5*10^6"
 * Se rechazan: texto libre, separadores de miles, valores con '.' y ',' a la vez,
 * Infinity, NaN y hexadecimal.
 */
export interface Decimal {
  readonly coef: bigint;
  readonly scale: number; // >= 0 o negativo (valor = coef * 10^-scale)
}

export type ParseResult = { ok: true; value: Decimal } | { ok: false; error: string };

const SCI_POW_RE = /^([+-]?\d+(?:[.,]\d+)?)\s*(?:[x×·*])\s*10\s*\^\s*([+-]?\d{1,3})$/i;
const PLAIN_RE = /^([+-]?)(\d+)(?:[.,](\d+))?(?:e([+-]?\d{1,3}))?$/i;

export function parseDecimal(input: string): ParseResult {
  if (typeof input !== "string") return { ok: false, error: "Valor no textual" };
  const s = input.trim().replace(/−/g, "-"); // signo menos tipográfico
  if (s.length === 0) return { ok: false, error: "Valor vacío" };
  if (s.length > 60) return { ok: false, error: "Valor demasiado largo" };

  const sci = SCI_POW_RE.exec(s);
  if (sci) {
    const base = parseDecimal(sci[1]);
    if (!base.ok) return base;
    return { ok: true, value: shift(base.value, parseInt(sci[2], 10)) };
  }
  const m = PLAIN_RE.exec(s);
  if (!m) return { ok: false, error: `"${input}" no es un número válido` };
  const [, sign, intPart, fracPart = "", expPart] = m;
  const digits = (intPart + fracPart).replace(/^0+(?=\d)/, "");
  let coef = BigInt(digits);
  if (sign === "-") coef = -coef;
  let scale = fracPart.length;
  if (expPart) scale -= parseInt(expPart, 10);
  return { ok: true, value: normalize({ coef, scale }) };
}

export function isDecimalString(s: string): boolean {
  return parseDecimal(s).ok;
}

/** Multiplica por 10^n de forma exacta. */
export function shift(d: Decimal, n: number): Decimal {
  return normalize({ coef: d.coef, scale: d.scale - n });
}

function normalize(d: Decimal): Decimal {
  let { coef, scale } = d;
  if (coef === BigInt(0)) return { coef: BigInt(0), scale: 0 };
  while (scale > 0 && coef % BigInt(10) === BigInt(0)) {
    coef /= BigInt(10);
    scale -= 1;
  }
  // scale negativo: expandimos para mantener scale >= 0 (representación canónica)
  if (scale < 0) {
    coef *= BigInt(10) ** BigInt(-scale);
    scale = 0;
  }
  return { coef, scale };
}

export function compare(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const s = Math.max(a.scale, b.scale);
  const ac = a.coef * BigInt(10) ** BigInt(s - a.scale);
  const bc = b.coef * BigInt(10) ** BigInt(s - b.scale);
  return ac < bc ? -1 : ac > bc ? 1 : 0;
}

export function add(a: Decimal, b: Decimal): Decimal {
  const s = Math.max(a.scale, b.scale);
  const ac = a.coef * BigInt(10) ** BigInt(s - a.scale);
  const bc = b.coef * BigInt(10) ** BigInt(s - b.scale);
  return normalize({ coef: ac + bc, scale: s });
}

/** División entera exacta hasta `digits` decimales (redondeo hacia cero). Solo para medias informativas. */
export function divideInt(a: Decimal, n: number, digits = 12): Decimal {
  const scaled = a.coef * BigInt(10) ** BigInt(digits);
  return normalize({ coef: scaled / BigInt(n), scale: a.scale + digits });
}

/** Representación canónica sin exponente, apta para columnas NUMERIC. */
export function toPlainString(d: Decimal): string {
  const neg = d.coef < BigInt(0);
  let digits = (neg ? -d.coef : d.coef).toString();
  if (d.scale > 0) {
    digits = digits.padStart(d.scale + 1, "0");
    digits = digits.slice(0, digits.length - d.scale) + "." + digits.slice(digits.length - d.scale);
  }
  return (neg ? "-" : "") + digits;
}

/** Para mostrar: notación científica compacta cuando es muy grande/pequeño. */
export function formatDecimal(d: Decimal, locale = "es-ES"): string {
  const n = toNumber(d);
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-3)) {
    const [m, e] = n.toExponential(3).split("e");
    return `${Number(m).toLocaleString(locale, { maximumFractionDigits: 3 })}·10^${parseInt(e, 10)}`;
  }
  return n.toLocaleString(locale, { maximumFractionDigits: 6 });
}

export function toNumber(d: Decimal): number {
  return Number(toPlainString(d));
}

export function fromPlainString(s: string): Decimal {
  const r = parseDecimal(s);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}
