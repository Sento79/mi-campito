"use client";
import * as React from "react";
import { X, CheckCircle2, AlertTriangle, XCircle, Info } from "lucide-react";
import { Button, cn } from "./core";

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
type ToastTone = "ok" | "bad" | "warn" | "info";
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
}
const ToastCtx = React.createContext<(t: Omit<ToastItem, "id">) => void>(() => {});
export const useToast = () => React.useContext(ToastCtx);

const toneIcon = { ok: CheckCircle2, bad: XCircle, warn: AlertTriangle, info: Info };
const toneBar = { ok: "border-l-ok", bad: "border-l-bad", warn: "border-l-warn", info: "border-l-info" };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const push = React.useCallback((t: Omit<ToastItem, "id">) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), t.tone === "bad" ? 9000 : 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6" aria-live="polite">
        {items.map((t) => {
          const Icon = toneIcon[t.tone];
          return (
            <div key={t.id} role={t.tone === "bad" ? "alert" : "status"} className={cn("animate-in pointer-events-auto flex w-full max-w-sm gap-3 rounded-lg border border-line border-l-4 bg-surface p-3 shadow-lg", toneBar[t.tone])}>
              <Icon className={cn("mt-0.5 size-5 shrink-0", { ok: "text-ok", bad: "text-bad", warn: "text-warn", info: "text-info" }[t.tone])} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-fg">{t.title}</p>
                {t.body ? <p className="mt-0.5 text-sm text-muted whitespace-pre-line">{t.body}</p> : null}
              </div>
              <button className="text-faint hover:text-fg" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))} aria-label="Cerrar aviso">
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------------------------------------------------------------------------
// Diálogo modal accesible (elemento <dialog> nativo: foco atrapado y Escape)
// ---------------------------------------------------------------------------
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const w = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={cn("m-auto w-[calc(100%-2rem)] rounded-xl border border-line bg-surface p-0 text-fg shadow-2xl", w)}
      aria-labelledby="modal-title"
    >
      {open ? (
        <div className="animate-in">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 id="modal-title" className="text-base font-semibold">
                {title}
              </h2>
              {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
            </div>
            <button onClick={onClose} className="rounded p-1 text-faint hover:bg-surface-2 hover:text-fg" aria-label="Cerrar">
              <X className="size-4" />
            </button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex justify-end gap-2 border-t border-line bg-surface-2/50 px-5 py-3">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}

/** Confirmación con motivo opcional/obligatorio. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirmar",
  danger,
  reason,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  reason?: "required" | "optional";
  loading?: boolean;
}) {
  const [text, setText] = React.useState("");
  React.useEffect(() => {
    if (open) setText("");
  }, [open]);
  const disabled = reason === "required" && text.trim().length < 3;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant={danger ? "danger" : "primary"} disabled={disabled} loading={loading} onClick={() => onConfirm(text.trim())}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description ? <div className="text-sm text-muted">{description}</div> : null}
      {reason ? (
        <div className="mt-3 space-y-1.5">
          <label htmlFor="confirm-reason" className="text-sm font-medium">
            Motivo {reason === "required" ? <span className="text-bad">*</span> : <span className="text-faint">(opcional)</span>}
          </label>
          <textarea
            id="confirm-reason"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-20 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
            maxLength={500}
            autoFocus
          />
        </div>
      ) : null}
    </Modal>
  );
}

/** Ejecuta una Server Action mostrando toasts y evitando doble envío. */
export function useAction<I, T>(fn: (i: I) => Promise<{ ok: true; data: T; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> }>) {
  const toast = useToast();
  const [pending, setPending] = React.useState(false);
  const busy = React.useRef(false);
  const run = React.useCallback(
    async (input: I, opts?: { success?: string; silent?: boolean }) => {
      if (busy.current) return null;
      busy.current = true;
      setPending(true);
      try {
        const r = await fn(input);
        if (!r.ok) {
          toast({ tone: "bad", title: r.error, body: r.fieldErrors ? [...new Set(Object.values(r.fieldErrors))].slice(0, 4).join("\n") : undefined });
          return r;
        }
        if (opts?.success && !opts.silent) toast({ tone: "ok", title: opts.success });
        return r;
      } catch (e) {
        // Las redirecciones de Next.js se propagan
        if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
        toast({ tone: "bad", title: "No se pudo completar la operación", body: "Compruebe la conexión e inténtelo de nuevo." });
        return null;
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [fn, toast],
  );
  return { run, pending };
}
