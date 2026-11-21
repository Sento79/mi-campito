"use client";
import { useEffect } from "react";
import { syncOutbox } from "@/lib/client/outbox";

/** Registra el service worker (solo en producción) y sincroniza la cola al recuperar conexión. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const onOnline = () => syncOutbox().catch(() => {});
    window.addEventListener("online", onOnline);
    if (navigator.onLine) onOnline();
    return () => window.removeEventListener("online", onOnline);
  }, []);
  return null;
}
