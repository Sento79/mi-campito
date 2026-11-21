import { NextResponse } from "next/server";
import { api } from "@/lib/server/api";
import { withCtx } from "@/lib/server/db";
import { audit } from "@/lib/server/audit";
import { storage } from "@/lib/server/storage";
import { labelData, labelsPdf } from "@/lib/server/labels";
import { labelRequestSchema } from "@/lib/server/labels-request";

export const POST = api({ permission: "read", mutating: true }, async (req, s) => {
  const p = labelRequestSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Datos no válidos" }, { status: 400 });
  const { items, logo } = await withCtx(s, async (tx) => {
    const items = await labelData(tx, p.data.assetIds);
    let logo: Buffer | null = null;
    if (p.data.layout.showLogo && s.org.settings.company.logoDocumentId) {
      const [d] = await tx`select storage_key from documents where id = ${s.org.settings.company.logoDocumentId}`;
      if (d) logo = await storage().get(d.storage_key).catch(() => null);
    }
    await audit(tx, s, { action: "print_labels", entityType: "asset", summary: `Etiquetas PDF generadas (${items.length})`, after: { codes: items.slice(0, 50).map((i) => i.code), size: `${p.data.widthMm}x${p.data.heightMm}` } });
    return { items, logo };
  });
  const pdf = await labelsPdf(items, p.data.widthMm, p.data.heightMm, p.data.layout, logo);
  return new NextResponse(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="etiquetas.pdf"` } });
});
