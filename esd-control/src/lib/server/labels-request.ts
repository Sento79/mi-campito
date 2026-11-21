import "server-only";
import { z } from "zod";
import { labelLayoutSchema } from "@/lib/domain/labels";

export const labelRequestSchema = z.object({
  assetIds: z.array(z.string().uuid()).min(1, "Seleccione activos").max(2000),
  widthMm: z.number().min(10).max(300),
  heightMm: z.number().min(10).max(300),
  layout: labelLayoutSchema,
});
