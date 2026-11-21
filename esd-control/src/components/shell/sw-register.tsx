"use client";
import { useEffect } from "react";
import { setOutboxIdentity, syncOutbox } from "@/lib/client/outbox";

/** Registra el service worker (solo en producción) y sincroniza la cola al recuperar conexión. */
export function ServiceWorkerRegister({ orgId, userId }: { orgId: string; userId: string }) {
  setOutboxIdentity({ orgId, userId });
  useEffect(() => {
    setOutboxIdentity({ orgId, userId });
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const onOnline = () => syncOutbox().catch(() => {});
    window.addEventListener("online", onOnline);
    if (navigator.onLine) onOnline();
    return () => window.removeEventListener("online", onOnline);
  }, [orgId, userId]);
  return null;
}
