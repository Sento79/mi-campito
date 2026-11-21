/**
 * Detección de lectores HID (USB/Bluetooth que actúan como teclado).
 *
 * Un lector "teclea" muy rápido una secuencia y termina con un sufijo
 * (Enter, Tab o ninguno). Distinguimos lectura de escritura humana por el
 * intervalo entre pulsaciones. La lógica es pura para poder probarla.
 */
export interface ScannerConfig {
  /** Sufijo que envía el lector. 'none' = se cierra por inactividad. */
  suffix: "Enter" | "Tab" | "none";
  /** Prefijo opcional configurado en el lector (se elimina). */
  prefix?: string;
  /** Intervalo máximo entre caracteres para considerarlos del lector (ms). */
  maxInterKeyMs: number;
  /** Longitud mínima de un código válido. */
  minLength: number;
  /** Para suffix 'none': ms de inactividad que cierran la lectura. */
  idleTimeoutMs: number;
}

export const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  suffix: "Enter",
  prefix: "",
  maxInterKeyMs: 50,
  minLength: 3,
  idleTimeoutMs: 80,
};

export type ScanEvent = { type: "scan"; code: string } | { type: "none" };

export class ScanBuffer {
  private chars: string[] = [];
  private lastTs = 0;

  constructor(private config: ScannerConfig) {}

  setConfig(c: ScannerConfig) {
    this.config = c;
    this.reset();
  }

  reset() {
    this.chars = [];
    this.lastTs = 0;
  }

  /**
   * Procesa una tecla. El búfer solo contiene secuencias "rápidas": una pausa
   * mayor que maxInterKeyMs descarta lo acumulado (escritura humana) o, con
   * sufijo 'none', cierra la lectura anterior.
   */
  push(key: string, ts: number): ScanEvent {
    const gap = this.lastTs ? ts - this.lastTs : 0;
    let emitted: ScanEvent = { type: "none" };
    if (this.chars.length && gap > this.config.maxInterKeyMs) {
      emitted = this.config.suffix === "none" ? this.flush() : { type: "none" };
      this.chars = [];
    }
    this.lastTs = ts;
    if (key === this.config.suffix) {
      return this.flush();
    }
    if (key.length === 1) this.chars.push(key);
    return emitted;
  }

  /** Para suffix 'none': llamar tras idleTimeoutMs sin teclas. */
  idle(ts: number): ScanEvent {
    if (this.config.suffix !== "none" || !this.chars.length) return { type: "none" };
    if (ts - this.lastTs < this.config.idleTimeoutMs) return { type: "none" };
    return this.flush();
  }

  private flush(): ScanEvent {
    let code = this.chars.join("");
    this.chars = [];
    if (this.config.prefix && code.startsWith(this.config.prefix)) code = code.slice(this.config.prefix.length);
    code = code.trim();
    if (code.length >= this.config.minLength) return { type: "scan", code };
    return { type: "none" };
  }
}

/** Normaliza el valor escaneado o tecleado para buscarlo. */
export function normalizeScanValue(raw: string, prefix = ""): string {
  let v = raw.replace(/[\r\n\t]/g, "").trim();
  if (prefix && v.startsWith(prefix)) v = v.slice(prefix.length);
  // Si el QR contiene un enlace de la propia app (/a/<codigo>), extraemos el código.
  const m = /\/a\/([A-Za-z0-9_.\-%]+)\/?$/.exec(v);
  if (m) v = decodeURIComponent(m[1]);
  return v.slice(0, 120);
}
