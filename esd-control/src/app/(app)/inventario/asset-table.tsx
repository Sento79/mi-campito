"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, MapPinned, Tags, ScanLine, CalendarPlus, Boxes } from "lucide-react";
import { Badge, Button, EmptyState, ResultBadge, Table, Td, Th, Select } from "@/components/ui/core";
import { ConfirmDialog, Modal, useAction } from "@/components/ui/client";
import { ASSET_STATUS_LABEL, type AssetStatus } from "@/lib/domain/asset-import";
import { fmtDate } from "@/lib/format";
import { archiveAssetsAction, moveAssetsAction } from "./actions";

interface Row {
  id: string;
  code: string;
  name: string;
  status: AssetStatus;
  category_name: string;
  location_name: string | null;
  last_result: string | null;
  last_measured_at: string | null;
  next_due_at: string | null;
  archived_at: string | null;
  period_unit: string | null;
}

export function DueBadge({ next, last, lead, hasPeriod }: { next: string | null; last: string | null; lead: number; hasPeriod: boolean }) {
  if (!hasPeriod) return <span className="text-xs text-faint">Sin periodicidad</span>;
  if (!last || !next) return <Badge tone="neutral">Sin medir</Badge>;
  const t = new Date(next).getTime();
  const now = Date.now();
  if (t <= now) return <Badge tone="bad">Vencida {fmtDate(next)}</Badge>;
  if (t - now <= lead * 86400000) return <Badge tone="warn">{fmtDate(next)}</Badge>;
  return <span className="text-sm tabular text-muted">{fmtDate(next)}</span>;
}

export const STATUS_TONE: Record<AssetStatus, "ok" | "bad" | "warn" | "neutral"> = { active: "ok", retired: "neutral", repair: "warn", blocked: "bad", review: "warn" };

export function AssetTable({ rows, canEdit, canMeasure, locations, leadDays }: { rows: Row[]; canEdit: boolean; canMeasure: boolean; locations: { id: string; label: string }[]; leadDays: number }) {
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const [moveOpen, setMoveOpen] = React.useState(false);
  const [target, setTarget] = React.useState("");
  const router = useRouter();
  const archive = useAction(archiveAssetsAction);
  const move = useAction(moveAssetsAction);
  const all = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const toggle = (id: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const ids = [...sel];

  if (rows.length === 0) return <EmptyState icon={Boxes} title="No hay activos con estos filtros" description="Cambie los filtros o dé de alta activos nuevos." />;

  return (
    <>
      {sel.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-primary-soft/60 px-4 py-2 text-sm">
          <span className="font-medium">{sel.size} seleccionado(s)</span>
          <Button size="sm" variant="outline" icon={Tags} onClick={() => router.push(`/etiquetas?assets=${ids.join(",")}`)}>Etiquetas</Button>
          {canEdit ? <Button size="sm" variant="outline" icon={CalendarPlus} onClick={() => router.push(`/campanas/nueva?assets=${ids.join(",")}`)}>Crear campaña</Button> : null}
          {canEdit ? <Button size="sm" variant="outline" icon={MapPinned} onClick={() => setMoveOpen(true)}>Mover</Button> : null}
          {canEdit ? <Button size="sm" variant="outline" icon={Archive} onClick={() => setArchiveOpen(true)}>Archivar</Button> : null}
          <button className="ml-auto text-xs text-muted hover:text-fg" onClick={() => setSel(new Set())}>Quitar selección</button>
        </div>
      ) : null}
      <Table>
        <thead>
          <tr>
            <Th className="w-10">
              <input type="checkbox" aria-label="Seleccionar todos" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.id)))} className="size-4 accent-[var(--primary)]" />
            </Th>
            <Th>ID</Th>
            <Th>Nombre</Th>
            <Th>Categoría</Th>
            <Th>Ubicación</Th>
            <Th>Estado</Th>
            <Th>Último resultado</Th>
            <Th>Próxima</Th>
            <Th className="w-12"><span className="sr-only">Acciones</span></Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-surface-2/50">
              <Td>
                <input type="checkbox" aria-label={`Seleccionar ${r.code}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} className="size-4 accent-[var(--primary)]" />
              </Td>
              <Td className="font-mono text-[13px] whitespace-nowrap">
                <Link href={`/inventario/${r.id}`} className="font-medium text-primary hover:underline">{r.code}</Link>
              </Td>
              <Td className="max-w-64 truncate">{r.name}</Td>
              <Td className="whitespace-nowrap text-muted">{r.category_name}</Td>
              <Td className="max-w-48 truncate text-muted">{r.location_name ?? "—"}</Td>
              <Td>{r.archived_at ? <Badge tone="neutral">Archivado</Badge> : <Badge tone={STATUS_TONE[r.status]}>{ASSET_STATUS_LABEL[r.status]}</Badge>}</Td>
              <Td className="whitespace-nowrap">
                <ResultBadge result={r.last_result} />
                {r.last_measured_at ? <span className="ml-2 text-xs text-muted">{fmtDate(r.last_measured_at)}</span> : null}
              </Td>
              <Td className="whitespace-nowrap"><DueBadge next={r.next_due_at} last={r.last_measured_at} lead={leadDays} hasPeriod={!!r.period_unit} /></Td>
              <Td>
                {canMeasure && !r.archived_at && r.status !== "retired" ? (
                  <Link href={`/medicion?asset=${encodeURIComponent(r.code)}`} className="inline-flex rounded p-1.5 text-muted hover:bg-primary-soft hover:text-primary" title="Medir" aria-label={`Medir ${r.code}`}>
                    <ScanLine className="size-4" />
                  </Link>
                ) : null}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <ConfirmDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        title={`Archivar ${sel.size} activo(s)`}
        description="Los activos archivados dejan de aparecer en el inventario activo y no admiten mediciones. Su historial se conserva y pueden reactivarse."
        confirmLabel="Archivar"
        danger
        reason="required"
        loading={archive.pending}
        onConfirm={async (reason) => {
          const r = await archive.run({ ids, reason }, { success: "Activos archivados" });
          if (r?.ok) {
            setArchiveOpen(false);
            setSel(new Set());
            router.refresh();
          }
        }}
      />
      <Modal
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        title={`Mover ${sel.size} activo(s)`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMoveOpen(false)}>Cancelar</Button>
            <Button
              loading={move.pending}
              disabled={!target}
              onClick={async () => {
                const r = await move.run({ ids, locationId: target, reason: null }, { success: "Activos movidos" });
                if (r?.ok) {
                  setMoveOpen(false);
                  setSel(new Set());
                  router.refresh();
                }
              }}
            >
              Mover
            </Button>
          </>
        }
      >
        <label className="text-sm font-medium" htmlFor="move-target">Nueva ubicación</label>
        <Select id="move-target" value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1.5">
          <option value="">Seleccione…</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </Select>
      </Modal>
    </>
  );
}
