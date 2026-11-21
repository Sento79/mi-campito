import { describe, expect, it } from "vitest";
import { compare, parseDecimal, toPlainString, shift } from "@/lib/domain/decimal";
import { convert } from "@/lib/domain/units";

const d = (s: string) => {
  const r = parseDecimal(s);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe("parseDecimal", () => {
  it.each([
    ["1500000", "1500000"],
    ["1.5e6", "1500000"],
    ["1,5E+6", "1500000"],
    ["1.5x10^6", "1500000"],
    ["1,5·10^6", "1500000"],
    ["1.5×10^-3", "0.0015"],
    ["-0.25", "-0.25"],
    ["  42  ", "42"],
    ["0.1", "0.1"],
    ["1e-9", "0.000000001"],
    ["000123.4500", "123.45"],
    ["−3", "-3"],
  ])("%s → %s", (input, expected) => {
    expect(toPlainString(d(input))).toBe(expected);
  });

  it.each(["", "abc", "1.000,5", "1 000", "NaN", "Infinity", "0x10", "1e", "1..2", "conforme", "10^6", "1,2,3"])(
    "rechaza texto no numérico: %j",
    (input) => {
      expect(parseDecimal(input).ok).toBe(false);
    },
  );

  it("no tiene errores de coma flotante", () => {
    // 0.1 + 0.2 != 0.3 en IEEE754, aquí comparamos exacto
    expect(compare(d("0.3"), d("0.30"))).toBe(0);
    expect(compare(d("1e9"), d("1000000000"))).toBe(0);
    expect(compare(d("999999999.9999999"), d("1e9"))).toBe(-1);
  });

  it("shift es exacto", () => {
    expect(toPlainString(shift(d("1.234"), 6))).toBe("1234000");
    expect(toPlainString(shift(d("1234"), -6))).toBe("0.001234");
  });
});

describe("conversión de unidades", () => {
  it("convierte resistencias de forma exacta", () => {
    const r = convert(d("1.2"), "MΩ", "Ω");
    expect(r.ok && toPlainString(r.value)).toBe("1200000");
    const g = convert(d("1"), "GΩ", "MΩ");
    expect(g.ok && toPlainString(g.value)).toBe("1000");
    const k = convert(d("350"), "kΩ", "MΩ");
    expect(k.ok && toPlainString(k.value)).toBe("0.35");
  });
  it("acepta alias", () => {
    const r = convert(d("5"), "Mohm", "ohm");
    expect(r.ok && toPlainString(r.value)).toBe("5000000");
  });
  it("rechaza magnitudes distintas", () => {
    const r = convert(d("5"), "V", "Ω");
    expect(r.ok).toBe(false);
  });
  it("rechaza unidades desconocidas", () => {
    expect(convert(d("5"), "furlong", "m").ok).toBe(false);
  });
  it("tensión y tiempo", () => {
    const v = convert(d("0.1"), "kV", "V");
    expect(v.ok && toPlainString(v.value)).toBe("100");
    const t = convert(d("1500"), "ms", "s");
    expect(t.ok && toPlainString(t.value)).toBe("1.5");
  });
});
