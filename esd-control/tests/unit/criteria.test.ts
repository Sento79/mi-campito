import { describe, expect, it } from "vitest";
import { criterionRulesSchema, evaluate, type CriterionRules, type NumericRule, describeRules } from "@/lib/domain/criteria";

// NOTA: límites ilustrativos para los tests; no son valores normativos.
const range: NumericRule = {
  kind: "numeric",
  unit: "Ω",
  min: { value: "1e6", inclusive: true },
  max: { value: "1e9", inclusive: false },
  allowedUnits: ["kΩ", "MΩ", "GΩ"],
};

describe("motor de criterios — numérico", () => {
  it("conforme dentro del rango", () => {
    const e = evaluate(range, { kind: "numeric", value: "5e7" });
    expect(e.result).toBe("pass");
    expect(e.values[0].normalizedValue).toBe("50000000");
    expect(e.reasons[0]).toMatch(/cumple/);
  });

  it("límite inferior inclusivo: igual al mínimo es conforme", () => {
    expect(evaluate(range, { kind: "numeric", value: "1000000" }).result).toBe("pass");
    expect(evaluate(range, { kind: "numeric", value: "999999.999" }).result).toBe("fail");
  });

  it("límite superior exclusivo: igual al máximo es no conforme", () => {
    expect(evaluate(range, { kind: "numeric", value: "1e9" }).result).toBe("fail");
    expect(evaluate(range, { kind: "numeric", value: "999999999.9999" }).result).toBe("pass");
  });

  it("límites exclusivos/inclusivos invertidos", () => {
    const r: NumericRule = { ...range, min: { value: "1e6", inclusive: false }, max: { value: "1e9", inclusive: true } };
    expect(evaluate(r, { kind: "numeric", value: "1e6" }).result).toBe("fail");
    expect(evaluate(r, { kind: "numeric", value: "1e9" }).result).toBe("pass");
  });

  it("convierte la unidad de entrada y guarda original y normalizado", () => {
    const e = evaluate(range, { kind: "numeric", value: "1,2", unit: "GΩ" });
    expect(e.result).toBe("fail");
    expect(e.values[0].rawInput).toBe("1,2");
    expect(e.values[0].rawUnit).toBe("GΩ");
    expect(e.values[0].normalizedValue).toBe("1200000000");
    expect(e.values[0].normalizedUnit).toBe("Ω");
  });

  it("rechaza unidades no permitidas por el criterio", () => {
    const e = evaluate(range, { kind: "numeric", value: "5", unit: "TΩ" });
    expect(e.result).toBe("incomplete");
    expect(e.reasons[0]).toMatch(/no admitida/);
  });

  it("texto libre no se trata como número", () => {
    const e = evaluate(range, { kind: "numeric", value: "ok" });
    expect(e.result).toBe("incomplete");
    expect(e.result).not.toBe("pass");
  });

  it("valor vacío → incompleto", () => {
    expect(evaluate(range, { kind: "numeric", value: "" }).result).toBe("incomplete");
  });

  it("solo límite superior", () => {
    const r: NumericRule = { kind: "numeric", unit: "V", max: { value: "100", inclusive: true } };
    expect(evaluate(r, { kind: "numeric", value: "100" }).result).toBe("pass");
    expect(evaluate(r, { kind: "numeric", value: "100.0001" }).result).toBe("fail");
  });
});

describe("motor de criterios — reglas de seguridad", () => {
  it("sin criterio vigente nunca es conforme", () => {
    const e = evaluate(null, { kind: "numeric", value: "5e7" });
    expect(e.result).toBe("review");
  });

  it("tipo de entrada distinto al criterio → revisión", () => {
    expect(evaluate(range, { kind: "select", option: "ok" }).result).toBe("review");
  });

  it("instrumento fuera de calibración con política 'review' degrada conforme a revisión", () => {
    const e = evaluate(range, { kind: "numeric", value: "5e7" }, {
      instrument: { required: true, provided: true, calibrationValid: false, policy: "review" },
    });
    expect(e.result).toBe("review");
    expect(e.warnings[0]).toMatch(/fuera de calibración/);
  });

  it("instrumento no válido no oculta un no conforme", () => {
    const e = evaluate(range, { kind: "numeric", value: "5" }, {
      instrument: { required: true, provided: true, calibrationValid: false, policy: "review" },
    });
    expect(e.result).toBe("fail");
  });

  it("política 'block' impide guardar", () => {
    const e = evaluate(range, { kind: "numeric", value: "5e7" }, {
      instrument: { required: true, provided: false, calibrationValid: null, policy: "block" },
    });
    expect(e.blockedReason).toMatch(/instrumento requerido/);
  });

  it("instrumento sin calibración registrada", () => {
    const e = evaluate(range, { kind: "numeric", value: "5e7" }, {
      instrument: { required: true, provided: true, calibrationValid: null, policy: "review" },
    });
    expect(e.result).toBe("review");
  });

  it("instrumento no requerido declarado por procedimiento", () => {
    const e = evaluate(range, { kind: "numeric", value: "5e7" }, {
      instrument: { required: true, declaredNotRequired: true, provided: false, calibrationValid: null, policy: "block" },
    });
    expect(e.result).toBe("pass");
    expect(e.blockedReason).toBeNull();
  });

  it("no medible exige motivo y se registra como tal", () => {
    const e = evaluate(range, { kind: "not_measurable", reason: "Zona inaccesible" });
    expect(e.result).toBe("not_measurable");
    expect(e.reasons[0]).toMatch(/inaccesible/);
  });
});

