/**
 * Motor de criterios de aceptación.
 *
 * Propiedades:
 *  - Determinista y puro: misma entrada + mismas reglas => mismo resultado.
 *  - Exacto: comparación decimal con BigInt (sin coma flotante).
 *  - Transparente: cada resultado incluye la lista de motivos legibles.
 *  - Conservador: sin criterio vigente, con datos ausentes o instrumento no
 *    válido nunca devuelve "Conforme".
 *
 * Los límites NO están predefinidos: los configura personal autorizado y cada
 * medición guarda la versión y la copia exacta de las reglas aplicadas.
 */
import { z } from "zod";
import { compare, Decimal, isDecimalString, parseDecimal, toPlainString, formatDecimal, add, divideInt } from "./decimal";
import { convert, findUnit } from "./units";
import { Result, RESULT_LABEL, worst } from "./results";

// ---------------------------------------------------------------------------
// Esquemas de reglas
// ---------------------------------------------------------------------------
const decimalString = z.string().trim().refine(isDecimalString, "Número no válido");
const bound = z.object({ value: decimalString, inclusive: z.boolean() });

export const numericRuleSchema = z
  .object({
    kind: z.literal("numeric"),
    unit: z.string().min(1).refine((u) => !!findUnit(u), "Unidad no reconocida"),
    min: bound.optional(),
    max: bound.optional(),
    /** Unidades de entrada aceptadas (misma magnitud). Vacío = solo la unidad del criterio. */
    allowedUnits: z.array(z.string()).optional(),
  })
  .superRefine((r, ctx) => {
    if (!r.min && !r.max) ctx.addIssue({ code: "custom", message: "Defina al menos un límite (inferior o superior)" });
    if (r.min && r.max) {
      const a = parseDecimal(r.min.value), b = parseDecimal(r.max.value);
      if (a.ok && b.ok && compare(a.value, b.value) > 0)
        ctx.addIssue({ code: "custom", message: "El límite inferior es mayor que el superior" });
    }
    for (const u of r.allowedUnits ?? []) {
      const conv = parseDecimal("1");
      if (conv.ok && !convert(conv.value, u, r.unit).ok)
        ctx.addIssue({ code: "custom", message: `La unidad ${u} no es convertible a ${r.unit}` });
    }
  });
export type NumericRule = z.infer<typeof numericRuleSchema>;

export const selectRuleSchema = z.object({
  kind: z.literal("select"),
  options: z
    .array(
      z.object({
        value: z.string().min(1).max(60),
        label: z.string().min(1).max(120),
        outcome: z.enum(["pass", "fail", "review", "not_applicable"]),
      }),
    )
    .min(1),
});
export type SelectRule = z.infer<typeof selectRuleSchema>;

export const checklistRuleSchema = z.object({
  kind: z.literal("checklist"),
  items: z
    .array(
      z.object({
        code: z.string().min(1).max(20),
        label: z.string().min(1).max(200),
        required: z.boolean().default(true),
        allowNA: z.boolean().default(false),
      }),
    )
    .min(1),
});
export type ChecklistRule = z.infer<typeof checklistRuleSchema>;

const aggregationSchema = z.discriminatedUnion("mode", [
  /** Todos los puntos obligatorios presentes y conformes. */
  z.object({ mode: z.literal("all_pass") }),
  /** Resultado global = peor resultado por punto (los optativos ausentes no cuentan). */
  z.object({ mode: z.literal("worst_case") }),
  /** Al menos N puntos conformes (regla específica autorizada). */
  z.object({ mode: z.literal("min_pass"), minPass: z.number().int().positive() }),
  /** Media dentro de límites (solo si el procedimiento lo autoriza expresamente). */
  z.object({ mode: z.literal("mean"), requireEachPoint: z.boolean(), justification: z.string().min(5) }),
]);
export type Aggregation = z.infer<typeof aggregationSchema>;

export const multipointRuleSchema = z.object({
  kind: z.literal("multipoint"),
  point: numericRuleSchema,
  aggregation: aggregationSchema,
});
export type MultipointRule = z.infer<typeof multipointRuleSchema>;

