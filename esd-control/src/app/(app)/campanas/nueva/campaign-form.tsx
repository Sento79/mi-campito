"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Save, Eye } from "lucide-react";
import { Alert, Button, Card, Checkbox, Field, Input, Select, Textarea } from "@/components/ui/core";
import { useAction } from "@/components/ui/client";
import { createCampaignAction, previewCampaignAction } from "../actions";

type Opt = { id: string; label: string; hint?: string };
const MODES = [
  { k: "category", l: "Por categoría", h: "Todos los activos de las categorías elegidas (opcionalmente en una ubicación)" },
  { k: "location", l: "Por ubicación", h: "Activos y puntos de suelo de una planta/zona" },
  { k: "plan", l: "Desde plano", h: "Puntos de un plano (todos o los marcados en el plano)" },
  { k: "due", l: "Por vencimientos", h: "Activos con medición vencida o que vence antes del fin de la campaña" },
  { k: "selection", l: "Selección de activos", h: "Los activos marcados en el inventario" },
] as const;

export function CampaignForm({ categories, locations, users, plans, me, initial }: { categories: Opt[]; locations: Opt[]; users: Opt[]; plans: Opt[]; me: string; initial: { assetIds: string[]; pointIds: string[]; planId: string | null; mode: string } }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const [v, setV] = React.useState({ name: "", description: "", locationId: "", planId: initial.planId ?? "", startsOn: today, endsOn: in30, ownerUserId: me, technicianIds: [] as string[], categoryIds: [] as string[], mode: initial.mode });
  const [preview, setPreview] = React.useState<{ assets: number; points: number } | null>(null);
  const [errs, setErrs] = React.useState<Record<string, string>>({});
  const prev = useAction(previewCampaignAction);
  const create = useAction(createCampaignAction);
  const payload = () => ({ ...v, description: v.description || null, locationId: v.locationId || null, planId: v.planId || null, ownerUserId: v.ownerUserId || null, assetIds: initial.assetIds, pointIds: v.mode === "plan" && v.planId === initial.planId ? initial.pointIds : [] });
  const toggle = (k: "technicianIds" | "categoryIds", id: string) => setV((x) => ({ ...x, [k]: x[k].includes(id) ? x[k].filter((y) => y !== id) : [...x[k], id] }));
  React.useEffect(() => setPreview(null), [v]);
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Nombre" htmlFor="c-name" required error={errs.name}><Input id="c-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
          <Field label="Inicio" htmlFor="c-start" required><Input id="c-start" type="date" value={v.startsOn} onChange={(e) => setV({ ...v, startsOn: e.target.value })} /></Field>
          <Field label="Fin" htmlFor="c-end" required error={errs.endsOn}><Input id="c-end" type="date" value={v.endsOn} onChange={(e) => setV({ ...v, endsOn: e.target.value })} /></Field>
          <Field label="Responsable" htmlFor="c-owner"><Select id="c-owner" value={v.ownerUserId} onChange={(e) => setV({ ...v, ownerUserId: e.target.value })}><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</Select></Field>
          <Field label="Planta / zona" htmlFor="c-loc"><Select id="c-loc" value={v.locationId} onChange={(e) => setV({ ...v, locationId: e.target.value })}><option value="">—</option>{locations.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</Select></Field>
          <Field label="Plano asociado" htmlFor="c-plan" hint="Bloquea cambios de disposición mientras esté en curso"><Select id="c-plan" value={v.planId} onChange={(e) => setV({ ...v, planId: e.target.value })}><option value="">—</option>{plans.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</Select></Field>
        </div>
        <Field label="Descripción / procedimientos" htmlFor="c-desc" className="mt-4"><Textarea id="c-desc" rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
      </Card>
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold">Selección de elementos</h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-5" role="radiogroup" aria-label="Modo de creación">
          {MODES.map((m) => (
            <label key={m.k} className={`cursor-pointer rounded-lg border p-3 text-sm ${v.mode === m.k ? "border-primary bg-primary-soft" : "border-line hover:bg-surface-2"}`}>
              <input type="radio" name="mode" className="sr-only" checked={v.mode === m.k} onChange={() => setV({ ...v, mode: m.k })} disabled={m.k === "selection" && initial.assetIds.length === 0} />
              <span className="font-medium">{m.l}</span>
              <span className="mt-1 block text-xs text-muted">{m.h}</span>
            </label>
          ))}
        </div>
        {v.mode === "selection" ? <p className="mt-3 text-sm text-muted">{initial.assetIds.length} activo(s) seleccionados desde el inventario.</p> : null}
        {v.mode === "plan" && initial.pointIds.length && v.planId === initial.planId ? <p className="mt-3 text-sm text-muted">{initial.pointIds.length} punto(s) marcados en el plano.</p> : null}
        <fieldset className="mt-4">
          <legend className="mb-2 text-sm font-medium">Categorías {v.mode === "category" ? <span className="text-bad">*</span> : <span className="text-xs font-normal text-muted">(filtro opcional)</span>}</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">{categories.map((c) => <Checkbox key={c.id} label={c.label} checked={v.categoryIds.includes(c.id)} onChange={() => toggle("categoryIds", c.id)} />)}</div>
        </fieldset>
        <fieldset className="mt-4">
          <legend className="mb-2 text-sm font-medium">Técnicos asignados</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">{users.map((u) => <Checkbox key={u.id} label={`${u.label}${u.hint ? ` (${u.hint})` : ""}` as string} checked={v.technicianIds.includes(u.id)} onChange={() => toggle("technicianIds", u.id)} />)}</div>
        </fieldset>
      </Card>
      {preview ? <Alert tone={preview.assets + preview.points ? "info" : "warn"} title={`La campaña incluirá ${preview.assets} activo(s) y ${preview.points} punto(s) de plano`} /> : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" icon={Eye} loading={prev.pending} onClick={async () => { const r = await prev.run(payload()); if (r?.ok) setPreview(r.data); else if (r && !r.ok) setErrs(r.fieldErrors ?? {}); }}>Previsualizar</Button>
        <Button icon={Save} loading={create.pending} onClick={async () => {
          const r = await create.run(payload(), { success: "Campaña creada en borrador" });
          if (r && !r.ok) setErrs(r.fieldErrors ?? {});
          if (r?.ok) { router.push(`/campanas/${r.data.id}`); router.refresh(); }
        }}>Crear campaña</Button>
      </div>
    </div>
  );
}
