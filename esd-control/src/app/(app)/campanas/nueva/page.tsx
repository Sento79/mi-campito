import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { categoryOptions, locationOptions, userOptions } from "@/lib/server/queries/common";
import { PageHeader } from "@/components/ui/core";
import { CampaignForm } from "./campaign-form";

export const metadata = { title: "Nueva campaña" };

export default async function NewCampaign({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requirePermission("create");
  const sp = await searchParams;
  const ids = (v?: string) => (v ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 5000);
  const d = await withCtx(s, async (tx) => ({
    categories: await categoryOptions(tx),
    locations: await locationOptions(tx),
    users: await userOptions(tx),
    plans: (await tx`select id, title as label from floor_plans where archived_at is null order by title`).map((r) => ({ id: r.id as string, label: r.label as string })),
  }));
  const assetIds = ids(sp.assets);
  const pointIds = ids(sp.points);
  const planId = sp.plan && /^[0-9a-f-]{36}$/.test(sp.plan) ? sp.plan : null;
  return (
    <>
      <PageHeader title="Nueva campaña" description="La campaña se crea en borrador; revise los elementos y pásela a planificada o en curso." />
      <CampaignForm {...d} me={s.userId} initial={{ assetIds, pointIds, planId, mode: assetIds.length ? "selection" : planId ? "plan" : "category" }} />
    </>
  );
}
