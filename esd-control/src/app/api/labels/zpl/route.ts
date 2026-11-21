import { NextResponse } from "next/server";
import { api } from "@/lib/server/api";
import { withCtx } from "@/lib/server/db";
import { audit } from "@/lib/server/audit";
import { labelData } from "@/lib/server/labels";
import { labelRequestSchema } from "@/lib/server/labels-request";
import { toZpl } from "@/lib/domain/labels";

/** ZPL II para impresoras Zebra: se descarga y se envía a la impresora (ver README). */
export const POST = api({ permission: "read", mutating: true }, async (req, s) => {
  const p = labelRequestSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Datos no válidos" }, { status: 400 });
  const items = await withCtx(s, async (tx) => {
    const it = await labelData(tx, p.data.assetIds);
    await audit(tx, s, { action: "print_labels", entityType: "asset", summary: `Etiquetas ZPL generadas (${it.length})` });
    return it;
  });
  const zpl = items.map((i) => toZpl(i, p.data.widthMm, p.data.heightMm, p.data.layout)).join("\n");
  return new NextResponse(zpl, { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="etiquetas.zpl"` } });
});
