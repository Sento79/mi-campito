"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Save, RotateCcw, MapPin, ClipboardList, Gauge, AlertTriangle, Info, CheckCircle2, WifiOff, ChevronRight, Route, Camera, Repeat, History } from "lucide-react";
import { Alert, Badge, Button, Card, Checkbox, ResultBadge, Select, Textarea, cn } from "@/components/ui/core";
import { useToast } from "@/components/ui/client";
import { evaluate, parseRules, type CriterionRules, type NumericRule } from "@/lib/domain/criteria";
import { RESULT_LABEL, type Result } from "@/lib/domain/results";
import type { ScannerConfig } from "@/lib/domain/scanner";
import type { OrgSettings } from "@/lib/domain/settings";
import { fmtDate, fmtDateTime, fmtRelative } from "@/lib/format";
import { cacheTarget, enqueue, getCachedTarget, syncOutbox } from "@/lib/client/outbox";
import { lookupTargetAction, nextCampaignItemAction, type TargetDTO } from "./actions";
import { uploadMeasurementPhotoAction } from "./photo-action";
import { ScanBar, useHidCapture, useScannerConfig } from "./scanner";
import { buildInput, emptyForm, ChecklistInput, CombinedInput, MultipointInput, NumericInput, ReasonPicker, SelectInput, type FormState } from "./measure-inputs";
import { OutboxPanel } from "./outbox-panel";

interface Instrument { id: string; label: string; valid: boolean; type: string; status: string; due: string | null }
interface Saved { result: Result; reasons: string[]; ncCode: string | null; ncId: string | null; id: string | null; offline: boolean; label: string; warnings: string[] }

const INSTR_KEY = "esd-last-instrument";

