"use client";
import { AlertOctagon } from "lucide-react";
import { Button, Card, EmptyState } from "@/components/ui/core";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card className="mx-auto mt-10 max-w-lg">
      <EmptyState
        icon={AlertOctagon}
        title="Se ha producido un error"
        description={`No se pudo cargar esta vista. ${error.digest ? `Referencia: ${error.digest}` : ""}`}
        action={<Button onClick={reset}>Reintentar</Button>}
      />
    </Card>
  );
}
