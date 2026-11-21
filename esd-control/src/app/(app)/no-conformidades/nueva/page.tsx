import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { userOptions } from "@/lib/server/queries/common";
import { PageHeader } from "@/components/ui/core";
import { NcCreateForm } from "./nc-create-form";

export const metadata = { title: "Nueva no conformidad" };

export default async function NewNc({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requirePermission("read");
  const sp = await searchParams;
  const mId = sp.measurement && /^[0-9a-f-]{36}$/.test(sp.measurement) ? sp.measurement : null;
  const d = await withCtx(s, async (tx) => {
    const [m] = mId ? await tx`select m.id, m.result, m.result_explanation, coalesce(a.code, pp.code) as code, coalesce(a.name, pp.name) as name, a.owner_user_id from measurements m left join assets a on a.id = m.asset_id left join plan_points pp on pp.id = m.plan_point_id where m.id = ${mId}` : [null];
    return {
      m,
      users: await userOptions(tx),
      severities: (await tx`select id, name as label, due_days from nc_severities order by rank`).map((r) => ({ id: r.id as string, label: r.label as string, dueDays: r.due_days as number | null })),
      assets: (await tx`select id, code || ' · ' || name as label from assets where archived_at is null order by code limit 3000`).map((r) => ({ id: r.id as string, label: r.label as string })),
    };
  });
  return (
    <>
      <PageHeader title="Nueva no conformidad" description={d.m ? `Vinculada a la medición de ${d.m.code} · ${d.m.name}` : "Registre la desviación detectada y vincule los elementos afectados."} />
      <NcCreateForm users={d.users} severities={d.severities} assets={d.assets} measurement={d.m ? { id: d.m.id, title: `No conforme: ${d.m.code} · ${d.m.name}`, description: (d.m.result_explanation as string[]).join("\n"), owner: d.m.owner_user_id } : null} />
    </>
  );
}
