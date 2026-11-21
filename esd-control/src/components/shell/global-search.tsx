"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, Boxes, MapPin, CalendarRange, Gauge, ShieldAlert, Map } from "lucide-react";
import { cn } from "@/components/ui/core";

interface Hit {
  type: "asset" | "location" | "campaign" | "instrument" | "nc" | "plan";
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}
const ICON = { asset: Boxes, location: MapPin, campaign: CalendarRange, instrument: Gauge, nc: ShieldAlert, plan: Map };
const GROUP = { asset: "Activos", location: "Ubicaciones", campaign: "Campañas", instrument: "Instrumentos", nc: "No conformidades", plan: "Planos" };

export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<Hit[]>([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [sel, setSel] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal });
        if (r.ok) {
          setHits((await r.json()).hits);
          setSel(0);
        }
      } catch {
        /* cancelada */
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const go = (h: Hit) => {
    setOpen(false);
    setQ("");
    router.push(h.href);
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" aria-hidden />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter" && hits[sel]) {
              e.preventDefault();
              go(hits[sel]);
            } else if (e.key === "Escape") {
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Buscar ID, QR, serie, ubicación…"
          aria-label="Búsqueda global"
          role="combobox"
          aria-expanded={open && hits.length > 0}
          aria-controls="search-results"
          className="h-9 w-44 rounded-md border border-line bg-surface-2 pr-10 pl-8 text-sm placeholder:text-faint focus:w-72 focus:border-primary focus:bg-surface focus:outline-none sm:w-64 transition-[width]"
        />
        <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border border-line bg-surface px-1 text-[10px] text-faint sm:block">Ctrl K</kbd>
      </div>
      {open && q.trim().length >= 2 ? (
        <div id="search-results" role="listbox" className="animate-in absolute right-0 z-50 mt-1 max-h-[70vh] w-[min(26rem,90vw)] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-xl">
          {loading && hits.length === 0 ? <p className="px-3 py-2 text-sm text-muted">Buscando…</p> : null}
          {!loading && hits.length === 0 ? <p className="px-3 py-2 text-sm text-muted">Sin resultados para «{q}»</p> : null}
          {hits.map((h, i) => {
            const Icon = ICON[h.type];
            const header = i === 0 || hits[i - 1].type !== h.type;
            return (
              <React.Fragment key={h.type + h.id}>
                {header ? <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">{GROUP[h.type]}</p> : null}
                <button
                  role="option"
                  aria-selected={i === sel}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(h)}
                  onMouseEnter={() => setSel(i)}
                  className={cn("flex w-full items-center gap-3 rounded-md px-3 py-2 text-left", i === sel ? "bg-primary-soft" : "hover:bg-surface-2")}
                >
                  <Icon className="size-4 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{h.title}</span>
                    {h.subtitle ? <span className="block truncate text-xs text-muted">{h.subtitle}</span> : null}
                  </span>
                </button>
              </React.Fragment>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
