import "server-only";
import { NextResponse } from "next/server";
import { getSession, type SessionInfo } from "./auth";
import { toUserMessage } from "./errors";
import { logger } from "./logger";
import type { Permission } from "@/lib/domain/permissions";

/** Comprobación CSRF para rutas API mutables: el Origin debe coincidir con el Host. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

type Handler = (req: Request, s: SessionInfo, params: Record<string, string>) => Promise<Response>;

export function api(opts: { permission?: Permission; mutating?: boolean }, handler: Handler) {
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }) => {
    try {
      if (opts.mutating && !sameOrigin(req)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
      const s = await getSession();
      if (!s) return NextResponse.json({ error: "Sesión no válida o caducada" }, { status: 401 });
      if (opts.permission && !s.permissions.has(opts.permission)) {
        return NextResponse.json({ error: `Se requiere el permiso «${opts.permission}»` }, { status: 403 });
      }
      const res = await handler(req, s, (await ctx.params) ?? {});
      // Respuestas de una sesión concreta: el navegador no debe reutilizarlas tras cambiar de usuario u organización
      if (!res.headers.has("cache-control") || /private, max-age/.test(res.headers.get("cache-control") ?? "")) res.headers.set("cache-control", "no-store");
      return res;
    } catch (e) {
      const u = toUserMessage(e);
      if (u.status >= 500) logger.error("api.failed", e, { path: new URL(req.url).pathname });
      return NextResponse.json({ error: u.message, fieldErrors: u.fieldErrors }, { status: u.status });
    }
  };
}
