import { Badge } from "@/components/ui/core";
import { fmtDate } from "@/lib/format";

export function CalBadge({ due, last, lead }: { due: string | null; last: string | null; lead: number }) {
  if (!last || !due) return <Badge tone="bad">Sin calibración</Badge>;
  const today = new Date().toISOString().slice(0, 10);
  if (due < today) return <Badge tone="bad">Vencida {fmtDate(due)}</Badge>;
  const soon = new Date(Date.now() + lead * 86400000).toISOString().slice(0, 10);
  if (due <= soon) return <Badge tone="warn">Vence {fmtDate(due)}</Badge>;
  return <Badge tone="ok">Vigente hasta {fmtDate(due)}</Badge>;
}

