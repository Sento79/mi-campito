import { requirePermission } from "@/lib/server/auth";
import { PageHeader } from "@/components/ui/core";
import { ImportWizard } from "./import-wizard";
import { IMPORT_COLUMNS } from "@/lib/domain/asset-import";

export const metadata = { title: "Importar activos" };

export default async function ImportPage() {
  await requirePermission("create");
  return (
    <>
      <PageHeader title="Importar activos" description="CSV (separado por ; , o tabulador, UTF-8) o XLSX. Se valida todo antes de importar y la importación es atómica: o entran todas las filas o ninguna." />
      <ImportWizard columns={IMPORT_COLUMNS.map((c) => ({ label: c.label, required: c.required, help: c.help }))} />
    </>
  );
}
