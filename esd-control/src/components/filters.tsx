"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

/**
 * Barra de filtros basada en la URL (enlaces compartibles). Recuerda los
 * últimos filtros de cada listado en este navegador (persistencia razonable).
 */
export function FilterBar({ children, storageKey }: { children: React.ReactNode; storageKey?: string }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const restored = React.useRef(false);

  React.useEffect(() => {
    if (!storageKey || restored.current) return;
    restored.current = true;
    try {
      if ([...sp.keys()].length === 0) {
        const saved = localStorage.getItem(`esd-filters:${storageKey}`);
        if (saved) router.replace(`${path}?${saved}`);
      }
    } catch {}
  }, [storageKey, sp, path, router]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const p = new URLSearchParams();
    for (const [k, v] of fd.entries()) if (typeof v === "string" && v.trim()) p.set(k, v.trim());
    const qs = p.toString();
    try {
      if (storageKey) localStorage.setItem(`esd-filters:${storageKey}`, qs);
    } catch {}
    router.push(qs ? `${path}?${qs}` : path);
  };
  const clear = () => {
    try {
      if (storageKey) localStorage.removeItem(`esd-filters:${storageKey}`);
    } catch {}
    router.push(path);
  };
  const active = [...sp.keys()].filter((k) => k !== "page").length;
  return (
    <form onSubmit={onSubmit} onChange={(e) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "SELECT" || (t as HTMLInputElement).type === "date") (e.currentTarget as HTMLFormElement).requestSubmit();
    }} className="mb-4 flex flex-wrap items-end gap-2" role="search" key={sp.toString()}>
      {children}
      <button type="submit" className="h-10 rounded-md border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-surface-2">
        Filtrar
      </button>
      {active ? (
        <button type="button" onClick={clear} className="flex h-10 items-center gap-1 rounded-md px-2 text-sm text-muted hover:text-fg">
          <X className="size-4" aria-hidden /> Limpiar ({active})
        </button>
      ) : null}
    </form>
  );
}

export function FilterSelect({ name, label, options, defaultValue, allLabel = "Todos" }: { name: string; label: string; options: { id: string; label: string }[]; defaultValue?: string; allLabel?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted">
      {label}
      <select name={name} defaultValue={defaultValue ?? ""} className="h-10 w-48 max-w-full rounded-md border border-line-strong bg-surface px-2.5 text-sm text-fg focus:border-primary focus:outline-none">
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterInput({ name, label, defaultValue, type = "text", placeholder }: { name: string; label: string; defaultValue?: string; type?: string; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted">
      {label}
      <input name={name} type={type} defaultValue={defaultValue} placeholder={placeholder} className="h-10 min-w-36 rounded-md border border-line-strong bg-surface px-2.5 text-sm text-fg focus:border-primary focus:outline-none" />
    </label>
  );
}

export function Pagination({ page, total, limit }: { page: number; total: number; limit: number }) {
  const sp = useSearchParams();
  const path = usePathname();
  const pages = Math.max(1, Math.ceil(total / limit));
  const href = (p: number) => {
    const q = new URLSearchParams(sp.toString());
    q.set("page", String(p));
    return `${path}?${q}`;
  };
  return (
    <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-muted">
      <span>
        {total === 0 ? "Sin resultados" : `${(page - 1) * limit + 1}–${Math.min(page * limit, total)} de ${total}`}
      </span>
      <div className="flex gap-1">
        <a aria-disabled={page <= 1} href={page > 1 ? href(page - 1) : undefined} className="rounded-md border border-line px-3 py-1 aria-disabled:pointer-events-none aria-disabled:opacity-40 hover:bg-surface-2">
          Anterior
        </a>
        <span className="px-2 py-1">
          {page} / {pages}
        </span>
        <a aria-disabled={page >= pages} href={page < pages ? href(page + 1) : undefined} className="rounded-md border border-line px-3 py-1 aria-disabled:pointer-events-none aria-disabled:opacity-40 hover:bg-surface-2">
          Siguiente
        </a>
      </div>
    </div>
  );
}
