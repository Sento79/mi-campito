export const RESULTS = ["pass", "fail", "pending", "incomplete", "not_measurable", "not_applicable", "review"] as const;
export type Result = (typeof RESULTS)[number];

export const RESULT_LABEL: Record<Result, string> = {
  pass: "Conforme",
  fail: "No conforme",
  pending: "Pendiente",
  incomplete: "Incompleto",
  not_measurable: "No medible",
  not_applicable: "No aplica",
  review: "Requiere revisión",
};

/** Tono visual: verde, rojo, naranja, gris. */
export const RESULT_TONE: Record<Result, "ok" | "bad" | "warn" | "neutral"> = {
  pass: "ok",
  fail: "bad",
  pending: "neutral",
  incomplete: "warn",
  not_measurable: "neutral",
  not_applicable: "neutral",
  review: "warn",
};

/** Gravedad para agregación "peor resultado". */
export const RESULT_SEVERITY: Record<Result, number> = {
  pass: 1,
  not_applicable: 0,
  pending: 2,
  not_measurable: 3,
  incomplete: 3,
  review: 4,
  fail: 5,
};

export function worst(results: Result[]): Result {
  let w: Result = "pass";
  for (const r of results) if (RESULT_SEVERITY[r] > RESULT_SEVERITY[w]) w = r;
  return w;
}

export function isResult(v: unknown): v is Result {
  return typeof v === "string" && (RESULTS as readonly string[]).includes(v);
}
