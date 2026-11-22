"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Save, Plus, Check, X } from "lucide-react";
import { Badge, Button, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/ui/core";
import { Modal, useAction } from "@/components/ui/client";
import { fmtDate } from "@/lib/format";
import { addNcActionAction, completeNcActionAction, transitionNcAction, updateNcAction } from "../actions";

type Opt = { id: string; label: string };
const LABEL: Record<string, string> = { open: "Abierta", containment: "Contención", analysis: "En análisis", action: "Acción en curso", verification: "Pendiente de verificación", closed: "Cerrada", reopened: "Reabierta" };
const BTN: Record<string, string> = { containment: "Pasar a contención", analysis: "Iniciar análisis", action: "Acción en curso", verification: "Solicitar verificación", closed: "Verificar y cerrar", reopened: "Reabrir" };

export function NcWorkflow({ id, status, allowed, canEdit, canValidate }: { id: string; status: string; allowed: string[]; canEdit: boolean; canValidate: boolean }) {
  const router = useRouter();
  const t = useAction(transitionNcAction);
  const [to, setTo] = React.useState<string | null>(null);
  const [comment, setComment] = React.useState("");
  if (!canEdit) return null;
  const options = allowed.filter((a) => a !== "closed" || canValidate);
  return (
    <>
      {options.map((a) => <Button key={a} variant={a === "closed" ? "primary" : "outline"} onClick={() => { setTo(a); setComment(""); }}>{BTN[a] ?? LABEL[a]}</Button>)}
      <Modal open={!!to} onClose={() => setTo(null)} title={to ? `${LABEL[status]} → ${LABEL[to]}` : ""} description={to === "closed" ? "Registre la verificación de eficacia. Solo usuarios con permiso de validación pueden cerrar." : undefined}
        footer={<><Button variant="ghost" onClick={() => setTo(null)}>Cancelar</Button><Button loading={t.pending} disabled={(to === "closed" || to === "reopened") && comment.trim().length < 3} onClick={async () => {
          const r = await t.run({ id, to: to as never, comment: to === "closed" ? null : comment || null, verificationNotes: to === "closed" ? comment : null }, { success: "Estado actualizado" });
          if (r?.ok) { setTo(null); router.refresh(); }
        }}>Confirmar</Button></>}>
        <label className="text-sm font-medium" htmlFor="nc-tr">{to === "closed" ? "Verificación realizada (evidencia, remedición, resultado)" : to === "reopened" ? "Motivo de la reapertura" : "Comentario"}{to === "closed" || to === "reopened" ? <span className="text-bad"> *</span> : null}</label>
        <Textarea id="nc-tr" className="mt-1.5" rows={4} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Modal>
    </>
  );
}

export function NcEditor({ nc, readOnly, users, severities }: { nc: Record<string, string>; readOnly: boolean; users: Opt[]; severities: Opt[] }) {
  const [v, setV] = React.useState(nc);
  const a = useAction(updateNcAction);
  const router = useRouter();
  const dirty = JSON.stringify(v) !== JSON.stringify(nc);
  const f = (k: string, label: string, rows = 3, hint?: string) => (
    <Field label={label} htmlFor={`nc-${k}`} hint={hint}><Textarea id={`nc-${k}`} rows={rows} value={v[k]} disabled={readOnly} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>
  );
  return (
    <Card>
      <CardHeader title="Tratamiento" actions={!readOnly ? <Button size="sm" icon={Save} disabled={!dirty} loading={a.pending} onClick={async () => { const r = await a.run(v as never, { success: "Cambios guardados" }); if (r?.ok) router.refresh(); }}>Guardar</Button> : null} />
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Field label="Título" htmlFor="nc-t" className="md:col-span-4"><Input id="nc-t" value={v.title} disabled={readOnly} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
          <Field label="Gravedad" htmlFor="nc-s"><Select id="nc-s" value={v.severityId} disabled={readOnly} onChange={(e) => setV({ ...v, severityId: e.target.value })}><option value="">—</option>{severities.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></Field>
          <Field label="Responsable" htmlFor="nc-o"><Select id="nc-o" value={v.ownerUserId} disabled={readOnly} onChange={(e) => setV({ ...v, ownerUserId: e.target.value })}><option value="">—</option>{users.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></Field>
          <Field label="Fecha límite" htmlFor="nc-d"><Input id="nc-d" type="date" value={v.dueOn} disabled={readOnly} onChange={(e) => setV({ ...v, dueOn: e.target.value })} /></Field>
        </div>
        {f("description", "Descripción")}
        {f("containment", "Contención", 2)}
        {f("rootCause", "Análisis de causa", 3, "p. ej. 5 porqués / Ishikawa")}
        {f("correctiveAction", "Acción correctiva")}
        {f("preventiveAction", "Acción preventiva", 2, "Cuando proceda")}
      </div>
    </Card>
  );
}

export function NcActions({ ncId, actions, users, canEdit }: { ncId: string; actions: { id: string; kind: string; description: string; owner: string | null; dueOn: string | null; status: string }[]; users: Opt[]; canEdit: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState({ kind: "corrective", description: "", ownerUserId: "", dueOn: "" });
  const add = useAction(addNcActionAction);
  const done = useAction(completeNcActionAction);
  const router = useRouter();
  const KIND: Record<string, string> = { containment: "Contención", corrective: "Correctiva", preventive: "Preventiva" };
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Card>
      <CardHeader title="Acciones" description="Deben completarse o cancelarse antes del cierre" actions={canEdit ? <Button size="sm" variant="outline" icon={Plus} onClick={() => setOpen(true)}>Añadir acción</Button> : null} />
      {actions.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Sin acciones registradas.</p> : (
        <ul className="divide-y divide-line">
          {actions.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
              <Badge>{KIND[a.kind]}</Badge>
              <span className="min-w-0 flex-1">{a.description}</span>
              <span className="text-xs text-muted">{a.owner ?? "—"}{a.dueOn ? ` · ${fmtDate(a.dueOn)}` : ""}</span>
              {a.status === "open" ? (a.dueOn && a.dueOn < today ? <Badge tone="bad">Vencida</Badge> : <Badge tone="warn">Abierta</Badge>) : <Badge tone={a.status === "done" ? "ok" : "neutral"}>{a.status === "done" ? "Completada" : "Cancelada"}</Badge>}
              {canEdit && a.status === "open" ? (
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" icon={Check} aria-label="Completar" onClick={async () => { const r = await done.run({ id: a.id, status: "done" }, { success: "Acción completada" }); if (r?.ok) router.refresh(); }} />
                  <Button size="sm" variant="ghost" icon={X} aria-label="Cancelar" onClick={async () => { const r = await done.run({ id: a.id, status: "cancelled" }, { success: "Acción cancelada" }); if (r?.ok) router.refresh(); }} />
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Nueva acción" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button loading={add.pending} onClick={async () => { const r = await add.run({ ncId, ...v }, { success: "Acción añadida" }); if (r?.ok) { setOpen(false); setV({ kind: "corrective", description: "", ownerUserId: "", dueOn: "" }); router.refresh(); } }}>Añadir</Button></>}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Tipo" htmlFor="ac-k"><Select id="ac-k" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <Field label="Responsable" htmlFor="ac-o"><Select id="ac-o" value={v.ownerUserId} onChange={(e) => setV({ ...v, ownerUserId: e.target.value })}><option value="">—</option>{users.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></Field>
          <Field label="Fecha límite" htmlFor="ac-d"><Input id="ac-d" type="date" value={v.dueOn} onChange={(e) => setV({ ...v, dueOn: e.target.value })} /></Field>
        </div>
        <Field label="Descripción" htmlFor="ac-desc" className="mt-4"><Textarea id="ac-desc" rows={3} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
      </Modal>
    </Card>
  );
}
