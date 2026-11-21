"use client";
import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/core";
import { LocationModal, type Loc } from "./locations-tree";

/** Crea una ubicación (por defecto una planta bajo la raíz de la empresa). */
export function NewRootButton({ locations }: { locations: Loc[] }) {
  const [open, setOpen] = React.useState(false);
  const root = locations.find((l) => l.parent_id === null);
  return (
    <>
      <Button icon={Plus} onClick={() => setOpen(true)}>Nueva ubicación</Button>
      {open ? <LocationModal loc={{ parent_id: root?.id ?? null, kind: "plant", is_active: true }} locations={locations} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
