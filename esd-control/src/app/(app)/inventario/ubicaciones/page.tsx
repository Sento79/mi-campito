import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { ButtonLink, Card, PageHeader } from "@/components/ui/core";
import { LocationsTree, type Loc } from "../../admin/plantas/locations-tree";
import { loadLocations } from "../../admin/plantas/queries";

export const metadata = { title: "Ubicaciones" };

export default async function Locations() {
  const s = await requirePermission("read");
  const rows = await withCtx(s, (tx) => loadLocations(tx));
  return (
    <>
      <PageHeader title="Ubicaciones" description="Activos por ubicación (incluye las ubicaciones dependientes). Pulse el recuento para ver el inventario filtrado." actions={<ButtonLink href="/admin/plantas" variant="outline">Gestionar estructura</ButtonLink>} />
      <Card><LocationsTree locations={rows as unknown as Loc[]} manage={false} /></Card>
    </>
  );
}
