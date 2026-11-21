import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { Alert, Card, CardHeader, PageHeader } from "@/components/ui/core";
import { CategoryForm } from "./category-form";
import { TemplateEditor } from "./template-editor";
import { AuditTrail } from "@/components/audit-trail";

export default async function CategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePermission("read");
  const { id } = await params;
  const isNew = id === "nueva";
  if (!isNew && !/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await withCtx(s, async (tx) => {
    const [c] = isNew ? [null] : await tx`select * from categories where id = ${id}`;
    const procedures = await tx`select id, code || ' · ' || title || ' (rev. ' || revision || ')' as label from procedures where is_active order by code`;
    const criteria = await tx`select c.id, c.code || ' · ' || c.name || coalesce(' — v' || cv.version, ' — sin versión activa') as label from criteria c left join criterion_versions cv on cv.criterion_id = c.id and cv.status = 'active' where c.is_active order by c.code`;
    const templates = isNew ? [] : await tx`select t.id, t.name, coalesce(json_agg(json_build_object('code', i.code, 'name', i.name, 'instructions', i.instructions, 'required', i.required, 'criterionId', i.criterion_id) order by i.sort_order) filter (where i.id is not null), '[]') as items from point_templates t left join point_template_items i on i.template_id = t.id where t.category_id = ${id} group by t.id order by t.created_at`;
    const auditRows = !isNew && s.permissions.has("audit.read") ? await tx`select l.id::text, l.at, l.action, l.summary, l.reason, l.before_data, l.after_data, u.full_name as user_name from audit_log l left join users u on u.id = l.user_id where l.entity_type = 'category' and l.entity_id = ${id} order by l.at desc limit 20` : [];
    return { c, procedures, criteria, templates, auditRows };
  });
  if (!isNew && !d.c) notFound();
  const c = d.c;
  const manage = s.permissions.has("criteria.manage");
  const opt = (rows: readonly Record<string, unknown>[]) => rows.map((r) => ({ id: r.id as string, label: r.label as string }));
  return (
    <>
      <PageHeader title={isNew ? "Nueva categoría" : `${c!.code} · ${c!.name}`} description="Los límites de aceptación se definen en el criterio vinculado (Administración › Criterios), versionado y aprobado por personal autorizado." />
      {!manage ? <div className="mb-4"><Alert tone="info">Vista de solo lectura: se requiere el permiso «Gestión de criterios» para modificar categorías.</Alert></div> : null}
      <CategoryForm
        id={isNew ? null : id}
        readOnly={!manage}
        procedures={opt(d.procedures)}
        criteria={opt(d.criteria)}
        defaults={c ? {
          code: c.code, name: c.name, description: c.description ?? "", inspectionType: c.inspection_type ?? "", quantity: c.quantity ?? "", unit: c.unit ?? "",
          recordMethod: c.record_method, procedureId: c.procedure_id ?? "", criterionId: c.criterion_id ?? "", periodUnit: c.period_unit ?? "", periodCount: c.period_count ? String(c.period_count) : "",
          instrumentRequired: c.instrument_required, instrumentTypes: (c.instrument_types ?? []).join(", "), requiredFields: c.required_fields ?? [], instructions: c.instructions ?? "", precautions: c.precautions ?? "", isActive: c.is_active,
        } : undefined}
      />
      {!isNew && c!.record_method === "multipoint" ? (
        <Card className="mt-4">
          <CardHeader title="Plantilla de puntos" description="Puntos que el técnico debe medir. La evaluación global la define el criterio multipunto." />
          <div className="p-5">
            <TemplateEditor categoryId={id} readOnly={!manage} template={(d.templates[0] as never) ?? null} criteria={opt(d.criteria)} />
          </div>
        </Card>
      ) : null}
      {d.auditRows.length ? (
        <Card className="mt-4">
          <CardHeader title="Historial de cambios" />
          <AuditTrail rows={d.auditRows as never} />
        </Card>
      ) : null}
    </>
  );
}
