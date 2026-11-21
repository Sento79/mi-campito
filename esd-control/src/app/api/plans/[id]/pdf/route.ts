import { NextResponse } from "next/server";
import type { Row as DbRow } from "postgres";
import { z } from "zod";
import { api } from "@/lib/server/api";
import { withCtx } from "@/lib/server/db";
import { storage } from "@/lib/server/storage";
import { audit } from "@/lib/server/audit";
import { createReport, heading, table, COLORS, resultColor } from "@/lib/server/pdf";
import { reportMeta } from "@/lib/server/report-context";
import { RESULT_LABEL, type Result } from "@/lib/domain/results";
import { fmtDateTime } from "@/lib/format";

const STATUS_HEX: Record<string, string> = { pass: COLORS.ok, fail: COLORS.bad, warn: COLORS.warn, pending: COLORS.neutral, reference: COLORS.muted };

/** Informe de plano: imagen de la página con marcadores vectoriales, leyenda y tabla de puntos. */
export const GET = api({ permission: "reports" }, async (req, s, params) => {
  const id = z.string().uuid().parse(params.id);
  const url = new URL(req.url);
  const pageNo = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const campaignId = z.string().uuid().optional().catch(undefined).parse(url.searchParams.get("campaign") ?? undefined);
  const since = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("since") ?? "") ? url.searchParams.get("since")! : null;
  const out = await withCtx(s, async (tx) => {
    const [plan] = await tx`select p.title, app_location_path(p.location_id) as location, v.version, v.label, pg.width_px, pg.height_px, d.storage_key
      from floor_plans p join floor_plan_versions v on v.id = p.current_version_id
      join floor_plan_pages pg on pg.version_id = v.id and pg.page_number = ${pageNo} join documents d on d.id = pg.image_document_id where p.id = ${id}`;
    if (!plan) return null;
    const [campaign] = campaignId ? await tx`select code, name from campaigns where id = ${campaignId}` : [null];
    const points = await tx`
      select pp.code, pp.name, pp.x::float8 as x, pp.y::float8 as y, pp.point_type, pp.route_order, c.name as category,
             ${campaignId ? tx`ci.status as item_status, ci.result as item_result, ci.measured_at as item_at` : tx`null as item_status, null as item_result, null as item_at`},
             pp.last_result, pp.last_measured_at,
             (select coalesce(mv.raw_input || ' ' || coalesce(mv.raw_unit,''), '') from measurements m join measurement_values mv on mv.measurement_id = m.id where m.id = ${campaignId ? tx`ci.last_measurement_id` : tx`pp.last_measurement_id`} limit 1) as value,
             (select u.full_name from measurements m join users u on u.id = m.measured_by where m.id = ${campaignId ? tx`ci.last_measurement_id` : tx`pp.last_measurement_id`}) as technician,
             (select cr.code || ' v' || cv.version from measurements m join criterion_versions cv on cv.id = m.criterion_version_id join criteria cr on cr.id = cv.criterion_id where m.id = ${campaignId ? tx`ci.last_measurement_id` : tx`pp.last_measurement_id`}) as criterion
        from plan_points pp left join categories c on c.id = pp.category_id
        ${campaignId ? tx`join campaign_items ci on ci.plan_point_id = pp.id and ci.campaign_id = ${campaignId}` : tx``}
       where pp.plan_id = ${id} and pp.page_number = ${pageNo} and pp.archived_at is null order by coalesce(pp.route_order, 100000), pp.code`;
    const image = await storage().get(plan.storage_key);
    const meta = await reportMeta(tx, s, `Informe de plano: ${plan.title}`, {
      subtitle: plan.location || undefined,
      landscape: plan.width_px >= plan.height_px,
      filters: [["Versión", `v${plan.version}${plan.label ? ` (${plan.label})` : ""} · página ${pageNo}`], ["Vista", campaign ? `Campaña ${campaign.code} · ${campaign.name}` : since ? `Pendiente si no se midió desde ${since}` : "Último resultado de cada punto"]],
    });
    await audit(tx, s, { action: "report", entityType: "floor_plan", entityId: id, summary: `Informe PDF del plano ${plan.title}` });
    return { plan, points, image, meta, campaign };
  });
  if (!out) return NextResponse.json({ error: "Plano no encontrado" }, { status: 404 });
  const { doc, done } = createReport(out.meta);
  const statusOf = (p: DbRow) => {
    if (p.point_type === "reference") return "reference";
    let r = p.last_result;
    if (out.campaign) {
      if (p.item_status !== "done") return "pending";
      r = p.item_result;
    } else if (since && (!p.last_measured_at || new Date(p.last_measured_at).toISOString().slice(0, 10) < since)) return "pending";
    return r === "pass" ? "pass" : r === "fail" ? "fail" : r === "review" || r === "incomplete" ? "warn" : "pending";
  };
  // Imagen escalada al ancho útil
  const left = doc.page.margins.left;
  const maxW = doc.page.width - left - doc.page.margins.right;
  const maxH = doc.page.height - doc.y - doc.page.margins.bottom - 40;
  const k = Math.min(maxW / out.plan.width_px, maxH / out.plan.height_px);
  const W = out.plan.width_px * k, H = out.plan.height_px * k;
  const x0 = left + (maxW - W) / 2, y0 = doc.y;
  doc.image(out.image, x0, y0, { width: W, height: H });
  doc.rect(x0, y0, W, H).lineWidth(0.5).strokeColor(COLORS.line).stroke();
  const r = Math.max(3.5, Math.min(7, W / 120));
  for (const p of out.points) {
    const cx = x0 + p.x * W, cy = y0 + p.y * H;
    doc.circle(cx, cy, r).fillColor(STATUS_HEX[statusOf(p)]).fill();
    doc.circle(cx, cy, r).lineWidth(1).strokeColor("#ffffff").stroke();
    doc.font("B").fontSize(Math.max(5, r * 0.95)).fillColor(COLORS.text).text(p.code, cx + r + 1.5, cy - r * 0.6, { lineBreak: false });
  }
  doc.y = y0 + H + 8;
  // Leyenda (texto + color: nunca solo color)
  const counts: Record<string, number> = {};
  for (const p of out.points) counts[statusOf(p)] = (counts[statusOf(p)] ?? 0) + 1;
  let lx = left;
  const ly = doc.y;
  for (const [k2, l] of [["pass", "Conforme"], ["fail", "No conforme"], ["warn", "Revisión / incompleto"], ["pending", "Sin medir / pendiente"]] as const) {
    doc.circle(lx + 4, ly + 5, 4).fillColor(STATUS_HEX[k2]).fill();
    const t = `${l} (${counts[k2] ?? 0})`;
    doc.font("R").fontSize(8).fillColor(COLORS.text).text(t, lx + 11, ly + 1, { lineBreak: false });
    lx += 24 + doc.widthOfString(t);
  }
  doc.y = ly + 18;
  doc.addPage({ layout: "portrait" });
  heading(doc, `Puntos (${out.points.length})`);
  table(doc, [
    { header: "Ruta", width: 0.06, align: "center" },
    { header: "Punto", width: 0.1 },
    { header: "Nombre", width: 0.2 },
    { header: "Categoría", width: 0.13 },
    { header: "Resultado", width: 0.13, color: (row) => resultColor(row[4]) },
    { header: "Valor", width: 0.12 },
    { header: "Fecha", width: 0.12 },
    { header: "Criterio / técnico", width: 0.14 },
  ], out.points.map((p) => {
    const st = statusOf(p);
    const res = out.campaign ? p.item_result : p.last_result;
    return [p.route_order ? String(p.route_order) : "", p.code, p.name, p.category ?? "", st === "pending" ? "Pendiente" : res ? RESULT_LABEL[res as Result] : "Sin medir", p.value ?? "", fmtDateTime(out.campaign ? p.item_at : p.last_measured_at), [p.criterion, p.technician].filter(Boolean).join(" · ")];
  }));
  const pdf = await done();
  return new NextResponse(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="plano-${out.plan.title.replace(/[^\w-]+/g, "_")}.pdf"` } });
});
