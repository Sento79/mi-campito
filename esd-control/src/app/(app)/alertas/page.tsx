import Link from "@/components/link";
import { BellRing } from "lucide-react";
import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/core";
import { ALERT_LABEL, ALERT_SEVERITY, computeAlerts, type AlertKind } from "@/lib/server/alerts";
import { fmtDate, fmtRelative } from "@/lib/format";
import { MarkAllRead } from "./mark-all-read";

export const metadata = { title: "Alertas" };

export default async function Alerts({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  const s = await requirePermission("read");
  const { tipo } = await searchParams;
  const d = await withCtx(s, async (tx) => ({
    alerts: await computeAlerts(tx, s.org.settings),
    notifications: await tx`select id, kind, title, body, link, created_at, read_at from notifications where user_id = ${s.userId} order by created_at desc limit 100`,
  }));
  const counts = d.alerts.reduce((acc, a) => ({ ...acc, [a.kind]: (acc[a.kind] ?? 0) + 1 }), {} as Record<string, number>);
  const list = tipo ? d.alerts.filter((a) => a.kind === tipo) : d.alerts;
  const st = s.org.settings;
  return (
    <>
      <PageHeader title="Alertas" description={`Calculadas en tiempo real. Avisos previos: mediciones ${st.dueLeadDays} d · calibraciones ${st.calibrationLeadDays} d · NC ${st.ncLeadDays} d. Canal activo: notificaciones en la aplicación (el correo no está implementado en esta versión).`} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/alertas" className={`rounded-full border px-3 py-1 text-sm ${!tipo ? "border-primary bg-primary-soft text-primary" : "border-line hover:bg-surface-2"}`}>Todas ({d.alerts.length})</Link>
        {(Object.keys(ALERT_LABEL) as AlertKind[]).map((k) => (
          <Link key={k} href={`/alertas?tipo=${k}`} className={`rounded-full border px-3 py-1 text-sm ${tipo === k ? "border-primary bg-primary-soft text-primary" : "border-line hover:bg-surface-2"}`}>{ALERT_LABEL[k]} ({counts[k] ?? 0})</Link>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card className="min-w-0">
          <CardHeader title={tipo ? ALERT_LABEL[tipo as AlertKind] ?? "Alertas" : "Alertas activas"} />
          {list.length === 0 ? <EmptyState icon={BellRing} title="Sin alertas" description="No hay elementos que requieran atención." /> : (
            <ul className="divide-y divide-line">
              {list.map((a) => (
                <li key={a.kind + a.id}>
                  <Link href={a.link} className="flex flex-wrap items-center gap-3 px-5 py-2.5 hover:bg-surface-2/50">
                    <Badge tone={ALERT_SEVERITY[a.kind]}>{ALERT_LABEL[a.kind]}</Badge>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm">{a.title}</span><span className="text-xs text-muted">{a.detail}{a.owner ? ` · ${a.owner}` : ""}</span></span>
                    {a.date ? <span className="text-xs tabular text-muted">{fmtDate(a.date)}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Mis notificaciones" description="Asignaciones y avisos programados" actions={<MarkAllRead />} />
          {d.notifications.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No tiene notificaciones.</p> : (
            <ul className="divide-y divide-line">
              {d.notifications.map((n) => (
                <li key={n.id} className={n.read_at ? "" : "bg-primary-soft/40"}>
                  <Link href={n.link ?? "/alertas"} className="block px-5 py-2.5 hover:bg-surface-2/50">
                    <p className="text-sm font-medium">{n.title}</p>
                    {n.body ? <p className="text-xs text-muted">{n.body}</p> : null}
                    <p className="text-[11px] text-faint">{fmtRelative(n.created_at)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
