"use client";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui/core";
import { useAction, useToast } from "@/components/ui/client";
import { ASSET_STATUSES, ASSET_STATUS_LABEL } from "@/lib/domain/asset-import";
import { PERIOD_LABEL, PERIOD_UNITS } from "@/lib/domain/periodicity";
import { createAssetAction, updateAssetAction } from "./actions";

export interface AssetFormValues {
  code: string;
  scanCode: string;
  name: string;
  categoryId: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  locationId: string;
  commissionedOn: string;
  status: string;
  ownerUserId: string;
  periodUnit: string;
  periodCount: string;
  criterionId: string;
  pointTemplateId: string;
  notes: string;
  reason: string;
}

type Opt = { id: string; label: string; hint?: string };

export function AssetForm({
  mode,
  id,
  defaults,
  categories,
  locations,
  users,
  criteria,
  templates,
}: {
  mode: "create" | "edit";
  id?: string;
  defaults: Partial<AssetFormValues>;
  categories: Opt[];
  locations: Opt[];
  users: Opt[];
  criteria: Opt[];
  templates: Opt[];
}) {
  const router = useRouter();
  const toast = useToast();
  const create = useAction(createAssetAction);
  const update = useAction(updateAssetAction);
  const { register, handleSubmit, setError, formState, watch } = useForm<AssetFormValues>({
    defaultValues: {
      status: "active",
      commissionedOn: new Date().toISOString().slice(0, 10),
      ...defaults,
    },
  });
  const e = formState.errors;
  const status = watch("status");
  const statusChanged = mode === "edit" && status !== defaults.status;

  const onSubmit = handleSubmit(async (v) => {
    const r = mode === "create" ? await create.run(v) : await update.run({ id: id!, data: v });
    if (!r) return;
    if (!r.ok) {
      for (const [k, msg] of Object.entries(r.fieldErrors ?? {})) setError(k.replace(/^data\./, "") as keyof AssetFormValues, { message: msg });
      return;
    }
    toast({ tone: "ok", title: mode === "create" ? "Activo creado" : "Cambios guardados" });
    router.push(`/inventario/${(r.data as { id: string }).id}`);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold">Identificación</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="ID legible" htmlFor="code" required error={e.code?.message} hint="Único. Letras, números, _ . - /">
            <Input id="code" autoFocus={mode === "create"} className="font-mono uppercase" aria-invalid={!!e.code} {...register("code", { required: "Obligatorio", setValueAs: (v: string) => v.trim().toUpperCase() })} />
          </Field>
          <Field label="Código QR / barras" htmlFor="scanCode" error={e.scanCode?.message} hint="Si se deja vacío se usa el ID">
            <Input id="scanCode" className="font-mono" {...register("scanCode")} />
          </Field>
          <Field label="Nombre" htmlFor="name" required error={e.name?.message}>
            <Input id="name" aria-invalid={!!e.name} {...register("name", { required: "Obligatorio" })} />
          </Field>
          <Field label="Categoría" htmlFor="categoryId" required error={e.categoryId?.message}>
            <Select id="categoryId" aria-invalid={!!e.categoryId} {...register("categoryId", { required: "Seleccione una categoría" })}>
              <option value="">Seleccione…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
          </Field>
          <Field label="Ubicación" htmlFor="locationId" error={e.locationId?.message}>
            <Select id="locationId" {...register("locationId")}>
              <option value="">Sin ubicación</option>
              {locations.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
          </Field>
          <Field label="Responsable" htmlFor="ownerUserId">
            <Select id="ownerUserId" {...register("ownerUserId")}>
              <option value="">—</option>
              {users.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
          </Field>
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold">Datos técnicos y estado</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Fabricante" htmlFor="manufacturer"><Input id="manufacturer" {...register("manufacturer")} /></Field>
          <Field label="Modelo" htmlFor="model"><Input id="model" {...register("model")} /></Field>
          <Field label="Número de serie" htmlFor="serialNumber"><Input id="serialNumber" {...register("serialNumber")} /></Field>
          <Field label="Fecha de alta" htmlFor="commissionedOn" required error={e.commissionedOn?.message}>
            <Input id="commissionedOn" type="date" {...register("commissionedOn", { required: "Obligatorio" })} />
          </Field>
          <Field label="Estado" htmlFor="status" required>
            <Select id="status" {...register("status")}>
              {ASSET_STATUSES.map((s) => <option key={s} value={s}>{ASSET_STATUS_LABEL[s]}</option>)}
            </Select>
          </Field>
          {statusChanged ? (
            <Field label="Motivo del cambio de estado" htmlFor="reason" error={e.reason?.message} hint="Queda registrado en auditoría">
              <Input id="reason" {...register("reason")} />
            </Field>
          ) : null}
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="mb-1 text-sm font-semibold">Inspección (excepciones por activo)</h2>
        <p className="mb-4 text-xs text-muted">Deje vacío para heredar la periodicidad, el criterio y la plantilla de la categoría.</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Field label="Periodicidad: unidad" htmlFor="periodUnit">
            <Select id="periodUnit" {...register("periodUnit")}>
              <option value="">De la categoría</option>
              {PERIOD_UNITS.map((u) => <option key={u} value={u}>{PERIOD_LABEL[u][1]}</option>)}
            </Select>
          </Field>
          <Field label="Cada" htmlFor="periodCount" error={e.periodCount?.message}>
            <Input id="periodCount" type="number" min={1} max={9999} {...register("periodCount")} />
          </Field>
          <Field label="Criterio específico" htmlFor="criterionId">
            <Select id="criterionId" {...register("criterionId")}>
              <option value="">De la categoría</option>
              {criteria.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
          </Field>
          <Field label="Plantilla multipunto" htmlFor="pointTemplateId">
            <Select id="pointTemplateId" {...register("pointTemplateId")}>
              <option value="">De la categoría</option>
              {templates.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
          </Field>
        </div>
      </Card>
      <Card className="p-5">
        <Field label="Observaciones" htmlFor="notes">
          <Textarea id="notes" rows={3} {...register("notes")} />
        </Field>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => router.back()}>Cancelar</Button>
        <Button type="submit" icon={Save} loading={create.pending || update.pending}>{mode === "create" ? "Crear activo" : "Guardar cambios"}</Button>
      </div>
    </form>
  );
}
