"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/core";
import { ConfirmDialog, useAction } from "@/components/ui/client";
import { invalidateMeasurementAction } from "../actions";

export function InvalidateButton({ id }: { id: string }) {
  const [open, setOpen] = React.useState(false);
  const a = useAction(invalidateMeasurementAction);
  const router = useRouter();
  return (
    <>
      <Button variant="outline" icon={Ban} onClick={() => setOpen(true)}>Invalidar</Button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} danger reason="required" loading={a.pending} title="Invalidar medición"
        description="La medición se marcará como no válida y dejará de contar para el estado del activo. El registro original, sus valores y su resultado se conservan y la acción queda en auditoría."
        confirmLabel="Invalidar"
        onConfirm={async (reason) => {
          const r = await a.run({ id, reason }, { success: "Medición invalidada" });
          if (r?.ok) { setOpen(false); router.refresh(); }
        }} />
    </>
  );
}
