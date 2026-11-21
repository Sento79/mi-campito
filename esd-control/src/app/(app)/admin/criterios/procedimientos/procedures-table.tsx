"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, FileText } from "lucide-react";
import { Badge, Button, Checkbox, EmptyState, Field, Input, Table, Td, Textarea, Th } from "@/components/ui/core";
import { Modal, useAction } from "@/components/ui/client";
import { UploadButton } from "@/components/upload";
import { saveProcedureAction, uploadProcedureDocAction } from "../actions";

type P = { id: string | null; code: string; title: string; revision: string; normReference: string; description: string; isActive: boolean; documentId?: string | null; uses?: number };

export function ProceduresTable({ rows, manage }: { rows: P[]; manage: boolean }) {
  const [edit, setEdit] = React.useState<P | null>(null);
  const [reason, setReason] = React.useState("");
  const a = useAction(saveProcedureAction);
  const router = useRouter();
  const orig = rows.find((r) => r.id === edit?.id);
  return (
    <>
      {manage ? <div className="flex justify-end border-b border-line p-3"><Button icon={Plus} onClick={() => { setEdit({ id: null, code: "", title: "", revision: "A", normReference: "", description: "", isActive: true }); setReason(""); }}>Nuevo procedimiento</Button></div> : null}
      {rows.length === 0 ? <EmptyState title="Sin procedimientos" /> : (
        <Table>
          <thead><tr><Th>Código</Th><Th>Título</Th><Th>Revisión</Th><Th>Referencia</Th><Th>Documento</Th><Th>Uso</Th><Th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="font-mono text-xs">{r.code}</Td>
                <Td>{r.title}{!r.isActive ? <Badge className="ml-2">Inactivo</Badge> : null}</Td>
                <Td><Badge tone="primary">rev. {r.revision}</Badge></Td>
                <Td className="text-xs text-muted">{r.normReference || "—"}</Td>
                <Td>{r.documentId ? <a className="inline-flex items-center gap-1 text-primary hover:underline" href={`/api/files/${r.documentId}`} target="_blank" rel="noopener"><FileText className="size-4" />PDF</a> : manage ? <UploadButton action={uploadProcedureDocAction} fields={{ procedureId: r.id! }} accept=".pdf" label="Subir PDF" /> : "—"}</Td>
                <Td className="text-xs text-muted">{r.uses} versiones de criterio</Td>
                <Td>{manage ? <Button size="sm" variant="ghost" icon={Pencil} aria-label="Editar" onClick={() => { setEdit(r); setReason(""); }} /> : null}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {edit ? (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? `Editar ${edit.code}` : "Nuevo procedimiento"} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button><Button loading={a.pending} onClick={async () => {
          const r = await a.run({ id: edit.id, code: edit.code, title: edit.title, revision: edit.revision, normReference: edit.normReference || null, description: edit.description || null, isActive: edit.isActive, reason: reason || null }, { success: "Procedimiento guardado" });
          if (r?.ok) { setEdit(null); router.refresh(); }
        }}>Guardar</Button></>}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Código" htmlFor="p-code" required><Input id="p-code" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></Field>
            <Field label="Título" htmlFor="p-title" required className="sm:col-span-2"><Input id="p-title" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
            <Field label="Revisión" htmlFor="p-rev" required><Input id="p-rev" value={edit.revision} onChange={(e) => setEdit({ ...edit, revision: e.target.value })} /></Field>
            <Field label="Referencia normativa" htmlFor="p-norm" className="sm:col-span-2"><Input id="p-norm" value={edit.normReference} onChange={(e) => setEdit({ ...edit, normReference: e.target.value })} /></Field>
          </div>
          <Field label="Descripción" htmlFor="p-desc" className="mt-4"><Textarea id="p-desc" rows={3} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
          {orig && orig.revision !== edit.revision ? <Field label="Motivo del cambio de revisión" htmlFor="p-reason" required className="mt-4"><Input id="p-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field> : null}
          <Checkbox className="mt-3" label="Activo" checked={edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} />
        </Modal>
      ) : null}
    </>
  );
}
