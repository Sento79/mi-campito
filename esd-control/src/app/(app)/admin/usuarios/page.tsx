import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { PageHeader } from "@/components/ui/core";
import { UsersAdmin } from "./users-admin";

export const metadata = { title: "Usuarios y roles" };

export default async function Users() {
  const s = await requirePermission("users.manage");
  const d = await withCtx(s, async (tx) => ({
    users: await tx`select u.id, u.email, u.full_name, u.last_login_at, u.locked_until, m.is_active, m.role_id, r.name as role_name from memberships m join users u on u.id = m.user_id join roles r on r.id = m.role_id order by m.is_active desc, u.full_name`,
    roles: await tx`select r.id, r.key, r.name, r.description, r.is_system, coalesce(array_agg(rp.permission_key) filter (where rp.permission_key is not null), '{}') as permissions,
      (select count(*)::int from memberships m where m.role_id = r.id and m.is_active) as members from roles r left join role_permissions rp on rp.role_id = r.id group by r.id order by r.is_system desc, r.name`,
  }));
  return (
    <>
      <PageHeader title="Usuarios y roles" description="Los permisos se aplican en el servidor y en la base de datos (RLS), no solo en la interfaz." />
      <UsersAdmin me={s.userId} users={d.users.map((u) => ({ id: u.id, email: u.email, name: u.full_name, lastLogin: u.last_login_at ? new Date(u.last_login_at).toISOString() : null, locked: !!u.locked_until && new Date(u.locked_until) > new Date(), active: u.is_active, roleId: u.role_id, roleName: u.role_name }))}
        roles={d.roles.map((r) => ({ id: r.id, key: r.key, name: r.name, description: r.description, isSystem: r.is_system, permissions: r.permissions as string[], members: r.members }))} />
    </>
  );
}
