import { z } from "zod";

export const orgSettingsSchema = z.object({
  /** Qué hacer si el instrumento requerido falta o no está calibrado */
  instrumentPolicy: z.enum(["block", "review", "warn"]).default("review"),
  /** Días de aviso previo para mediciones */
  dueLeadDays: z.number().int().min(0).max(365).default(14),
  /** Días de aviso previo para calibraciones */
  calibrationLeadDays: z.number().int().min(0).max(365).default(30),
  /** Días de aviso previo para fechas límite de NC y acciones */
  ncLeadDays: z.number().int().min(0).max(365).default(7),
  /** Creación de NC al registrar un no conforme */
  autoCreateNc: z.enum(["ask", "always", "never"]).default("ask"),
  /** Confirmación explícita (firma) del técnico al guardar */
  requireSignature: z.boolean().default(false),
  /** Motivos predefinidos para No medible / No aplica */
  notMeasurableReasons: z
    .array(z.string().min(2).max(120))
    .default(["Zona inaccesible", "Activo en uso / producción", "Activo no localizado", "Condiciones ambientales fuera de rango", "Otro (detallar)"]),
  scanner: z
    .object({
      suffix: z.enum(["Enter", "Tab", "none"]).default("Enter"),
      prefix: z.string().max(10).default(""),
      maxInterKeyMs: z.number().int().min(10).max(300).default(50),
      minLength: z.number().int().min(1).max(40).default(3),
    })
    .default({ suffix: "Enter", prefix: "", maxInterKeyMs: 50, minLength: 3 }),
  company: z
    .object({
      displayName: z.string().max(200).default(""),
      logoDocumentId: z.string().uuid().nullable().default(null),
      reportFooter: z.string().max(300).default(""),
    })
    .default({ displayName: "", logoDocumentId: null, reportFooter: "" }),
  notifications: z
    .object({
      inApp: z.boolean().default(true),
      // El correo no está implementado en esta versión: no se simulan envíos.
      email: z.literal(false).default(false),
    })
    .default({ inApp: true, email: false }),
});
export type OrgSettings = z.infer<typeof orgSettingsSchema>;

export function parseSettings(raw: unknown): OrgSettings {
  const r = orgSettingsSchema.safeParse(raw ?? {});
  return r.success ? r.data : orgSettingsSchema.parse({});
}
