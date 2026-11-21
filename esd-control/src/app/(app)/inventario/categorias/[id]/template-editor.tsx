"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ArrowUp, ArrowDown, Save } from "lucide-react";
import { Button, Input, Select } from "@/components/ui/core";
import { useAction } from "@/components/ui/client";
import { saveTemplateAction } from "../actions";
import { nextFreeId } from "@/lib/domain/ids";

interface Item { code: string; name: string; instructions: string | null; required: boolean; criterionId: string | null }

export function TemplateEditor({ categoryId, template, criteria, readOnly }: { categoryId: string; template: { id: string; name: string; items: Item[] } | null; criteria: { id: string; label: string }[]; readOnly: boolean }) {
  const [name, setName] = React.useState(template?.name ?? "Plantilla estándar");
  const [items, setItems] = React.useState<Item[]>(template?.items?.length ? template.items : [{ code: "P1", name: "Punto 1", instructions: null, required: true, criterionId: null }]);
  const save = useAction(saveTemplateAction);
  const router = useRouter();
  const upd = (i: number, patch: Partial<Item>) => setItems((x) => x.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const mv = (i: number, d: -1 | 1) => setItems((x) => {
    const n = [...x];
    const j = i + d;
    if (j < 0 || j >= n.length) return n;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  return (
    <div className="space-y-3">
      <label className="block max-w-sm text-sm font-medium">Nombre de la plantilla<Input className="mt-1" value={name} disabled={readOnly} onChange={(e) => setName(e.target.value)} /></label>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted"><th className="py-1 pr-2">Orden</th><th className="pr-2">Código</th><th className="pr-2">Nombre</th><th className="pr-2">Instrucciones</th><th className="pr-2">Criterio propio</th><th className="pr-2">Obligatorio</th><th /></tr></thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1.5 pr-2 whitespace-nowrap">
                  <button type="button" disabled={readOnly} onClick={() => mv(i, -1)} className="p-1 text-muted hover:text-fg" aria-label="Subir"><ArrowUp className="size-4" /></button>
                  <button type="button" disabled={readOnly} onClick={() => mv(i, 1)} className="p-1 text-muted hover:text-fg" aria-label="Bajar"><ArrowDown className="size-4" /></button>
                </td>
                <td className="pr-2"><Input aria-label="Código" className="h-9 w-20 font-mono" disabled={readOnly} value={it.code} onChange={(e) => upd(i, { code: e.target.value })} /></td>
                <td className="pr-2"><Input aria-label="Nombre" className="h-9 min-w-40" disabled={readOnly} value={it.name} onChange={(e) => upd(i, { name: e.target.value })} /></td>
                <td className="pr-2"><Input aria-label="Instrucciones" className="h-9 min-w-48" disabled={readOnly} value={it.instructions ?? ""} onChange={(e) => upd(i, { instructions: e.target.value || null })} /></td>
                <td className="pr-2">
                  <Select aria-label="Criterio propio" className="h-9 min-w-44" disabled={readOnly} value={it.criterionId ?? ""} onChange={(e) => upd(i, { criterionId: e.target.value || null })}>
                    <option value="">El del criterio multipunto</option>
                    {criteria.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </Select>
                </td>
                <td className="pr-2 text-center"><input type="checkbox" aria-label="Obligatorio" className="size-4 accent-[var(--primary)]" disabled={readOnly} checked={it.required} onChange={(e) => upd(i, { required: e.target.checked })} /></td>
                <td><button type="button" disabled={readOnly || items.length === 1} onClick={() => setItems((x) => x.filter((_, k) => k !== i))} className="p-1 text-muted hover:text-bad disabled:opacity-30" aria-label="Quitar punto"><Trash2 className="size-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly ? (
        <div className="flex justify-between">
          <Button variant="outline" size="sm" icon={Plus} onClick={() => setItems((x) => [...x, { code: nextFreeId("P", x.map((i) => i.code)), name: `Punto ${x.length + 1}`, instructions: null, required: true, criterionId: null }])}>Añadir punto</Button>
          <Button size="sm" icon={Save} loading={save.pending} onClick={async () => {
            const r = await save.run({ categoryId, templateId: template?.id ?? null, name, items }, { success: "Plantilla guardada" });
            if (r?.ok) router.refresh();
          }}>Guardar plantilla</Button>
        </div>
      ) : null}
    </div>
  );
}
