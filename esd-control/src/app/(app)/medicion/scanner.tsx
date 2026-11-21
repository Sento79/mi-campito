"use client";
import * as React from "react";
import { ScanLine, Camera, Settings2, Keyboard } from "lucide-react";
import { Button, Field, Input, Select, cn } from "@/components/ui/core";
import { Modal } from "@/components/ui/client";
import { ScanBuffer, normalizeScanValue, type ScannerConfig } from "@/lib/domain/scanner";

const LS_KEY = "esd-scanner-config";

export function useScannerConfig(orgDefault: ScannerConfig) {
  const [cfg, setCfg] = React.useState<ScannerConfig>(orgDefault);
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setCfg({ ...orgDefault, ...JSON.parse(raw) });
    } catch {}
  }, [orgDefault]);
  const save = (c: ScannerConfig) => {
    setCfg(c);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(c));
    } catch {}
  };
  return [cfg, save] as const;
}

/**
 * Captura global de lectores HID. Solo actúa cuando el foco NO está en un
 * campo editable (para no robar lo que se escribe en formularios) o cuando
 * está en el propio campo de escaneo. Distingue lector de teclado humano por
 * la cadencia (ScanBuffer).
 */
export function useHidCapture(cfg: ScannerConfig, enabled: boolean, onScan: (code: string) => void, scanInput: React.RefObject<HTMLInputElement | null>): boolean {
  const [listening, setListening] = React.useState(false);
  const bufRef = React.useRef(new ScanBuffer(cfg));
  const cb = React.useRef(onScan);
  cb.current = onScan;
  React.useEffect(() => bufRef.current.setConfig(cfg), [cfg]);
  React.useEffect(() => {
    if (!enabled) return;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const editable = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (editable && t !== scanInput.current) return; // no interferir con formularios
      if (t === scanInput.current) return; // el campo visible gestiona su propio Enter
      const ev = bufRef.current.push(e.key, performance.now());
      if (ev.type === "scan") {
        e.preventDefault();
        cb.current(normalizeScanValue(ev.code));
      } else if (cfg.suffix === "none") {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          const r = bufRef.current.idle(performance.now());
          if (r.type === "scan") cb.current(normalizeScanValue(r.code));
        }, cfg.idleTimeoutMs + 10);
      }
    };
    window.addEventListener("keydown", onKey, true);
    setListening(true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      setListening(false);
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, [enabled, cfg, scanInput]);
  return listening;
}

export function ScanBar({
  inputRef,
  onSubmit,
  busy,
  cfg,
  onConfig,
  captureActive,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onSubmit: (code: string) => void;
  busy: boolean;
  cfg: ScannerConfig;
  onConfig: (c: ScannerConfig) => void;
  captureActive: boolean;
}) {
  const [value, setValue] = React.useState("");
  const [camOpen, setCamOpen] = React.useState(false);
  const [cfgOpen, setCfgOpen] = React.useState(false);
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          const v = normalizeScanValue(value, cfg.prefix);
          if (v) onSubmit(v);
          setValue("");
        }}
      >
        <div className="relative flex-1">
          <ScanLine className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-primary" aria-hidden />
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              // Lectores configurados con Tab como sufijo: enviar en lugar de saltar de campo
              if (cfg.suffix === "Tab" && e.key === "Tab" && value.trim()) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Escanee el QR / código de barras o escriba el ID y pulse Enter"
            aria-label="Código del activo"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="h-14 w-full rounded-lg border-2 border-line-strong bg-surface pr-4 pl-11 font-mono text-lg tracking-wide placeholder:font-sans placeholder:text-sm placeholder:tracking-normal placeholder:text-faint focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15"
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="lg" loading={busy} className="flex-1 sm:flex-none">Buscar</Button>
          <Button type="button" size="lg" variant="outline" icon={Camera} onClick={() => setCamOpen(true)} aria-label="Escanear con cámara">
            <span className="hidden md:inline">Cámara</span>
          </Button>
          <Button type="button" size="lg" variant="ghost" icon={Settings2} onClick={() => setCfgOpen(true)} aria-label="Configurar lector" />
        </div>
      </form>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
        <Keyboard className="size-3.5" aria-hidden />
        <span className={cn("inline-block size-2 rounded-full", captureActive ? "bg-ok" : "bg-faint")} aria-hidden />
        <span data-hid-ready={captureActive ? "1" : "0"}>{captureActive ? "Lector HID activo: puede escanear sin hacer clic en el campo." : "Iniciando lector… (puede usar el campo de arriba)"}</span>
        <span className="ml-auto hidden sm:inline">F2 enfocar · Ctrl+Enter guardar · Alt+M medición rápida</span>
      </p>
      {camOpen ? <CameraScanner onClose={() => setCamOpen(false)} onCode={(c) => { setCamOpen(false); onSubmit(normalizeScanValue(c, cfg.prefix)); }} /> : null}
      {cfgOpen ? <ScannerConfigModal cfg={cfg} onClose={() => setCfgOpen(false)} onSave={(c) => { onConfig(c); setCfgOpen(false); }} /> : null}
    </div>
  );
}

