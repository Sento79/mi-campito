"use client";
import * as React from "react";
import Link from "@/components/link";
import { useRouter } from "next/navigation";
import {
  ZoomIn, ZoomOut, Maximize, RotateCw, MousePointer2, Plus, Move, Route, Download, FileDown, ScanLine, Pencil, Archive, X, CalendarPlus, Lock, Search, Check, CircleDashed, AlertTriangle, Diamond, History,
} from "lucide-react";
import { Badge, Button, Checkbox, Field, Input, ResultBadge, Select, Textarea, cn } from "@/components/ui/core";
import { ConfirmDialog, Modal, useAction, useToast } from "@/components/ui/client";
import { fitToContainer, imageMatrix, normToScreen, screenToNorm, zoomAt, type Viewport } from "@/lib/domain/coords";
import { fmtDateTime } from "@/lib/format";
import { archivePointAction, createPointAction, movePointAction, setRouteAction, updatePointAction } from "../actions";

export interface PlanPoint {
  id: string; code: string; name: string; x: number; y: number; page: number; type: "measurement" | "asset" | "reference";
  category_id: string | null; category_name: string | null; location_id: string | null; asset_id: string | null; asset_code: string | null;
  criterion_id: string | null; route_order: number | null; notes: string | null; last_result: string | null; last_measured_at: string | null;
}
export interface PageImg { page: number; docId: string; w: number; h: number }
export interface CampaignView { id: string; code: string; name: string; status: string; items: Record<string, { status: string; result: string | null }> }
type Opt = { id: string; label: string };

type Status = "pass" | "fail" | "warn" | "pending" | "reference";
const STATUS_META: Record<Status, { label: string; color: string; Icon: typeof Check }> = {
  pass: { label: "Conforme", color: "var(--ok)", Icon: Check },
  fail: { label: "No conforme", color: "var(--bad)", Icon: X },
  warn: { label: "Revisión / incompleto", color: "var(--warn)", Icon: AlertTriangle },
  pending: { label: "Sin medir / pendiente", color: "var(--neutral)", Icon: CircleDashed },
  reference: { label: "Referencia", color: "var(--text-muted)", Icon: Diamond },
};
const HEX: Record<Status, string> = { pass: "#18794e", fail: "#c22a2a", warn: "#b45309", pending: "#616b7a", reference: "#5a6475" };

function statusOf(p: PlanPoint, campaign: CampaignView | null, since: string | null): Status {
  if (p.type === "reference") return "reference";
  let r = p.last_result;
  if (campaign) {
    const it = campaign.items[p.id];
    if (!it || it.status === "pending") return "pending";
    if (it.status === "skipped") return "pending";
    r = it.result;
  } else if (since && (!p.last_measured_at || p.last_measured_at < since)) return "pending";
  if (r === "pass") return "pass";
  if (r === "fail") return "fail";
  if (r === "review" || r === "incomplete") return "warn";
  return "pending";
}

