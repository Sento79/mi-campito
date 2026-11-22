"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save, FlaskConical, CheckCircle2 } from "lucide-react";
import { Alert, Button, Card, CardHeader, Checkbox, Field, Input, ResultBadge, Select, Textarea } from "@/components/ui/core";
import { useAction } from "@/components/ui/client";
import { criterionRulesSchema, describeRules, evaluate, type CriterionRules, type NumericRule } from "@/lib/domain/criteria";
import { UNITS, compatibleUnits } from "@/lib/domain/units";
import { nextFreeId } from "@/lib/domain/ids";
import { activateVersionAction, createVersionAction, discardDraftAction } from "../actions";

const defaults: Record<CriterionRules["kind"], CriterionRules> = {
  numeric: { kind: "numeric", unit: "Ω", max: { value: "", inclusive: false } } as NumericRule,
  select: { kind: "select", options: [{ value: "ok", label: "Correcto", outcome: "pass" }, { value: "ko", label: "Defectuoso", outcome: "fail" }] },
  checklist: { kind: "checklist", items: [{ code: "c1", label: "Elemento a comprobar", required: true, allowNA: false }] },
  multipoint: { kind: "multipoint", point: { kind: "numeric", unit: "Ω", max: { value: "", inclusive: false } } as NumericRule, aggregation: { mode: "all_pass" } },
  combined: { kind: "combined", parts: [{ code: "p1", label: "Parte 1", rule: { kind: "numeric", unit: "Ω", max: { value: "", inclusive: false } } as NumericRule }] },
};

function NumericEditor({ r, onChange }: { r: NumericRule; onChange: (r: NumericRule) => void }) {
  const bound = (k: "min" | "max", label: string) => (
    <div className="rounded-md border border-line p-3">
      <Checkbox label={label} checked={!!r[k]} onChange={(e) => onChange({ ...r, [k]: e.target.checked ? { value: "", inclusive: true } : undefined })} />
      {r[k] ? (
        <div className="mt-2 flex items-center gap-2">
          <Input aria-label={`${label}: valor`} className="min-w-0 font-mono" placeholder="p. ej. 1e6" value={r[k]!.value} onChange={(e) => onChange({ ...r, [k]: { ...r[k]!, value: e.target.value } })} />
          <Select aria-label={`${label}: tipo`} className="w-40 shrink-0" value={r[k]!.inclusive ? "inc" : "exc"} onChange={(e) => onChange({ ...r, [k]: { ...r[k]!, inclusive: e.target.value === "inc" } })}>
            <option value="inc">{k === "min" ? "≥ (inclusivo)" : "≤ (inclusivo)"}</option>
            <option value="exc">{k === "min" ? "> (exclusivo)" : "< (exclusivo)"}</option>
          </Select>
        </div>
      ) : null}
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Unidad del criterio" htmlFor="ru-unit"><Select id="ru-unit" value={r.unit} onChange={(e) => onChange({ ...r, unit: e.target.value, allowedUnits: [] })}>{UNITS.map((u) => <option key={u.symbol} value={u.symbol}>{u.symbol} · {u.label}</option>)}</Select></Field>
        <fieldset><legend className="mb-1.5 text-sm font-medium">Unidades de entrada admitidas (conversión exacta)</legend>
          <div className="flex flex-wrap gap-3">{compatibleUnits(r.unit).filter((u) => u.symbol !== r.unit).map((u) => <Checkbox key={u.symbol} label={u.symbol} checked={(r.allowedUnits ?? []).includes(u.symbol)} onChange={(e) => onChange({ ...r, allowedUnits: e.target.checked ? [...(r.allowedUnits ?? []), u.symbol] : (r.allowedUnits ?? []).filter((x) => x !== u.symbol) })} />)}</div>
        </fieldset>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{bound("min", "Límite inferior")}{bound("max", "Límite superior")}</div>
    </div>
  );
}

