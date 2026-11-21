import { ShieldOff } from "lucide-react";
import { ButtonLink, Card, EmptyState } from "@/components/ui/core";
import { PERMISSION_LABEL, type Permission } from "@/lib/domain/permissions";

export const metadata = { title: "Sin permiso" };

export default async function NoPermission({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p } = await searchParams;
  const label = p && p in PERMISSION_LABEL ? PERMISSION_LABEL[p as Permission] : null;
  return (
    <Card className="mx-auto mt-10 max-w-lg">
      <EmptyState
        icon={ShieldOff}
        title="No tiene permiso para ver esta página"
        description={label ? `Se requiere el permiso «${label}». Solicítelo a un administrador de su organización.` : "Solicite acceso a un administrador."}
        action={<ButtonLink href="/" variant="outline">Volver al dashboard</ButtonLink>}
      />
    </Card>
  );
}
