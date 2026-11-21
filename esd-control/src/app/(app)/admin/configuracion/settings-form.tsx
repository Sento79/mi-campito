"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Save, Plus } from "lucide-react";
import { Alert, Button, Card, CardHeader, Checkbox, Field, Input, Select, Textarea } from "@/components/ui/core";
import { useAction } from "@/components/ui/client";
import { UploadButton } from "@/components/upload";
import type { OrgSettings } from "@/lib/domain/settings";
import { saveSettingsAction, saveSeveritiesAction, uploadLogoAction } from "./actions";

type Sev = { id: string | null; key: string; name: string; rank: number; dueDays: number | null };

export function SettingsForm({ settings, severities }: { settings: OrgSettings; severities: Sev[] }) {
  const [v, setV] = React.useState(settings);
  const [sev, setSev] = React.useState(severities);
  const [reasons, setReasons] = React.useState(settings.notMeasurableReasons.join("\n"));
  const save = useAction(saveSettingsAction);
  const saveSev = useAction(saveSeveritiesAction);
  const router = useRouter();
  const num = (k: "dueLeadDays" | "calibrationLeadDays" | "ncLeadDays") => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Math.max(0, Math.min(365, Number(e.target.value) || 0)) });
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Mediciones e instrumentos" />
        <div className="grid gap-4 p-5 md:grid-cols-2">
          <Field label="Instrumento requerido ausente o fuera de calibración" htmlFor="s-inst">
            <Select id="s-inst" value={v.instrumentPolicy} onChange={(e) => setV({ ...v, instrumentPolicy: e.target.value as OrgSettings["instrumentPolicy"] })}>
              <option value="block">Impedir el registro</option>
              <option value="review">Registrar como «Requiere revisión» (recomendado)</option>
              <option value="warn">Registrar con aviso (no recomendado)</option>
            </Select>
          </Field>
          <Field label="No conformidad al registrar un no conforme" htmlFor="s-nc">
            <Select id="s-nc" value={v.autoCreateNc} onChange={(e) => setV({ ...v, autoCreateNc: e.target.value as OrgSettings["autoCreateNc"] })}>
              <option value="ask">Preguntar al técnico (marcado por defecto)</option><option value="always">Crear siempre</option><option value="never">No crear automáticamente</option>
            </Select>
          </Field>
          <Checkbox label="Exigir confirmación (firma) del técnico en cada medición" checked={v.requireSignature} onChange={(e) => setV({ ...v, requireSignature: e.target.checked })} />
          <Field label="Motivos de «No medible / No aplica» (uno por línea)" htmlFor="s-reasons" className="md:col-span-2"><Textarea id="s-reasons" rows={5} value={reasons} onChange={(e) => setReasons(e.target.value)} /></Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Alertas" description="Días de aviso previo. Canal: notificaciones en la aplicación." />
        <div className="grid gap-4 p-5 md:grid-cols-3">
          <Field label="Mediciones (días)" htmlFor="s-due"><Input id="s-due" type="number" min={0} max={365} value={v.dueLeadDays} onChange={num("dueLeadDays")} /></Field>
          <Field label="Calibraciones (días)" htmlFor="s-cal"><Input id="s-cal" type="number" min={0} max={365} value={v.calibrationLeadDays} onChange={num("calibrationLeadDays")} /></Field>
          <Field label="NC y acciones (días)" htmlFor="s-ncd"><Input id="s-ncd" type="number" min={0} max={365} value={v.ncLeadDays} onChange={num("ncLeadDays")} /></Field>
          <div className="md:col-span-3"><Alert tone="info">Correo electrónico: no implementado en esta versión (no se simulan envíos). Ver README › Notificaciones.</Alert></div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Lector de códigos (valores por defecto)" description="Cada dispositivo puede ajustarlo en Medición rápida" />
        <div className="grid gap-4 p-5 md:grid-cols-4">
          <Field label="Sufijo" htmlFor="s-suf"><Select id="s-suf" value={v.scanner.suffix} onChange={(e) => setV({ ...v, scanner: { ...v.scanner, suffix: e.target.value as "Enter" } })}><option value="Enter">Enter</option><option value="Tab">Tab</option><option value="none">Ninguno</option></Select></Field>
          <Field label="Prefijo" htmlFor="s-pre"><Input id="s-pre" value={v.scanner.prefix} onChange={(e) => setV({ ...v, scanner: { ...v.scanner, prefix: e.target.value } })} /></Field>
          <Field label="Intervalo máx. (ms)" htmlFor="s-gap"><Input id="s-gap" type="number" min={10} max={300} value={v.scanner.maxInterKeyMs} onChange={(e) => setV({ ...v, scanner: { ...v.scanner, maxInterKeyMs: Number(e.target.value) || 50 } })} /></Field>
          <Field label="Longitud mínima" htmlFor="s-min"><Input id="s-min" type="number" min={1} max={40} value={v.scanner.minLength} onChange={(e) => setV({ ...v, scanner: { ...v.scanner, minLength: Number(e.target.value) || 3 } })} /></Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Empresa e informes" actions={<UploadButton action={uploadLogoAction} fields={{}} accept=".png,.jpg,.jpeg" label="Subir logo" maxMb={1} />} />
        <div className="grid gap-4 p-5 md:grid-cols-2">
          <Field label="Nombre en informes" htmlFor="s-cn"><Input id="s-cn" value={v.company.displayName} onChange={(e) => setV({ ...v, company: { ...v.company, displayName: e.target.value } })} /></Field>
          <Field label="Pie de página de informes" htmlFor="s-ft"><Input id="s-ft" value={v.company.reportFooter} onChange={(e) => setV({ ...v, company: { ...v.company, reportFooter: e.target.value } })} /></Field>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {v.company.logoDocumentId ? <img src={`/api/files/${v.company.logoDocumentId}`} alt="Logo actual" className="h-12 w-auto object-contain" /> : <p className="text-sm text-muted">Sin logo.</p>}
        </div>
      </Card>
      <div className="flex justify-end"><Button icon={Save} loading={save.pending} onClick={async () => { const r = await save.run({ ...v, notMeasurableReasons: reasons.split("\n").map((x) => x.trim()).filter((x) => x.length >= 2) }, { success: "Configuración guardada" }); if (r?.ok) router.refresh(); }}>Guardar configuración</Button></div>
      <Card>
        <CardHeader title="Gravedades de no conformidad" description="Clasificación y plazo por defecto" actions={<Button size="sm" icon={Save} loading={saveSev.pending} onClick={async () => { const r = await saveSev.run(sev, { success: "Gravedades guardadas" }); if (r?.ok) router.refresh(); }}>Guardar</Button>} />
        <div className="space-y-2 p-5">
          {sev.map((x, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <Field label="Clave" htmlFor={`sv-k${i}`}><Input id={`sv-k${i}`} className="w-28 font-mono" disabled={!!x.id} value={x.key} onChange={(e) => setSev(sev.map((y, k) => (k === i ? { ...y, key: e.target.value } : y)))} /></Field>
              <Field label="Nombre" htmlFor={`sv-n${i}`}><Input id={`sv-n${i}`} className="w-40" value={x.name} onChange={(e) => setSev(sev.map((y, k) => (k === i ? { ...y, name: e.target.value } : y)))} /></Field>
              <Field label="Rango" htmlFor={`sv-r${i}`}><Input id={`sv-r${i}`} type="number" className="w-20" value={x.rank} onChange={(e) => setSev(sev.map((y, k) => (k === i ? { ...y, rank: Number(e.target.value) || 1 } : y)))} /></Field>
              <Field label="Plazo (días)" htmlFor={`sv-d${i}`}><Input id={`sv-d${i}`} type="number" className="w-24" value={x.dueDays ?? ""} onChange={(e) => setSev(sev.map((y, k) => (k === i ? { ...y, dueDays: e.target.value ? Number(e.target.value) : null } : y)))} /></Field>
            </div>
          ))}
          <Button size="sm" variant="outline" icon={Plus} onClick={() => setSev([...sev, { id: null, key: "", name: "", rank: sev.length + 1, dueDays: null }])}>Añadir gravedad</Button>
        </div>
      </Card>
    </div>
  );
}
