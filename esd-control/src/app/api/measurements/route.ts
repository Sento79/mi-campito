import { NextResponse } from "next/server";
import { api } from "@/lib/server/api";
import { withCtx } from "@/lib/server/db";
import { recordMeasurement, recordMeasurementSchema } from "@/lib/server/services/measurements";

/** Registro de mediciones (también usado por la cola offline). Idempotente por clientId. */
export const POST = api({ permission: "measure", mutating: true }, async (req, s) => {
  const body = await req.json().catch(() => null);
  const parsed = recordMeasurementSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos de medición no válidos", issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  }
  const r = await withCtx(s, (tx) => recordMeasurement(tx, s, s.org.settings, parsed.data));
  return NextResponse.json(r, { status: r.duplicate ? 200 : 201 });
});
