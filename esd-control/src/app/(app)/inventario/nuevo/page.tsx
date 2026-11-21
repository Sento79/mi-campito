import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { PageHeader } from "@/components/ui/core";
import { AssetForm } from "../asset-form";
import { assetFormOptions, assetToForm } from "../form-data";
import { uuidOrUndef } from "@/lib/server/queries/common";

export const metadata = { title: "Nuevo activo" };

export default async function NewAsset({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requirePermission("create");
  const sp = await searchParams;
  const from = uuidOrUndef(sp.duplicar);
  const { opts, source } = await withCtx(s, async (tx) => ({
    opts: await assetFormOptions(tx),
    source: from ? (await tx`select * from assets where id = ${from}`)[0] : null,
  }));
  const defaults = source ? { ...assetToForm(source), code: "", scanCode: "", serialNumber: "", name: `${source.name} (copia)` } : {};
  return (
    <>
      <PageHeader title={source ? `Duplicar ${source.code}` : "Nuevo activo"} description={source ? "Se copian categoría, ubicación y configuración. Indique un ID y número de serie nuevos." : "Alta de un elemento ESD en el inventario."} />
      <AssetForm mode="create" defaults={defaults} {...opts} />
    </>
  );
}
