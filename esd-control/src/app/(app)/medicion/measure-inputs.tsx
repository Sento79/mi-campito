"use client";
import * as React from "react";
import { Check, X, Minus } from "lucide-react";
import { cn, Input, Select } from "@/components/ui/core";
import type { ChecklistRule, CriterionRules, MeasurementInput, NumericRule, SelectRule } from "@/lib/domain/criteria";
import { describeNumericRule } from "@/lib/domain/criteria";
import { findUnit } from "@/lib/domain/units";
import { RESULT_LABEL } from "@/lib/domain/results";

export interface FormState {
  numeric: { value: string; unit: string };
  option: string;
  checklist: Record<string, "ok" | "nok" | "na" | undefined>;
  points: Record<string, { value: string; unit?: string; comment?: string }>;
  parts: Record<string, { value?: string; unit?: string; option?: string; checklist?: Record<string, "ok" | "nok" | "na" | undefined> }>;
}

export const emptyForm = (): FormState => ({ numeric: { value: "", unit: "" }, option: "", checklist: {}, points: {}, parts: {} });

export function buildInput(rules: CriterionRules | null, method: string | null, f: FormState): MeasurementInput {
  const kind = rules?.kind ?? (method as MeasurementInput["kind"]) ?? "numeric";
  switch (kind) {
    case "select":
      return { kind: "select", option: f.option };
    case "checklist":
      return { kind: "checklist", items: f.checklist };
    case "multipoint":
      return { kind: "multipoint", points: Object.fromEntries(Object.entries(f.points).map(([k, v]) => [k, { value: v.value || undefined, unit: v.unit || undefined, comment: v.comment || undefined }])) };
    case "combined": {
      const parts: Record<string, Extract<MeasurementInput, { kind: "numeric" | "select" | "checklist" }>> = {};
      if (rules?.kind === "combined") {
        for (const p of rules.parts) {
          const s = f.parts[p.code] ?? {};
          if (p.rule.kind === "numeric") parts[p.code] = { kind: "numeric", value: s.value ?? "", unit: s.unit || undefined };
          else if (p.rule.kind === "select") parts[p.code] = { kind: "select", option: s.option ?? "" };
          else parts[p.code] = { kind: "checklist", items: s.checklist ?? {} };
        }
      }
      return { kind: "combined", parts };
    }
    default:
      return { kind: "numeric", value: f.numeric.value, unit: f.numeric.unit || undefined };
  }
}

function unitChoices(rule: NumericRule) {
  return [rule.unit, ...(rule.allowedUnits ?? [])].map((u) => findUnit(u)?.symbol ?? u).filter((v, i, a) => a.indexOf(v) === i);
}

export function NumericInput({ rule, value, unit, onChange, autoFocus, id, label = "Valor medido", onEnter }: { rule: NumericRule | null; value: string; unit: string; onChange: (v: { value: string; unit: string }) => void; autoFocus?: boolean; id: string; label?: string; onEnter?: () => void }) {
  const units = rule ? unitChoices(rule) : [];
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">{label}</label>
      <div className="flex gap-2">
        <input
          id={id}
          value={value}
          autoFocus={autoFocus}
          inputMode="decimal"
          autoComplete="off"
          placeholder="p. ej. 2,5  ·  1.2e6  ·  3x10^7"
          onChange={(e) => onChange({ value: e.target.value, unit })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.ctrlKey && onEnter) {
              e.preventDefault();
              onEnter();
            }
          }}
          className="h-14 min-w-0 flex-1 rounded-lg border-2 border-line-strong bg-surface px-4 font-mono text-2xl tabular focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15"
        />
        {units.length ? (
          <select aria-label="Unidad" value={unit || units[0]} onChange={(e) => onChange({ value, unit: e.target.value })} className="h-14 w-24 rounded-lg border-2 border-line-strong bg-surface px-2 text-lg focus:border-primary focus:outline-none">
            {units.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        ) : null}
      </div>
      {rule ? <p className="mt-1 text-xs text-muted">Criterio: {describeNumericRule(rule)}</p> : null}
    </div>
  );
}

export function SelectInput({ rule, value, onChange }: { rule: SelectRule; value: string; onChange: (v: string) => void }) {
  const tone = { pass: "border-ok bg-ok-soft text-ok", fail: "border-bad bg-bad-soft text-bad", review: "border-warn bg-warn-soft text-warn", not_applicable: "border-neutral bg-neutral-soft text-neutral" };
  return (
    <div role="radiogroup" aria-label="Seleccione el estado observado" className="grid gap-2 sm:grid-cols-2">
      {rule.options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("flex min-h-14 items-center justify-between gap-3 rounded-lg border-2 px-4 py-3 text-left text-sm font-medium transition-colors", value === o.value ? tone[o.outcome] : "border-line hover:border-line-strong")}
        >
          <span><kbd className="mr-2 rounded border border-line px-1 text-[10px] text-faint">{i + 1}</kbd>{o.label}</span>
          <span className="text-xs opacity-80">{RESULT_LABEL[o.outcome]}</span>
        </button>
      ))}
    </div>
  );
}

