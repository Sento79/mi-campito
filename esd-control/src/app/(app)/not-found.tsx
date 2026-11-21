import { SearchX } from "lucide-react";
import { ButtonLink, Card, EmptyState } from "@/components/ui/core";

export default function NotFound() {
  return (
    <Card className="mx-auto mt-10 max-w-lg">
      <EmptyState icon={SearchX} title="No encontrado" description="El elemento no existe o no pertenece a su organización." action={<ButtonLink href="/" variant="outline">Ir al dashboard</ButtonLink>} />
    </Card>
  );
}
