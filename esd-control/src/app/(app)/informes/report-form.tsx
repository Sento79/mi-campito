"use client";
import * as React from "react";
import { FileDown } from "lucide-react";
import { Button, Card, CardHeader, Field, Input, Select } from "@/components/ui/core";

type Opt = { id: string; label: string };
const TYPES = [
  { k: "summary", l: "Resumen global", h: "KPI, estado por categoría y ubicación, no conformes del periodo, criterios aplicados y firmas" },
  { k: "measurements", l: "Mediciones / historial", h: "Detalle de mediciones con valores (incluido multipunto), criterio y versión, instrumento y técnico" },
  { k: "overdue", l: "Vencidos y pendientes", h: "Activos con medición vencida, próxima o nunca medidos" },
  { k: "instruments", l: "Instrumentos y calibración", h: "Estado de calibración, certificados y uso" },
  { k: "nonconformities", l: "No conformidades", h: "Detalle de cada NC: contención, causa, acciones y verificación" },
];

export function ReportForm({ locations, categories, campaigns, canExport }: { locations: Opt[]; categories: Opt[]; campaigns: Opt[]; canExport: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  const [v, setV] = React.useState({ type: "summary", from: new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10), to: today, location: "", category: "", campaign: "", result: "" });
  const qs = new URLSearchParams(Object.entries(v).filter(([k, x]) => x && k !== "type")).toString();
  const t = TYPES.find((x) => x.k === v.type)!;
  return (
    <Card>
      <CardHeader title="Generar informe" />
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Tipo de informe">
          {TYPES.map((x) => (
            <label key={x.k} className={`cursor-pointer rounded-lg border p-3 text-sm ${v.type === x.k ? "border-primary bg-primary-soft" : "border-line hover:bg-surface-2"}`}>
              <input type="radio" className="sr-only" checked={v.type === x.k} onChange={() => setV({ ...v, type: x.k })} />
              <span className="font-medium">{x.l}</span>
              <span className="mt-1 block text-xs text-muted">{x.h}</span>
            </label>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Desde" htmlFor="r-from"><Input id="r-from" type="date" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} /></Field>
          <Field label="Hasta" htmlFor="r-to"><Input id="r-to" type="date" value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} /></Field>
          <Field label="Planta / área / zona" htmlFor="r-loc"><Select id="r-loc" value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })}><option value="">Todas</option>{locations.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></Field>
          <Field label="Categoría" htmlFor="r-cat"><Select id="r-cat" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}><option value="">Todas</option>{categories.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></Field>
          <Field label="Campaña" htmlFor="r-camp"><Select id="r-camp" value={v.campaign} onChange={(e) => setV({ ...v, campaign: e.target.value })}><option value="">Todas</option>{campaigns.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></Field>
          <Field label="Resultado" htmlFor="r-res"><Select id="r-res" value={v.result} onChange={(e) => setV({ ...v, result: e.target.value })}><option value="">Todos</option><option value="pass">Conformes</option><option value="fail">No conformes</option><option value="review">Requiere revisión</option><option value="incomplete">Incompletos</option></Select></Field>
        </div>
        <p className="text-xs text-muted">{t.h}. Los filtros que no apliquen al tipo se ignoran.</p>
        <div className="flex flex-wrap justify-end gap-2">
          {canExport && v.type === "measurements" ? <><a className="inline-flex h-10 items-center rounded-md border border-line-strong px-4 text-sm font-medium hover:bg-surface-2" href={`/api/export/measurements?format=xlsx&${qs}`}>XLSX</a><a className="inline-flex h-10 items-center rounded-md border border-line-strong px-4 text-sm font-medium hover:bg-surface-2" href={`/api/export/measurements?format=csv&${qs}`}>CSV</a></> : null}
          <a href={`/api/reports/${v.type}?${qs}`} target="_blank" rel="noopener"><Button icon={FileDown}>Generar PDF</Button></a>
        </div>
      </div>
    </Card>
  );
}
