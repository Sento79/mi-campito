"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Upload, FileText } from "lucide-react";
import { Alert, Button, Card, Field, Input, Select, Textarea } from "@/components/ui/core";
import { useToast } from "@/components/ui/client";
import { addPlanVersionAction, createPlanAction } from "./actions";

const MAX_MB = 20;
// Anchos de renderizado de página PDF, de mayor a menor calidad, para respetar el límite total de subida
const RENDER_WIDTHS = [2400, 1800, 1400, 1000];
const TOTAL_BUDGET = 24 * 1024 * 1024; // límite de la Server Action: 25 MB

/**
 * Convierte cada página de un PDF a PNG en el navegador con pdf.js (sin
 * enviar el PDF a terceros). El servidor guarda el PDF original y las
 * imágenes de página, sobre las que se posicionan los puntos.
 */
async function renderPdfPages(file: File, targetWidth: number, onProgress: (done: number, total: number) => void): Promise<Blob[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  if (doc.numPages > 30) throw new Error("El PDF tiene más de 30 páginas");
  const out: Blob[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(4, targetWidth / base.width);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push(await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("No se pudo convertir la página"))), "image/png")));
    onProgress(i, doc.numPages);
  }
  await doc.destroy();
  return out;
}

export function PlanUploadForm({ mode, planId, locations, users }: { mode: "create" | "version"; planId?: string; locations: { id: string; label: string }[]; users: { id: string; label: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [file, setFile] = React.useState<File | null>(null);
  const [progress, setProgress] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    if (!file) return setError("Seleccione un archivo PDF, PNG o JPG");
    if (file.size > MAX_MB * 1024 * 1024) return setError(`El archivo supera ${MAX_MB} MB`);
    const ok = /\.(pdf|png|jpe?g)$/i.test(file.name) && ["application/pdf", "image/png", "image/jpeg"].includes(file.type);
    if (!ok) return setError("Formato no admitido. Use PDF, PNG o JPG.");
    const fd = new FormData(e.currentTarget);
    fd.set("file", file);
    if (planId) fd.set("planId", planId);
    setBusy(true);
    try {
      if (file.type === "application/pdf") {
        setProgress("Procesando PDF…");
        let pages: Blob[] = [];
        let fits = false;
        for (const w of RENDER_WIDTHS) {
          pages = await renderPdfPages(file, w, (d, t) => setProgress(`Convirtiendo página ${d} de ${t} (${w} px)…`));
          if (file.size + pages.reduce((n, b) => n + b.size, 0) <= TOTAL_BUDGET) { fits = true; break; }
        }
        if (!fits) { setError("El plano es demasiado pesado incluso a resolución reducida. Divida el PDF o súbalo como imagen."); return; }
        pages.forEach((b, i) => fd.set(`page_${String(i + 1).padStart(3, "0")}`, new File([b], `p${i + 1}.png`, { type: "image/png" })));
      }
      setProgress("Subiendo…");
      const r = mode === "create" ? await createPlanAction(fd) : await addPlanVersionAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const data = r.data as { id?: string; warning?: string | null };
      if (data.warning) toast({ tone: "warn", title: "Nueva versión guardada", body: data.warning });
      else toast({ tone: "ok", title: mode === "create" ? "Plano creado" : "Nueva versión guardada" });
      router.push(`/planos/${data.id ?? planId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo procesar el archivo");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Card className="p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {mode === "create" ? (
            <>
              <Field label="Título" htmlFor="title" required><Input id="title" name="title" required maxLength={200} /></Field>
              <Field label="Planta / edificio / zona" htmlFor="locationId">
                <Select id="locationId" name="locationId"><option value="">—</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select>
              </Field>
              <Field label="Responsable" htmlFor="ownerUserId">
                <Select id="ownerUserId" name="ownerUserId"><option value="">—</option>{users.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select>
              </Field>
            </>
          ) : (
            <Field label="Motivo del cambio de versión" htmlFor="reason" required hint="Queda registrado en auditoría"><Input id="reason" name="reason" required /></Field>
          )}
          <Field label="Etiqueta de versión" htmlFor="label" hint="p. ej. «Rev. B – reforma línea 3»"><Input id="label" name="label" maxLength={120} /></Field>
          <Field label="Fecha de vigencia" htmlFor="effectiveOn"><Input id="effectiveOn" name="effectiveOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
        </div>
        <Field label="Notas" htmlFor="notes" className="mt-4"><Textarea id="notes" name="notes" rows={2} /></Field>
      </Card>
      <Card className="p-5">
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line-strong px-6 py-10 text-center hover:bg-surface-2">
          {file ? <FileText className="size-8 text-primary" aria-hidden /> : <Upload className="size-8 text-muted" aria-hidden />}
          <span className="max-w-full break-words text-sm font-medium">{file ? file.name : "Seleccione el plano (PDF, PNG o JPG, máx. 20 MB)"}</span>
          {file ? <span className="text-xs text-muted">{(file.size / 1048576).toFixed(1)} MB</span> : <span className="text-xs text-muted">Los PDF se convierten a imagen en su navegador; se conserva también el original.</span>}
          <input type="file" accept="application/pdf,image/png,image/jpeg" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Archivo del plano" />
        </label>
      </Card>
      {error ? <Alert tone="bad">{error}</Alert> : null}
      <div className="flex items-center justify-end gap-3">
        {progress ? <span className="text-sm text-muted" role="status">{progress}</span> : null}
        <Button type="submit" icon={Upload} loading={busy}>{mode === "create" ? "Crear plano" : "Subir nueva versión"}</Button>
      </div>
    </form>
  );
}
