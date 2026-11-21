import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/lib/server/api";
import { withCtx } from "@/lib/server/db";
import { storage } from "@/lib/server/storage";

/** Descarga protegida: la fila del documento solo es visible (RLS) para miembros de su organización. */
export const GET = api({ permission: "read" }, async (req, s, params) => {
  const id = z.string().uuid().safeParse(params.id);
  if (!id.success) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const [doc] = await withCtx(s, (tx) => tx`select file_name, mime_type, storage_key, size_bytes from documents where id = ${id.data}`);
  if (!doc) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const data = await storage().get(doc.storage_key);
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "content-type": doc.mime_type,
      "content-length": String(data.length),
      "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(doc.file_name)}`,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
});
