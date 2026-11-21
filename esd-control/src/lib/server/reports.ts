import "server-only";
import type { Tx } from "./db";
import type { SessionInfo } from "./auth";
import { createReport, heading, kpiRow, paragraph, resultColor, signatureBlock, table, COLORS } from "./pdf";
import { reportMeta } from "./report-context";
import { measurementWhere } from "./queries/measurements";
import { campaignSummary } from "./services/campaigns";
import { RESULT_LABEL, type Result } from "@/lib/domain/results";
import { describeRules, parseRules } from "@/lib/domain/criteria";
import { CAMPAIGN_STATUS_LABEL, INSTRUMENT_STATUS_LABEL, fmtDate, fmtDateTime } from "@/lib/format";
import { NC_STATUS_LABEL, type NcStatus } from "./services/nonconformities";
import { ASSET_STATUS_LABEL, type AssetStatus } from "@/lib/domain/asset-import";

export type SP = Record<string, string | undefined>;
const R = (r: string | null | undefined) => (r ? RESULT_LABEL[r as Result] ?? r : "Sin medir");
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10} %` : "—");

async function filterLabels(tx: Tx, sp: SP): Promise<[string, string][]> {
  const out: [string, string][] = [];
  if (sp.from || sp.to) out.push(["Periodo", `${sp.from ? fmtDate(sp.from) : "inicio"} – ${sp.to ? fmtDate(sp.to) : "hoy"}`]);
  if (sp.location) out.push(["Ubicación", (await tx`select app_location_path(${sp.location}) as p`)[0]?.p ?? "—"]);
  if (sp.category) out.push(["Categoría", (await tx`select name from categories where id = ${sp.category}`)[0]?.name ?? "—"]);
  if (sp.campaign) out.push(["Campaña", (await tx`select code || ' · ' || name as n from campaigns where id = ${sp.campaign}`)[0]?.n ?? "—"]);
  if (sp.result) out.push(["Resultado", R(sp.result)]);
  return out;
}

/** Criterios (versiones) usados por las mediciones del informe. */
async function criteriaSection(doc: PDFKit.PDFDocument, tx: Tx, versionIds: string[]) {
  if (!versionIds.length) return;
  const rows = await tx`select c.code, c.name, cv.version, cv.rules, cv.approved_at, p.code as proc, cv.procedure_revision, cv.norm_reference
    from criterion_versions cv join criteria c on c.id = cv.criterion_id left join procedures p on p.id = cv.procedure_id where cv.id = any(${versionIds}) order by c.code, cv.version`;
  heading(doc, "Criterios aplicados");
  table(doc, [{ header: "Criterio", width: 0.2 }, { header: "Versión", width: 0.08 }, { header: "Regla", width: 0.42 }, { header: "Procedimiento", width: 0.15 }, { header: "Aprobado", width: 0.15 }],
    rows.map((r) => { const ru = parseRules(r.rules); return [`${r.code} · ${r.name}`, `v${r.version}`, ru ? describeRules(ru) : "—", r.proc ? `${r.proc} rev. ${r.procedure_revision ?? "—"}` : r.norm_reference ?? "—", fmtDate(r.approved_at)]; }));
}

export async function buildReport(tx: Tx, s: SessionInfo, type: string, sp: SP, id?: string): Promise<{ pdf: Buffer; name: string } | null> {
  const filters = await filterLabels(tx, sp);
  switch (type) {
    case "summary": {
      const meta = await reportMeta(tx, s, "Informe resumen de control ESD", { filters });
      const { doc, done } = createReport(meta);
      const where = measurementWhere(tx, sp);
      const [m] = await tx`select count(*)::int as total, count(*) filter (where m.result='pass')::int as pass, count(*) filter (where m.result='fail')::int as fail, count(*) filter (where m.result not in ('pass','fail'))::int as other
        from measurements m left join assets a on a.id = m.asset_id left join plan_points pp on pp.id = m.plan_point_id where ${where}`;
      const assetScope = tx`a.archived_at is null and a.status <> 'retired' ${sp.location ? tx`and a.location_id in (select app_location_subtree(${sp.location}))` : tx``} ${sp.category ? tx`and a.category_id = ${sp.category}` : tx``}`;
      const [a] = await tx`select count(*)::int as total, count(*) filter (where a.next_due_at <= now())::int as overdue, count(*) filter (where a.last_measured_at is null)::int as never,
        count(*) filter (where a.last_result = 'pass' and a.next_due_at > now())::int as ok from assets a where ${assetScope}`;
      kpiRow(doc, [["Activos", String(a.total)], ["Mediciones", String(m.total)], ["Conformes", String(m.pass), COLORS.ok], ["No conformes", String(m.fail), m.fail ? COLORS.bad : undefined], ["Vencidos", String(a.overdue), a.overdue ? COLORS.bad : undefined], ["Cumplimiento", pct(a.ok, a.total)]]);
      paragraph(doc, "Cumplimiento = activos con último resultado conforme y medición al día / activos en servicio del ámbito.", { color: COLORS.muted, size: 7.5 });
      heading(doc, "Estado por categoría");
      const byCat = await tx`select c.name, count(*)::int as total, count(*) filter (where a.last_result='pass')::int as pass, count(*) filter (where a.last_result='fail')::int as fail,
        count(*) filter (where a.next_due_at <= now())::int as overdue, count(*) filter (where a.last_measured_at is null)::int as never
        from assets a join categories c on c.id = a.category_id where ${assetScope} group by c.name order by c.name`;
      table(doc, [{ header: "Categoría", width: 0.3 }, { header: "Activos", width: 0.12, align: "right" }, { header: "Conformes", width: 0.14, align: "right" }, { header: "No conformes", width: 0.14, align: "right" }, { header: "Vencidos", width: 0.14, align: "right" }, { header: "Sin medir", width: 0.16, align: "right" }],
        byCat.map((r) => [r.name, String(r.total), String(r.pass), String(r.fail), String(r.overdue), String(r.never)]));
      heading(doc, "Estado por ubicación");
      const byLoc = await tx`select coalesce(app_location_path(a.location_id), 'Sin ubicación') as loc, count(*)::int as total, count(*) filter (where a.last_result='fail')::int as fail, count(*) filter (where a.next_due_at <= now())::int as overdue
        from assets a where ${assetScope} group by 1 order by 1`;
      table(doc, [{ header: "Ubicación", width: 0.55 }, { header: "Activos", width: 0.15, align: "right" }, { header: "No conformes", width: 0.15, align: "right" }, { header: "Vencidos", width: 0.15, align: "right" }], byLoc.map((r) => [r.loc, String(r.total), String(r.fail), String(r.overdue)]));
      heading(doc, "Mediciones no conformes del periodo");
      const fails = await tx`select m.recorded_at, coalesce(a.code, pp.code) as code, coalesce(a.name, pp.name) as name, u.full_name, m.result_explanation
        from measurements m join users u on u.id = m.measured_by left join assets a on a.id = m.asset_id left join plan_points pp on pp.id = m.plan_point_id where ${where} and m.result = 'fail' order by m.recorded_at desc limit 200`;
      if (fails.length) table(doc, [{ header: "Fecha", width: 0.16 }, { header: "Elemento", width: 0.24 }, { header: "Motivo", width: 0.44 }, { header: "Técnico", width: 0.16 }], fails.map((f) => [fmtDateTime(f.recorded_at), `${f.code} · ${f.name}`, (f.result_explanation as string[]).join("; "), f.full_name]));
      else paragraph(doc, "Ninguna.", { color: COLORS.muted });
      const cv = await tx`select distinct m.criterion_version_id as id from measurements m left join assets a on a.id = m.asset_id left join plan_points pp on pp.id = m.plan_point_id where ${where} and m.criterion_version_id is not null`;
      await criteriaSection(doc, tx, cv.map((r) => r.id));
      signatureBlock(doc, ["Elaborado por", "Revisado por (Responsable ESD)"]);
      return { pdf: await done(), name: "resumen-esd" };
    }
    case "measurements": {
      const meta = await reportMeta(tx, s, "Informe de mediciones", { filters, landscape: true });
      const { doc, done } = createReport(meta);
      const where = measurementWhere(tx, sp);
      const rows = await tx`
        select m.id, m.recorded_at, m.result, m.status, coalesce(a.code, pp.code) as code, coalesce(a.name, pp.name) as name, u.full_name, i.code as instrument, c.code as crit, cv.version, m.comment, m.criterion_version_id,
          (select string_agg(coalesce(mv.point_code || ': ', '') || coalesce(mv.raw_input, mv.option_value, case when mv.checked then 'OK' when mv.checked = false then 'NO OK' end, '—') || coalesce(' ' || mv.raw_unit, '') || case when mv.point_code is not null then ' (' || case mv.result when 'pass' then 'C' when 'fail' then 'NC' else '?' end || ')' else '' end, '; ' order by mv.sort_order) from measurement_values mv where mv.measurement_id = m.id) as vals
        from measurements m join users u on u.id = m.measured_by left join assets a on a.id = m.asset_id left join plan_points pp on pp.id = m.plan_point_id
        left join instruments i on i.id = m.instrument_id left join criterion_versions cv on cv.id = m.criterion_version_id left join criteria c on c.id = cv.criterion_id
        where ${where} order by m.recorded_at desc limit 3000`;
      kpiRow(doc, [["Mediciones", String(rows.length)], ["Conformes", String(rows.filter((r) => r.result === "pass").length), COLORS.ok], ["No conformes", String(rows.filter((r) => r.result === "fail").length), COLORS.bad], ["Otras", String(rows.filter((r) => !["pass", "fail"].includes(r.result)).length)]]);
      table(doc, [{ header: "Fecha", width: 0.11 }, { header: "Elemento", width: 0.19 }, { header: "Resultado", width: 0.1, color: (r) => resultColor(r[2]) }, { header: "Valores (multipunto: C/NC por punto)", width: 0.26 }, { header: "Criterio", width: 0.09 }, { header: "Instrumento", width: 0.08 }, { header: "Técnico", width: 0.1 }, { header: "Observaciones", width: 0.07 }],
        rows.map((r) => [fmtDateTime(r.recorded_at), `${r.code} · ${r.name}`, r.status === "invalidated" ? "Invalidada" : R(r.result), r.vals ?? "", r.crit ? `${r.crit} v${r.version}` : "—", r.instrument ?? "—", r.full_name, r.comment ?? ""]), { fontSize: 7 });
      if (rows.length === 3000) paragraph(doc, "Se muestran las 3000 mediciones más recientes. Use la exportación XLSX para el conjunto completo.", { color: COLORS.warn });
      await criteriaSection(doc, tx, [...new Set(rows.map((r) => r.criterion_version_id).filter(Boolean))] as string[]);
      return { pdf: await done(), name: "mediciones" };
    }
    case "overdue": {
      const meta = await reportMeta(tx, s, "Informe de vencimientos y pendientes", { filters });
      const { doc, done } = createReport(meta);
      const rows = await tx`select a.code, a.name, c.name as cat, app_location_path(a.location_id) as loc, a.last_measured_at, a.next_due_at, a.last_result
        from assets a join categories c on c.id = a.category_id where a.archived_at is null and a.status <> 'retired' and coalesce(a.period_unit, c.period_unit) is not null
        and (a.next_due_at is null or a.next_due_at <= now() + make_interval(days => ${s.org.settings.dueLeadDays}))
        ${sp.location ? tx`and a.location_id in (select app_location_subtree(${sp.location}))` : tx``} ${sp.category ? tx`and a.category_id = ${sp.category}` : tx``}
        order by a.next_due_at nulls first, a.code`;
      const now = Date.now();
      kpiRow(doc, [["Vencidos", String(rows.filter((r) => r.next_due_at && new Date(r.next_due_at).getTime() <= now).length), COLORS.bad], ["Nunca medidos", String(rows.filter((r) => !r.last_measured_at).length)], [`Próximos (${s.org.settings.dueLeadDays} d)`, String(rows.filter((r) => r.next_due_at && new Date(r.next_due_at).getTime() > now).length), COLORS.warn]]);
      table(doc, [{ header: "ID", width: 0.12 }, { header: "Nombre", width: 0.22 }, { header: "Categoría", width: 0.14 }, { header: "Ubicación", width: 0.2 }, { header: "Última", width: 0.1 }, { header: "Prevista", width: 0.1 }, { header: "Último resultado", width: 0.12, color: (r) => resultColor(r[6]) }],
        rows.map((r) => [r.code, r.name, r.cat, r.loc ?? "", fmtDate(r.last_measured_at), r.next_due_at ? fmtDate(r.next_due_at) : "Sin medir", R(r.last_result)]));
      return { pdf: await done(), name: "vencimientos" };
    }
    case "instruments": {
      const meta = await reportMeta(tx, s, "Informe de instrumentos y calibración", { filters: [] });
      const { doc, done } = createReport(meta);
      const rows = await tx`select i.*, (select count(*)::int from measurements m where m.instrument_id = i.id) as uses,
        (select c.certificate_number || ' (' || coalesce(c.provider,'') || ')' from calibrations c where c.id = i.current_calibration_id) as cert from instruments i where i.archived_at is null order by i.code`;
      const today = new Date().toISOString().slice(0, 10);
      kpiRow(doc, [["Instrumentos", String(rows.length)], ["Calibración vigente", String(rows.filter((r) => r.calibration_due_on && r.calibration_due_on >= today).length), COLORS.ok], ["Vencida / sin calibrar", String(rows.filter((r) => !r.calibration_due_on || r.calibration_due_on < today).length), COLORS.bad]]);
      table(doc, [{ header: "Código", width: 0.1 }, { header: "Tipo", width: 0.18 }, { header: "Modelo / S/N", width: 0.18 }, { header: "Estado", width: 0.12 }, { header: "Calibrado", width: 0.1 }, { header: "Vence", width: 0.1, color: (r) => (r[5] === "—" || r[8] === "1" ? COLORS.bad : undefined) }, { header: "Certificado", width: 0.14 }, { header: "Usos", width: 0.08, align: "right" }],
        rows.map((r) => [r.code, r.type, [r.model, r.serial_number].filter(Boolean).join(" · "), INSTRUMENT_STATUS_LABEL[r.status], fmtDate(r.last_calibrated_on), fmtDate(r.calibration_due_on), r.cert ?? "—", String(r.uses), !r.calibration_due_on || r.calibration_due_on < today ? "1" : "0"]));
      return { pdf: await done(), name: "instrumentos" };
    }
    case "nonconformities": {
      const meta = await reportMeta(tx, s, "Informe de no conformidades", { filters });
      const { doc, done } = createReport(meta);
      const rows = await tx`select n.*, sv.name as severity, u.full_name as owner,
        (select string_agg(distinct coalesce(a.code, pp.code), ', ') from nc_links l left join assets a on a.id = l.asset_id left join plan_points pp on pp.id = l.plan_point_id where l.nc_id = n.id) as targets
        from nonconformities n left join nc_severities sv on sv.id = n.severity_id left join users u on u.id = n.owner_user_id
        where true ${sp.from ? tx`and n.detected_at >= ${sp.from}` : tx``} ${sp.to ? tx`and n.detected_at < (${sp.to}::date + 1)` : tx``} order by n.code`;
      kpiRow(doc, [["Total", String(rows.length)], ["Abiertas", String(rows.filter((r) => r.status !== "closed").length), COLORS.warn], ["Cerradas", String(rows.filter((r) => r.status === "closed").length), COLORS.ok], ["Fuera de plazo", String(rows.filter((r) => r.status !== "closed" && r.due_on && r.due_on < new Date().toISOString().slice(0, 10)).length), COLORS.bad]]);
      for (const n of rows) {
        heading(doc, `${n.code} · ${n.title}`);
        paragraph(doc, `Estado: ${NC_STATUS_LABEL[n.status as NcStatus]} · Gravedad: ${n.severity ?? "—"} · Responsable: ${n.owner ?? "—"} · Detectada: ${fmtDate(n.detected_at)} · Límite: ${fmtDate(n.due_on)} · Elementos: ${n.targets ?? "—"}`, { size: 8, color: COLORS.muted });
        for (const [k, v] of [["Descripción", n.description], ["Contención", n.containment], ["Causa", n.root_cause], ["Acción correctiva", n.corrective_action], ["Acción preventiva", n.preventive_action], ["Verificación", n.verification_notes ? `${n.verification_notes} (${fmtDate(n.verified_at)})` : null]] as const) {
          if (v) paragraph(doc, `${k}: ${v}`, { size: 8.5 });
        }
      }
      return { pdf: await done(), name: "no-conformidades" };
    }
    case "campaign": {
      const [c] = await tx`select c.*, app_location_path(c.location_id) as location, u.full_name as owner from campaigns c left join users u on u.id = c.owner_user_id where c.id = ${id!}`;
      if (!c) return null;
      const meta = await reportMeta(tx, s, `Informe de campaña ${c.code}`, { subtitle: c.name, filters: [["Estado", CAMPAIGN_STATUS_LABEL[c.status]], ["Periodo", `${fmtDate(c.starts_on)} – ${fmtDate(c.ends_on)}`], ["Ámbito", c.location ?? "—"], ["Responsable", c.owner ?? "—"]] });
      const { doc, done } = createReport(meta);
      const sum = await campaignSummary(tx, c.id);
      kpiRow(doc, [["Total", String(sum.total)], ["Realizados", String(sum.done)], ["Pendientes", String(sum.pending), sum.pending ? COLORS.warn : undefined], ["Conformes", String(sum.pass), COLORS.ok], ["No conformes", String(sum.fail), sum.fail ? COLORS.bad : undefined], ["NC abiertas", String(sum.openNcs)]]);
      if (c.close_notes) paragraph(doc, c.close_notes, { size: 8.5 });
      const items = await tx`select ci.status, ci.result, ci.measured_at, ci.skip_reason, coalesce(a.code, pp.code) as code, coalesce(a.name, pp.name) as name, u.full_name, cr.code as crit, cv.version, i.code as instrument,
          (select string_agg(coalesce(mv.point_code || ': ', '') || coalesce(mv.raw_input, mv.option_value, case when mv.checked then 'OK' when mv.checked = false then 'NO OK' end, '—') || coalesce(' ' || mv.raw_unit, ''), '; ' order by mv.sort_order) from measurement_values mv where mv.measurement_id = ci.last_measurement_id) as vals, m.criterion_version_id
        from campaign_items ci left join assets a on a.id = ci.asset_id left join plan_points pp on pp.id = ci.plan_point_id
        left join measurements m on m.id = ci.last_measurement_id left join users u on u.id = m.measured_by left join instruments i on i.id = m.instrument_id
        left join criterion_versions cv on cv.id = m.criterion_version_id left join criteria cr on cr.id = cv.criterion_id
        where ci.campaign_id = ${c.id} order by coalesce(pp.route_order, ci.sort_order), ci.sort_order`;
      heading(doc, "Elementos");
      table(doc, [{ header: "Elemento", width: 0.22 }, { header: "Estado", width: 0.1 }, { header: "Resultado", width: 0.12, color: (r) => resultColor(r[2]) }, { header: "Valores", width: 0.2 }, { header: "Fecha", width: 0.12 }, { header: "Criterio / instr.", width: 0.12 }, { header: "Técnico", width: 0.12 }],
        items.map((r) => [`${r.code} · ${r.name}`, r.status === "pending" ? "No realizado" : r.status === "skipped" ? `Omitido: ${r.skip_reason ?? ""}` : "Realizado", r.result ? R(r.result) : "—", r.vals ?? "", fmtDateTime(r.measured_at), [r.crit ? `${r.crit} v${r.version}` : null, r.instrument].filter(Boolean).join(" · "), r.full_name ?? ""]));
      await criteriaSection(doc, tx, [...new Set(items.map((r) => r.criterion_version_id).filter(Boolean))] as string[]);
      signatureBlock(doc, ["Responsable de la campaña", "Responsable ESD"]);
      return { pdf: await done(), name: `campana-${c.code}` };
    }
    case "asset": {
      const [a] = await tx`select a.*, c.name as cat, app_location_path(a.location_id) as loc from assets a join categories c on c.id = a.category_id where a.id = ${id!}`;
      if (!a) return null;
      const meta = await reportMeta(tx, s, `Ficha e historial de ${a.code}`, { subtitle: a.name, filters: [["Categoría", a.cat], ["Ubicación", a.loc ?? "—"], ["Estado", ASSET_STATUS_LABEL[a.status as AssetStatus]], ["Nº serie", a.serial_number ?? "—"]] });
      const { doc, done } = createReport(meta);
      const ms = await tx`select m.recorded_at, m.result, m.status, m.invalidation_reason, u.full_name, i.code as inst, cr.code as crit, cv.version, m.criterion_version_id,
        (select string_agg(coalesce(mv.point_code || ': ', '') || coalesce(mv.raw_input, mv.option_value, case when mv.checked then 'OK' when mv.checked = false then 'NO OK' end, '—') || coalesce(' ' || mv.raw_unit, ''), '; ' order by mv.sort_order) from measurement_values mv where mv.measurement_id = m.id) as vals
        from measurements m join users u on u.id = m.measured_by left join instruments i on i.id = m.instrument_id left join criterion_versions cv on cv.id = m.criterion_version_id left join criteria cr on cr.id = cv.criterion_id
        where m.asset_id = ${a.id} order by m.recorded_at desc`;
      table(doc, [{ header: "Fecha", width: 0.16 }, { header: "Resultado", width: 0.14, color: (r) => resultColor(r[1]) }, { header: "Valores", width: 0.28 }, { header: "Criterio", width: 0.12 }, { header: "Instrumento", width: 0.12 }, { header: "Técnico", width: 0.18 }],
        ms.map((m) => [fmtDateTime(m.recorded_at), m.status === "invalidated" ? `Invalidada: ${m.invalidation_reason}` : R(m.result), m.vals ?? "", m.crit ? `${m.crit} v${m.version}` : "—", m.inst ?? "—", m.full_name]));
      await criteriaSection(doc, tx, [...new Set(ms.map((r) => r.criterion_version_id).filter(Boolean))] as string[]);
      return { pdf: await done(), name: `activo-${a.code}` };
    }
  }
  return null;
}
