"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/server/action";
import { invalidateMeasurement } from "@/lib/server/services/measurements";

export const invalidateMeasurementAction = defineAction(
  { permission: "validate", schema: z.object({ id: z.string().uuid(), reason: z.string().trim().min(3, "Indique el motivo").max(500) }) },
  async (i, { tx, session }) => {
    await invalidateMeasurement(tx, session, i.id, i.reason);
    revalidatePath(`/historial/${i.id}`);
    return { id: i.id };
  },
);