describe("selección y checklist", () => {
  const sel: CriterionRules = {
    kind: "select",
    options: [
      { value: "ok", label: "Correcto", outcome: "pass" },
      { value: "worn", label: "Desgastado", outcome: "review" },
      { value: "broken", label: "Roto", outcome: "fail" },
    ],
  };
  it("asigna resultado por opción", () => {
    expect(evaluate(sel, { kind: "select", option: "ok" }).result).toBe("pass");
    expect(evaluate(sel, { kind: "select", option: "worn" }).result).toBe("review");
    expect(evaluate(sel, { kind: "select", option: "broken" }).result).toBe("fail");
    expect(evaluate(sel, { kind: "select", option: "inventada" }).result).toBe("incomplete");
  });

  const cl: CriterionRules = {
    kind: "checklist",
    items: [
      { code: "c1", label: "Cable de tierra conectado", required: true, allowNA: false },
      { code: "c2", label: "Sin daños visibles", required: true, allowNA: false },
      { code: "c3", label: "Etiqueta legible", required: false, allowNA: true },
    ],
  };
  it("checklist completo OK", () => {
    expect(evaluate(cl, { kind: "checklist", items: { c1: "ok", c2: "ok" } }).result).toBe("pass");
  });
  it("cualquier NO OK → no conforme", () => {
    expect(evaluate(cl, { kind: "checklist", items: { c1: "ok", c2: "nok", c3: "ok" } }).result).toBe("fail");
  });
  it("obligatorio sin completar → incompleto", () => {
    expect(evaluate(cl, { kind: "checklist", items: { c1: "ok" } }).result).toBe("incomplete");
  });
  it("N/A no permitido → incompleto", () => {
    expect(evaluate(cl, { kind: "checklist", items: { c1: "na", c2: "ok" } }).result).toBe("incomplete");
  });
});

