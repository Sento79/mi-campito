/**
 * Periodicidad de inspección. Replica exactamente la aritmética de PostgreSQL
 * (app_period_interval en 0003): al sumar meses se recorta al último día del
 * mes destino (31-ene + 1 mes = 28-feb). Se calcula en UTC.
 */
export const PERIOD_UNITS = ["day", "week", "month", "quarter", "semester", "year"] as const;
export type PeriodUnit = (typeof PERIOD_UNITS)[number];

export const PERIOD_LABEL: Record<PeriodUnit, [string, string]> = {
  day: ["día", "días"],
  week: ["semana", "semanas"],
  month: ["mes", "meses"],
  quarter: ["trimestre", "trimestres"],
  semester: ["semestre", "semestres"],
  year: ["año", "años"],
};

export const PERIOD_PRESETS: { key: string; label: string; unit: PeriodUnit; count: number }[] = [
  { key: "weekly", label: "Semanal", unit: "week", count: 1 },
  { key: "monthly", label: "Mensual", unit: "month", count: 1 },
  { key: "quarterly", label: "Trimestral", unit: "quarter", count: 1 },
  { key: "semiannual", label: "Semestral", unit: "semester", count: 1 },
  { key: "annual", label: "Anual", unit: "year", count: 1 },
];

export function describePeriod(unit: PeriodUnit | null | undefined, count: number | null | undefined): string {
  if (!unit || !count) return "Sin periodicidad";
  const preset = PERIOD_PRESETS.find((p) => p.unit === unit && p.count === count);
  if (preset) return preset.label;
  const [s, p] = PERIOD_LABEL[unit];
  return `Cada ${count} ${count === 1 ? s : p}`;
}

function daysInMonthUTC(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

function addMonthsUTC(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const ty = y + Math.floor(m / 12);
  const tm = ((m % 12) + 12) % 12;
  const day = Math.min(d.getUTCDate(), daysInMonthUTC(ty, tm));
  return new Date(Date.UTC(ty, tm, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
}

export function addPeriod(from: Date, unit: PeriodUnit, count: number): Date {
  if (!Number.isInteger(count) || count <= 0) throw new Error("La periodicidad debe ser un entero positivo");
  switch (unit) {
    case "day":
      return new Date(from.getTime() + count * 86_400_000);
    case "week":
      return new Date(from.getTime() + count * 7 * 86_400_000);
    case "month":
      return addMonthsUTC(from, count);
    case "quarter":
      return addMonthsUTC(from, 3 * count);
    case "semester":
      return addMonthsUTC(from, 6 * count);
    case "year":
      return addMonthsUTC(from, 12 * count);
  }
}

export type DueStatus = "overdue" | "due_soon" | "ok" | "never_measured" | "unscheduled";

export const DUE_LABEL: Record<DueStatus, string> = {
  overdue: "Vencida",
  due_soon: "Próxima",
  ok: "Al día",
  never_measured: "Sin medir",
  unscheduled: "Sin periodicidad",
};

export function dueStatus(nextDue: Date | null, lastMeasured: Date | null, now: Date, leadDays: number, hasPeriod = true): DueStatus {
  if (!hasPeriod) return "unscheduled";
  if (!lastMeasured || !nextDue) return "never_measured";
  if (nextDue.getTime() <= now.getTime()) return "overdue";
  if (nextDue.getTime() - now.getTime() <= leadDays * 86_400_000) return "due_soon";
  return "ok";
}
