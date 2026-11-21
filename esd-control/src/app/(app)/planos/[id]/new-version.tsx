"use client";
import * as React from "react";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/core";
import { Modal } from "@/components/ui/client";
import { PlanUploadForm } from "../plan-upload";

export function NewVersionButton({ planId }: { planId: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="outline" icon={Layers} onClick={() => setOpen(true)}>Nueva versión</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Subir nueva versión del plano" description="La versión anterior se conserva en el historial. Los puntos mantienen sus coordenadas normalizadas." size="lg">
        <PlanUploadForm mode="version" planId={planId} locations={[]} users={[]} />
      </Modal>
    </>
  );
}
