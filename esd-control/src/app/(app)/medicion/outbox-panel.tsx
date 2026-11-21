"use client";
import * as React from "react";
import { CloudUpload, Trash2, RefreshCw } from "lucide-react";
import { Badge, Button, Card, CardHeader, ResultBadge } from "@/components/ui/core";
import { ConfirmDialog, useToast } from "@/components/ui/client";
import { discard, listOutbox, OUTBOX_EVENT, syncOutbox, type OutboxItem } from "@/lib/client/outbox";
import { fmtDateTime } from "@/lib/format";

/** Mediciones guardadas en el dispositivo pendientes de confirmar por el servidor. */
export function OutboxPanel({ orgId, defaultOpen }: { orgId: string; defaultOpen: boolean }) {
  const [items, setItems] = React.useState<OutboxItem[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [toDiscard, setToDiscard] = React.useState<OutboxItem | null>(null);
  const toast = useToast();
  const refresh = React.useCallback(() => listOutbox().then((x) => setItems(x.filter((i) => i.orgId === orgId))).catch(() => setItems([])), [orgId]);
  React.useEffect(() => {
    refresh();
    window.addEventListener(OUTBOX_EVENT, refresh);
    return () => window.removeEventListener(OUTBOX_EVENT, refresh);
  }, [refresh]);
  if (!items.length && !defaultOpen) return null;
  return (
    <Card>
      <CardHeader
        title={`Cola del dispositivo (${items.length})`}
        description="Mediciones guardadas sin conexión. Solo se eliminan de aquí cuando el servidor confirma su registro."
        actions={
          <Button size="sm" icon={RefreshCw} loading={busy} disabled={!items.length} onClick={async () => {
            setBusy(true);
            const r = await syncOutbox({ includeErrored: true });
            setBusy(false);
            toast({ tone: r.offline ? "bad" : r.failed ? "warn" : "ok", title: r.offline ? "Sigue sin conexión" : `${r.sent} enviada(s)${r.failed ? `, ${r.failed} con error` : ""}` });
          }}>Sincronizar</Button>
        }
      />
      {items.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No hay mediciones pendientes en este dispositivo.</p> : (
        <ul className="divide-y divide-line">
          {items.map((i) => (
            <li key={i.clientId} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
              <CloudUpload className="size-4 text-warn" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{i.label}</span>
              {i.provisionalResult ? <ResultBadge result={i.provisionalResult} /> : null}
              <Badge tone={i.status === "error" ? "bad" : "warn"}>{i.status === "error" ? "Rechazada" : "Pendiente"}</Badge>
              <span className="text-xs text-muted">{fmtDateTime(i.createdAt)}</span>
              {i.lastError ? <span className="w-full pl-7 text-xs text-bad">{i.lastError}</span> : null}
              <button className="rounded p-1 text-muted hover:text-bad" aria-label="Descartar" onClick={() => setToDiscard(i)}><Trash2 className="size-4" /></button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={!!toDiscard} onClose={() => setToDiscard(null)} danger title="Descartar medición local" description={`La medición de ${toDiscard?.label} no se ha registrado en el servidor. Si la descarta se perderá definitivamente.`} confirmLabel="Descartar" onConfirm={async () => { if (toDiscard) await discard(toDiscard.clientId); setToDiscard(null); }} />
    </Card>
  );
}
