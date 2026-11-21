/**
 * Logger estructurado (JSON por línea). Nunca registra contraseñas, tokens,
 * cookies ni valores de formularios: solo identificadores y códigos.
 */
const SENSITIVE = /pass|token|secret|cookie|authorization|hash/i;

function scrub(meta: Record<string, unknown> | undefined) {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) out[k] = SENSITIVE.test(k) ? "[redactado]" : v;
  return out;
}

function write(level: "info" | "warn" | "error", event: string, meta?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test" && level === "info") return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...scrub(meta) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (e: string, m?: Record<string, unknown>) => write("info", e, m),
  warn: (e: string, m?: Record<string, unknown>) => write("warn", e, m),
  error: (e: string, err?: unknown, m?: Record<string, unknown>) =>
    write("error", e, { ...m, error: err instanceof Error ? err.message : String(err), code: (err as { code?: string })?.code }),
};
