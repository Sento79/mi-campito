import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { Card, PageHeader } from "@/components/ui/core";
import { ProceduresTable } from "./procedures-table";

export const metadata = { title: "Procedimientos" };

export default async function Procedures() {
  const s = await requirePermission("read");
  const rows = await withCtx(s, (tx) => tx`select p.*, (select count(*)::int from criterion_versions cv where cv.procedure_id = p.id) as uses from procedures p order by p.code`);
  return (
    <>
      <PageHeader title="Procedimientos de medición" description="Documentos y revisiones a los que se vinculan las categorías y versiones de criterio. Los cambios de revisión quedan auditados." />
      <Card><ProceduresTable rows={rows.map((r) => ({ id: r.id, code: r.code, title: r.title, revision: r.revision, normReference: r.norm_reference ?? "", description: r.description ?? "", isActive: r.is_active, documentId: r.document_id, uses: r.uses }))} manage={s.permissions.has("criteria.manage")} /></Card>
    </>
  );
}
