const TZ = "Europe/Madrid";

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? (d.length === 10 ? new Date(d + "T12:00:00Z") : new Date(d)) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

export function fmtRelative(d: Date | string | null | undefined, now = new Date()): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = (date.getTime() - now.getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 45) return rtf.format(Math.round(diff / 86400), "day");
  return rtf.format(Math.round(diff / (86400 * 30)), "month");
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function fmtNumber(n: number | string | null | undefined, digits = 0): string {
  if (n === null || n === undefined || n === "") return "—";
  return Number(n).toLocaleString("es-ES", { maximumFractionDigits: digits });
}

export function pct(part: number, total: number): string {
  if (!total) return "—";
  return `${Math.round((part / total) * 1000) / 10}%`;
}

export const LOCATION_KIND_LABEL: Record<string, string> = {
  company: "Empresa",
  plant: "Planta",
  building: "Edificio",
  floor: "Piso",
  area: "Área",
  zone: "Zona",
  line: "Línea",
  spot: "Ubicación",
  other: "Otro",
};

export const CAMPAIGN_STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  planned: "Planificada",
  in_progress: "En curso",
  in_review: "En revisión",
  completed: "Completada",
  closed: "Cerrada",
  cancelled: "Cancelada",
};

export const INSTRUMENT_STATUS_LABEL: Record<string, string> = {
  active: "Operativo",
  in_calibration: "En calibración",
  out_of_service: "Fuera de servicio",
  retired: "Retirado",
};

export const RECORD_METHOD_LABEL: Record<string, string> = {
  numeric: "Numérico",
  select: "Selección",
  multipoint: "Multipunto",
  checklist: "Checklist",
  combined: "Combinado",
};

export const CAMPAIGN_STATUS_TONE: Record<string, "ok" | "bad" | "warn" | "neutral" | "info" | "primary"> = {
  draft: "neutral",
  planned: "info",
  in_progress: "primary",
  in_review: "warn",
  completed: "ok",
  closed: "neutral",
  cancelled: "neutral",
};