describe("multipunto", () => {
  const points = [
    { code: "P1", name: "Esquina A", required: true },
    { code: "P2", name: "Centro", required: true },
    { code: "P3", name: "Esquina B", required: true },
    { code: "P4", name: "Extra", required: false },
  ];
  const base = { kind: "multipoint" as const, point: range };

  it("all_pass: todos conformes", () => {
    const r: CriterionRules = { ...base, aggregation: { mode: "all_pass" } };
    const e = evaluate(r, { kind: "multipoint", points: { P1: { value: "2e6" }, P2: { value: "3e6" }, P3: { value: "4e6" } } }, { expectedPoints: points });
    expect(e.result).toBe("pass");
    expect(e.values).toHaveLength(4);
    expect(e.values[3].result).toBe("not_applicable");
  });

  it("all_pass: un punto no conforme → no conforme, con evaluación por punto", () => {
    const r: CriterionRules = { ...base, aggregation: { mode: "all_pass" } };
    const e = evaluate(r, { kind: "multipoint", points: { P1: { value: "2e6" }, P2: { value: "5e9" }, P3: { value: "4e6" } } }, { expectedPoints: points });
    expect(e.result).toBe("fail");
    expect(e.values.find((v) => v.pointCode === "P2")?.result).toBe("fail");
  });

  it("falta un punto obligatorio → incompleto (no conforme automáticamente)", () => {
    const r: CriterionRules = { ...base, aggregation: { mode: "worst_case" } };
    const e = evaluate(r, { kind: "multipoint", points: { P1: { value: "2e6" }, P2: { value: "3e6" } } }, { expectedPoints: points });
    expect(e.result).toBe("incomplete");
  });

  it("falta un punto pero otro falla → no conforme", () => {
    const r: CriterionRules = { ...base, aggregation: { mode: "all_pass" } };
    const e = evaluate(r, { kind: "multipoint", points: { P1: { value: "1" } } }, { expectedPoints: points });
    expect(e.result).toBe("fail");
  });

  it("min_pass", () => {
    const r: CriterionRules = { ...base, aggregation: { mode: "min_pass", minPass: 2 } };
    const opt = points.map((p) => ({ ...p, required: false }));
    expect(evaluate(r, { kind: "multipoint", points: { P1: { value: "2e6" }, P2: { value: "1" }, P3: { value: "3e6" } } }, { expectedPoints: opt }).result).toBe("pass");
    expect(evaluate(r, { kind: "multipoint", points: { P1: { value: "2e6" }, P2: { value: "1" }, P3: { value: "1" } } }, { expectedPoints: opt }).result).toBe("fail");
  });

  it("mean: solo si está autorizada y con justificación", () => {
    const r = { ...base, aggregation: { mode: "mean", requireEachPoint: false, justification: "Procedimiento PR-07 rev. C §4" } };
    expect(criterionRulesSchema.safeParse(r).success).toBe(true);
    const bad = { ...base, aggregation: { mode: "mean", requireEachPoint: false } };
    expect(criterionRulesSchema.safeParse(bad).success).toBe(false);
    const e = evaluate(r as CriterionRules, { kind: "multipoint", points: { P1: { value: "5e5" }, P2: { value: "3e6" }, P3: { value: "3e6" } } }, { expectedPoints: points });
    expect(e.result).toBe("pass");
    const strict = { ...r, aggregation: { ...r.aggregation, requireEachPoint: true } } as CriterionRules;
    expect(evaluate(strict, { kind: "multipoint", points: { P1: { value: "5e5" }, P2: { value: "3e6" }, P3: { value: "3e6" } } }, { expectedPoints: points }).result).toBe("fail");
  });

  it("regla específica por punto", () => {
    const pts = [{ code: "P1", name: "Superficie", required: true }, { code: "G", name: "Tierra", required: true, rule: { kind: "numeric", unit: "Ω", max: { value: "2", inclusive: true } } as NumericRule }];
    const r: CriterionRules = { ...base, aggregation: { mode: "all_pass" } };
    const e = evaluate(r, { kind: "multipoint", points: { P1: { value: "2e6" }, G: { value: "1.5" } } }, { expectedPoints: pts });
    expect(e.result).toBe("pass");
  });

  it("sin plantilla → revisión", () => {
    const r: CriterionRules = { ...base, aggregation: { mode: "all_pass" } };
    expect(evaluate(r, { kind: "multipoint", points: {} }).result).toBe("review");
  });
});

describe("combinado", () => {
  it("todas las partes deben cumplir", () => {
    const r: CriterionRules = {
      kind: "combined",
      parts: [
        { code: "rtg", label: "Resistencia a tierra", rule: range },
        { code: "vis", label: "Inspección visual", rule: { kind: "select", options: [{ value: "ok", label: "OK", outcome: "pass" }, { value: "ko", label: "Dañado", outcome: "fail" }] } },
      ],
    };
    expect(evaluate(r, { kind: "combined", parts: { rtg: { kind: "numeric", value: "2e6" }, vis: { kind: "select", option: "ok" } } }).result).toBe("pass");
    expect(evaluate(r, { kind: "combined", parts: { rtg: { kind: "numeric", value: "2e6" }, vis: { kind: "select", option: "ko" } } }).result).toBe("fail");
    expect(evaluate(r, { kind: "combined", parts: { rtg: { kind: "numeric", value: "2e6" } } }).result).toBe("incomplete");
  });
});

describe("validación del esquema de reglas", () => {
  it("rechaza mínimo > máximo", () => {
    expect(criterionRulesSchema.safeParse({ kind: "numeric", unit: "Ω", min: { value: "10", inclusive: true }, max: { value: "1", inclusive: true } }).success).toBe(false);
  });
  it("rechaza criterio sin límites", () => {
    expect(criterionRulesSchema.safeParse({ kind: "numeric", unit: "Ω" }).success).toBe(false);
  });
  it("rechaza unidades permitidas incompatibles", () => {
    expect(criterionRulesSchema.safeParse({ ...range, allowedUnits: ["V"] }).success).toBe(false);
  });
  it("describe las reglas de forma legible", () => {
    expect(describeRules(range)).toContain("≤ valor <");
  });
  it("evaluación reproducible", () => {
    const a = evaluate(range, { kind: "numeric", value: "7.5", unit: "MΩ" });
    const b = evaluate(range, { kind: "numeric", value: "7.5", unit: "MΩ" });
    expect(a).toEqual(b);
  });
});