export function ChecklistInput({ rule, value, onChange }: { rule: ChecklistRule; value: Record<string, "ok" | "nok" | "na" | undefined>; onChange: (v: Record<string, "ok" | "nok" | "na" | undefined>) => void }) {
  return (
    <ul className="divide-y divide-line rounded-lg border border-line">
      {rule.items.map((it) => {
        const v = value[it.code];
        const btn = (k: "ok" | "nok" | "na", label: string, Icon: typeof Check, cls: string) => (
          <button type="button" aria-pressed={v === k} onClick={() => onChange({ ...value, [it.code]: v === k ? undefined : k })} className={cn("flex h-10 min-w-16 items-center justify-center gap-1 rounded-md border px-2 text-xs font-semibold", v === k ? cls : "border-line text-muted hover:bg-surface-2")}>
            <Icon className="size-4" aria-hidden />{label}
          </button>
        );
        return (
          <li key={it.code} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <span className="min-w-0 flex-1 text-sm">{it.label}{it.required ? <span className="ml-1 text-bad" aria-label="obligatorio">*</span> : null}</span>
            <div className="flex gap-1.5">
              {btn("ok", "OK", Check, "border-ok bg-ok-soft text-ok")}
              {btn("nok", "NO OK", X, "border-bad bg-bad-soft text-bad")}
              {it.allowNA ? btn("na", "N/A", Minus, "border-neutral bg-neutral-soft text-neutral") : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function MultipointInput({ rule, points, value, onChange, results }: { rule: NumericRule; points: { code: string; name: string; required: boolean; rule?: unknown }[]; value: FormState["points"]; onChange: (v: FormState["points"]) => void; results?: Record<string, string> }) {
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);
  return (
    <div className="space-y-2">
      {points.map((p, i) => {
        const r = (p.rule as NumericRule | undefined) ?? rule;
        const units = unitChoices(r);
        const v = value[p.code] ?? { value: "" };
        const res = results?.[p.code];
        return (
          <div key={p.code} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2">
            <span className="w-14 font-mono text-sm font-semibold">{p.code}</span>
            <span className="min-w-28 flex-1 text-sm">{p.name}{p.required ? <span className="ml-1 text-bad">*</span> : <span className="ml-1 text-xs text-faint">(optativo)</span>}</span>
            <input
              ref={(el) => { refs.current[i] = el; }}
              aria-label={`Valor punto ${p.code}`}
              inputMode="decimal"
              autoFocus={i === 0}
              value={v.value}
              onChange={(e) => onChange({ ...value, [p.code]: { ...v, value: e.target.value } })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.ctrlKey) {
                  e.preventDefault();
                  refs.current[i + 1]?.focus();
                }
              }}
              className="h-11 w-40 rounded-md border-2 border-line-strong bg-surface px-3 font-mono text-lg tabular focus:border-primary focus:outline-none"
            />
            <select aria-label={`Unidad punto ${p.code}`} value={v.unit || units[0]} onChange={(e) => onChange({ ...value, [p.code]: { ...v, unit: e.target.value } })} className="h-11 w-20 rounded-md border border-line-strong bg-surface px-1">
              {units.map((u) => <option key={u}>{u}</option>)}
            </select>
            <span className={cn("w-28 text-right text-xs font-medium", res === "pass" ? "text-ok" : res === "fail" ? "text-bad" : "text-muted")}>{res ? RESULT_LABEL[res as keyof typeof RESULT_LABEL] : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

export function CombinedInput({ rules, value, onChange }: { rules: Extract<CriterionRules, { kind: "combined" }>; value: FormState["parts"]; onChange: (v: FormState["parts"]) => void }) {
  return (
    <div className="space-y-4">
      {rules.parts.map((p) => {
        const s = value[p.code] ?? {};
        const set = (patch: Partial<typeof s>) => onChange({ ...value, [p.code]: { ...s, ...patch } });
        return (
          <fieldset key={p.code} className="rounded-lg border border-line p-3">
            <legend className="px-1 text-sm font-semibold">{p.label}</legend>
            {p.rule.kind === "numeric" ? (
              <NumericInput id={`part-${p.code}`} label="Valor" rule={p.rule} value={s.value ?? ""} unit={s.unit ?? ""} onChange={(v) => set(v)} />
            ) : p.rule.kind === "select" ? (
              <SelectInput rule={p.rule} value={s.option ?? ""} onChange={(o) => set({ option: o })} />
            ) : (
              <ChecklistInput rule={p.rule} value={s.checklist ?? {}} onChange={(c) => set({ checklist: c })} />
            )}
          </fieldset>
        );
      })}
    </div>
  );
}

export function ReasonPicker({ reasons, reason, detail, onChange }: { reasons: string[]; reason: string; detail: string; onChange: (r: string, d: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor="nm-reason" className="mb-1.5 block text-sm font-medium">Motivo <span className="text-bad">*</span></label>
        <Select id="nm-reason" value={reason} onChange={(e) => onChange(e.target.value, detail)}>
          <option value="">Seleccione…</option>
          {reasons.map((r) => <option key={r}>{r}</option>)}
        </Select>
      </div>
      <div>
        <label htmlFor="nm-detail" className="mb-1.5 block text-sm font-medium">Detalle</label>
        <Input id="nm-detail" value={detail} onChange={(e) => onChange(reason, e.target.value)} placeholder="Opcional (obligatorio si «Otro»)" />
      </div>
    </div>
  );
}
