import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { Card, CardHeader, PageHeader } from "@/components/ui/core";
import { LocationsTree, type Loc } from "./locations-tree";
import { loadLocations } from "./queries";
import { NewRootButton } from "./new-root";

export const metadata = { title: "Plantas y zonas" };

export default async function Plants() {
  const s = await requirePermission("read");
  const rows = await withCtx(s, (tx) => loadLocations(tx));
  const manage = ["settings.manage", "create", "edit"].some((p) => s.permissions.has(p));
  return (
    <>
      <PageHeader title="Plantas y zonas" description="Jerarquía flexible: empresa, planta, edificio, piso, área, zona, línea y ubicación. Use solo los niveles que necesite." actions={manage ? <NewRootButton locations={rows as never} /> : null} />
      <Card>
        <CardHeader title="Estructura" description="Las ubicaciones con activos no se borran; pueden desactivarse cuando estén vacías." />
        <LocationsTree locations={rows as unknown as Loc[]} manage={manage} />
      </Card>
    </>
  );
}