const partRuleSchema = z.union([numericRuleSchema, selectRuleSchema, checklistRuleSchema]);
export const combinedRuleSchema = z.object({
  kind: z.literal("combined"),
  parts: z
    .array(z.object({ code: z.string().min(1).max(20), label: z.string().min(1).max(120), rule: partRuleSchema }))
    .min(1),
});
export type CombinedRule = z.infer<typeof combinedRuleSchema>;

export const criterionRulesSchema = z.union([
  numericRuleSchema,
  selectRuleSchema,
  checklistRuleSchema,
  multipointRuleSchema,
  combinedRuleSchema,
]);
export type CriterionRules = z.infer<typeof criterionRulesSchema>;

// ---------------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------------
export const numericInputSchema = z.object({ kind: z.literal("numeric"), value: z.string().max(60), unit: z.string().max(10).optional() });
export const selectInputSchema = z.object({ kind: z.literal("select"), option: z.string().max(60) });
export const checklistInputSchema = z.object({
  kind: z.literal("checklist"),
  items: z.record(z.string(), z.enum(["ok", "nok", "na"]).optional()),
});
export const multipointInputSchema = z.object({
  kind: z.literal("multipoint"),
  points: z.record(z.string(), z.object({ value: z.string().max(60).optional(), unit: z.string().max(10).optional(), comment: z.string().max(500).optional() })),
});
export const combinedInputSchema = z.object({
  kind: z.literal("combined"),
  parts: z.record(z.string(), z.union([numericInputSchema, selectInputSchema, checklistInputSchema])),
});
export const notMeasuredInputSchema = z.object({
  kind: z.enum(["not_measurable", "not_applicable"]),
  reason: z.string().trim().min(3, "Indique el motivo").max(500),
});
export const measurementInputSchema = z.union([
  numericInputSchema,
  selectInputSchema,
  checklistInputSchema,
  multipointInputSchema,
  combinedInputSchema,
  notMeasuredInputSchema,
]);
export type MeasurementInput = z.infer<typeof measurementInputSchema>;

// ---------------------------------------------------------------------------
// Contexto y salida
// ---------------------------------------------------------------------------
export interface ExpectedPoint {
  code: string;
  name: string;
  required: boolean;
  /** Regla específica del punto (si la plantilla la define). */
  rule?: NumericRule;
}

export interface InstrumentContext {
  required: boolean;
  /** true si el procedimiento admite registrar "instrumento no requerido" y el técnico lo indicó */
  declaredNotRequired?: boolean;
  provided: boolean;
  /** null = sin datos de calibración */
  calibrationValid: boolean | null;
  status?: string;
  /** 'block' impide guardar; 'review' degrada a "Requiere revisión"; 'warn' solo avisa */
  policy: "block" | "review" | "warn";
}

export interface EvaluationContext {
  instrument?: InstrumentContext;
  expectedPoints?: ExpectedPoint[];
}

export interface ValueOutcome {
  pointCode?: string;
  pointName?: string;
  partCode?: string;
  kind: "numeric" | "select" | "check";
  rawInput?: string;
  rawUnit?: string;
  rawValue?: string;
  normalizedValue?: string;
  normalizedUnit?: string;
  optionValue?: string;
  checked?: boolean | null;
  required: boolean;
  result: Result;
  explanation: string;
  comment?: string;
}