export function QuickMeasure({ orgId, settings, instruments, canCreateNc }: { orgId: string; settings: OrgSettings; instruments: Instrument[]; canCreateNc: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const sp = useSearchParams();
  const scanRef = React.useRef<HTMLInputElement>(null);
  const [cfg, setCfg] = useScannerConfig({ ...settings.scanner, idleTimeoutMs: 80 } as ScannerConfig);
  const [target, setTarget] = React.useState<TargetDTO | null>(null);
  const [fromCache, setFromCache] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [lookupError, setLookupError] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<FormState>(emptyForm());
  const [mode, setMode] = React.useState<"measure" | "not_measurable" | "not_applicable">("measure");
  const [reason, setReason] = React.useState({ r: "", d: "" });
  const [comment, setComment] = React.useState("");
  const [instrumentId, setInstrumentId] = React.useState("");
  const [notRequired, setNotRequired] = React.useState(false);
  const [campaignId, setCampaignId] = React.useState("");
  const [signature, setSignature] = React.useState(false);
  const [createNc, setCreateNc] = React.useState(settings.autoCreateNc !== "never");
  const [photo, setPhoto] = React.useState<File | null>(null);
  const [repeat, setRepeat] = React.useState<{ id: string; reason: string } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState<Saved | null>(null);
  const [routeCampaign, setRouteCampaign] = React.useState<string | null>(sp.get("campaign"));
  const [routeInfo, setRouteInfo] = React.useState<{ route: number; total: number; completed: number; remaining: number } | null>(null);
  const savingRef = React.useRef(false);

  React.useEffect(() => {
    try {
      const last = localStorage.getItem(INSTR_KEY);
      if (last && instruments.some((i) => i.id === last)) setInstrumentId(last);
    } catch {}
  }, [instruments]);

  const rules: CriterionRules | null = React.useMemo(() => (target?.criterion ? parseRules(target.criterion.rules) : null), [target]);
  const draftKey = target ? `esd-draft:${target.pointId ?? target.assetId}` : null;

  // Borrador local (se guarda en este dispositivo mientras se completa)
  React.useEffect(() => {
    if (!draftKey) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ form, mode, reason, comment, at: Date.now() }));
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [draftKey, form, mode, reason, comment]);

  const resetForm = () => {
    setForm(emptyForm());
    setMode("measure");
    setReason({ r: "", d: "" });
    setComment("");
    setSignature(false);
    setPhoto(null);
    setRepeat(null);
    setCreateNc(settings.autoCreateNc !== "never");
  };

  const applyTarget = React.useCallback(
    (dto: TargetDTO, cached = false) => {
      setTarget(dto);
      setFromCache(cached);
      setSaved(null);
      setLookupError(null);
      resetForm();
      const fromRoute = routeCampaign && dto.campaigns.some((c) => c.id === routeCampaign) ? routeCampaign : null;
      setCampaignId(fromRoute ?? (dto.campaigns.length === 1 ? dto.campaigns[0].id : ""));
      if (!dto.instrumentRequired) setNotRequired(false);
      try {
        const d = localStorage.getItem(`esd-draft:${dto.pointId ?? dto.assetId}`);
        if (d) {
          const p = JSON.parse(d);
          if (Date.now() - p.at < 24 * 3600_000) {
            setForm(p.form);
            setMode(p.mode);
            setReason(p.reason);
            setComment(p.comment);
            toast({ tone: "info", title: "Borrador restaurado", body: "Se recuperaron los datos sin guardar de este elemento." });
          }
        }
      } catch {}
      if (!cached) {
        const keys = [dto.code, dto.scanCode, dto.assetId, dto.pointId].filter(Boolean) as string[];
        cacheTarget(orgId, keys, dto);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orgId, routeCampaign],
  );

  const lookup = React.useCallback(
    async (q: { scan?: string; assetId?: string; pointId?: string }) => {
      setLoading(true);
      setLookupError(null);
      try {
        const r = await lookupTargetAction(q);
        if (r.ok) applyTarget(r.data);
        else {
          setLookupError(r.error);
          setTarget(null);
          toast({ tone: "bad", title: r.error });
          scanRef.current?.focus();
        }
      } catch {
        // Sin conexión: intentar la caché local
        const key = q.scan ?? q.assetId ?? q.pointId ?? "";
        const c = await getCachedTarget(orgId, key);
        if (c) {
          applyTarget(c.data as TargetDTO, true);
          toast({ tone: "warn", title: "Sin conexión: datos de la última consulta", body: `Guardados el ${fmtDateTime(c.cachedAt)}. El resultado se confirmará al sincronizar.` });
        } else {
          setLookupError("Sin conexión y sin datos guardados de este elemento en el dispositivo.");
          toast({ tone: "bad", title: "Sin conexión", body: "Este elemento no se ha consultado antes en este dispositivo." });
        }
      } finally {
        setLoading(false);
      }
    },
    [applyTarget, orgId, toast],
  );

  const loadNext = React.useCallback(
    async (campaign: string, after?: number) => {
      setLoading(true);
      try {
        const r = await nextCampaignItemAction({ campaignId: campaign, afterItemOrder: after });
        if (!r.ok) {
          toast({ tone: "bad", title: r.error });
          return;
        }
        if (r.data.done) {
          setRouteInfo(null);
          setTarget(null);
          toast({ tone: "ok", title: "Ruta completada", body: `Todos los elementos de la campaña están registrados (${r.data.completed}/${r.data.total}).` });
          return;
        }
        setRouteInfo({ route: r.data.route, total: r.data.total, completed: r.data.completed, remaining: r.data.remaining });
        applyTarget(r.data.target);
      } catch {
        toast({ tone: "bad", title: "Sin conexión", body: "No se pudo cargar el siguiente elemento de la ruta." });
      } finally {
        setLoading(false);
      }
    },
    [applyTarget, toast],
  );

  // Carga inicial por URL: ?asset=CODIGO, ?point=ID, ?campaign=ID
  const initDone = React.useRef(false);
  React.useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;
    const asset = sp.get("asset");
    const point = sp.get("point");
    if (point) lookup({ pointId: point });
    else if (asset) lookup({ scan: asset });
    else if (routeCampaign) loadNext(routeCampaign);
    else scanRef.current?.focus();
  }, [sp, lookup, loadNext, routeCampaign]);

  const capturing = !saving;
  useHidCapture(cfg, capturing, (code) => lookup({ scan: code }), scanRef);

  // Vista previa (provisional): el servidor recalcula al guardar
  const selectedInstrument = instruments.find((i) => i.id === instrumentId);
  const input = React.useMemo(() => {
    if (mode !== "measure") return { kind: mode, reason: [reason.r, reason.d].filter(Boolean).join(": ") } as const;
    return buildInput(rules, target?.recordMethod ?? null, form);
  }, [mode, reason, rules, target, form]);
  const preview = React.useMemo(() => {
    if (!target) return null;
    if (mode !== "measure" && reason.r.length < 2) return null;
    try {
      return evaluate(mode === "measure" ? rules : null, input as never, {
        expectedPoints: target.expectedPoints as never,
        instrument: mode === "measure" ? { required: target.instrumentRequired, declaredNotRequired: notRequired, provided: !!selectedInstrument, calibrationValid: selectedInstrument ? selectedInstrument.valid : null, status: selectedInstrument?.status, policy: settings.instrumentPolicy } : undefined,
      });
    } catch {
      return null;
    }
  }, [target, rules, input, mode, reason, notRequired, selectedInstrument, settings.instrumentPolicy]);
  const pointResults = React.useMemo(() => Object.fromEntries((preview?.values ?? []).filter((v) => v.pointCode).map((v) => [v.pointCode!, v.result])), [preview]);
  const hasAnyValue = mode !== "measure" || (preview?.values ?? []).some((v) => v.rawInput || v.optionValue || v.checked !== null && v.checked !== undefined);

  const save = React.useCallback(async () => {
    if (!target || savingRef.current) return;
    if (target.archived || target.status === "retired") return;
    if (mode !== "measure" && reason.r.length < 2) {
      toast({ tone: "bad", title: "Indique el motivo de «" + (mode === "not_measurable" ? "No medible" : "No aplica") + "»" });
      return;
    }
    if (mode !== "measure" && reason.r.startsWith("Otro") && reason.d.trim().length < 3) {
      toast({ tone: "bad", title: "Detalle el motivo" });
      return;
    }
    if (mode === "measure" && !hasAnyValue) {
      toast({ tone: "bad", title: "Introduzca el valor medido" });
      return;
    }
    if (preview?.blockedReason) {
      toast({ tone: "bad", title: "No se puede registrar", body: preview.blockedReason });
      return;
    }
    if (target.requiredFields.includes("comment") && !comment.trim()) {
      toast({ tone: "bad", title: "El comentario es obligatorio para esta categoría" });
      return;
    }
    if (target.requiredFields.includes("photo") && !photo && mode === "measure") {
      toast({ tone: "bad", title: "Adjunte una foto (obligatoria para esta categoría)" });
      return;
    }
    if (settings.requireSignature && !signature) {
      toast({ tone: "bad", title: "Confirme la medición marcando la casilla de conformidad del técnico" });
      return;
    }
    if (repeat && repeat.reason.trim().length < 3) {
      toast({ tone: "bad", title: "Indique el motivo de la repetición" });
      return;
    }
    savingRef.current = true;
    setSaving(true);
    const clientId = crypto.randomUUID();
    const payload = {
      clientId,
      assetId: target.assetId,
      planPointId: target.pointId,
      campaignId: campaignId || null,
      instrumentId: mode === "measure" && !notRequired ? instrumentId || null : null,
      instrumentNotRequired: mode === "measure" && notRequired,
      input,
      comment: comment.trim() || undefined,
      measuredAtLocal: new Date().toISOString(),
      deviceTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      repeatsMeasurementId: repeat?.id ?? null,
      repeatReason: repeat?.reason,
      signatureConfirmed: signature,
      expectedCriterionVersionId: target.criterion?.id ?? null,
      createNc: canCreateNc && createNc,
    };
    const label = `${target.code} · ${target.name}`;
    try {
      let res: Response;
      try {
        res = await fetch("/api/measurements", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      } catch {
        await enqueue({ clientId, orgId, payload, label, provisionalResult: preview?.result ?? null });
        setSaved({ result: (preview?.result ?? "pending") as Result, reasons: preview?.reasons ?? [], ncCode: null, ncId: null, id: null, offline: true, label, warnings: [] });
        toast({ tone: "warn", title: "Guardada en este dispositivo", body: "Sin conexión. Se enviará automáticamente al recuperar la red. NO está registrada todavía en el servidor." });
        if (draftKey) localStorage.removeItem(draftKey);
        resetForm();
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        router.push("/login?next=/medicion");
        return;
      }
      if (!res.ok) {
        toast({ tone: "bad", title: body.error ?? "No se pudo guardar", body: body.issues?.join("\n") });
        return;
      }
      if (photo && body.id) {
        const fd = new FormData();
        fd.set("file", photo);
        fd.set("measurementId", body.id);
        const up = await uploadMeasurementPhotoAction(fd).catch(() => null);
        if (!up?.ok) toast({ tone: "warn", title: "Medición guardada, pero la foto no se pudo subir", body: up && !up.ok ? up.error : "Adjúntela desde el historial." });
      }
      if (draftKey) localStorage.removeItem(draftKey);
      setSaved({ result: body.result, reasons: body.reasons ?? [], ncCode: body.ncCode, ncId: body.ncId, id: body.id, offline: false, label, warnings: body.warnings ?? [] });
      toast({ tone: body.result === "pass" ? "ok" : body.result === "fail" ? "bad" : "warn", title: `${RESULT_LABEL[body.result as Result]} · ${target.code}`, body: body.ncCode ? `Creada ${body.ncCode}` : undefined });
      resetForm();
      syncOutbox().catch(() => {});
      if (routeCampaign && routeInfo) {
        await loadNext(routeCampaign, routeInfo.route);
      } else {
        setTarget((t) => (t ? { ...t, lastResult: body.result, lastMeasuredAt: new Date().toISOString() } : t));
        scanRef.current?.focus();
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [target, mode, reason, hasAnyValue, preview, comment, photo, settings.requireSignature, signature, repeat, campaignId, notRequired, instrumentId, input, canCreateNc, createNc, orgId, toast, draftKey, router, routeCampaign, routeInfo, loadNext]);

  // Atajos: F2 enfocar escáner, Ctrl+Enter guardar, 1-9 opciones de selección
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        scanRef.current?.focus();
        scanRef.current?.select();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        save();
      } else if (rules?.kind === "select" && mode === "measure" && /^[1-9]$/.test(e.key)) {
        const t = e.target as HTMLElement;
        if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
        const o = rules.options[Number(e.key) - 1];
        if (o) setForm((f) => ({ ...f, option: o.value }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, rules, mode]);

  const disabled = !target || target.archived || target.status === "retired";
  const kind = rules?.kind ?? target?.recordMethod ?? "numeric";

  return (
    <div className="space-y-4">
      <ScanBar inputRef={scanRef} onSubmit={(c) => lookup({ scan: c })} busy={loading} cfg={cfg} onConfig={setCfg} captureActive={capturing} />

      {routeCampaign ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary-soft px-4 py-2.5 text-sm">
          <Route className="size-4 text-primary" aria-hidden />
          <span className="font-medium">Modo ruta de campaña</span>
          {routeInfo ? <span className="text-muted">Elemento {routeInfo.route} · {routeInfo.completed}/{routeInfo.total} registrados · {routeInfo.remaining} pendientes</span> : null}
          <div className="ml-auto flex gap-2">
            {routeInfo ? <Button size="sm" variant="outline" icon={ChevronRight} onClick={() => loadNext(routeCampaign, routeInfo.route)}>Saltar</Button> : null}
            <Button size="sm" variant="ghost" onClick={() => { setRouteCampaign(null); setRouteInfo(null); router.replace("/medicion"); }}>Salir de la ruta</Button>
          </div>
        </div>
      ) : null}

      {saved ? (
        <div className={cn("animate-in flex flex-wrap items-start gap-4 rounded-xl border-2 p-4", saved.offline ? "border-warn bg-warn-soft" : saved.result === "pass" ? "border-ok bg-ok-soft" : saved.result === "fail" ? "border-bad bg-bad-soft" : "border-warn bg-warn-soft")} role="status" aria-live="assertive">
          {saved.offline ? <WifiOff className="size-6 text-warn" aria-hidden /> : <CheckCircle2 className="size-6" aria-hidden />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{saved.offline ? "Pendiente de sincronizar (guardada solo en este dispositivo)" : "Medición registrada"} · {saved.label}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2"><ResultBadge result={saved.result} size="lg" />{saved.offline ? <Badge tone="warn">Resultado provisional</Badge> : null}</div>
            <ul className="mt-2 list-disc pl-5 text-sm text-fg/80">{saved.reasons.slice(0, 4).map((r, i) => <li key={i}>{r}</li>)}</ul>
            {saved.ncCode ? <p className="mt-2 text-sm">No conformidad creada: <Link className="font-semibold text-primary underline" href={`/no-conformidades/${saved.ncId}`}>{saved.ncCode}</Link></p> : null}
          </div>
          <div className="flex flex-col gap-2">
            {saved.id ? <Button size="sm" variant="outline" icon={Repeat} onClick={() => { setRepeat({ id: saved.id!, reason: "" }); setSaved(null); }}>Repetir medición</Button> : null}
            {saved.id ? <Link href={`/historial/${saved.id}`} className="text-center text-xs text-primary hover:underline">Ver registro</Link> : null}
            {saved.result === "fail" && !saved.ncCode && saved.id && canCreateNc ? <Link href={`/no-conformidades/nueva?measurement=${saved.id}`} className="text-center text-xs font-medium text-bad hover:underline">Crear no conformidad</Link> : null}
          </div>
        </div>
      ) : null}

      {lookupError && !target ? <Alert tone="bad" icon={AlertTriangle}>{lookupError}</Alert> : null}

      {!target && !lookupError && !loading ? (
        <Card className="p-10 text-center">
          <p className="text-base font-medium">Listo para escanear</p>
          <p className="mt-1 text-sm text-muted">Escanee la etiqueta del activo con el lector, use la cámara o escriba el ID. El formulario aparecerá aquí.</p>
        </Card>
      ) : null}

      {target ? (
        <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          {/* Ficha */}
          <Card className="h-fit">
            <div className="border-b border-line p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-lg font-semibold">{target.code}</p>
                  <p className="text-sm text-muted">{target.name}</p>
                </div>
                <ResultBadge result={target.lastResult} />
              </div>
              {fromCache ? <Badge tone="warn" className="mt-2" icon={WifiOff}>Datos sin conexión</Badge> : null}
              {target.archived ? <Alert tone="bad">Elemento archivado: no admite mediciones.</Alert> : null}
              {target.status === "blocked" ? <div className="mt-2"><Badge tone="bad">Activo bloqueado</Badge></div> : null}
              {target.status === "retired" ? <div className="mt-2"><Badge tone="neutral">Retirado: no admite mediciones</Badge></div> : null}
            </div>
            <dl className="space-y-3 p-4 text-sm">
              <div className="flex gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /><div><dt className="sr-only">Ubicación</dt><dd>{target.location ?? "Sin ubicación"}{target.planTitle ? ` · Plano: ${target.planTitle}` : ""}</dd></div></div>
              <div className="flex gap-2"><ClipboardList className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /><div><dt className="sr-only">Categoría</dt><dd>{target.categoryName ?? "—"} · {target.periodText}</dd></div></div>
              <div className="rounded-md bg-surface-2 p-3">
                <dt className="text-xs font-semibold text-muted">Criterio de aceptación</dt>
                {target.criterion ? (
                  <dd className="mt-1">
                    <p className="font-medium">{target.criterion.code} · v{target.criterion.version}</p>
                    <p className="text-muted">{target.criterion.description}</p>
                    {target.procedure ? <p className="mt-1 text-xs text-muted">Procedimiento {target.procedure.code} rev. {target.procedure.revision}</p> : null}
                  </dd>
                ) : (
                  <dd className="mt-1 text-warn">Sin criterio vigente: el resultado quedará «Requiere revisión».</dd>
                )}
              </div>
              {target.instructions ? <div className="flex gap-2"><Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden /><div><dt className="text-xs font-semibold text-muted">Instrucciones</dt><dd>{target.instructions}</dd></div></div> : null}
              {target.precautions ? <div className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden /><div><dt className="text-xs font-semibold text-muted">Precauciones</dt><dd>{target.precautions}</dd></div></div> : null}
              <div className="flex gap-2"><Gauge className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /><div><dt className="text-xs font-semibold text-muted">Instrumento</dt><dd>{target.instrumentRequired ? `Requerido${target.instrumentTypes.length ? `: ${target.instrumentTypes.join(", ")}` : ""}` : "No requerido por el procedimiento"}</dd></div></div>
              <div className="flex gap-2"><History className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /><div className="min-w-0 flex-1"><dt className="text-xs font-semibold text-muted">Últimas mediciones</dt>
                <dd>
                  {target.lastMeasurements.length === 0 ? <span className="text-muted">Ninguna</span> : (
                    <ul className="mt-1 space-y-1">
                      {target.lastMeasurements.slice(0, 3).map((m) => (
                        <li key={m.id} className={cn("flex items-center gap-2", m.status === "invalidated" && "line-through opacity-60")}>
                          <ResultBadge result={m.result} /><span className="truncate font-mono text-xs">{m.values ?? ""}</span><span className="ml-auto shrink-0 text-xs text-muted">{fmtRelative(m.recorded_at)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {target.nextDueAt ? <p className="mt-1 text-xs text-muted">Próxima prevista: {fmtDate(target.nextDueAt)}</p> : null}
                </dd></div></div>
            </dl>
          </Card>

          {/* Formulario */}
          <Card className="p-5">
            <fieldset disabled={disabled || saving} className="space-y-5">
              <legend className="sr-only">Registro de medición</legend>
              {repeat ? (
                <Alert tone="warn" icon={Repeat} title="Repetición de medición">
                  Se conservará el intento anterior. Motivo de la repetición:
                  <Textarea className="mt-2" rows={2} value={repeat.reason} onChange={(e) => setRepeat({ ...repeat, reason: e.target.value })} aria-label="Motivo de la repetición" />
                </Alert>
              ) : null}
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Tipo de registro">
                {([["measure", "Medición"], ["not_measurable", "No medible"], ["not_applicable", "No aplica"]] as const).map(([k, l]) => (
                  <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={cn("rounded-full border px-3.5 py-1.5 text-sm font-medium", mode === k ? "border-primary bg-primary text-primary-fg" : "border-line text-muted hover:bg-surface-2")}>{l}</button>
                ))}
              </div>

              {mode === "measure" ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="instrument" className="mb-1.5 block text-sm font-medium">Instrumento{target.instrumentRequired ? <span className="text-bad"> *</span> : null}</label>
                      <Select id="instrument" value={instrumentId} disabled={notRequired} onChange={(e) => { setInstrumentId(e.target.value); try { localStorage.setItem(INSTR_KEY, e.target.value); } catch {} }}>
                        <option value="">Seleccione…</option>
                        {instruments.filter((i) => !target.instrumentTypes.length || target.instrumentTypes.includes(i.type)).map((i) => (
                          <option key={i.id} value={i.id}>{i.label}{i.valid ? "" : " — ⚠ calibración no válida"}</option>
                        ))}
                      </Select>
                      {selectedInstrument && !selectedInstrument.valid ? <p className="mt-1 text-xs text-warn">Calibración no válida (vence {fmtDate(selectedInstrument.due)}). Política: {settings.instrumentPolicy === "block" ? "se impedirá guardar" : settings.instrumentPolicy === "review" ? "el resultado quedará en revisión" : "solo aviso"}.</p> : null}
                      {!target.instrumentRequired ? <Checkbox className="mt-2" label="Sin instrumento (el procedimiento lo admite)" checked={notRequired} onChange={(e) => setNotRequired(e.target.checked)} /> : null}
                    </div>
                    <div>
                      <label htmlFor="campaign" className="mb-1.5 block text-sm font-medium">Campaña</label>
                      <Select id="campaign" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                        <option value="">Fuera de campaña</option>
                        {target.campaigns.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}{c.itemStatus !== "pending" ? " (ya registrado)" : ""}</option>)}
                      </Select>
                      {target.campaigns.length === 0 ? <p className="mt-1 text-xs text-muted">No pertenece a ninguna campaña en curso.</p> : null}
                    </div>
                  </div>

                  {kind === "numeric" ? (
                    <NumericInput id="value" autoFocus rule={rules?.kind === "numeric" ? rules : null} value={form.numeric.value} unit={form.numeric.unit} onChange={(v) => setForm({ ...form, numeric: v })} onEnter={save} />
                  ) : kind === "select" && rules?.kind === "select" ? (
                    <SelectInput rule={rules} value={form.option} onChange={(o) => setForm({ ...form, option: o })} />
                  ) : kind === "checklist" && rules?.kind === "checklist" ? (
                    <ChecklistInput rule={rules} value={form.checklist} onChange={(c) => setForm({ ...form, checklist: c })} />
                  ) : kind === "multipoint" && rules?.kind === "multipoint" ? (
                    target.expectedPoints.length ? (
                      <MultipointInput rule={rules.point as NumericRule} points={target.expectedPoints} value={form.points} onChange={(p) => setForm({ ...form, points: p })} results={pointResults} />
                    ) : <Alert tone="warn">La categoría no tiene plantilla de puntos: defínala en Inventario › Categorías.</Alert>
                  ) : kind === "combined" && rules?.kind === "combined" ? (
                    <CombinedInput rules={rules} value={form.parts} onChange={(p) => setForm({ ...form, parts: p })} />
                  ) : (
                    <NumericInput id="value" autoFocus rule={null} value={form.numeric.value} unit={form.numeric.unit} onChange={(v) => setForm({ ...form, numeric: v })} />
                  )}
                </>
              ) : (
                <ReasonPicker reasons={settings.notMeasurableReasons} reason={reason.r} detail={reason.d} onChange={(r, d) => setReason({ r, d })} />
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="comment" className="mb-1.5 block text-sm font-medium">Comentario{target.requiredFields.includes("comment") ? <span className="text-bad"> *</span> : null}</label>
                  <Textarea id="comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
                </div>
                <div>
                  <label htmlFor="photo" className="mb-1.5 block text-sm font-medium">Foto {target.requiredFields.includes("photo") ? <span className="text-bad">*</span> : <span className="text-faint">(opcional)</span>}</label>
                  <label className="flex h-[66px] cursor-pointer items-center gap-2 rounded-md border border-dashed border-line-strong px-3 text-sm text-muted hover:bg-surface-2">
                    <Camera className="size-4" aria-hidden />
                    <span className="truncate">{photo ? photo.name : "Hacer foto o elegir imagen (JPG/PNG)"}</span>
                    <input id="photo" type="file" accept="image/jpeg,image/png" capture="environment" className="sr-only" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
                  </label>
                </div>
              </div>

              {/* Resultado previsto */}
              {preview && hasAnyValue ? (
                <div className={cn("rounded-lg border p-3", preview.result === "pass" ? "border-ok/40 bg-ok-soft/50" : preview.result === "fail" ? "border-bad/40 bg-bad-soft/50" : "border-warn/40 bg-warn-soft/50")} aria-live="polite">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted">Resultado previsto</span>
                    <ResultBadge result={preview.result} />
                    <span className="text-xs text-muted">(lo confirma el servidor al guardar)</span>
                  </div>
                  <ul className="mt-1.5 list-disc pl-5 text-sm">{preview.reasons.slice(0, 5).map((r, i) => <li key={i}>{r}</li>)}</ul>
                  {preview.blockedReason ? <p className="mt-1 text-sm font-medium text-bad">{preview.blockedReason}</p> : null}
                </div>
              ) : null}

              {preview?.result === "fail" && canCreateNc && settings.autoCreateNc === "ask" ? <Checkbox label="Crear no conformidad automáticamente al guardar" checked={createNc} onChange={(e) => setCreateNc(e.target.checked)} /> : null}
              {preview?.result === "fail" && settings.autoCreateNc === "always" ? <p className="text-xs text-muted">Se creará una no conformidad automáticamente (configuración de la organización).</p> : null}
              {settings.requireSignature ? <Checkbox label="Confirmo que he realizado la medición según el procedimiento indicado" checked={signature} onChange={(e) => setSignature(e.target.checked)} /> : null}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
                <Button variant="ghost" icon={RotateCcw} onClick={() => { resetForm(); if (draftKey) localStorage.removeItem(draftKey); }}>Limpiar</Button>
                <Button size="lg" icon={Save} loading={saving} onClick={save} disabled={disabled} className="min-w-48">Guardar medición</Button>
              </div>
            </fieldset>
          </Card>
        </div>
      ) : null}
      <OutboxPanel orgId={orgId} defaultOpen={sp.get("cola") === "1"} />
    </div>
  );
}
