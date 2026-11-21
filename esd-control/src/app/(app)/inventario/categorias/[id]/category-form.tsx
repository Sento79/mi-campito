"use client";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button, Card, Checkbox, Field, Input, Select, Textarea } from "@/components/ui/core";
import { useAction } from "@/components/ui/client";
import { PERIOD_LABEL, PERIOD_UNITS } from "@/lib/domain/periodicity";
import { UNITS } from "@/lib/domain/units";
import { RECORD_METHOD_LABEL } from "@/lib/format";
import { saveCategoryAction } from "../actions";

type Opt = { id: string; label: string };
interface V {
  code: string; name: string; description: string; inspectionType: string; quantity: string; unit: string; recordMethod: string;
  procedureId: string; criterionId: string; periodUnit: string; periodCount: string; instrumentRequired: boolean; instrumentTypes: string;
  requiredFields: string[]; instructions: string; precautions: string; isActive: boolean;
}

export function CategoryForm({ id, defaults, procedures, criteria, readOnly }: { id: string | null; defaults?: V; procedures: Opt[]; criteria: Opt[]; readOnly: boolean }) {
  const router = useRouter();
  const save = useAction(saveCategoryAction);
  const { register, handleSubmit, setError, formState: { errors: e } } = useForm<V>({
    defaultValues: defaults ?? { recordMethod: "numeric", instrumentRequired: true, isActive: true, requiredFields: [], instrumentTypes: "" } as Partial<V> as V,
  });
  return (
    <form
      noValidate
      onSubmit={handleSubmit(async (v) => {
        const r = await save.run({ id, data: v }, { success: "Categoría guardada" });
        if (r && !r.ok) for (const [k, m] of Object.entries(r.fieldErrors ?? {})) setError(k.replace("data.", "") as keyof V, { message: m });
        if (r?.ok) {
          router.push(`/inventario/categorias/${(r.data as { id: string }).id}`);
          router.refresh();
        }
      })}
    >
      <fieldset disabled={readOnly} className="space-y-4">
        <Card className="p-5">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Código" htmlFor="code" required error={e.code?.message}><Input id="code" className="font-mono uppercase" {...register("code", { required: "Obligatorio" })} /></Field>
            <Field label="Nombre" htmlFor="name" required error={e.name?.message}><Input id="name" {...register("name", { required: "Obligatorio" })} /></Field>
            <Field label="Tipo de inspección" htmlFor="inspectionType"><Input id="inspectionType" placeholder="p. ej. Resistencia a tierra" {...register("inspectionType")} /></Field>
            <Field label="Magnitud" htmlFor="quantity"><Input id="quantity" {...register("quantity")} /></Field>
            <Field label="Unidad" htmlFor="unit">
              <Select id="unit" {...register("unit")}>
                <option value="">—</option>
                {UNITS.map((u) => <option key={u.symbol} value={u.symbol}>{u.symbol} ({u.label})</option>)}
              </Select>
            </Field>
            <Field label="Método de registro" htmlFor="recordMethod" hint="Debe coincidir con el tipo del criterio">
              <Select id="recordMethod" {...register("recordMethod")}>
                {Object.entries(RECORD_METHOD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Procedimiento" htmlFor="procedureId">
              <Select id="procedureId" {...register("procedureId")}><option value="">—</option>{procedures.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select>
            </Field>
            <Field label="Criterio de aceptación" htmlFor="criterionId" hint="Sin criterio, los resultados quedan «Requiere revisión»">
              <Select id="criterionId" {...register("criterionId")}><option value="">Sin criterio</option>{criteria.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Periodicidad" htmlFor="periodUnit">
                <Select id="periodUnit" {...register("periodUnit")}><option value="">Ninguna</option>{PERIOD_UNITS.map((u) => <option key={u} value={u}>{PERIOD_LABEL[u][1]}</option>)}</Select>
              </Field>
              <Field label="Cada" htmlFor="periodCount" error={e.periodCount?.message}><Input id="periodCount" type="number" min={1} {...register("periodCount")} /></Field>
            </div>
          </div>
          <Field label="Descripción" htmlFor="description" className="mt-4"><Textarea id="description" rows={2} {...register("description")} /></Field>
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold">Requisitos de registro</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Checkbox label="Instrumento obligatorio" {...register("instrumentRequired")} />
              <Field label="Tipos de instrumento admitidos" htmlFor="instrumentTypes" hint="Separados por comas; deben coincidir con el tipo del instrumento. Vacío = cualquiera">
                <Input id="instrumentTypes" {...register("instrumentTypes")} />
              </Field>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Campos obligatorios adicionales</legend>
              <Checkbox label="Comentario" value="comment" {...register("requiredFields")} />
              <Checkbox label="Foto adjunta" value="photo" {...register("requiredFields")} />
            </fieldset>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Instrucciones para el técnico" htmlFor="instructions"><Textarea id="instructions" rows={3} {...register("instructions")} /></Field>
            <Field label="Precauciones" htmlFor="precautions"><Textarea id="precautions" rows={3} {...register("precautions")} /></Field>
          </div>
          <Checkbox className="mt-4" label="Categoría activa" {...register("isActive")} />
        </Card>
        {!readOnly ? <div className="flex justify-end"><Button type="submit" icon={Save} loading={save.pending}>Guardar categoría</Button></div> : null}
      </fieldset>
    </form>
  );
}
