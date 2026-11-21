import { FileText, Image as ImageIcon } from "lucide-react";
import { fmtDate } from "@/lib/format";

export function DocumentsList({ docs }: { docs: { id: string; file_name: string; mime_type: string; size_bytes: string | number; created_at: string | Date; kind: string }[] }) {
  if (!docs.length) return <p className="px-5 py-4 text-sm text-muted">Sin documentos adjuntos.</p>;
  return (
    <ul className="divide-y divide-line">
      {docs.map((d) => (
        <li key={d.id} className="flex items-center gap-3 px-5 py-2.5">
          {d.mime_type.startsWith("image/") ? <ImageIcon className="size-4 text-muted" aria-hidden /> : <FileText className="size-4 text-muted" aria-hidden />}
          <a href={`/api/files/${d.id}`} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate text-sm text-primary hover:underline">{d.file_name}</a>
          <span className="text-xs text-muted">{Math.round(Number(d.size_bytes) / 1024)} KB · {fmtDate(d.created_at)}</span>
          <a href={`/api/files/${d.id}?download=1`} className="text-xs text-muted hover:text-fg">Descargar</a>
        </li>
      ))}
    </ul>
  );
}
