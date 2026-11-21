"use client";
import * as React from "react";
import Link from "@/components/link";
import { useRouter } from "next/navigation";
import { Plus, Pencil, ChevronRight, MapPin } from "lucide-react";
import { Badge, Button, Checkbox, Field, Input, Select, Textarea } from "@/components/ui/core";
import { Modal, useAction } from "@/components/ui/client";
import { LOCATION_KIND_LABEL } from "@/lib/format";
import { saveLocationAction } from "./actions";

export interface Loc { id: string; parent_id: string | null; kind: string; code: string; name: string; description: string | null; is_active: boolean; assets: number; total_assets: number }

export function LocationsTree({ locations, manage }: { locations: Loc[]; manage: boolean }) {
  const [edit, setEdit] = React.useState<Partial<Loc> | null>(null);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const children = React.useMemo(() => {
    const m = new Map<string | null, Loc[]>();
    for (const l of locations) m.set(l.parent_id, [...(m.get(l.parent_id) ?? []), l]);
    return m;
  }, [locations]);
  const render = (parent: string | null, depth: number): React.ReactNode =>
    (children.get(parent) ?? []).map((l) => {
      const kids = children.get(l.id)?.length ?? 0;
      const open = !collapsed.has(l.id);
      return (
        <React.Fragment key={l.id}>
          <li className={`flex items-center gap-2 border-b border-line py-2 pr-4 ${l.is_active ? "" : "opacity-55"}`} style={{ paddingLeft: 16 + depth * 22 }}>
            {kids ? (
              <button onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })} aria-expanded={open} aria-label={open ? "Contraer" : "Expandir"} className="text-muted">
                <ChevronRight className={`size-4 transition-transform ${open ? "rotate-90" : ""}`} />
              </button>
            ) : <MapPin className="size-4 text-faint" aria-hidden />}
            <span className="font-medium">{l.name}</span>
            <span className="font-mono text-xs text-muted">{l.code}</span>
            <Badge>{LOCATION_KIND_LABEL[l.kind]}</Badge>
            {!l.is_active ? <Badge tone="neutral">Inactiva</Badge> : null}
            <Link href={`/inventario?location=${l.id}`} className="ml-auto text-xs text-primary hover:underline">{l.total_assets} activo(s)</Link>
            {manage ? (
              <>
                <button onClick={() => setEdit({ parent_id: l.id, kind: "zone", is_active: true })} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Añadir dentro de ${l.name}`} title="Añadir dentro"><Plus className="size-4" /></button>
                <button onClick={() => setEdit(l)} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Editar ${l.name}`} title="Editar"><Pencil className="size-4" /></button>
              </>
            ) : null}
          </li>
          {open ? render(l.id, depth + 1) : null}
        </React.Fragment>
      );
    });
  return (
    <>
      <ul>{render(null, 0)}</ul>
      {edit ? <LocationModal loc={edit} locations={locations} onClose={() => setEdit(null)} /> : null}
    </>
  );
}

export function LocationModal({ loc, locations, onClose }: { loc: Partial<Loc>; locations: Loc[]; onClose: () => void }) {
  const [v, setV] = React.useState({ parentId: loc.parent_id ?? "", kind: loc.kind ?? "zone", code: loc.code ?? "", name: loc.name ?? "", description: loc.description ?? "", isActive: loc.is_active ?? true });
  const save = useAction(saveLocationAction);
  const router = useRouter();
  const [errs, setErrs] = React.useState<Record<string, string>>({});
  return (
    <Modal open onClose={onClose} title={loc.id ? `Editar ${loc.name}` : "Nueva ubicación"} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={save.pending} onClick={async () => {
      const r = await save.run({ id: loc.id ?? null, parentId: v.parentId || null, kind: v.kind, code: v.code, name: v.name, description: v.description || null, isActive: v.isActive }, { success: "Ubicación guardada" });
      if (r && !r.ok) setErrs(r.fieldErrors ?? {});
      if (r?.ok) { onClose(); router.refresh(); }
    }}>Guardar</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Depende de" htmlFor="l-parent">
          <Select id="l-parent" value={v.parentId} onChange={(e) => setV({ ...v, parentId: e.target.value })}>
            <option value="">(Raíz)</option>
            {locations.filter((l) => l.id !== loc.id).map((l) => <option key={l.id} value={l.id}>{l.name} ({l.code})</option>)}
          </Select>
        </Field>
        <Field label="Tipo" htmlFor="l-kind">
          <Select id="l-kind" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
            {Object.entries(LOCATION_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Código" htmlFor="l-code" required error={errs.code}><Input id="l-code" className="font-mono uppercase" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} /></Field>
        <Field label="Nombre" htmlFor="l-name" required error={errs.name}><Input id="l-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
      </div>
      <Field label="Descripción" htmlFor="l-desc" className="mt-4"><Textarea id="l-desc" rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
      <Checkbox className="mt-3" label="Activa" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} />
    </Modal>
  );
}
