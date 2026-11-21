"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Download, CheckCircle2, AlertTriangle } from "lucide-react";
import { Alert, Badge, Button, ButtonLink, Card, CardHeader, Table, Td, Th } from "@/components/ui/core";
import { useAction } from "@/components/ui/client";
import { commitImportAction, previewImportAction } from "../actions";

interface Preview {
  valid: { row: number; code: string; name: string; category_code: string; location_code?: string; status: string }[];
  validCount: number;
  issues: { row: number; field?: string; message: string }[];
  total: number;
}

export function ImportWizard({ columns }: { columns: { label: string; required: boolean; help: string }[] }) {
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const fileGen = React.useRef(0);
  const prev = useAction(previewImportAction);
  const commit = useAction(commitImportAction);
  const router = useRouter();
  const fd = () => {
    const f = new FormData();
    f.set("file", file!);
    return f;
  };
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="1. Prepare el archivo" actions={<><ButtonLink href="/api/import/template?format=xlsx" variant="outline" size="sm" icon={Download} prefetch={false}>Plantilla XLSX</ButtonLink><ButtonLink href="/api/import/template?format=csv" variant="outline" size="sm" icon={Download} prefetch={false}>Plantilla CSV</ButtonLink></>} />
        <div className="p-5">
          <p className="mb-3 text-sm text-muted">La primera fila debe contener las cabeceras. Columnas reconocidas:</p>
          <div className="flex flex-wrap gap-2">
            {columns.map((c) => (
              <Badge key={c.label} tone={c.required ? "primary" : "neutral"} title={c.help}>{c.label}{c.required ? " *" : ""}</Badge>
            ))}
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="2. Suba y valide" />
        <div className="flex flex-wrap items-center gap-3 p-5">
          <input
            type="file"
            accept=".csv,.xlsx,.txt"
            aria-label="Archivo de importación"
            onChange={(e) => {
              fileGen.current++;
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
            }}
            className="text-sm file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-surface file:px-3 file:py-2 file:text-sm"
          />
          <Button
            icon={FileSpreadsheet}
            disabled={!file}
            loading={prev.pending}
            onClick={async () => {
              const gen = fileGen.current;
              const r = await prev.run(fd());
              if (r?.ok && gen === fileGen.current) setPreview(r.data as Preview);
            }}
          >
            Previsualizar
          </Button>
        </div>
      </Card>
      {preview ? (
        <Card>
          <CardHeader
            title="3. Revise y confirme"
            description={`${preview.total} filas leídas · ${preview.validCount} válidas · ${preview.issues.length} errores`}
            actions={
              <Button
                disabled={preview.issues.length > 0 || preview.validCount === 0}
                loading={commit.pending}
                onClick={async () => {
                  if (!confirm(`¿Importar ${preview.validCount} activos? La operación quedará registrada en auditoría.`)) return;
                  const r = await commit.run(fd(), { success: "Importación completada" });
                  if (r?.ok) {
                    router.push("/inventario");
                    router.refresh();
                  }
                }}
              >
                Importar {preview.validCount} activos
              </Button>
            }
          />
          <div className="space-y-4 p-5">
            {preview.issues.length ? (
              <Alert tone="bad" icon={AlertTriangle} title="Corrija los errores y vuelva a subir el archivo">
                No se importará nada mientras haya errores.
              </Alert>
            ) : (
              <Alert tone="ok" icon={CheckCircle2} title="Archivo válido">Todas las filas pueden importarse.</Alert>
            )}
            {preview.issues.length ? (
              <Table>
                <thead><tr><Th>Fila</Th><Th>Columna</Th><Th>Error</Th></tr></thead>
                <tbody>
                  {preview.issues.slice(0, 300).map((i, k) => (
                    <tr key={k}><Td className="tabular">{i.row}</Td><Td className="font-mono text-xs">{i.field ?? "—"}</Td><Td className="text-bad">{i.message}</Td></tr>
                  ))}
                </tbody>
              </Table>
            ) : null}
            {preview.valid.length ? (
              <Table>
                <thead><tr><Th>Fila</Th><Th>ID</Th><Th>Nombre</Th><Th>Categoría</Th><Th>Ubicación</Th><Th>Estado</Th></tr></thead>
                <tbody>
                  {preview.valid.map((v) => (
                    <tr key={v.row}><Td className="tabular">{v.row}</Td><Td className="font-mono text-xs">{v.code}</Td><Td>{v.name}</Td><Td>{v.category_code}</Td><Td>{v.location_code ?? "—"}</Td><Td>{v.status}</Td></tr>
                  ))}
                </tbody>
              </Table>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