export function RulesEditor({ criterionId, procedures, initial }: { criterionId: string; procedures: { id: string; label: string }[]; initial: CriterionRules | null }) {
  const router = useRouter();
  const [rules, setRules] = React.useState<CriterionRules>(initial ?? defaults.numeric);
  const [json, setJson] = React.useState<string | null>(null);
  const [meta, setMeta] = React.useState({ procedureId: "", normReference: "", changeReason: "" });
  const [test, setTest] = React.useState({ value: "", unit: "" });
  const save = useAction(createVersionAction);
  const parsed = criterionRulesSchema.safeParse(rules);
  const sim = parsed.success && parsed.data.kind === "numeric" && test.value ? evaluate(parsed.data, { kind: "numeric", value: test.value, unit: test.unit || undefined }) : null;
  return (
    <Card>
      <CardHeader title="Nueva versión" description={initial ? "Parte de la versión vigente. Se guarda como borrador hasta su publicación." : "Defina los límites y publique la versión 1."} />
      <div className="space-y-4 p-5">
        <Field label="Tipo de regla" htmlFor="ru-kind">
          <Select id="ru-kind" value={rules.kind} onChange={(e) => setRules(defaults[e.target.value as CriterionRules["kind"]])}>
            <option value="numeric">Numérica (límites)</option><option value="select">Selección</option><option value="checklist">Checklist</option><option value="multipoint">Multipunto</option><option value="combined">Combinada (JSON)</option>
          </Select>
        </Field>
        {json === null ? (
          <>
            {rules.kind === "numeric" ? <NumericEditor r={rules} onChange={setRules} /> : null}
            {rules.kind === "multipoint" ? (
              <div className="space-y-3">
                <p className="text-sm font-medium">Criterio por punto</p>
                <NumericEditor r={rules.point} onChange={(p) => setRules({ ...rules, point: p })} />
                <Field label="Evaluación global" htmlFor="ru-agg" hint="No se asume que la media sea válida: selecciónela solo si el procedimiento lo autoriza">
                  <Select id="ru-agg" value={rules.aggregation.mode} onChange={(e) => {
                    const m = e.target.value;
                    setRules({ ...rules, aggregation: m === "min_pass" ? { mode: "min_pass", minPass: 1 } : m === "mean" ? { mode: "mean", requireEachPoint: true, justification: "" } : { mode: m as "all_pass" | "worst_case" } });
                  }}>
                    <option value="all_pass">Todos los puntos obligatorios conformes</option><option value="worst_case">Peor resultado</option><option value="min_pass">Mínimo de N puntos conformes</option><option value="mean">Media (regla específica autorizada)</option>
                  </Select>
                </Field>
                {rules.aggregation.mode === "min_pass" ? <Field label="N mínimo" htmlFor="ru-n"><Input id="ru-n" type="number" min={1} value={rules.aggregation.minPass} onChange={(e) => setRules({ ...rules, aggregation: { mode: "min_pass", minPass: Math.max(1, Number(e.target.value) || 1) } })} /></Field> : null}
                {rules.aggregation.mode === "mean" ? (
                  <>
                    <Checkbox label="Además, cada punto debe ser conforme" checked={rules.aggregation.requireEachPoint} onChange={(e) => setRules({ ...rules, aggregation: { ...(rules.aggregation as { mode: "mean"; requireEachPoint: boolean; justification: string }), requireEachPoint: e.target.checked } })} />
                    <Field label="Justificación (procedimiento y apartado)" htmlFor="ru-just"><Input id="ru-just" value={rules.aggregation.justification} onChange={(e) => setRules({ ...rules, aggregation: { ...(rules.aggregation as { mode: "mean"; requireEachPoint: boolean; justification: string }), justification: e.target.value } })} /></Field>
                  </>
                ) : null}
              </div>
            ) : null}
            {rules.kind === "select" ? (
              <div className="space-y-2">
                {rules.options.map((o, i) => (
                  <div key={i} className="flex flex-wrap gap-2">
                    <Input aria-label="Valor" className="w-28 font-mono" value={o.value} onChange={(e) => setRules({ ...rules, options: rules.options.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) })} />
                    <Input aria-label="Texto" className="min-w-40 flex-1" value={o.label} onChange={(e) => setRules({ ...rules, options: rules.options.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
                    <Select aria-label="Resultado" className="w-44" value={o.outcome} onChange={(e) => setRules({ ...rules, options: rules.options.map((x, k) => (k === i ? { ...x, outcome: e.target.value as typeof o.outcome } : x)) })}><option value="pass">Conforme</option><option value="fail">No conforme</option><option value="review">Requiere revisión</option><option value="not_applicable">No aplica</option></Select>
                    <Button variant="ghost" icon={Trash2} aria-label="Quitar" onClick={() => setRules({ ...rules, options: rules.options.filter((_, k) => k !== i) })} />
                  </div>
                ))}
                <Button size="sm" variant="outline" icon={Plus} onClick={() => setRules({ ...rules, options: [...rules.options, { value: nextFreeId("op", rules.options.map((o) => o.value)), label: "", outcome: "pass" }] })}>Añadir opción</Button>
              </div>
            ) : null}
            {rules.kind === "checklist" ? (
              <div className="space-y-2">
                {rules.items.map((o, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Input aria-label="Código" className="w-20 font-mono" value={o.code} onChange={(e) => setRules({ ...rules, items: rules.items.map((x, k) => (k === i ? { ...x, code: e.target.value } : x)) })} />
                    <Input aria-label="Texto" className="min-w-48 flex-1" value={o.label} onChange={(e) => setRules({ ...rules, items: rules.items.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
                    <Checkbox label="Obligatorio" checked={o.required} onChange={(e) => setRules({ ...rules, items: rules.items.map((x, k) => (k === i ? { ...x, required: e.target.checked } : x)) })} />
                    <Checkbox label="Admite N/A" checked={o.allowNA} onChange={(e) => setRules({ ...rules, items: rules.items.map((x, k) => (k === i ? { ...x, allowNA: e.target.checked } : x)) })} />
                    <Button variant="ghost" icon={Trash2} aria-label="Quitar" onClick={() => setRules({ ...rules, items: rules.items.filter((_, k) => k !== i) })} />
                  </div>
                ))}
                <Button size="sm" variant="outline" icon={Plus} onClick={() => setRules({ ...rules, items: [...rules.items, { code: nextFreeId("c", rules.items.map((o) => o.code)), label: "", required: true, allowNA: false }] })}>Añadir elemento</Button>
              </div>
            ) : null}
            {rules.kind === "combined" ? <p className="text-sm text-muted">Las reglas combinadas se editan en JSON.</p> : null}
            <Button size="sm" variant="ghost" onClick={() => setJson(JSON.stringify(rules, null, 2))}>Editar como JSON (avanzado)</Button>
          </>
        ) : (
          <div className="space-y-2">
            <Textarea aria-label="Reglas en JSON" rows={14} className="font-mono text-xs" value={json} onChange={(e) => setJson(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => {
                let parsedJson: unknown;
                try { parsedJson = JSON.parse(json); } catch { alert("JSON no válido"); return; }
                const v = criterionRulesSchema.safeParse(parsedJson);
                if (!v.success) { alert("Reglas no válidas: " + v.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")); return; }
                setRules(v.data); setJson(null);
              }}>Aplicar JSON</Button>
              <Button size="sm" variant="ghost" onClick={() => setJson(null)}>Volver al formulario</Button>
            </div>
          </div>
        )}
        {parsed.success ? <Alert tone="ok" icon={CheckCircle2} title="Regla válida">{describeRules(parsed.data)}</Alert> : <Alert tone="bad" title="Regla incompleta o no válida">{parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join(" · ")}</Alert>}
        {parsed.success && parsed.data.kind === "numeric" ? (
          <div className="rounded-lg border border-dashed border-line-strong p-3">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium"><FlaskConical className="size-4" />Simulador</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input aria-label="Valor de prueba" className="w-40 font-mono" placeholder="Valor" value={test.value} onChange={(e) => setTest({ ...test, value: e.target.value })} />
              <Select aria-label="Unidad de prueba" className="w-24" value={test.unit} onChange={(e) => setTest({ ...test, unit: e.target.value })}>{[parsed.data.unit, ...(parsed.data.allowedUnits ?? [])].map((u) => <option key={u}>{u}</option>)}</Select>
              {sim ? <><ResultBadge result={sim.result} /><span className="text-xs text-muted">{sim.reasons[0]}</span></> : null}
            </div>
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Procedimiento" htmlFor="ru-proc"><Select id="ru-proc" value={meta.procedureId} onChange={(e) => setMeta({ ...meta, procedureId: e.target.value })}><option value="">—</option>{procedures.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select></Field>
          <Field label="Referencia normativa / interna" htmlFor="ru-norm" hint="Norma y revisión aplicables según su sistema de calidad"><Input id="ru-norm" value={meta.normReference} onChange={(e) => setMeta({ ...meta, normReference: e.target.value })} /></Field>
        </div>
        <Field label="Motivo del cambio" htmlFor="ru-reason" required><Textarea id="ru-reason" rows={2} value={meta.changeReason} onChange={(e) => setMeta({ ...meta, changeReason: e.target.value })} /></Field>
        <div className="flex justify-end">
          <Button icon={Save} disabled={!parsed.success || meta.changeReason.trim().length < 3} loading={save.pending} onClick={async () => {
            const r = await save.run({ criterionId, rules, procedureId: meta.procedureId || null, normReference: meta.normReference || null, changeReason: meta.changeReason }, { success: "Borrador creado. Revíselo y publíquelo." });
            if (r?.ok) router.refresh();
          }}>Guardar como borrador</Button>
        </div>
      </div>
    </Card>
  );
}

export function VersionActions({ versionId }: { versionId: string }) {
  const router = useRouter();
  const act = useAction(activateVersionAction);
  const discard = useAction(discardDraftAction);
  return (
    <div className="flex gap-2 pt-1">
      <Button size="sm" loading={act.pending} onClick={async () => { if (!confirm("¿Publicar esta versión? Se aplicará a las mediciones nuevas y sustituirá a la vigente.")) return; const r = await act.run({ versionId }, { success: "Versión publicada" }); if (r?.ok) router.refresh(); }}>Publicar</Button>
      <Button size="sm" variant="ghost" loading={discard.pending} onClick={async () => { const r = await discard.run({ versionId }, { success: "Borrador descartado" }); if (r?.ok) router.refresh(); }}>Descartar</Button>
    </div>
  );
}
