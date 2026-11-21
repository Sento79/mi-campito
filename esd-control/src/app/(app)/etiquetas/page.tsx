import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { categoryOptions, locationOptions } from "@/lib/server/queries/common";
import { PageHeader } from "@/components/ui/core";
import { labelData } from "@/lib/server/labels";
import { labelLayoutSchema } from "@/lib/domain/labels";
import { LabelDesigner } from "./label-designer";

export const metadata = { title: "Etiquetas" };

export default async function Labels({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requirePermission("read");
  const sp = await searchParams;
  const ids = (sp.assets ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 2000);
  const d = await withCtx(s, async (tx) => {
    const templates = await tx`select id, name, width_mm::float8 as width_mm, height_mm::float8 as height_mm, layout, is_default from label_templates order by is_default desc, name`;
    const selected = ids.length ? await tx`select id, code, name from assets where id = any(${ids}) order by code` : [];
    const sample = ids.length ? (await labelData(tx, [ids[0]]))[0] : (await tx`select id from assets where archived_at is null order by code limit 1`).length ? (await labelData(tx, [(await tx`select id from assets where archived_at is null order by code limit 1`)[0].id]))[0] : null;
    return { templates, selected, sample, categories: await categoryOptions(tx), locations: await locationOptions(tx) };
  });
  return (
    <>
      <PageHeader title="Etiquetas" description="Diseñe la etiqueta, elija los activos e imprima en PDF (hoja o rollo) o en ZPL para impresoras Zebra. El QR enlaza a la ficha protegida por inicio de sesión." />
      <LabelDesigner
        templates={d.templates.map((t) => ({ id: t.id, name: t.name, widthMm: t.width_mm, heightMm: t.height_mm, layout: labelLayoutSchema.parse(t.layout), isDefault: t.is_default }))}
        initialAssets={d.selected.map((a) => ({ id: a.id, code: a.code, name: a.name }))}
        sample={d.sample}
        categories={d.categories}
        locations={d.locations}
        canSave={s.permissions.has("create") || s.permissions.has("edit")}
        hasLogo={!!s.org.settings.company.logoDocumentId}
      />
    </>
  );
}
