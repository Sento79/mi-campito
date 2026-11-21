import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { PageHeader } from "@/components/ui/core";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Configuración" };

export default async function Settings() {
  const s = await requirePermission("settings.manage");
  const severities = await withCtx(s, (tx) => tx`select id, key, name, rank, due_days from nc_severities order by rank`);
  return (
    <>
      <PageHeader title="Configuración" description="Políticas de la organización. Todos los cambios quedan en la auditoría." />
      <SettingsForm settings={s.org.settings} severities={severities.map((x) => ({ id: x.id, key: x.key, name: x.name, rank: x.rank, dueDays: x.due_days }))} />
    </>
  );
}
