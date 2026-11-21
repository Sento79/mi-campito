import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getSql } from "@/lib/server/db";
import { logger } from "@/lib/server/logger";

/**
 * Generación periódica de notificaciones de alerta (idempotente).
 * Protegida por CRON_SECRET: Authorization: Bearer <CRON_SECRET>.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!secret || secret.length < 16 || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    const [r] = await getSql()`select app_generate_alert_notifications() as n`;
    logger.info("cron.alerts", { created: r.n });
    return NextResponse.json({ created: r.n });
  } catch (e) {
    logger.error("cron.alerts_failed", e);
    return NextResponse.json({ error: "Error al generar alertas" }, { status: 500 });
  }
}
