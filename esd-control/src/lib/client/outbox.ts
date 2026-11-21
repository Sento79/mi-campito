"use client";
/**
 * Cola local de mediciones (IndexedDB) para trabajar con conectividad irregular.
 *
 * - Cada medición lleva un clientId (UUID) generado en el dispositivo: el
 *   servidor lo usa como clave de idempotencia, así un reenvío nunca duplica.
 * - Una medición solo se elimina de la cola cuando el servidor confirma (2xx).
 * - Errores de validación/permisos (4xx) quedan marcados para que el técnico
 *   decida (reintentar o descartar); nunca se pierden en silencio.
 * - El resultado mostrado offline es PROVISIONAL: el servidor recalcula con el
 *   criterio vigente y, si cambió, lo marca como "Requiere revisión".
 * - La caché de activos contiene solo los activos consultados por el usuario
 *   (sin documentos ni datos de otros módulos) y se borra al cerrar sesión.
 */
import { openDB, type IDBPDatabase } from "idb";

export const OUTBOX_EVENT = "esd-outbox-changed";

export interface OutboxItem {
  clientId: string;
  orgId: string;
  payload: Record<string, unknown>;
  label: string;
  provisionalResult: string | null;
  createdAt: string;
  attempts: number;
  status: "pending" | "error";
  lastError?: string;
}

export interface CachedTarget {
  key: string; // orgId:scanCode o orgId:id
  orgId: string;
  data: unknown;
  cachedAt: string;
}

let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB no disponible"));
  dbp ??= openDB("esd-offline", 1, {
    upgrade(d) {
      d.createObjectStore("outbox", { keyPath: "clientId" });
      d.createObjectStore("targets", { keyPath: "key" });
    },
  });
  return dbp;
}

const emit = () => window.dispatchEvent(new Event(OUTBOX_EVENT));

export async function enqueue(item: Omit<OutboxItem, "attempts" | "status" | "createdAt">) {
  const d = await db();
  await d.put("outbox", { ...item, attempts: 0, status: "pending", createdAt: new Date().toISOString() } satisfies OutboxItem);
  emit();
}

export async function listOutbox(): Promise<OutboxItem[]> {
  const d = await db();
  return (await d.getAll("outbox")) as OutboxItem[];
}

export async function outboxCount(): Promise<number> {
  try {
    const d = await db();
    return await d.count("outbox");
  } catch {
    return 0;
  }
}

export async function discard(clientId: string) {
  const d = await db();
  await d.delete("outbox", clientId);
  emit();
}

let syncing = false;

/** Envía la cola. Devuelve cuántas se confirmaron. */
export async function syncOutbox(opts: { includeErrored?: boolean } = {}): Promise<{ sent: number; failed: number; offline: boolean }> {
  if (syncing) return { sent: 0, failed: 0, offline: false };
  syncing = true;
  let sent = 0,
    failed = 0;
  try {
    const d = await db();
    const items = (await d.getAll("outbox")) as OutboxItem[];
    for (const it of items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      if (it.status === "error" && !opts.includeErrored) continue;
      let res: Response;
      try {
        res = await fetch("/api/measurements", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...it.payload, clientId: it.clientId, fromOffline: true }),
        });
      } catch {
        return { sent, failed, offline: true };
      }
      if (res.ok) {
        await d.delete("outbox", it.clientId);
        sent++;
      } else if (res.status === 401) {
        return { sent, failed, offline: false };
      } else if (res.status >= 500) {
        await d.put("outbox", { ...it, attempts: it.attempts + 1, lastError: "Error del servidor; se reintentará" });
        failed++;
      } else {
        const body = await res.json().catch(() => ({}));
        await d.put("outbox", { ...it, attempts: it.attempts + 1, status: "error", lastError: body.error ?? `Rechazada (${res.status})` });
        failed++;
      }
    }
    return { sent, failed, offline: false };
  } finally {
    syncing = false;
    emit();
  }
}

export async function cacheTarget(orgId: string, keys: string[], data: unknown) {
  try {
    const d = await db();
    const tx = d.transaction("targets", "readwrite");
    for (const k of keys) await tx.store.put({ key: `${orgId}:${k.toUpperCase()}`, orgId, data, cachedAt: new Date().toISOString() } satisfies CachedTarget);
    await tx.done;
  } catch {
    /* caché opcional */
  }
}

export async function getCachedTarget(orgId: string, key: string): Promise<CachedTarget | null> {
  try {
    const d = await db();
    return ((await d.get("targets", `${orgId}:${key.toUpperCase()}`)) as CachedTarget) ?? null;
  } catch {
    return null;
  }
}

/** Borra la caché de activos (al cerrar sesión). La cola NO se borra si tiene pendientes. */
export async function clearOfflineCache() {
  try {
    const d = await db();
    await d.clear("targets");
  } catch {}
}
