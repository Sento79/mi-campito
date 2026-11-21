import { Suspense } from "react";
import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { instrumentOptions } from "@/lib/server/queries/common";
import { PageHeader } from "@/components/ui/core";
import { QuickMeasure } from "./quick-measure";

export const metadata = { title: "Medición rápida" };

export default async function MeasurePage() {
  const s = await requirePermission("measure");
  const instruments = await withCtx(s, (tx) => instrumentOptions(tx));
  return (
    <>
      <PageHeader title="Medición rápida" description="Escanear → medir → guardar → siguiente. El resultado lo calcula el servidor con el criterio vigente." />
      <Suspense>
        <QuickMeasure orgId={s.orgId} settings={s.org.settings} instruments={instruments} canCreateNc={s.permissions.has("measure") || s.permissions.has("create")} />
      </Suspense>
    </>
  );
}
