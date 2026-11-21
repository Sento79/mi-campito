import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { locationOptions, userOptions } from "@/lib/server/queries/common";
import { PageHeader } from "@/components/ui/core";
import { PlanUploadForm } from "../plan-upload";

export const metadata = { title: "Nuevo plano" };

export default async function NewPlan() {
  const s = await requirePermission("create");
  const { locations, users } = await withCtx(s, async (tx) => ({ locations: await locationOptions(tx), users: await userOptions(tx) }));
  return (
    <>
      <PageHeader title="Nuevo plano" description="Suba el plano de planta. Después podrá colocar puntos de medición haciendo clic sobre él." />
      <PlanUploadForm mode="create" locations={locations} users={users} />
    </>
  );
}
