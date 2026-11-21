import "server-only";
import { z } from "zod";
import { requireSession, type SessionInfo } from "./auth";
import { withCtx, type Tx } from "./db";
import { ForbiddenError, toUserMessage } from "./errors";
import { logger } from "./logger";
import type { Permission } from "@/lib/domain/permissions";

export type ActionResult<T = unknown> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Envoltorio de Server Actions:
 *  1) exige sesión, 2) comprueba permisos, 3) valida con Zod,
 *  4) ejecuta en transacción con contexto RLS, 5) traduce errores.
 * Next.js protege las Server Actions contra CSRF comparando Origin/Host.
 */
export function defineAction<S extends z.ZodType, T>(
  opts: { permission?: Permission | Permission[]; schema: S },
  handler: (input: z.infer<S>, ctx: { tx: Tx; session: SessionInfo }) => Promise<T>,
) {
  return async (raw: unknown): Promise<ActionResult<T>> => {
    let session: SessionInfo;
    try {
      session = await requireSession();
    } catch (e) {
      throw e; // redirect a /login
    }
    try {
      const perms = opts.permission ? (Array.isArray(opts.permission) ? opts.permission : [opts.permission]) : [];
      if (perms.length && !perms.some((p) => session.permissions.has(p))) {
        throw new ForbiddenError(`Se requiere el permiso: ${perms.join(" o ")}`);
      }
      const parsed = opts.schema.safeParse(raw);
      if (!parsed.success) {
        const fieldErrors: Record<string, string> = {};
        for (const i of parsed.error.issues) {
          const k = i.path.join(".") || "_";
          if (!fieldErrors[k]) fieldErrors[k] = i.message;
        }
        return { ok: false, error: "Revise los datos del formulario", fieldErrors };
      }
      const data = await withCtx(session, (tx) => handler(parsed.data, { tx, session }));
      return { ok: true, data };
    } catch (e) {
      const u = toUserMessage(e);
      if (u.status >= 500) logger.error("action.failed", e, { userId: session.userId });
      return { ok: false, error: u.message, fieldErrors: u.fieldErrors };
    }
  };
}
