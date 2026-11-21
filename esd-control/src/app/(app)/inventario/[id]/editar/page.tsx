import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { PageHeader } from "@/components/ui/core";
import { AssetForm } from "../../asset-form";
import { assetFormOptions, assetToForm } from "../../form-data";

export const metadata = { title: "Editar activo" };

export default async function EditAsset({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePermission("edit");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { opts, a } = await withCtx(s, async (tx) => ({ opts: await assetFormOptions(tx), a: (await tx`select * from assets where id = ${id}`)[0] }));
  if (!a) notFound();
  return (
    <>
      <PageHeader title={`Editar ${a.code}`} description="Los cambios quedan registrados en la auditoría con sus valores anteriores." />
      <AssetForm mode="edit" id={id} defaults={assetToForm(a)} {...opts} />
    </>
  );
}
