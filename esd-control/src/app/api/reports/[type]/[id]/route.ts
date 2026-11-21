import { NextResponse } from "next/server";
import { api } from "@/lib/server/api";
import { withCtx } from "@/lib/server/db";
import { audit } from "@/lib/server/audit";
import { buildReport } from "@/lib/server/reports";

export const GET = api({ permission: "reports" }, async (_req, s, params) => {
  if (!["campaign", "asset"].includes(params.type) || !/^[0-9a-f-]{36}$/.test(params.id)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const r = await withCtx(s, async (tx) => {
    const out = await buildReport(tx, s, params.type, {}, params.id);
    if (out) await audit(tx, s, { action: "report", entityType: params.type, entityId: params.id, summary: `Informe PDF generado: ${out.name}` });
    return out;
  });
  if (!r) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return new NextResponse(new Uint8Array(r.pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${r.name}.pdf"` } });
});
