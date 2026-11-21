"use client";
import * as React from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { listNotificationsAction, markNotificationsReadAction } from "./shell-actions";
import { fmtRelative } from "@/lib/format";
import { cn } from "@/components/ui/core";

interface N {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string | Date;
  read_at: string | Date | null;
}

export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<N[] | null>(null);
  const [unread, setUnread] = React.useState(initialUnread);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => setUnread(initialUnread), [initialUnread]);
  React.useEffect(() => {
    if (!open) return;
    listNotificationsAction().then((r) => setItems(r as unknown as N[]));
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-md p-2 text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Avisos${unread ? ` (${unread} sin leer)` : ""}`} aria-expanded={open}>
        <Bell className="size-5" aria-hidden />
        {unread > 0 ? <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] font-semibold text-white">{unread > 99 ? "99+" : unread}</span> : null}
      </button>
      {open ? (
        <div className="animate-in absolute right-0 z-50 mt-1 w-80 rounded-lg border border-line bg-surface shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <p className="text-sm font-semibold">Avisos</p>
            <button
              className="flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
              disabled={!unread}
              onClick={async () => {
                await markNotificationsReadAction("all");
                setUnread(0);
                setItems((x) => x?.map((i) => ({ ...i, read_at: new Date() })) ?? null);
              }}
            >
              <CheckCheck className="size-3.5" aria-hidden /> Marcar leídos
            </button>
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items === null ? <li className="p-4 text-sm text-muted">Cargando…</li> : null}
            {items?.length === 0 ? <li className="p-4 text-sm text-muted">No hay avisos.</li> : null}
            {items?.map((n) => (
              <li key={n.id} className={cn("border-b border-line last:border-0", !n.read_at && "bg-primary-soft/50")}>
                <Link href={n.link ?? "/alertas"} onClick={() => setOpen(false)} className="block px-3 py-2.5 hover:bg-surface-2">
                  <p className="text-sm font-medium">{n.title}</p>
                  {n.body ? <p className="line-clamp-2 text-xs text-muted">{n.body}</p> : null}
                  <p className="mt-1 text-[11px] text-faint">{fmtRelative(n.created_at)}</p>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/alertas" onClick={() => setOpen(false)} className="block border-t border-line px-3 py-2 text-center text-xs font-medium text-primary hover:bg-surface-2">
            Ver centro de alertas
          </Link>
        </div>
      ) : null}
    </div>
  );
}
