import { requireSession } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { AppShell } from "@/components/shell/app-shell";
import { ServiceWorkerRegister } from "@/components/shell/sw-register";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const [{ n }] = await withCtx(s, (tx) => tx`select count(*)::int as n from notifications where user_id = ${s.userId} and read_at is null`);
  return (
    <AppShell
      user={{
        fullName: s.user.fullName,
        email: s.user.email,
        roleName: s.role.name,
        orgName: s.org.name,
        orgId: s.orgId,
        isDemo: s.org.isDemo,
        permissions: [...s.permissions],
        orgs: s.orgs,
        unread: n,
      }}
    >
      <ServiceWorkerRegister />
      {children}
    </AppShell>
  );
}
