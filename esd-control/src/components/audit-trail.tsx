import { fmtDateTime } from "@/lib/format";

export function AuditTrail({ rows }: { rows: { id: string; at: string | Date; action: string; summary: string; user_name: string | null; reason: string | null; before_data: unknown; after_data: unknown }[] }) {
  if (!rows.length) return <p className="px-5 py-4 text-sm text-muted">Sin eventos.</p>;
  return (
    <ol className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.id} className="px-5 py-2.5 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{r.summary}</span>
            <span className="text-xs text-muted">{fmtDateTime(r.at)} · {r.user_name ?? "Sistema"}</span>
          </div>
          {r.reason ? <p className="text-xs text-muted">Motivo: {r.reason}</p> : null}
          {r.before_data || r.after_data ? (
            <details className="mt-1 text-xs">
              <summary className="cursor-pointer text-muted">Valores anteriores / nuevos</summary>
              <pre className="mt-1 overflow-x-auto rounded bg-surface-2 p-2 font-mono text-[11px]">{JSON.stringify({ antes: r.before_data, despues: r.after_data }, null, 2)}</pre>
            </details>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
