"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Play, Pause, CheckCheck, Lock, XCircle, ClipboardCheck, CalendarCheck, SkipForward } from "lucide-react";
import { Alert, Button, Checkbox, Textarea } from "@/components/ui/core";
import { ConfirmDialog, Modal, useAction } from "@/components/ui/client";
import { skipItemAction, transitionCampaignAction } from "../actions";

type Sum = { total: number; done: number; pending: number; skipped: number; pass: number; fail: number; incomplete: number; openNcs: number };

export function CampaignActions({ id, status, paused, canEdit, canClose, summary }: { id: string; status: string; paused: boolean; canEdit: boolean; canClose: boolean; summary: Sum }) {
  const router = useRouter();
  const t = useAction(transitionCampaignAction);
  const [closeOpen, setCloseOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [ack, setAck] = React.useState(false);
  const [notes, setNotes] = React.useState("");
  const go = async (to: string, extra: { notes?: string | null; acknowledge?: boolean } = {}, msg?: string) => {
    const r = await t.run({ id, to: to as never, notes: extra.notes ?? null, acknowledge: extra.acknowledge ?? false }, { success: msg ?? "Campaña actualizada" });
    if (r?.ok) router.refresh();
    return r?.ok;
  };
  const issues = summary.pending > 0 || summary.fail > 0 || summary.openNcs > 0;
  return (
    <>
      {canEdit && status === "draft" ? <Button variant="outline" icon={CalendarCheck} loading={t.pending} onClick={() => go("planned", {}, "Campaña planificada")}>Planificar</Button> : null}
      {canEdit && (status === "draft" || status === "planned") ? <Button icon={Play} loading={t.pending} onClick={() => go("in_progress", {}, "Campaña iniciada")}>Iniciar</Button> : null}
      {canEdit && status === "in_progress" ? (paused ? <Button variant="outline" icon={Play} onClick={() => go("resume", {}, "Campaña reanudada")}>Reanudar</Button> : <Button variant="outline" icon={Pause} onClick={() => go("pause", {}, "Campaña en pausa")}>Pausar</Button>) : null}
      {canEdit && status === "in_progress" ? <Button variant="outline" icon={ClipboardCheck} onClick={() => go("in_review", {}, "Campaña en revisión")}>A revisión</Button> : null}
      {canEdit && status === "in_review" ? <Button variant="outline" icon={Play} onClick={() => go("in_progress")}>Reabrir medición</Button> : null}
      {canEdit && (status === "in_progress" || status === "in_review") ? <Button variant="outline" icon={CheckCheck} onClick={() => go("completed", {}, "Campaña completada")}>Completar</Button> : null}
      {canClose && status === "completed" ? <Button icon={Lock} onClick={() => setCloseOpen(true)}>Cerrar campaña</Button> : null}
      {canEdit && ["draft", "planned", "in_progress"].includes(status) ? <Button variant="ghost" icon={XCircle} onClick={() => setCancelOpen(true)}>Cancelar</Button> : null}
      <Modal open={closeOpen} onClose={() => setCloseOpen(false)} title="Cerrar campaña" description="El cierre es definitivo. El resumen se registra con la campaña y en auditoría."
        footer={<><Button variant="ghost" onClick={() => setCloseOpen(false)}>Volver</Button><Button icon={Lock} loading={t.pending} disabled={issues && !ack} onClick={async () => { if (await go("closed", { notes: notes || null, acknowledge: ack }, "Campaña cerrada")) setCloseOpen(false); }}>Cerrar definitivamente</Button></>}>
        <ul className="space-y-1 text-sm">
          <li>Realizados: <strong>{summary.done}</strong> de {summary.total} ({summary.skipped} omitidos)</li>
          <li>Pendientes (quedarán como no realizados): <strong className={summary.pending ? "text-warn" : ""}>{summary.pending}</strong></li>
          <li>No conformes: <strong className={summary.fail ? "text-bad" : ""}>{summary.fail}</strong> · Incompletos/revisión: <strong>{summary.incomplete}</strong></li>
          <li>No conformidades abiertas: <strong className={summary.openNcs ? "text-bad" : ""}>{summary.openNcs}</strong></li>
        </ul>
        {issues ? <div className="mt-3"><Alert tone="warn">El cierre no oculta estos elementos: seguirán visibles en el historial, en las NC y en los informes.</Alert><Checkbox className="mt-3" label="He revisado los pendientes y no conformidades y confirmo el cierre" checked={ack} onChange={(e) => setAck(e.target.checked)} /></div> : null}
        <label className="mt-3 block text-sm font-medium" htmlFor="close-notes">Observaciones de cierre</label>
        <Textarea id="close-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Modal>
      <ConfirmDialog open={cancelOpen} onClose={() => setCancelOpen(false)} danger reason="required" title="Cancelar campaña" description="Las mediciones ya registradas se conservan. La campaña no podrá reactivarse." confirmLabel="Cancelar campaña" loading={t.pending}
        onConfirm={async (r) => { if (await go("cancelled", { notes: r }, "Campaña cancelada")) setCancelOpen(false); }} />
    </>
  );
}

export function SkipButton({ itemId, code }: { itemId: string; code: string }) {
  const [open, setOpen] = React.useState(false);
  const a = useAction(skipItemAction);
  const router = useRouter();
  return (
    <>
      <button className="ml-3 inline-flex items-center gap-1 text-xs text-muted hover:text-fg" onClick={() => setOpen(true)}><SkipForward className="size-3.5" />Omitir</button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} reason="required" title={`Omitir ${code}`} description="El elemento quedará como omitido con su motivo; no se considera medido." confirmLabel="Omitir" loading={a.pending}
        onConfirm={async (reason) => { const r = await a.run({ itemId, reason }, { success: "Elemento omitido" }); if (r?.ok) { setOpen(false); router.refresh(); } }} />
    </>
  );
}
