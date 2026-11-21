"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button, Field, Input, Textarea } from "@/components/ui/core";
import { Modal, useAction } from "@/components/ui/client";
import { createCriterionAction } from "./actions";

export function NewCriterionButton() {
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState({ code: "", name: "", description: "" });
  const a = useAction(createCriterionAction);
  const router = useRouter();
  return (
    <>
      <Button icon={Plus} onClick={() => setOpen(true)}>Nuevo criterio</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Nuevo criterio" description="Después cree y publique su primera versión con los límites." footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button loading={a.pending} onClick={async () => { const r = await a.run({ ...v, description: v.description || null }, { success: "Criterio creado" }); if (r?.ok) router.push(`/admin/criterios/${r.data.id}`); }}>Crear</Button></>}>
        <div className="space-y-4">
          <Field label="Código" htmlFor="cr-code" required><Input id="cr-code" className="font-mono uppercase" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} /></Field>
          <Field label="Nombre" htmlFor="cr-name" required><Input id="cr-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
          <Field label="Descripción" htmlFor="cr-desc"><Textarea id="cr-desc" rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}
