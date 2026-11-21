"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardHeader, Field, Input } from "@/components/ui/core";
import { useAction } from "@/components/ui/client";
import { changePasswordAction, updateProfileAction } from "./actions";

export function ProfileForms({ name, permissions }: { name: string; permissions: string[] }) {
  const [n, setN] = React.useState(name);
  const [pw, setPw] = React.useState({ current: "", next: "", confirm: "" });
  const [errs, setErrs] = React.useState<Record<string, string>>({});
  const prof = useAction(updateProfileAction);
  const chg = useAction(changePasswordAction);
  const router = useRouter();
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Datos personales" />
        <div className="space-y-4 p-5">
          <Field label="Nombre completo" htmlFor="pf-name"><Input id="pf-name" value={n} onChange={(e) => setN(e.target.value)} /></Field>
          <Button loading={prof.pending} onClick={async () => { const r = await prof.run({ fullName: n }, { success: "Perfil actualizado" }); if (r?.ok) router.refresh(); }}>Guardar</Button>
          <div><p className="mb-2 text-sm font-medium">Permisos de su rol</p><div className="flex flex-wrap gap-1.5">{permissions.map((p) => <Badge key={p} tone="primary">{p}</Badge>)}</div></div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Cambiar contraseña" />
        <div className="space-y-4 p-5">
          <Field label="Contraseña actual" htmlFor="pf-cur" error={errs.current}><Input id="pf-cur" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="Nueva contraseña" htmlFor="pf-new" error={errs.next} hint="Mín. 10 caracteres y 3 tipos de carácter"><Input id="pf-new" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <Field label="Repetir nueva contraseña" htmlFor="pf-rep" error={pw.confirm && pw.confirm !== pw.next ? "No coincide" : undefined}><Input id="pf-rep" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
          <Button disabled={!pw.current || !pw.next || pw.next !== pw.confirm} loading={chg.pending} onClick={async () => { setErrs({}); const r = await chg.run({ current: pw.current, next: pw.next }, { success: "Contraseña cambiada" }); if (r && !r.ok) setErrs(r.fieldErrors ?? {}); if (r?.ok) setPw({ current: "", next: "", confirm: "" }); }}>Cambiar contraseña</Button>
        </div>
      </Card>
    </div>
  );
}
