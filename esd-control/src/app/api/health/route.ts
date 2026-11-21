import { NextResponse } from "next/server";
import { getSql } from "@/lib/server/db";

export const dynamic = "force-dynamic";

/** Comprobación de salud para la plataforma de despliegue: la app responde y la base de datos acepta consultas. */
export async function GET() {
  try {
    await getSql()`select 1`;
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Base de datos no disponible" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