export function PlanViewer({
  planId, planTitle, pages, points: initialPoints, campaigns, canCreate, canEdit, canMeasure, lockedBy, categories, criteria, assets, locations, versionLabel, isCurrentVersion,
}: {
  planId: string; planTitle: string; pages: PageImg[]; points: PlanPoint[]; campaigns: CampaignView[]; canCreate: boolean; canEdit: boolean; canMeasure: boolean; lockedBy: string | null;
  categories: Opt[]; criteria: Opt[]; assets: Opt[]; locations: Opt[]; versionLabel: string; isCurrentVersion: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [points, setPoints] = React.useState(initialPoints);
  React.useEffect(() => setPoints(initialPoints), [initialPoints]);
  const [pageNo, setPageNo] = React.useState(pages[0]?.page ?? 1);
  const img = pages.find((p) => p.page === pageNo) ?? pages[0];
  const size = React.useMemo(() => ({ width: img?.w ?? 1, height: img?.h ?? 1 }), [img]);
  const [rotation, setRotation] = React.useState<Viewport["rotation"]>(0);
  const [vp, setVp] = React.useState<Viewport | null>(null);
  const [mode, setMode] = React.useState<"view" | "add" | "move" | "route">("view");
  const [selected, setSelected] = React.useState<string | null>(null);
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [campaignId, setCampaignId] = React.useState<string>("");
  const [statusFilter, setStatusFilter] = React.useState<Status | "">("");
  const [since, setSince] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [showRoute, setShowRoute] = React.useState(true);
  const [route, setRoute] = React.useState<string[]>([]);
  const [formFor, setFormFor] = React.useState<{ id?: string; x?: number; y?: number } | null>(null);
  const [archiveFor, setArchiveFor] = React.useState<PlanPoint | null>(null);
  const [override, setOverride] = React.useState<{ message: string; retry: (reason: string) => Promise<void> } | null>(null);
  // hit: punto bajo el cursor al pulsar (con captura de puntero, pointerup llega al contenedor)
  const drag = React.useRef<{ kind: "pan" | "point"; id?: string; hit?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const pinch = React.useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchDist = React.useRef<number | null>(null);
  const moveAct = useAction(movePointAction);
  const archiveAct = useAction(archivePointAction);
  const routeAct = useAction(setRouteAction);
  const editable = isCurrentVersion;
  const campaign = campaigns.find((c) => c.id === campaignId) ?? null;

  const fit = React.useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setVp(fitToContainer(size, { width: el.clientWidth, height: el.clientHeight }, rotation));
  }, [size, rotation]);
  React.useEffect(() => {
    fit();
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const pagePoints = points.filter((p) => p.page === pageNo);
  const visible = pagePoints.filter((p) => {
    const st = statusOf(p, campaign, since || null);
    if (statusFilter && st !== statusFilter) return false;
    if (campaign && !campaign.items[p.id]) return false;
    return true;
  });
  const listed = visible.filter((p) => !query || `${p.code} ${p.name} ${p.asset_code ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const sel = points.find((p) => p.id === selected) ?? null;
  const counts = pagePoints.reduce((acc, p) => ({ ...acc, [statusOf(p, campaign, since || null)]: (acc[statusOf(p, campaign, since || null)] ?? 0) + 1 }), {} as Record<Status, number>);

  // Ejecuta una acción de disposición manejando el bloqueo por campaña en curso
  const withLock = async <T,>(fn: (overrideReason: string | null) => Promise<{ ok: true; data: T } | { ok: false; error: string } | null>): Promise<boolean> => {
    const r = await fn(null);
    if (r && !r.ok && r.error.startsWith("LAYOUT_LOCKED:")) {
      return new Promise((resolve) => {
        setOverride({
          message: r.error.slice("LAYOUT_LOCKED:".length),
          retry: async (reason) => {
            const r2 = await fn(reason);
            setOverride(null);
            resolve(!!r2?.ok);
          },
        });
      });
    }
    return !!r?.ok;
  };

  const center = (p: PlanPoint) => {
    const el = containerRef.current;
    if (!el || !vp) return;
    if (p.page !== pageNo) setPageNo(p.page);
    const s = normToScreen({ x: p.x, y: p.y }, size, vp);
    setVp({ ...vp, offsetX: vp.offsetX + el.clientWidth / 2 - s.x, offsetY: vp.offsetY + el.clientHeight / 2 - s.y });
  };

  // --- Eventos de puntero (pan, arrastre de puntos, pellizco)
  const local = (e: { clientX: number; clientY: number }) => {
    const r = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (!vp) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pinch.current.set(e.pointerId, local(e));
    if (pinch.current.size === 2) {
      const [a, b] = [...pinch.current.values()];
      pinchDist.current = Math.hypot(a.x - b.x, a.y - b.y);
      drag.current = null;
      return;
    }
    const target = (e.target as HTMLElement).closest("[data-point]") as HTMLElement | null;
    const p = local(e);
    if (target && mode === "move" && editable && canEdit) {
      drag.current = { kind: "point", id: target.dataset.point, hit: target.dataset.point, sx: p.x, sy: p.y, ox: 0, oy: 0, moved: false };
    } else {
      drag.current = { kind: "pan", hit: target?.dataset.point, sx: p.x, sy: p.y, ox: vp.offsetX, oy: vp.offsetY, moved: false };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!vp) return;
    const p = local(e);
    if (pinch.current.has(e.pointerId)) pinch.current.set(e.pointerId, p);
    if (pinch.current.size === 2 && pinchDist.current) {
      const [a, b] = [...pinch.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      setVp(zoomAt(vp, d / pinchDist.current, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }));
      pinchDist.current = d;
      return;
    }
    const dr = drag.current;
    if (!dr) return;
    if (Math.abs(p.x - dr.sx) + Math.abs(p.y - dr.sy) > 4) dr.moved = true;
    if (dr.kind === "pan" && dr.moved) setVp({ ...vp, offsetX: dr.ox + p.x - dr.sx, offsetY: dr.oy + p.y - dr.sy });
    if (dr.kind === "point" && dr.moved) {
      const n = screenToNorm(p, size, vp);
      if (n) setPoints((ps) => ps.map((x) => (x.id === dr.id ? { ...x, x: n.x, y: n.y } : x)));
    }
  };
  const onPointerUp = async (e: React.PointerEvent) => {
    pinch.current.delete(e.pointerId);
    if (pinch.current.size < 2) pinchDist.current = null;
    const dr = drag.current;
    drag.current = null;
    if (!dr || !vp) return;
    const p = local(e);
    if (dr.kind === "point" && dr.id) {
      if (!dr.moved) { setSelected(dr.id); return; }
      const pt = points.find((x) => x.id === dr.id)!;
      const ok = await withLock((reason) => moveAct.run({ id: pt.id, x: pt.x, y: pt.y, overrideReason: reason }, { success: `Punto ${pt.code} reubicado` }));
      if (!ok) setPoints(initialPoints);
      router.refresh();
      return;
    }
    if (dr.moved) return;
    if (dr.hit) {
      const id = dr.hit;
      if (mode === "route") setRoute((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));
      else setSelected(id);
      return;
    }
    if (mode === "add" && editable && canCreate) {
      const n = screenToNorm(p, size, vp);
      if (n) setFormFor({ x: n.x, y: n.y });
      else toast({ tone: "warn", title: "Haga clic dentro del plano" });
      return;
    }
    setSelected(null);
  };
  const onWheel = (e: React.WheelEvent) => {
    if (!vp) return;
    setVp(zoomAt(vp, e.deltaY < 0 ? 1.15 : 1 / 1.15, local(e)));
  };
  // React registra wheel como pasivo: evitamos el scroll de la página manualmente
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const prevent = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", prevent, { passive: false });
    return () => el.removeEventListener("wheel", prevent);
  }, []);

  const zoomBtn = (f: number) => {
    const el = containerRef.current;
    if (vp && el) setVp(zoomAt(vp, f, { x: el.clientWidth / 2, y: el.clientHeight / 2 }));
  };

  // --- Exportar imagen (PNG) con marcadores y leyenda
  const exportPng = async () => {
    const blob = await fetch(`/api/files/${img.docId}`).then((r) => r.blob());
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, 4000 / Math.max(bmp.width, bmp.height));
    const W = Math.round(bmp.width * scale), H = Math.round(bmp.height * scale);
    const legendH = 90;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H + legendH;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, W, H);
    const r = Math.max(8, Math.round(W / 140));
    for (const p of visible) {
      const st = statusOf(p, campaign, since || null);
      const x = p.x * W, y = p.y * H;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = HEX[st];
      g.fill();
      g.lineWidth = Math.max(2, r / 4);
      g.strokeStyle = "#fff";
      g.stroke();
      g.font = `bold ${Math.round(r * 1.1)}px sans-serif`;
      g.fillStyle = "#111827";
      g.fillText(p.code, x + r + 3, y + r / 2);
    }
    g.font = "bold 22px sans-serif";
    g.fillStyle = "#111827";
    g.fillText(`${planTitle} · ${versionLabel} · pág. ${pageNo}${campaign ? ` · Campaña ${campaign.code}` : ""}`, 20, H + 32);
    g.font = "18px sans-serif";
    let lx = 20;
    for (const st of ["pass", "fail", "warn", "pending"] as Status[]) {
      g.beginPath();
      g.arc(lx + 9, H + 64, 9, 0, Math.PI * 2);
      g.fillStyle = HEX[st];
      g.fill();
      g.fillStyle = "#111827";
      const t = `${STATUS_META[st].label} (${counts[st] ?? 0})`;
      g.fillText(t, lx + 24, H + 70);
      lx += 40 + g.measureText(t).width;
    }
    g.fillStyle = "#5a6475";
    g.fillText(`Exportado ${new Date().toLocaleString("es-ES")}`, W - 330, H + 70);
    c.toBlob((b) => {
      if (!b) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `${planTitle.replace(/[^\w-]+/g, "_")}-p${pageNo}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, "image/png");
  };

  const routeOrdered = points.filter((p) => p.page === pageNo && p.route_order).sort((a, b) => a.route_order! - b.route_order!);
  const routeLine = (mode === "route" ? route.map((id) => points.find((p) => p.id === id)!).filter(Boolean) : routeOrdered);
  const m = vp ? imageMatrix(size, vp) : null;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-3">
        {lockedBy ? (
          <div className="flex items-center gap-2 rounded-lg border border-info/30 bg-info-soft px-3 py-2 text-sm text-info"><Lock className="size-4" aria-hidden />Campaña {lockedBy} en curso: los cambios de disposición requieren confirmación con motivo.</div>
        ) : null}
        {!isCurrentVersion ? <div className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">Está viendo una versión histórica ({versionLabel}): solo lectura.</div> : null}
        {/* Barra de herramientas */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-2">
          <div className="flex items-center gap-1" role="group" aria-label="Zoom">
            <Button size="sm" variant="ghost" icon={ZoomIn} onClick={() => zoomBtn(1.3)} aria-label="Acercar" />
            <Button size="sm" variant="ghost" icon={ZoomOut} onClick={() => zoomBtn(1 / 1.3)} aria-label="Alejar" />
            <Button size="sm" variant="ghost" icon={Maximize} onClick={fit} aria-label="Ajustar a pantalla" />
            <Button size="sm" variant="ghost" icon={RotateCw} onClick={() => setRotation((r) => ((r + 90) % 360) as Viewport["rotation"])} aria-label="Girar 90°" />
            <span className="w-12 text-center text-xs tabular text-muted" aria-live="polite">{vp ? `${Math.round(vp.scale * 100)}%` : ""}</span>
          </div>
          <span className="h-6 w-px bg-line" aria-hidden />
          <div className="flex items-center gap-1" role="radiogroup" aria-label="Modo">
            {([["view", "Ver", MousePointer2, true], ["add", "Añadir", Plus, canCreate && editable], ["move", "Mover", Move, canEdit && editable], ["route", "Ruta", Route, canEdit && editable]] as const).map(([k, l, I, allowed]) =>
              allowed ? (
                <button key={k} role="radio" aria-checked={mode === k} onClick={() => { setMode(k); if (k === "route") setRoute(routeOrdered.map((p) => p.id)); }} className={cn("flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm", mode === k ? "bg-primary text-primary-fg" : "text-muted hover:bg-surface-2")}>
                  <I className="size-4" aria-hidden />{l}
                </button>
              ) : null,
            )}
          </div>
          {pages.length > 1 ? (
            <>
              <span className="h-6 w-px bg-line" aria-hidden />
              <Select aria-label="Página" className="h-8 w-28" value={pageNo} onChange={(e) => setPageNo(Number(e.target.value))}>
                {pages.map((p) => <option key={p.page} value={p.page}>Página {p.page}</option>)}
              </Select>
            </>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="ghost" icon={Download} onClick={exportPng}>PNG</Button>
            <a className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm hover:bg-surface-2" href={`/api/plans/${planId}/pdf?page=${pageNo}${campaignId ? `&campaign=${campaignId}` : ""}${since ? `&since=${since}` : ""}`}><FileDown className="size-4" aria-hidden />PDF</a>
          </div>
        </div>
        {mode === "add" ? <p className="text-sm text-muted">Haga clic sobre el plano para añadir un punto.</p> : null}
        {mode === "move" ? <p className="text-sm text-muted">Arrastre un punto para reubicarlo. El cambio queda en auditoría.</p> : null}
        {mode === "route" ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary-soft px-3 py-2 text-sm">
            <Route className="size-4 text-primary" aria-hidden />Pulse los puntos en el orden en que deben medirse ({route.length} seleccionados).
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setRoute([])}>Vaciar</Button>
              <Button size="sm" loading={routeAct.pending} onClick={async () => { // La ruta del plano es única: se conservan los puntos de otras páginas en su orden
                const byOrder = (a: PlanPoint, b: PlanPoint) => (a.route_order ?? 0) - (b.route_order ?? 0);
                const before = points.filter((p) => p.page < pageNo && p.route_order).sort(byOrder).map((p) => p.id);
                const after = points.filter((p) => p.page > pageNo && p.route_order).sort(byOrder).map((p) => p.id);
                const r = await routeAct.run({ planId, ids: [...before, ...route, ...after] }, { success: "Ruta guardada" }); if (r?.ok) { setMode("view"); router.refresh(); } }}>Guardar ruta</Button>
            </div>
          </div>
        ) : null}

        {/* Lienzo */}
        <div
          ref={containerRef}
          className={cn("relative h-[62vh] min-h-[420px] touch-none select-none overflow-hidden rounded-lg border border-line bg-[repeating-conic-gradient(var(--surface-2)_0%_25%,var(--surface)_0%_50%)] [background-size:24px_24px]", mode === "add" ? "cursor-crosshair" : mode === "move" ? "cursor-move" : "cursor-grab active:cursor-grabbing")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { drag.current = null; pinch.current.clear(); }}
          onWheel={onWheel}
          role="application"
          aria-label={`Plano ${planTitle}. ${visible.length} puntos visibles. Use la lista lateral para navegar con teclado.`}
        >
          {m ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/files/${img.docId}`} alt={`Plano ${planTitle}, página ${pageNo}`} draggable={false} width={size.width} height={size.height}
              style={{ position: "absolute", left: 0, top: 0, width: size.width, height: size.height, maxWidth: "none", transformOrigin: "0 0", transform: `matrix(${m.join(",")})` }} />
          ) : null}
          {vp && showRoute && routeLine.length > 1 ? (
            <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden>
              <polyline fill="none" stroke="var(--primary)" strokeWidth={2} strokeDasharray="6 4" points={routeLine.map((p) => { const s = normToScreen(p, size, vp); return `${s.x},${s.y}`; }).join(" ")} />
            </svg>
          ) : null}
          {vp ? visible.map((p) => {
            const s = normToScreen({ x: p.x, y: p.y }, size, vp);
            const st = statusOf(p, campaign, since || null);
            const meta = STATUS_META[st];
            const isSel = p.id === selected;
            const inRoute = mode === "route" ? route.indexOf(p.id) + 1 : p.route_order;
            return (
              <div key={p.id} data-point={p.id} className="absolute" style={{ left: s.x, top: s.y, transform: "translate(-50%,-50%)" }} title={`${p.code} · ${p.name} · ${meta.label}`}>
                <div className={cn("grid size-7 place-items-center rounded-full border-2 border-white text-white shadow-md transition-transform", isSel && "scale-125 ring-4 ring-[#2563eb]", checked.has(p.id) && "outline-2 outline-offset-2 outline-dashed outline-[#2563eb]")} style={{ background: meta.color }}>
                  <meta.Icon className="size-4" aria-hidden strokeWidth={3} />
                </div>
                <span className="pointer-events-none absolute top-1/2 left-full ml-1 -translate-y-1/2 rounded bg-surface/90 px-1 text-[11px] font-semibold whitespace-nowrap text-fg shadow-sm">
                  {p.code}{showRoute && inRoute ? <span className="ml-1 text-primary">#{inRoute}</span> : null}
                </span>
              </div>
            );
          }) : null}
          {/* Leyenda + escala */}
          <div className="pointer-events-none absolute bottom-2 left-2 rounded-md border border-line bg-surface/95 px-2.5 py-1.5 text-xs shadow-sm">
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              {(["pass", "fail", "warn", "pending"] as Status[]).map((st) => {
                const M = STATUS_META[st];
                return <li key={st} className="flex items-center gap-1"><span className="grid size-4 place-items-center rounded-full text-white" style={{ background: M.color }}><M.Icon className="size-2.5" strokeWidth={3} aria-hidden /></span>{M.label} ({counts[st] ?? 0})</li>;
              })}
              <li className="flex items-center gap-1"><span className="size-4 rounded-full ring-2 ring-[#2563eb]" aria-hidden />Seleccionado</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Panel lateral: filtros + lista sincronizada + detalle */}
      <div className="space-y-3">
        <div className="space-y-2 rounded-lg border border-line bg-surface p-3">
          <Select aria-label="Vista de campaña" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
            <option value="">Vista: último resultado</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>Campaña {c.code} · {c.name}</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Select aria-label="Filtrar por estado" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as Status | "")}>
              <option value="">Todos los estados</option>
              {(["pass", "fail", "warn", "pending"] as Status[]).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </Select>
            <Input type="date" aria-label="Considerar pendiente si no se ha medido desde" title="Pendiente si no se ha medido desde esta fecha" value={since} onChange={(e) => setSince(e.target.value)} disabled={!!campaign} />
          </div>
          <Checkbox label="Mostrar ruta de medición" checked={showRoute} onChange={(e) => setShowRoute(e.target.checked)} />
        </div>

        {sel ? (
          <div className="animate-in rounded-lg border-2 border-[#2563eb]/40 bg-surface p-3">
            <div className="flex items-start justify-between gap-2">
              <div><p className="font-mono font-semibold">{sel.code}</p><p className="text-sm text-muted">{sel.name}</p></div>
              <button onClick={() => setSelected(null)} aria-label="Cerrar detalle" className="text-faint hover:text-fg"><X className="size-4" /></button>
            </div>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between gap-2"><dt className="text-muted">Estado</dt><dd><ResultBadge result={campaign ? campaign.items[sel.id]?.result : sel.last_result} /></dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Última medición</dt><dd>{sel.last_measured_at ? fmtDateTime(sel.last_measured_at) : "Nunca"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Tipo / categoría</dt><dd className="text-right">{sel.type === "asset" ? `Activo ${sel.asset_code}` : sel.type === "reference" ? "Referencia" : "Medición"}{sel.category_name ? ` · ${sel.category_name}` : ""}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Coordenadas</dt><dd className="font-mono text-xs">x {sel.x.toFixed(4)} · y {sel.y.toFixed(4)}</dd></div>
              {sel.route_order ? <div className="flex justify-between gap-2"><dt className="text-muted">Orden en ruta</dt><dd>#{sel.route_order}</dd></div> : null}
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              {canMeasure && sel.type !== "reference" && editable ? <Link href={`/medicion?point=${sel.id}${campaign && campaign.status === "in_progress" ? `&campaign=${campaign.id}` : ""}`} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-fg hover:bg-primary-hover"><ScanLine className="size-4" />Medir</Link> : null}
              <Link href={`/historial?q=${encodeURIComponent(sel.code)}&status=all`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-sm hover:bg-surface-2"><History className="size-4" />Histórico</Link>
              {canEdit && editable ? <Button size="sm" variant="outline" icon={Pencil} onClick={() => setFormFor({ id: sel.id })}>Editar</Button> : null}
              {canEdit && editable ? <Button size="sm" variant="outline" icon={Archive} onClick={() => setArchiveFor(sel)}>Archivar</Button> : null}
            </div>
          </div>
        ) : null}

        <div className="rounded-lg border border-line bg-surface">
          <div className="flex items-center gap-2 border-b border-line p-2">
            <Search className="ml-1 size-4 text-faint" aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar punto…" aria-label="Buscar punto" className="h-8 flex-1 bg-transparent text-sm focus:outline-none" />
            <span className="text-xs text-muted">{listed.length}</span>
          </div>
          {checked.size > 0 ? (
            <div className="flex items-center gap-2 border-b border-line bg-primary-soft/60 px-3 py-1.5 text-xs">
              {checked.size} marcados
              {canEdit ? <Link className="ml-auto inline-flex items-center gap-1 font-medium text-primary hover:underline" href={`/campanas/nueva?plan=${planId}&points=${[...checked].join(",")}`}><CalendarPlus className="size-3.5" />Crear campaña</Link> : null}
              <button className="text-muted hover:text-fg" onClick={() => setChecked(new Set())}>Quitar</button>
            </div>
          ) : null}
          <ul className="max-h-[48vh] overflow-y-auto" aria-label="Puntos del plano">
            {listed.length === 0 ? <li className="px-3 py-4 text-sm text-muted">Sin puntos.</li> : null}
            {listed.sort((a, b) => (a.route_order ?? 1e9) - (b.route_order ?? 1e9) || a.code.localeCompare(b.code)).map((p) => {
              const st = statusOf(p, campaign, since || null);
              const M = STATUS_META[st];
              return (
                <li key={p.id} className={cn("flex items-center gap-2 border-b border-line px-2 py-1.5 last:border-0", p.id === selected && "bg-info-soft")}>
                  <input type="checkbox" aria-label={`Marcar ${p.code}`} className="size-4 accent-[var(--primary)]" checked={checked.has(p.id)} onChange={() => setChecked((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} />
                  <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => { setSelected(p.id); center(p); }}>
                    <span className="grid size-5 shrink-0 place-items-center rounded-full text-white" style={{ background: M.color }}><M.Icon className="size-3" strokeWidth={3} aria-hidden /></span>
                    <span className="font-mono text-xs font-semibold">{p.code}</span>
                    <span className="truncate text-xs text-muted">{p.name}</span>
                    <span className="sr-only">{M.label}</span>
                  </button>
                  {p.route_order ? <Badge>#{p.route_order}</Badge> : null}
                </li>
              );
            })}
          </ul>
        </div>
        {campaign && campaign.status === "in_progress" && canMeasure ? (
          <Link href={`/medicion?campaign=${campaign.id}`} className="flex h-10 items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-fg hover:bg-primary-hover"><Route className="size-4" />Recorrer ruta de la campaña</Link>
        ) : null}
      </div>

      {formFor ? (
        <PointForm
          planId={planId} page={pageNo} target={formFor} point={formFor.id ? points.find((p) => p.id === formFor.id) ?? null : null}
          nextCode={`P-${String(points.length + 1).padStart(2, "0")}`}
          categories={categories} criteria={criteria} assets={assets} locations={locations}
          withLock={withLock}
          onClose={() => setFormFor(null)}
          onSaved={() => { setFormFor(null); router.refresh(); }}
        />
      ) : null}
      <ConfirmDialog open={!!archiveFor} onClose={() => setArchiveFor(null)} danger reason="required" loading={archiveAct.pending} title={`Archivar punto ${archiveFor?.code}`}
        description="El punto deja de mostrarse y de admitir mediciones. Su historial se conserva y la acción queda en auditoría." confirmLabel="Archivar"
        onConfirm={async (reason) => {
          const p = archiveFor!;
          const ok = await withLock((o) => archiveAct.run({ id: p.id, reason, overrideReason: o ?? reason }, { success: `Punto ${p.code} archivado` }));
          setArchiveFor(null);
          if (ok) { setSelected(null); router.refresh(); }
        }} />
      <ConfirmDialog open={!!override} onClose={() => { setOverride(null); setPoints(initialPoints); }} reason="required" title="Plano protegido por campaña en curso" description={override?.message} confirmLabel="Confirmar cambio" onConfirm={(r) => override?.retry(r)} />
    </div>
  );
}

function PointForm({ planId, page, target, point, nextCode, categories, criteria, assets, locations, onClose, onSaved, withLock }: {
  planId: string; page: number; target: { id?: string; x?: number; y?: number }; point: PlanPoint | null; nextCode: string;
  categories: Opt[]; criteria: Opt[]; assets: Opt[]; locations: Opt[]; onClose: () => void; onSaved: () => void;
  withLock: <T>(fn: (o: string | null) => Promise<{ ok: true; data: T } | { ok: false; error: string } | null>) => Promise<boolean>;
}) {
  const [v, setV] = React.useState({
    code: point?.code ?? nextCode, name: point?.name ?? "", pointType: point?.type ?? "measurement", categoryId: point?.category_id ?? categories[0]?.id ?? "",
    locationId: point?.location_id ?? "", assetId: point?.asset_id ?? "", criterionId: point?.criterion_id ?? "", routeOrder: point?.route_order ? String(point.route_order) : "", notes: point?.notes ?? "",
  });
  const [errs, setErrs] = React.useState<Record<string, string>>({});
  const create = useAction(createPointAction);
  const update = useAction(updatePointAction);
  const data = () => ({ code: v.code, name: v.name, pointType: v.pointType as PlanPoint["type"], categoryId: v.categoryId || null, locationId: v.locationId || null, assetId: v.assetId || null, criterionId: v.criterionId || null, routeOrder: v.routeOrder ? Number(v.routeOrder) : null, notes: v.notes || null });
  const save = async () => {
    if (point) {
      const r = await update.run({ id: point.id, data: data() }, { success: "Punto actualizado" });
      if (r && !r.ok) setErrs(Object.fromEntries(Object.entries(r.fieldErrors ?? {}).map(([k, m]) => [k.replace("data.", ""), m])));
      if (r?.ok) onSaved();
      return;
    }
    const ok = await withLock(async (o) => {
      const r = await create.run({ planId, page, x: target.x!, y: target.y!, data: data(), overrideReason: o }, { success: "Punto añadido" });
      if (r && !r.ok) setErrs(Object.fromEntries(Object.entries(r.fieldErrors ?? {}).map(([k, m]) => [k.replace("data.", ""), m])));
      return r;
    });
    if (ok) onSaved();
  };
  return (
    <Modal open onClose={onClose} title={point ? `Editar punto ${point.code}` : "Nuevo punto"} description={point ? undefined : `Posición normalizada x ${target.x?.toFixed(4)} · y ${target.y?.toFixed(4)} (página ${page})`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={create.pending || update.pending} onClick={save}>Guardar</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Código" htmlFor="pt-code" required error={errs.code}><Input id="pt-code" className="font-mono" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} autoFocus /></Field>
        <Field label="Nombre" htmlFor="pt-name" required error={errs.name}><Input id="pt-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Tipo de punto" htmlFor="pt-type">
          <Select id="pt-type" value={v.pointType} onChange={(e) => setV({ ...v, pointType: e.target.value as PlanPoint["type"] })}>
            <option value="measurement">Punto de medición (p. ej. suelo)</option>
            <option value="asset">Activo inventariado</option>
            <option value="reference">Referencia (no se mide)</option>
          </Select>
        </Field>
        <Field label="Categoría" htmlFor="pt-cat"><Select id="pt-cat" value={v.categoryId} onChange={(e) => setV({ ...v, categoryId: e.target.value })}><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></Field>
        {v.pointType === "asset" ? (
          <Field label="Activo vinculado" htmlFor="pt-asset" required error={errs.assetId}><Select id="pt-asset" value={v.assetId} onChange={(e) => setV({ ...v, assetId: e.target.value })}><option value="">Seleccione…</option>{assets.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></Field>
        ) : null}
        <Field label="Zona" htmlFor="pt-loc"><Select id="pt-loc" value={v.locationId} onChange={(e) => setV({ ...v, locationId: e.target.value })}><option value="">—</option>{locations.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></Field>
        <Field label="Criterio específico" htmlFor="pt-crit" hint="Vacío = el de la categoría"><Select id="pt-crit" value={v.criterionId} onChange={(e) => setV({ ...v, criterionId: e.target.value })}><option value="">De la categoría</option>{criteria.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></Field>
        <Field label="Orden en la ruta" htmlFor="pt-route"><Input id="pt-route" type="number" min={1} value={v.routeOrder} onChange={(e) => setV({ ...v, routeOrder: e.target.value })} /></Field>
      </div>
      <Field label="Notas" htmlFor="pt-notes" className="mt-4"><Textarea id="pt-notes" rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
    </Modal>
  );
}

