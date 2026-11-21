import { NextResponse } from "next/server";
import { api } from "@/lib/server/api";
import { svgCode } from "@/lib/server/labels";

/** Vista previa de QR/código de barras en SVG (requiere sesión). */
export const GET = api({ permission: "read" }, async (req) => {
  const u = new URL(req.url);
  const text = (u.searchParams.get("text") ?? "").slice(0, 300);
  const kind = u.searchParams.get("type") === "barcode" ? "barcode" : "qr";
  if (!text) return NextResponse.json({ error: "Falta el texto" }, { status: 400 });
  try {
    return new NextResponse(svgCode(kind, text), { headers: { "content-type": "image/svg+xml", "cache-control": "private, max-age=3600" } });
  } catch {
    return NextResponse.json({ error: "No se pudo generar el código" }, { status: 400 });
  }
});
