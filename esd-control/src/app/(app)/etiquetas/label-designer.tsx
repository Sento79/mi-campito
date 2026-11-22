"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Printer, FileCode2, Save, Search, X, Plus } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, Checkbox, Field, Input, Select } from "@/components/ui/core";
import { useAction, useToast } from "@/components/ui/client";
import { LABEL_SIZES, labelLayoutSchema, labelLines, sheetGrid, type LabelData, type LabelLayout } from "@/lib/domain/labels";
import { saveLabelTemplateAction, searchAssetsForLabelsAction } from "./actions";

type Tpl = { id: string; name: string; widthMm: number; heightMm: number; layout: LabelLayout; isDefault: boolean };
type A = { id: string; code: string; name: string };
type Opt = { id: string; label: string };

export function LabelDesigner({ templates, initialAssets, sample, categories, locations, canSave, hasLogo }: { templates: Tpl[]; initialAssets: A[]; sample: LabelData | null; categories: Opt[]; locations: Opt[]; canSave: boolean; hasLogo: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const def = templates[0];
  const [tplId, setTplId] = React.useState(def?.id ?? "");
  const [name, setName] = React.useState(def?.name ?? "Nueva plantilla");
  const [w, setW] = React.useState(def?.widthMm ?? 50);
  const [h, setH] = React.useState(def?.heightMm ?? 30);
  const [l, setL] = React.useState<LabelLayout>(def?.layout ?? labelLayoutSchema.parse({}));
  const [assets, setAssets] = React.useState<A[]>(initialAssets);
  const [q, setQ] = React.useState({ q: "", categoryId: "", locationId: "" });
  const [results, setResults] = React.useState<A[]>([]);
  const [busy, setBusy] = React.useState<"pdf" | "zpl" | null>(null);
  const save = useAction(saveLabelTemplateAction);
  const search = useAction(searchAssetsForLabelsAction);

  const pick = (t: Tpl) => { setTplId(t.id); setName(t.name); setW(t.widthMm); setH(t.heightMm); setL(t.layout); };
  const set = <K extends keyof LabelLayout>(k: K, v: LabelLayout[K]) => setL((x) => ({ ...x, [k]: v }));
  const grid = sheetGrid(w, h, l);
  const data = sample ?? { code: "TAP-0001", name: "Ejemplo", scanCode: "TAP-0001", url: "https://ejemplo/a/TAP-0001", category: "Tapetes ESD", location: "Línea 1", nextDue: "01/01/2027", lastMeasured: "01/10/2026", status: "Activo" };
  const lines = labelLines(data, l);

  const generate = async (kind: "pdf" | "zpl") => {
    if (!assets.length) return toast({ tone: "warn", title: "Añada al menos un activo" });
    setBusy(kind);
    try {
      const res = await fetch(`/api/labels/${kind}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetIds: assets.map((a) => a.id), widthMm: w, heightMm: h, layout: l }) });
      if (!res.ok) return toast({ tone: "bad", title: (await res.json().catch(() => ({}))).error ?? "No se pudo generar" });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (kind === "pdf") window.open(url, "_blank", "noopener");
      else {
        const a = document.createElement("a");
        a.href = url;
        a.download = "etiquetas.zpl";
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } finally {
      setBusy(null);
    }
  };

  // Vista previa a escala real (unidades mm de CSS)
  const qrSide = (h - 2 * l.marginMm) * l.qrSize;
  const showQr = l.code === "qr" || l.code === "both";
  const showBar = l.code === "barcode" || l.code === "both";
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card>
          <CardHeader title="Plantilla" />
          <div className="space-y-3 p-4">
            <Select aria-label="Plantilla" value={tplId} disabled={save.pending} onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); if (t) pick(t); else { setTplId(""); setName("Nueva plantilla"); } }}>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isDefault ? " (por defecto)" : ""}</option>)}
              <option value="">+ Nueva plantilla</option>
            </Select>
            <Field label="Nombre" htmlFor="lt-name"><Input id="lt-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <div className="flex flex-wrap gap-1.5">
              {LABEL_SIZES.map((s) => <button key={s.key} onClick={() => { setW(s.width); setH(s.height); }} className={`rounded-md border px-2 py-1 text-xs ${w === s.width && h === s.height ? "border-primary bg-primary-soft text-primary" : "border-line hover:bg-surface-2"}`}>{s.label}</button>)}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Ancho (mm)" htmlFor="lt-w"><Input id="lt-w" type="number" min={10} max={300} value={w} onChange={(e) => setW(Number(e.target.value) || 10)} /></Field>
              <Field label="Alto (mm)" htmlFor="lt-h"><Input id="lt-h" type="number" min={10} max={300} value={h} onChange={(e) => setH(Number(e.target.value) || 10)} /></Field>
            </div>
            <Field label="Código" htmlFor="lt-code">
              <Select id="lt-code" value={l.code} onChange={(e) => set("code", e.target.value as LabelLayout["code"])}><option value="qr">QR</option><option value="barcode">Código de barras (Code 128)</option><option value="both">QR + código de barras</option><option value="none">Ninguno</option></Select>
            </Field>
            <fieldset className="grid grid-cols-2 gap-2 text-sm">
              <legend className="mb-1 text-sm font-medium">Contenido</legend>
              <Checkbox label="Nombre" checked={l.showName} onChange={(e) => set("showName", e.target.checked)} />
              <Checkbox label="ID" checked={l.showCode} onChange={(e) => set("showCode", e.target.checked)} />
              <Checkbox label="Categoría" checked={l.showCategory} onChange={(e) => set("showCategory", e.target.checked)} />
              <Checkbox label="Ubicación" checked={l.showLocation} onChange={(e) => set("showLocation", e.target.checked)} />
              <Checkbox label="Última medición" checked={l.showLastMeasured} onChange={(e) => set("showLastMeasured", e.target.checked)} />
              <Checkbox label="Próxima medición" checked={l.showNextDue} onChange={(e) => set("showNextDue", e.target.checked)} />
              <Checkbox label="Estado" checked={l.showStatus} onChange={(e) => set("showStatus", e.target.checked)} />
              <Checkbox label="Logo" checked={l.showLogo} disabled={!hasLogo} title={hasLogo ? "" : "Suba un logo en Configuración"} onChange={(e) => set("showLogo", e.target.checked)} />
            </fieldset>
            <Field label="Texto personalizado" htmlFor="lt-txt"><Input id="lt-txt" maxLength={80} value={l.customText} onChange={(e) => set("customText", e.target.value)} placeholder="p. ej. «Elemento ESD – no retirar»" /></Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Fuente (pt)" htmlFor="lt-fs"><Input id="lt-fs" type="number" min={4} max={20} step={0.5} value={l.fontSize} onChange={(e) => set("fontSize", Number(e.target.value) || 7)} /></Field>
              <Field label="QR (% alto)" htmlFor="lt-qr"><Input id="lt-qr" type="number" min={30} max={100} value={Math.round(l.qrSize * 100)} onChange={(e) => set("qrSize", Math.min(1, Math.max(0.3, Number(e.target.value) / 100)))} /></Field>
              <Field label="Margen (mm)" htmlFor="lt-m"><Input id="lt-m" type="number" min={0} max={10} step={0.5} value={l.marginMm} onChange={(e) => set("marginMm", Number(e.target.value) || 0)} /></Field>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Papel" htmlFor="lt-paper"><Select id="lt-paper" value={l.sheet.paper} onChange={(e) => set("sheet", { ...l.sheet, paper: e.target.value as LabelLayout["sheet"]["paper"] })}><option value="A4">A4</option><option value="Letter">Carta</option><option value="roll">Rollo (térmica)</option></Select></Field>
              <Field label="Separación" htmlFor="lt-gap"><Input id="lt-gap" type="number" min={0} max={20} value={l.sheet.gapMm} onChange={(e) => set("sheet", { ...l.sheet, gapMm: Number(e.target.value) || 0 })} /></Field>
              <Field label="Margen hoja" htmlFor="lt-sm"><Input id="lt-sm" type="number" min={0} max={30} value={l.sheet.marginMm} onChange={(e) => set("sheet", { ...l.sheet, marginMm: Number(e.target.value) || 0 })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Zebra: resolución" htmlFor="lt-dpi"><Select id="lt-dpi" value={l.thermal.dpi} onChange={(e) => set("thermal", { ...l.thermal, dpi: Number(e.target.value) as 203 | 300 | 600 })}><option value={203}>203 dpi</option><option value={300}>300 dpi</option><option value={600}>600 dpi</option></Select></Field>
              <Field label="Zebra: densidad (0–30)" htmlFor="lt-dk"><Input id="lt-dk" type="number" min={0} max={30} value={l.thermal.darkness} onChange={(e) => set("thermal", { ...l.thermal, darkness: Math.min(30, Math.max(0, Number(e.target.value) || 0)) })} /></Field>
            </div>
            {canSave ? <Button variant="outline" icon={Save} loading={save.pending} className="w-full" onClick={async () => { const r = await save.run({ id: tplId || null, name, widthMm: w, heightMm: h, layout: l, isDefault: templates.find((t) => t.id === tplId)?.isDefault ?? false }, { success: "Plantilla guardada" }); if (r?.ok) { setTplId(r.data.id); router.refresh(); } }}>Guardar plantilla</Button> : null}
          </div>
        </Card>
      </div>
      <div className="min-w-0 space-y-4">
        <Card>
          <CardHeader title="Vista previa a escala real" description={l.sheet.paper === "roll" ? "Una etiqueta por página (rollo)" : `${grid.cols} × ${grid.rows} = ${grid.cols * grid.rows} etiquetas por hoja ${l.sheet.paper}`} />
          <div className="flex justify-center overflow-x-auto bg-surface-2 p-8">
            <div className="relative overflow-hidden bg-white text-black shadow-md" style={{ width: `${w}mm`, height: `${h}mm`, padding: `${l.marginMm}mm` }} aria-label="Vista previa de etiqueta">
              <div className="flex h-full gap-[1.5mm]">
                {showQr ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/barcode?type=qr&text=${encodeURIComponent(data.url)}`} alt="QR" style={{ width: `${qrSide}mm`, height: `${qrSide}mm` }} />
                ) : null}
                <div className="flex min-w-0 flex-1 flex-col">
                  {lines.map((t, i) => <div key={i} className="truncate leading-tight" style={{ fontSize: `${l.fontSize}pt`, fontWeight: i === 0 && l.showName ? 700 : 400 }}>{t}</div>)}
                  {showBar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/barcode?type=barcode&text=${encodeURIComponent(data.scanCode)}`} alt="Código de barras" className="mt-auto" style={{ height: `${(h - 2 * l.marginMm) * 0.28}mm`, width: "100%" }} />
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          <p className="px-5 py-2 text-xs text-muted">QR: <span className="font-mono break-words">{data.url}</span> — no contiene datos del activo; abre la ficha tras iniciar sesión.</p>
        </Card>
        <Card>
          <CardHeader title={`Activos a imprimir (${assets.length})`} actions={<><Button variant="outline" icon={FileCode2} loading={busy === "zpl"} onClick={() => generate("zpl")}>ZPL</Button><Button icon={Printer} loading={busy === "pdf"} onClick={() => generate("pdf")}>Generar PDF</Button></>} />
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap items-end gap-2">
              <Input aria-label="Buscar activos" placeholder="ID o nombre" className="w-48" value={q.q} onChange={(e) => setQ({ ...q, q: e.target.value })} />
              <Select aria-label="Categoría" className="w-44" value={q.categoryId} onChange={(e) => setQ({ ...q, categoryId: e.target.value })}><option value="">Todas las categorías</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>
              <Select aria-label="Ubicación" className="w-44" value={q.locationId} onChange={(e) => setQ({ ...q, locationId: e.target.value })}><option value="">Todas las ubicaciones</option>{locations.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>
              <Button variant="outline" icon={Search} loading={search.pending} onClick={async () => { const r = await search.run({ q: q.q, categoryId: q.categoryId || null, locationId: q.locationId || null }); if (r?.ok) setResults(r.data); }}>Buscar</Button>
              {results.length ? <Button variant="ghost" icon={Plus} onClick={() => { setAssets((x) => { const merged = [...x, ...results.filter((r) => !x.some((y) => y.id === r.id))]; if (merged.length > 2000) toast({ tone: "warn", title: "Máximo 2000 etiquetas por lote", body: "Se han añadido las primeras." }); return merged.slice(0, 2000); }); setResults([]); }}>Añadir {results.length}</Button> : null}
            </div>
            {results.length ? <Alert tone="info">{results.length} resultado(s): {results.slice(0, 8).map((r) => r.code).join(", ")}{results.length > 8 ? "…" : ""}</Alert> : null}
            <div className="flex flex-wrap gap-1.5">
              {assets.map((a) => <Badge key={a.id} tone="primary">{a.code}<button className="ml-0.5" aria-label={`Quitar ${a.code}`} onClick={() => setAssets((x) => x.filter((y) => y.id !== a.id))}><X className="size-3" /></button></Badge>)}
              {assets.length === 0 ? <p className="text-sm text-muted">Busque activos o selecciónelos en el inventario («Etiquetas» en acciones masivas).</p> : null}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
