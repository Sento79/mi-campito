"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import { Button } from "@/components/ui/core";
import { ConfirmDialog, useAction } from "@/components/ui/client";
import { archiveAssetsAction, reactivateAssetAction } from "../actions";

export function ArchiveToggle({ id, archived }: { id: string; archived: boolean }) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const archive = useAction(archiveAssetsAction);
  const reactivate = useAction(reactivateAssetAction);
  return (
    <>
      <Button variant="outline" icon={archived ? ArchiveRestore : Archive} onClick={() => setOpen(true)}>
        {archived ? "Reactivar" : "Archivar"}
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={archived ? "Reactivar activo" : "Archivar activo"}
        description={archived ? "El activo volverá al inventario activo." : "No se borra: el historial se conserva y podrá reactivarse."}
        reason={archived ? "optional" : "required"}
        danger={!archived}
        confirmLabel={archived ? "Reactivar" : "Archivar"}
        loading={archive.pending || reactivate.pending}
        onConfirm={async (reason) => {
          const r = archived ? await reactivate.run({ id, reason: reason || null }, { success: "Activo reactivado" }) : await archive.run({ ids: [id], reason }, { success: "Activo archivado" });
          if (r?.ok) {
            setOpen(false);
            router.refresh();
          }
        }}
      />
    </>
  );
}
