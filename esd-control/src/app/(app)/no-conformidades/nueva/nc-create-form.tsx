"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui/core";
import { useAction } from "@/components/ui/client";
import { createNcAction } from "../actions";

type Opt = { id: string; label: string };

export function NcCreateForm({ users, severities, assets, measurement }: { users: Opt[]; severities: (Opt & { dueDays: number | null })[]; assets: Opt[]; measurement: { id: string; title: string; description: string; owner: string | null } | null }) {
  const router = useRouter();
  const [v, setV] = React.useState({ title: measurement?.title ?? "", description: measurement?.description ?? "", severityId: severities[1]?.id ?? "", ownerUserId: measurement?.owner ?? "", dueOn: "", containment: "", assetId: "" });
  const [errs, setErrs] = React.useState<Record<string, string>>({});
  const a = useAction(createNcAction);
  const sev = severities.find((s) => s.id === v.severityId);
  return (
    <Card className="space-y-4 p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Título" htmlFor="nc-title" required error={errs.title} className="md:col-span-2"><Input id="nc-title" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <Field label="Gravedad" htmlFor="nc-sev" hint={sev?.dueDays ? `Plazo por defecto: ${sev.dueDays} días` : undefined}><Select id="nc-sev" value={v.severityId} onChange={(e) => setV({ ...v, severityId: e.target.value })}><option value="">—</option>{severities.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>
        <Field label="Responsable" htmlFor="nc-owner"><Select id="nc-owner" value={v.ownerUserId} onChange={(e) => setV({ ...v, ownerUserId: e.target.value })}><option value="">—</option>{users.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>
        <Field label="Fecha límite" htmlFor="nc-due" hint="Vacío = según gravedad"><Input id="nc-due" type="date" value={v.dueOn} onChange={(e) => setV({ ...v, dueOn: e.target.value })} /></Field>
        {!measurement ? <Field label="Activo afectado" htmlFor="nc-asset"><Select id="nc-asset" value={v.assetId} onChange={(e) => setV({ ...v, assetId: e.target.value })}><option value="">—</option>{assets.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field> : null}
      </div>
      <Field label="Descripción" htmlFor="nc-desc"><Textarea id="nc-desc" rows={4} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
      <Field label="Contención inmediata" htmlFor="nc-cont" hint="Si se registra, la NC pasa directamente a «Contención»"><Textarea id="nc-cont" rows={2} value={v.containment} onChange={(e) => setV({ ...v, containment: e.target.value })} /></Field>
      <div className="flex justify-end">
        <Button icon={Save} loading={a.pending} onClick={async () => {
          const r = await a.run({ title: v.title, description: v.description, severityId: v.severityId, ownerUserId: v.ownerUserId, dueOn: v.dueOn, containment: v.containment, measurementIds: measurement ? [measurement.id] : [], assetIds: v.assetId ? [v.assetId] : [] }, { success: "No conformidad registrada" });
          if (r && !r.ok) setErrs(r.fieldErrors ?? {});
          if (r?.ok) { router.push(`/no-conformidades/${r.data.id}`); router.refresh(); }
        }}>Registrar NC</Button>
      </div>
    </Card>
  );
}
