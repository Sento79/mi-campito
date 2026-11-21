"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Moon, Sun, Building2, UserRound, Check } from "lucide-react";
import type { ShellUser } from "./app-shell";
import { logoutAction, switchOrgAction } from "./shell-actions";

export function UserMenu({ user }: { user: ShellUser }) {
  const [open, setOpen] = React.useState(false);
  const [dark, setDark] = React.useState(false);
  const router = useRouter();
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("esd-theme", next ? "dark" : "light");
    } catch {}
  };
  const initials = user.fullName
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md p-1 pr-2 hover:bg-surface-2"
        aria-label="Menú de usuario"
      >
        <span className="grid size-8 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-fg">{initials}</span>
        <span className="hidden text-left leading-tight lg:block">
          <span className="block text-sm font-medium">{user.fullName}</span>
          <span className="block text-[11px] text-muted">{user.roleName}</span>
        </span>
      </button>
      {open ? (
        <div role="menu" className="animate-in absolute right-0 z-50 mt-1 w-72 rounded-lg border border-line bg-surface p-1 shadow-xl">
          <div className="border-b border-line px-3 py-2.5">
            <p className="text-sm font-medium">{user.fullName}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
            <p className="mt-1 text-xs text-muted">
              {user.roleName} · {user.orgName}
            </p>
          </div>
          {user.orgs.length > 1 ? (
            <div className="border-b border-line py-1">
              <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Organización</p>
              {user.orgs.map((o) => (
                <button
                  key={o.org_id}
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-surface-2"
                  onClick={async () => {
                    if (o.org_id === user.orgId) return;
                    await switchOrgAction(o.org_id);
                    setOpen(false);
                    router.push("/");
                    router.refresh();
                  }}
                >
                  <Building2 className="size-4 text-muted" aria-hidden />
                  <span className="flex-1 truncate text-left">
                    {o.org_name}
                    {o.is_demo ? <span className="ml-1 text-[10px] font-semibold text-warn">DEMO</span> : null}
                  </span>
                  {o.org_id === user.orgId ? <Check className="size-4 text-primary" aria-label="Actual" /> : null}
                </button>
              ))}
            </div>
          ) : null}
          <Link href="/perfil" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-surface-2">
            <UserRound className="size-4 text-muted" aria-hidden /> Mi perfil y contraseña
          </Link>
          <button role="menuitem" onClick={toggleTheme} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-surface-2">
            {dark ? <Sun className="size-4 text-muted" aria-hidden /> : <Moon className="size-4 text-muted" aria-hidden />}
            {dark ? "Modo claro" : "Modo oscuro"}
          </button>
          <form action={logoutAction}>
            <button role="menuitem" type="submit" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-bad hover:bg-bad-soft">
              <LogOut className="size-4" aria-hidden /> Cerrar sesión
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
