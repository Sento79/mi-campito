import { NextResponse } from "next/server";
import { api } from "@/lib/server/api";
import { withCtx } from "@/lib/server/db";
import { audit } from "@/lib/server/audit";
import { buildReport } from "@/lib/server/reports";

const TYPES = ["summary", "measurements", "overdue", "instruments", "nonconformities"];

export const GET = api({ permission: "reports" }, async (req, s, params) => {
  if (!TYPES.includes(params.type)) return NextResponse.json({ error: "Tipo de informe no válido" }, { status: 404 });
  const sp = Object.fromEntries([...new URL(req.url).searchParams.entries()].filter(([k, v]) => v && (["from", "to"].includes(k) ? /^\d{4}-\d{2}-\d{2}$/.test(v) : ["location", "category", "campaign"].includes(k) ? /^[0-9a-f-]{36}$/.test(v) : ["result", "status"].includes(k))));
  const r = await withCtx(s, async (tx) => {
    const out = await buildReport(tx, s, params.type, sp);
    await audit(tx, s, { action: "report", entityType: "report", entityId: params.type, summary: `Informe PDF generado: ${params.type}`, after: { filters: sp } });
    return out;
  });
  if (!r) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return new NextResponse(new Uint8Array(r.pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${r.name}-${new Date().toISOString().slice(0, 10)}.pdf"` } });
});