function CameraScanner({ onClose, onCode }: { onClose: () => void; onCode: (c: string) => void }) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Este navegador no permite usar la cámara (requiere HTTPS o localhost).");
        return;
      }
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints({ video: { facingMode: "environment" } }, videoRef.current!, (res, _err, ctrl) => {
          if (res && !cancelled) {
            cancelled = true;
            ctrl.stop();
            onCode(res.getText());
          }
        });
        stop = () => controls.stop();
        if (cancelled) controls.stop();
      } catch (e) {
        setError(e instanceof Error && e.name === "NotAllowedError" ? "Permiso de cámara denegado. Puede usar el lector o escribir el ID." : "No se pudo iniciar la cámara.");
      }
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [onCode]);
  return (
    <Modal open onClose={onClose} title="Escanear con cámara" description="Apunte al QR o código de barras de la etiqueta." size="lg">
      {error ? <p className="text-sm text-bad">{error}</p> : <video ref={videoRef} className="aspect-video w-full rounded-lg bg-black object-cover" muted playsInline />}
    </Modal>
  );
}

function ScannerConfigModal({ cfg, onClose, onSave }: { cfg: ScannerConfig; onClose: () => void; onSave: (c: ScannerConfig) => void }) {
  const [c, setC] = React.useState(cfg);
  const [test, setTest] = React.useState<{ code: string; ms: number } | null>(null);
  const buf = React.useRef(new ScanBuffer(c));
  const times = React.useRef<number[]>([]);
  React.useEffect(() => buf.current.setConfig(c), [c]);
  return (
    <Modal open onClose={onClose} title="Configuración del lector" description="Se guarda en este dispositivo. Por defecto se usa la configuración de la organización." footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={() => onSave(c)}>Guardar</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Sufijo que envía el lector" htmlFor="sc-suffix">
          <Select id="sc-suffix" value={c.suffix} onChange={(e) => setC({ ...c, suffix: e.target.value as ScannerConfig["suffix"] })}>
            <option value="Enter">Enter (habitual)</option>
            <option value="Tab">Tabulador</option>
            <option value="none">Ninguno (por inactividad)</option>
          </Select>
        </Field>
        <Field label="Prefijo a eliminar" htmlFor="sc-prefix" hint="Si el lector añade un prefijo fijo">
          <Input id="sc-prefix" value={c.prefix ?? ""} onChange={(e) => setC({ ...c, prefix: e.target.value })} />
        </Field>
        <Field label="Intervalo máx. entre caracteres (ms)" htmlFor="sc-gap" hint="Lectores típicos: 5–30 ms. Teclado humano: >80 ms">
          <Input id="sc-gap" type="number" min={10} max={300} value={c.maxInterKeyMs} onChange={(e) => setC({ ...c, maxInterKeyMs: Number(e.target.value) || 50 })} />
        </Field>
        <Field label="Longitud mínima" htmlFor="sc-min">
          <Input id="sc-min" type="number" min={1} max={40} value={c.minLength} onChange={(e) => setC({ ...c, minLength: Number(e.target.value) || 3 })} />
        </Field>
      </div>
      <div className="mt-4 rounded-lg border border-dashed border-line-strong p-4">
        <p className="text-sm font-medium">Prueba de lectura</p>
        <p className="text-xs text-muted">Haga clic en el recuadro y escanee una etiqueta.</p>
        <input
          aria-label="Zona de prueba del lector"
          className="mt-2 h-10 w-full rounded-md border border-line bg-surface-2 px-3 font-mono text-sm"
          onKeyDown={(e) => {
            const now = performance.now();
            if (e.key.length === 1) times.current.push(now);
            const ev = buf.current.push(e.key, now);
            if (e.key === c.suffix || ev.type === "scan") e.preventDefault();
            if (ev.type === "scan") {
              const t = times.current;
              const avg = t.length > 1 ? (t[t.length - 1] - t[0]) / (t.length - 1) : 0;
              setTest({ code: ev.code, ms: Math.round(avg) });
              times.current = [];
              (e.target as HTMLInputElement).value = "";
            }
          }}
        />
        {test ? (
          <p className="mt-2 text-sm text-ok">Leído: <span className="font-mono">{test.code}</span> · {test.ms} ms entre caracteres</p>
        ) : (
          <p className="mt-2 text-xs text-muted">Si el código no se reconoce, aumente el intervalo o revise el sufijo.</p>
        )}
      </div>
    </Modal>
  );
}
