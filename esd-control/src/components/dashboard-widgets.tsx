"use client";
import * as React from "react";
import { SlidersHorizontal } from "lucide-react";
import { Modal } from "@/components/ui/client";
import { Button, Checkbox } from "@/components/ui/core";

const KEY = "esd-dashboard-widgets";
export const WIDGETS = [
  { key: "kpis", label: "Indicadores principales" },
  { key: "trend", label: "Tendencia de mediciones" },
  { key: "categories", label: "Resultado por categoría" },
  { key: "upcoming", label: "Próximas tareas" },
  { key: "recent", label: "Últimas actividades" },
] as const;

const Ctx = React.createContext<Record<string, boolean>>({});

/** Dashboard personalizable: cada usuario elige qué bloques ver (guardado en el navegador). */
export function DashboardCustomizer({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = React.useState<Record<string, boolean>>({});
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    try {
      setHidden(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
    } catch {}
  }, []);
  const save = (h: Record<string, boolean>) => {
    setHidden(h);
    try {
      localStorage.setItem(KEY, JSON.stringify(h));
    } catch {}
  };
  return (
    <Ctx.Provider value={hidden}>
      <div className="mb-3 flex justify-end">
        <Button variant="ghost" size="sm" icon={SlidersHorizontal} onClick={() => setOpen(true)}>
          Personalizar
        </Button>
      </div>
      {children}
      <Modal open={open} onClose={() => setOpen(false)} title="Personalizar dashboard" description="Elija los bloques visibles. Se guarda en este navegador." size="sm">
        <div className="space-y-3">
          {WIDGETS.map((w) => (
            <div key={w.key}>
              <Checkbox label={w.label} checked={!hidden[w.key]} onChange={(e) => save({ ...hidden, [w.key]: !e.target.checked })} />
            </div>
          ))}
        </div>
      </Modal>
    </Ctx.Provider>
  );
}

export function Widget({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  const hidden = React.useContext(Ctx);
  if (hidden[id]) return null;
  return <div className={className}>{children}</div>;
}