export interface Evaluation {
  result: Result;
  reasons: string[];
  values: ValueOutcome[];
  /** Si no es null, la medición no debe guardarse (política de bloqueo). */
  blockedReason: string | null;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Utilidades de presentación de límites
// ---------------------------------------------------------------------------
export function describeNumericRule(r: NumericRule): string {
  const f = (v: string) => {
    const p = parseDecimal(v);
    return p.ok ? formatDecimal(p.value) : v;
  };
  if (r.min && r.max)
    return `${f(r.min.value)} ${r.min.inclusive ? "≤" : "<"} valor ${r.max.inclusive ? "≤" : "<"} ${f(r.max.value)} ${r.unit}`;
  if (r.min) return `valor ${r.min.inclusive ? "≥" : ">"} ${f(r.min.value)} ${r.unit}`;
  if (r.max) return `valor ${r.max.inclusive ? "≤" : "<"} ${f(r.max.value)} ${r.unit}`;
  return "sin límites";
}

export function describeRules(r: CriterionRules): string {
  switch (r.kind) {
    case "numeric":
      return describeNumericRule(r);
    case "select":
      return "Selección: " + r.options.map((o) => `${o.label} → ${RESULT_LABEL[o.outcome]}`).join("; ");
    case "checklist":
      return `Checklist de ${r.items.length} elementos: cualquier "No OK" es no conforme`;
    case "multipoint": {
      const agg =
        r.aggregation.mode === "all_pass"
          ? "todos los puntos obligatorios deben ser conformes"
          : r.aggregation.mode === "worst_case"
            ? "resultado global = peor punto"
            : r.aggregation.mode === "min_pass"
              ? `al menos ${r.aggregation.minPass} puntos conformes`
              : `media dentro de límites${r.aggregation.requireEachPoint ? " y cada punto conforme" : ""}`;
      return `Por punto: ${describeNumericRule(r.point)}. Global: ${agg}`;
    }
    case "combined":
      return r.parts.map((p) => `${p.label}: ${describeRules(p.rule)}`).join(" | ");
  }
}

// ---------------------------------------------------------------------------
// Evaluación
// ---------------------------------------------------------------------------
interface NumericEval {
  outcome: ValueOutcome;
  normalized?: Decimal;
}

function evalNumeric(rule: NumericRule, value: string | undefined, unit: string | undefined, required: boolean, label: string): NumericEval {
  const base: ValueOutcome = { kind: "numeric", rawInput: value, rawUnit: unit ?? rule.unit, required, result: "incomplete", explanation: "" };
  if (value === undefined || value.trim() === "") {
    return {
      outcome: {
        ...base,
        rawInput: undefined,
        result: required ? "incomplete" : "not_applicable",
        explanation: required ? `${label}: falta el valor (obligatorio)` : `${label}: sin valor (optativo)`,
      },
    };
  }
  const parsed = parseDecimal(value);
  if (!parsed.ok) {
    return { outcome: { ...base, result: "incomplete", explanation: `${label}: ${parsed.error}` } };
  }
  const inUnit = unit && unit.trim() ? unit.trim() : rule.unit;
  const allowed = [rule.unit, ...(rule.allowedUnits ?? [])].map((u) => findUnit(u)?.symbol);
  const inDef = findUnit(inUnit);
  if (!inDef || !allowed.includes(inDef.symbol)) {
    return { outcome: { ...base, result: "incomplete", explanation: `${label}: unidad "${inUnit}" no admitida por el criterio (${allowed.join(", ")})` } };
  }
  const conv = convert(parsed.value, inDef.symbol, rule.unit);
  if (!conv.ok) return { outcome: { ...base, result: "incomplete", explanation: `${label}: ${conv.error}` } };
  const v = conv.value;
  const failures: string[] = [];
  if (rule.min) {
    const lim = parseDecimal(rule.min.value);
    if (!lim.ok) return { outcome: { ...base, result: "review", explanation: `${label}: límite inferior mal configurado` } };
    const c = compare(v, lim.value);
    if (rule.min.inclusive ? c < 0 : c <= 0) failures.push(`inferior al límite ${rule.min.inclusive ? "≥" : ">"} ${formatDecimal(lim.value)} ${rule.unit}`);
  }
  if (rule.max) {
    const lim = parseDecimal(rule.max.value);
    if (!lim.ok) return { outcome: { ...base, result: "review", explanation: `${label}: límite superior mal configurado` } };
    const c = compare(v, lim.value);
    if (rule.max.inclusive ? c > 0 : c >= 0) failures.push(`superior al límite ${rule.max.inclusive ? "≤" : "<"} ${formatDecimal(lim.value)} ${rule.unit}`);
  }
  const shown = `${formatDecimal(v)} ${rule.unit}` + (inDef.symbol !== findUnit(rule.unit)?.symbol ? ` (introducido ${value.trim()} ${inDef.symbol})` : "");
  return {
    normalized: v,
    outcome: {
      ...base,
      rawUnit: inDef.symbol,
      rawValue: toPlainString(parsed.value),
      normalizedValue: toPlainString(v),
      normalizedUnit: findUnit(rule.unit)!.symbol,
      result: failures.length ? "fail" : "pass",
      explanation: failures.length
        ? `${label}: ${shown} ${failures.join(" y ")}`
        : `${label}: ${shown} cumple ${describeNumericRule(rule)}`,
    },
  };
}

function evalSelect(rule: SelectRule, option: string | undefined, label: string, required = true): ValueOutcome {
  if (!option) return { kind: "select", required, result: required ? "incomplete" : "not_applicable", explanation: `${label}: sin selección` };
  const o = rule.options.find((x) => x.value === option);
  if (!o) return { kind: "select", required, optionValue: option, result: "incomplete", explanation: `${label}: opción "${option}" no definida en el criterio` };
  return { kind: "select", required, optionValue: o.value, rawInput: o.label, result: o.outcome, explanation: `${label}: "${o.label}" → ${RESULT_LABEL[o.outcome]}` };
}

function evalChecklist(rule: ChecklistRule, items: Record<string, "ok" | "nok" | "na" | undefined>, prefix = ""): ValueOutcome[] {
  return rule.items.map((it) => {
    const v = items[it.code];
    const label = `${prefix}${it.label}`;
    const base = { kind: "check" as const, pointCode: it.code, pointName: it.label, required: it.required };
    if (v === "ok") return { ...base, checked: true, result: "pass" as Result, explanation: `${label}: OK` };
    if (v === "nok") return { ...base, checked: false, result: "fail" as Result, explanation: `${label}: NO OK` };
    if (v === "na") {
      if (!it.allowNA) return { ...base, checked: null, result: "incomplete" as Result, explanation: `${label}: "No aplica" no permitido para este elemento` };
      return { ...base, checked: null, result: "not_applicable" as Result, explanation: `${label}: no aplica` };
    }
    return { ...base, checked: null, result: (it.required ? "incomplete" : "not_applicable") as Result, explanation: `${label}: sin comprobar${it.required ? " (obligatorio)" : ""}` };
  });
}

function aggregateSimple(values: ValueOutcome[]): Result {
  const relevant = values.filter((v) => v.result !== "not_applicable").map((v) => v.result);
  if (relevant.length === 0) return "incomplete";
  return worst(relevant);
}

function evalMultipoint(rule: MultipointRule, input: z.infer<typeof multipointInputSchema>, expected: ExpectedPoint[] | undefined): { result: Result; reasons: string[]; values: ValueOutcome[] } {
  if (!expected || expected.length === 0) {
    return { result: "review", reasons: ["No hay plantilla de puntos definida para esta medición multipunto"], values: [] };
  }
  const reasons: string[] = [];
  const values: ValueOutcome[] = [];
  const normalized: { p: ExpectedPoint; v?: Decimal; r: Result }[] = [];
  for (const p of expected) {
    const pi = input.points[p.code];
    const ev = evalNumeric(p.rule ?? rule.point, pi?.value, pi?.unit, p.required, `Punto ${p.code} (${p.name})`);
    values.push({ ...ev.outcome, pointCode: p.code, pointName: p.name, comment: pi?.comment });
    normalized.push({ p, v: ev.normalized, r: ev.outcome.result });
  }
  const unknown = Object.keys(input.points).filter((k) => !expected.some((p) => p.code === k) && input.points[k]?.value);
  if (unknown.length) reasons.push(`Se ignoraron puntos no definidos en la plantilla: ${unknown.join(", ")}`);

  const missingRequired = normalized.filter((n) => n.p.required && n.r === "incomplete");
  if (missingRequired.length) {
    reasons.push(`Faltan o son inválidos ${missingRequired.length} punto(s) obligatorio(s): ${missingRequired.map((n) => n.p.code).join(", ")}`);
  }
  const present = normalized.filter((n) => n.r !== "not_applicable" && n.r !== "incomplete");
  const fails = present.filter((n) => n.r === "fail");
  const passes = present.filter((n) => n.r === "pass");
  const agg = rule.aggregation;
  let result: Result;

  switch (agg.mode) {
    case "all_pass":
    case "worst_case": {
      if (fails.length) {
        result = "fail";
        reasons.push(`${fails.length} punto(s) no conforme(s): ${fails.map((n) => n.p.code).join(", ")}`);
      } else if (missingRequired.length) {
        result = "incomplete";
      } else if (present.length === 0) {
        result = "incomplete";
        reasons.push("No se ha registrado ningún punto");
      } else {
        result = worst(present.map((n) => n.r));
        if (result === "pass") reasons.push(`Los ${passes.length} punto(s) medidos son conformes (${agg.mode === "all_pass" ? "todos deben cumplir" : "peor resultado"})`);
      }
      break;
    }
    case "min_pass": {
      const reviews = present.filter((n) => n.r === "review").length;
      if (passes.length >= agg.minPass) {
        result = missingRequired.length ? "incomplete" : "pass";
        reasons.push(`${passes.length} punto(s) conformes; mínimo requerido ${agg.minPass}`);
      } else if (passes.length + missingRequired.length + reviews >= agg.minPass) {
        // Aún podría cumplirse si se completan/revisan los puntos pendientes
        result = missingRequired.length ? "incomplete" : "review";
        reasons.push(`${passes.length} punto(s) conformes de ${agg.minPass} requeridos; hay puntos pendientes`);
      } else {
        result = "fail";
        reasons.push(`Solo ${passes.length} punto(s) conformes; se requieren ${agg.minPass}`);
      }
      break;
    }
    case "mean": {
      if (missingRequired.length || present.length === 0) {
        result = "incomplete";
        if (present.length === 0) reasons.push("No se ha registrado ningún punto");
        break;
      }
      let sum: Decimal = { coef: BigInt(0), scale: 0 };
      for (const n of present) if (n.v) sum = add(sum, n.v);
      const mean = divideInt(sum, present.length);
      const meanEval = evalNumeric(rule.point, toPlainString(mean), rule.point.unit, true, "Media");
      reasons.push(`Media de ${present.length} punto(s) = ${formatDecimal(mean)} ${rule.point.unit} (regla autorizada: ${agg.justification})`);
      result = meanEval.outcome.result;
      if (result !== "pass") reasons.push(meanEval.outcome.explanation);
      if (agg.requireEachPoint && fails.length) {
        result = "fail";
        reasons.push(`Además se exige que cada punto cumpla: ${fails.length} punto(s) no conforme(s)`);
      }
      break;
    }
  }
  return { result, reasons, values };
}

/**
 * Evalúa una medición. `rules` = null significa "sin criterio vigente".
 */
export function evaluate(rules: CriterionRules | null, input: MeasurementInput, ctx: EvaluationContext = {}): Evaluation {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let values: ValueOutcome[] = [];
  let result: Result;

  if (input.kind === "not_measurable" || input.kind === "not_applicable") {
    return {
      result: input.kind,
      reasons: [`${RESULT_LABEL[input.kind]}: ${input.reason}`],
      values: [],
      blockedReason: null,
      warnings,
    };
  }

  if (!rules) {
    return {
      result: "review",
      reasons: ["No hay una versión de criterio vigente: el resultado no puede clasificarse automáticamente"],
      values: [],
      blockedReason: null,
      warnings: ["Sin criterio vigente"],
    };
  }

  if (rules.kind !== input.kind) {
    return {
      result: "review",
      reasons: [`El tipo de registro (${input.kind}) no coincide con el criterio (${rules.kind})`],
      values: [],
      blockedReason: null,
      warnings,
    };
  }

  switch (rules.kind) {
    case "numeric": {
      const i = input as z.infer<typeof numericInputSchema>;
      const ev = evalNumeric(rules, i.value, i.unit, true, "Valor");
      values = [ev.outcome];
      result = ev.outcome.result;
      reasons.push(ev.outcome.explanation);
      break;
    }
    case "select": {
      const i = input as z.infer<typeof selectInputSchema>;
      const v = evalSelect(rules, i.option, "Selección");
      values = [v];
      result = v.result;
      reasons.push(v.explanation);
      break;
    }
    case "checklist": {
      const i = input as z.infer<typeof checklistInputSchema>;
      values = evalChecklist(rules, i.items);
      result = aggregateSimple(values);
      const nok = values.filter((v) => v.result === "fail");
      const missing = values.filter((v) => v.result === "incomplete");
      if (nok.length) reasons.push(`${nok.length} elemento(s) NO OK: ${nok.map((v) => v.pointName).join(", ")}`);
      if (missing.length) reasons.push(`${missing.length} elemento(s) sin completar correctamente`);
      if (result === "pass") reasons.push("Todos los elementos comprobados están OK");
      break;
    }
    case "multipoint": {
      const r = evalMultipoint(rules, input as z.infer<typeof multipointInputSchema>, ctx.expectedPoints);
      values = r.values;
      result = r.result;
      reasons.push(...r.reasons);
      break;
    }
    case "combined": {
      const i = input as z.infer<typeof combinedInputSchema>;
      const partResults: Result[] = [];
      for (const part of rules.parts) {
        const pi = i.parts[part.code];
        let pv: ValueOutcome[];
        if (part.rule.kind === "numeric") {
          const ni = pi && pi.kind === "numeric" ? pi : undefined;
          pv = [evalNumeric(part.rule, ni?.value, ni?.unit, true, part.label).outcome];
        } else if (part.rule.kind === "select") {
          const si = pi && pi.kind === "select" ? pi : undefined;
          pv = [evalSelect(part.rule, si?.option, part.label)];
        } else {
          const ci = pi && pi.kind === "checklist" ? pi : { items: {} };
          pv = evalChecklist(part.rule, ci.items, `${part.label} · `);
        }
        pv = pv.map((v) => ({ ...v, partCode: part.code }));
        values.push(...pv);
        const pr = aggregateSimple(pv);
        partResults.push(pr);
        reasons.push(`${part.label}: ${RESULT_LABEL[pr]}`);
      }
      result = worst(partResults);
      break;
    }
  }

  // Instrumento
  const inst = ctx.instrument;
  let blockedReason: string | null = null;
  if (inst && inst.required && !inst.declaredNotRequired) {
    let problem: string | null = null;
    if (!inst.provided) problem = "No se ha indicado el instrumento requerido";
    else if (inst.calibrationValid === null) problem = "El instrumento no tiene calibración registrada";
    else if (!inst.calibrationValid) problem = "El instrumento está fuera de calibración";
    else if (inst.status && inst.status !== "active") problem = `El instrumento no está operativo (estado: ${inst.status})`;
    if (problem) {
      if (inst.policy === "block") {
        blockedReason = `${problem}. La política de la organización impide registrar la medición.`;
      } else if (inst.policy === "review") {
        warnings.push(problem);
        if (result === "pass") {
          result = "review";
          reasons.push(`${problem}: el resultado conforme queda pendiente de revisión`);
        } else {
          reasons.push(problem);
        }
      } else {
        warnings.push(problem);
        reasons.push(`Aviso: ${problem}`);
      }
    }
  }

  return { result, reasons, values, blockedReason, warnings };
}

/** Valida reglas guardadas (p. ej. al cargar una versión de criterio). */
export function parseRules(json: unknown): CriterionRules | null {
  const r = criterionRulesSchema.safeParse(json);
  return r.success ? r.data : null;
}
