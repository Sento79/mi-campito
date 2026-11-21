"use server";
import { z } from "zod";
import { defineAction } from "@/lib/server/action";
import { saveDocument } from "@/lib/server/storage";
import { audit } from "@/lib/server/audit";
import { AppError } from "@/lib/server/errors";

/** Foto asociada a una medición (solo el autor, poco después de registrarla, o un usuario con edición). */
export const uploadMeasurementPhotoAction = defineAction({ permission: ["measure", "edit"], schema: z.instanceof(FormData) }, async (fd, { tx, session }) => {
  const id = z.string().uuid().parse(fd.get("measurementId"));
  const f = fd.get("file");
  if (!(f instanceof File) || f.size === 0) throw new AppError("Seleccione una imagen");
  const [m] = await tx`select id, measured_by, recorded_at from measurements where id = ${id}`;
  if (!m) throw new AppError("Medición no encontrada", 404);
  const own = m.measured_by === session.userId && Date.now() - new Date(m.recorded_at).getTime() < 24 * 3600_000;
  if (!own && !session.permissions.has("edit")) throw new AppError("Solo el autor (24 h) o un usuario con edición puede adjuntar", 403);
  const doc = await saveDocument(tx, session, { entityType: "measurement", entityId: id, kind: "photo", fileName: f.name, data: Buffer.from(await f.arrayBuffer()), allowed: ["image/jpeg", "image/png"] });
  await audit(tx, session, { action: "attach", entityType: "measurement", entityId: id, summary: `Foto adjuntada a la medición: ${f.name}`.slice(0, 500) });
  return { id: doc.id };
});
