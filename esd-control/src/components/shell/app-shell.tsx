"use client";
import * as React from "react";
import Link from "@/components/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, ChevronsLeft, ChevronsRight, Menu, Zap, X, FlaskConical } from "lucide-react";
import { NAV, SEGMENT_LABEL } from "./nav";
import { cn } from "@/components/ui/core";
import { GlobalSearch } from "./global-search";
import { UserMenu } from "./user-menu";
import { NotificationBell } from "./notification-bell";
import { OfflineIndicator } from "./offline-indicator";

export interface ShellUser {
  fullName: string;
  email: string;
  roleName: string;
  orgName: string;
  isDemo: boolean;
  permissions: string[];
  orgs: { org_id: string; org_name: string; is_demo: boolean; role_name: string }[];
  orgId: string;
  unread: number;
}

function isActive(path: string, href: string) {
  if (href === "/") return path === "/";
  return path === href || path.startsWith(href + "/");
}

function Sidebar({ user, collapsed, onNavigate }: { user: ShellUser; collapsed: boolean; onNavigate?: () => void }) {
  const path = usePathname();
  const perms = new Set(user.permissions);
  const [open, setOpen] = React.useState<Record<string, boolean>>(() => ({ "/inventario": path.startsWith("/inventario"), "/admin": path.startsWith("/admin") }));
  return (
    <nav aria-label="Navegación principal" className="flex-1 overflow-y-auto px-2 py-3">
      <ul className="space-y-0.5">
        {NAV.filter((n) => !n.permission || perms.has(n.permission)).map((item) => {
          const active = isActive(path, item.href);
          const Icon = item.icon;
          if (item.children && !collapsed) {
            const children = item.children.filter((c) => !c.permission || perms.has(c.permission));
            const isOpen = open[item.href] ?? active;
            return (
              <li key={item.href}>
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [item.href]: !isOpen }))}
                  aria-expanded={isOpen}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    active ? "text-white" : "text-sidebar-text hover:bg-sidebar-2 hover:text-white",
                  )}
                >
                  <Icon className="size-[18px] shrink-0" aria-hidden />
                  <span className="flex-1 text-left">{item.label}</span>
                  <ChevronDown className={cn("size-4 transition-transform", isOpen && "rotate-180")} aria-hidden />
                </button>
                {isOpen ? (
                  <ul className="mt-0.5 ml-[26px] space-y-0.5 border-l border-white/10 pl-3">
                    {children.map((c) => {
                      const ca = c.href === item.href ? path === c.href || (path.startsWith(c.href + "/") && !children.some((o) => o.href !== c.href && isActive(path, o.href))) : isActive(path, c.href);
                      return (
                        <li key={c.href}>
                          <Link
                            href={c.href}
                            onClick={onNavigate}
                            aria-current={ca ? "page" : undefined}
                            className={cn("block rounded-md px-2.5 py-1.5 text-[13px] transition-colors", ca ? "bg-white/10 text-white" : "text-sidebar-text hover:bg-sidebar-2 hover:text-white")}
                          >
                            {c.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          }
          return (
            <li key={item.href}>
              <Link
                href={item.children ? item.children[0].href : item.href}
                onClick={onNavigate}
                title={collapsed ? item.label : undefined}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  collapsed && "justify-center px-0",
                  active ? "bg-white/10 text-white" : "text-sidebar-text hover:bg-sidebar-2 hover:text-white",
                )}
              >
                <Icon className="size-[18px] shrink-0" aria-hidden />
                {collapsed ? <span className="sr-only">{item.label}</span> : <span>{item.label}</span>}
                {active && !collapsed ? <span className="ml-auto h-4 w-0.5 rounded bg-[#3aa5cc]" aria-hidden /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Breadcrumbs() {
  const path = usePathname();
  const segs = path.split("/").filter(Boolean);
  if (segs.length === 0) return <span className="text-sm font-medium text-fg">Dashboard</span>;
  let acc = "";
  return (
    <nav aria-label="Migas de pan" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        <li>
          <Link href="/" className="text-muted hover:text-fg">
            Inicio
          </Link>
        </li>
        {segs.map((s, i) => {
          acc += "/" + s;
          const last = i === segs.length - 1;
          const label = SEGMENT_LABEL[s] ?? (/^[0-9a-f-]{36}$/.test(s) ? "Detalle" : decodeURIComponent(s));
          return (
            <li key={acc} className="flex min-w-0 items-center gap-1.5">
              <span className="text-faint" aria-hidden>
                /
              </span>
              {last ? (
                <span className="truncate font-medium text-fg" aria-current="page">
                  {label}
                </span>
              ) : (
                <Link href={acc} className="truncate text-muted hover:text-fg">
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function AppShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const router = useRouter();

  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("esd-sidebar") === "collapsed");
    } catch {}
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("esd-sidebar", c ? "open" : "collapsed");
      } catch {}
      return !c;
    });
  };

  // Atajos globales: Alt+M medición rápida
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "m" || e.key === "M")) {
        e.preventDefault();
        router.push("/medicion");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const brand = (
    <div className={cn("flex h-14 items-center gap-2.5 border-b border-white/10 px-4", collapsed && "justify-center px-0")}>
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-[#3aa5cc]/15 text-[#3aa5cc]">
        <Zap className="size-4" aria-hidden />
      </span>
      {!collapsed ? (
        <div className="min-w-0 leading-tight">
          <p className="text-sm font-semibold text-white">ESD Control</p>
          <p className="truncate text-[11px] text-sidebar-text">{user.orgName}</p>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Saltar al contenido
      </a>
      {/* Escritorio/tablet */}
      <aside className={cn("no-print sticky top-0 hidden h-screen shrink-0 flex-col bg-sidebar transition-[width] duration-200 md:flex", collapsed ? "w-16" : "w-64")}>
        {brand}
        <Sidebar user={user} collapsed={collapsed} />
        <button
          onClick={toggle}
          className="flex h-11 items-center justify-center gap-2 border-t border-white/10 text-xs text-sidebar-text hover:bg-sidebar-2 hover:text-white"
          aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
        >
          {collapsed ? <ChevronsRight className="size-4" /> : (<><ChevronsLeft className="size-4" /> Contraer</>)}
        </button>
      </aside>
      {/* Móvil */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-sidebar">
            <div className="flex items-center justify-between pr-2">
              {brand}
              <button onClick={() => setMobileOpen(false)} className="p-2 text-sidebar-text" aria-label="Cerrar menú">
                <X className="size-5" />
              </button>
            </div>
            <Sidebar user={user} collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {user.isDemo ? (
          <div className="no-print flex items-center justify-center gap-2 bg-warn-soft px-4 py-1.5 text-xs font-medium text-warn" role="status">
            <FlaskConical className="size-3.5" aria-hidden />
            Organización de DEMOSTRACIÓN: datos ficticios y criterios ilustrativos, no válidos para decisiones de calidad.
          </div>
        ) : null}
        <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur md:px-6">
          <button className="rounded p-1.5 text-muted hover:bg-surface-2 md:hidden" onClick={() => setMobileOpen(true)} aria-label="Abrir menú">
            <Menu className="size-5" />
          </button>
          <div className="hidden min-w-0 flex-1 md:block">
            <Breadcrumbs />
          </div>
          <div className="flex flex-1 items-center justify-end gap-2 md:flex-none">
            <OfflineIndicator />
            <GlobalSearch />
            <NotificationBell initialUnread={user.unread} />
            <UserMenu user={user} />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-6 md:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
