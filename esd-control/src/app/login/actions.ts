"use server";
import { z } from "zod";
import { login } from "@/lib/server/auth";
import { logger } from "@/lib/server/logger";

const schema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(200) });

export async function loginAction(raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const p = schema.safeParse(raw);
  if (!p.success) return { ok: false, error: "Credenciales no válidas" };
  try {
    return await login(p.data.email, p.data.password);
  } catch (e) {
    logger.error("auth.login_error", e);
    return { ok: false, error: "No se pudo iniciar sesión. Inténtelo de nuevo." };
  }
}
