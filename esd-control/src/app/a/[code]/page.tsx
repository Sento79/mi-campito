import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { findAssetByScan } from "@/lib/server/services/measurements";

/**
 * Destino de los QR de las etiquetas: /a/<código>. Exige sesión (el QR no
 * contiene datos sensibles) y solo resuelve activos de la organización del usuario.
 */
export default async function QrResolve({ params }: { params: Promise<{ code: string }> }) {
  const s = await requireSession();
  const { code } = await params;
  const a = await withCtx(s, (tx) => findAssetByScan(tx, decodeURIComponent(code).slice(0, 120)));
  if (!a) notFound();
  redirect(`/inventario/${a.id}`);
}
