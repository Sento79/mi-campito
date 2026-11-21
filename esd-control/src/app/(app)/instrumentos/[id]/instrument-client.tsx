"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Save, Plus } from "lucide-react";
import { Button, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/ui/core";
import { useAction, useToast } from "@/components/ui/client";
import { INSTRUMENT_STATUS_LABEL } from "@/lib/format";
import { addCalibrationAction, saveInstrumentAction } from "../actions";

type Opt = { id: string; label: string };
type V = { id: string | null; code: string; type: string; manufacturer: string; model: string; serialNumber: string; acquiredOn: string; status: string; ownerUserId: string; locationId: string; notes: string; reason: string };

export function InstrumentForm({ v: initial, users, locations, readOnly }: { v: V | null; users: Opt[]; locations: Opt[]; readOnly: boolean }) {
  const [v, setV] = React.useState<V>(initial ?? { id: null, code: "", type: "Medidor de resistencia", manufacturer: "", model: "", serialNumber: "", acquiredOn: "", status: "active", ownerUserId: "", locationId: "", notes: "", reason: "" });
  const [errs, setErrs] = React.useState<Record<string, string>>({});
  const a = useAction(saveInstrumentAction);
  const router = useRouter();
  const set = (k: keyof V) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <Card>
      <CardHeader title="Datos del instrumento" actions={!readOnly ? <Button size="sm" icon={Save} loading={a.pending} onClick={async () => {
        const r = await a.run(v, { success: "Instrumento guardado" });
        if (r && !r.ok) setErrs(r.fieldErrors ?? {});
        if (r?.ok) { router.push(`/instrumentos/${r.data.id}`); router.refresh(); }
      }}>Guardar</Button> : null} />
      <fieldset disabled={readOnly} className="grid gap-4 p-5 md:grid-cols-3">
        <Field label="Código" htmlFor="i-code" required error={errs.code}><Input id="i-code" className="font-mono" value={v.code} onChange={set("code")} /></Field>
        <Field label="Tipo" htmlFor="i-type" required hint="Debe coincidir con el tipo exigido por la categoría"><Input id="i-type" value={v.type} onChange={set("type")} list="instrument-types" /></Field>
        <datalist id="instrument-types"><option value="Medidor de resistencia" /><option value="Comprobador de pulseras" /><option value="Comprobador de calzado" /><option value="Medidor de campo electrostático" /><option value="Monitor de ionizador" /></datalist>
        <Field label="Estado" htmlFor="i-status"><Select id="i-status" value={v.status} onChange={set("status")}>{Object.entries(INSTRUMENT_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="Fabricante" htmlFor="i-man"><Input id="i-man" value={v.manufacturer} onChange={set("manufacturer")} /></Field>
        <Field label="Modelo" htmlFor="i-model"><Input id="i-model" value={v.model} onChange={set("model")} /></Field>
        <Field label="Nº de serie" htmlFor="i-sn"><Input id="i-sn" value={v.serialNumber} onChange={set("serialNumber")} /></Field>
        <Field label="Fecha de adquisición" htmlFor="i-acq"><Input id="i-acq" type="date" value={v.acquiredOn} onChange={set("acquiredOn")} /></Field>
        <Field label="Responsable" htmlFor="i-owner"><Select id="i-owner" value={v.ownerUserId} onChange={set("ownerUserId")}><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</Select></Field>
        <Field label="Ubicación" htmlFor="i-loc"><Select id="i-loc" value={v.locationId} onChange={set("locationId")}><option value="">—</option>{locations.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</Select></Field>
        {initial && v.status !== initial.status ? <Field label="Motivo del cambio de estado" htmlFor="i-reason" error={errs.reason} className="md:col-span-3"><Input id="i-reason" value={v.reason} onChange={set("reason")} /></Field> : null}
        <Field label="Notas" htmlFor="i-notes" className="md:col-span-3"><Textarea id="i-notes" rows={2} value={v.notes} onChange={set("notes")} /></Field>
      </fieldset>
    </Card>
  );
}

export function CalibrationForm({ instrumentId }: { instrumentId: string }) {
  const ref = React.useRef<HTMLFormElement>(null);
  const [busy, setBusy] = React.useState(false);
  const toast = useToast();
  const router = useRouter();
  return (
    <Card>
      <CardHeader title="Registrar calibración" />
      <form ref={ref} className="space-y-3 p-5" onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        fd.set("instrumentId", instrumentId);
        setBusy(true);
        try {
          const r = await addCalibrationAction(fd);
          if (r.ok) { toast({ tone: "ok", title: "Calibración registrada" }); ref.current?.reset(); router.refresh(); }
          else toast({ tone: "bad", title: r.error, body: Object.values(r.fieldErrors ?? {}).join("\n") });
        } finally { setBusy(false); }
      }}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha de calibración" htmlFor="c-on" required><Input id="c-on" name="calibratedOn" type="date" required /></Field>
          <Field label="Válida hasta" htmlFor="c-due" required><Input id="c-due" name="dueOn" type="date" required /></Field>
        </div>
        <Field label="Resultado" htmlFor="c-out"><Select id="c-out" name="outcome"><option value="pass">Apto</option><option value="adjusted">Ajustado y apto</option><option value="fail">No apto (fuera de servicio)</option></Select></Field>
        <Field label="Laboratorio / proveedor" htmlFor="c-prov"><Input id="c-prov" name="provider" /></Field>
        <Field label="Nº de certificado" htmlFor="c-cert"><Input id="c-cert" name="certificateNumber" /></Field>
        <Field label="Certificado (PDF/imagen)" htmlFor="c-file"><input id="c-file" name="file" type="file" accept="application/pdf,image/png,image/jpeg" className="text-sm" /></Field>
        <Field label="Notas" htmlFor="c-notes"><Textarea id="c-notes" name="notes" rows={2} /></Field>
        <Button type="submit" icon={Plus} loading={busy} className="w-full">Registrar calibración</Button>
      </form>
    </Card>
  );
}
