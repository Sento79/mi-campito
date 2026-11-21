"use client";
import * as React from "react";
import Link from "@/components/link";
import { WifiOff, CloudUpload } from "lucide-react";
import { outboxCount, OUTBOX_EVENT } from "@/lib/client/outbox";

/** Muestra el estado de conexión y las mediciones pendientes de sincronizar. */
export function OfflineIndicator() {
  const [online, setOnline] = React.useState(true);
  const [pending, setPending] = React.useState(0);
  React.useEffect(() => {
    const refresh = () => outboxCount().then(setPending).catch(() => {});
    const on = () => setOnline(navigator.onLine);
    on();
    refresh();
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    window.addEventListener(OUTBOX_EVENT, refresh);
    const t = setInterval(refresh, 15000);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
      window.removeEventListener(OUTBOX_EVENT, refresh);
      clearInterval(t);
    };
  }, []);
  if (online && pending === 0) return null;
  return (
    <Link
      href="/medicion?cola=1"
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${online ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad"}`}
      title={online ? "Hay mediciones guardadas en este dispositivo pendientes de enviar" : "Sin conexión"}
    >
      {online ? <CloudUpload className="size-4" aria-hidden /> : <WifiOff className="size-4" aria-hidden />}
      {online ? `${pending} sin sincronizar` : `Sin conexión${pending ? ` · ${pending} en cola` : ""}`}
    </Link>
  );
}
