import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Tx, Ctx } from "./db";
import { AppError } from "./errors";

/**
 * Almacenamiento de archivos.
 * Driver implementado: "local" (directorio fuera de /public, servido solo a
 * través de /api/files/[id] tras comprobar sesión y organización).
 * Para despliegues sin disco persistente, implementar StorageDriver con un
 * servicio S3/Supabase Storage (ver docs/ARQUITECTURA.md); no está incluido.
 */
export interface StorageDriver {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

const KEY_RE = /^[0-9a-f-]{36}\/\d{4}\/[0-9a-f-]{36}\.(pdf|png|jpg)$/;

class LocalDriver implements StorageDriver {
  constructor(private root: string) {}
  private resolve(key: string) {
    if (!KEY_RE.test(key)) throw new AppError("Clave de almacenamiento no válida", 400);
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new AppError("Ruta no válida", 400);
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data, { flag: "wx" });
  }
  async get(key: string) {
    return readFile(this.resolve(key));
  }
}

let driver: StorageDriver | null = null;
export function storage(): StorageDriver {
  if (!driver) {
    const kind = process.env.STORAGE_DRIVER ?? "local";
    if (kind !== "local") throw new Error(`STORAGE_DRIVER=${kind} no está implementado; use "local"`);
    driver = new LocalDriver(path.resolve(process.env.STORAGE_DIR ?? "./storage"));
  }
  return driver;
}

export const ALLOWED_TYPES = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
} as const;
export type AllowedMime = keyof typeof ALLOWED_TYPES;

/** Detecta el tipo real por la firma de bytes (no se confía en la extensión ni en el navegador). */
export function sniffMime(buf: Buffer): AllowedMime | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  return null;
}

export function maxUploadBytes() {
  const mb = Number(process.env.MAX_UPLOAD_MB ?? 20);
  return (Number.isFinite(mb) && mb > 0 ? mb : 20) * 1024 * 1024;
}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "archivo";
  return base.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 200) || "archivo";
}

export type DocEntity = "asset" | "instrument" | "calibration" | "nonconformity" | "measurement" | "floor_plan" | "procedure" | "organization" | "label";
export type DocKind = "attachment" | "photo" | "certificate" | "plan_original" | "plan_page" | "logo" | "procedure";

export async function saveDocument(
  tx: Tx,
  ctx: Ctx,
  input: { entityType: DocEntity; entityId: string | null; kind: DocKind; fileName: string; data: Buffer; allowed?: AllowedMime[] },
): Promise<{ id: string; mime: AllowedMime }> {
  if (input.data.length === 0) throw new AppError("El archivo está vacío");
  if (input.data.length > maxUploadBytes()) throw new AppError(`El archivo supera el máximo de ${Math.round(maxUploadBytes() / 1048576)} MB`);
  const mime = sniffMime(input.data);
  const allowed = input.allowed ?? (Object.keys(ALLOWED_TYPES) as AllowedMime[]);
  if (!mime || !allowed.includes(mime)) {
    throw new AppError(`Tipo de archivo no permitido. Admitidos: ${allowed.map((m) => ALLOWED_TYPES[m].toUpperCase()).join(", ")}`);
  }
  const id = randomUUID();
  const key = `${ctx.orgId}/${new Date().getUTCFullYear()}/${id}.${ALLOWED_TYPES[mime]}`;
  const sha = createHash("sha256").update(input.data).digest("hex");
  await storage().put(key, input.data);
  await tx`insert into documents(id, org_id, entity_type, entity_id, kind, file_name, mime_type, size_bytes, sha256, storage_key, uploaded_by)
           values (${id}, ${ctx.orgId}, ${input.entityType}, ${input.entityId}, ${input.kind}, ${sanitizeFileName(input.fileName)}, ${mime}, ${input.data.length}, ${sha}, ${key}, ${ctx.userId})`;
  return { id, mime };
}
