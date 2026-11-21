import { requireSession } from "@/lib/server/auth";
import { PageHeader } from "@/components/ui/core";
import { ProfileForms } from "./profile-forms";
import { PERMISSION_LABEL, type Permission } from "@/lib/domain/permissions";

export const metadata = { title: "Mi perfil" };

export default async function Profile() {
  const s = await requireSession();
  return (
    <>
      <PageHeader title="Mi perfil" description={`${s.user.email} · ${s.role.name} en ${s.org.name}`} />
      <ProfileForms name={s.user.fullName} permissions={[...s.permissions].map((p) => PERMISSION_LABEL[p as Permission] ?? p)} />
    </>
  );
}
