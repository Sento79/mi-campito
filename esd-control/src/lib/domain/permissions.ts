export const PERMISSIONS = [
  "read",
  "create",
  "edit",
  "measure",
  "validate",
  "campaign.close",
  "criteria.manage",
  "users.manage",
  "instruments.manage",
  "reports",
  "export",
  "audit.read",
  "settings.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABEL: Record<Permission, string> = {
  read: "Lectura",
  create: "Creación",
  edit: "Edición",
  measure: "Medición",
  validate: "Validación",
  "campaign.close": "Cierre de campaña",
  "criteria.manage": "Gestión de criterios",
  "users.manage": "Gestión de usuarios",
  "instruments.manage": "Gestión de instrumentos",
  reports: "Informes",
  export: "Exportación",
  "audit.read": "Auditoría",
  "settings.manage": "Configuración",
};

export interface RoleTemplate {
  key: string;
  name: string;
  description: string;
  permissions: Permission[];
}

export const DEFAULT_ROLES: RoleTemplate[] = [
  { key: "admin", name: "Administrador", description: "Control total de la organización", permissions: [...PERMISSIONS] },
  {
    key: "esd_manager",
    name: "Responsable ESD",
    description: "Define criterios, planifica campañas, valida y cierra",
    permissions: ["read", "create", "edit", "measure", "validate", "campaign.close", "criteria.manage", "instruments.manage", "reports", "export", "audit.read"],
  },
  { key: "technician", name: "Técnico", description: "Realiza mediciones y registra incidencias", permissions: ["read", "measure", "reports"] },
  { key: "auditor", name: "Auditor", description: "Consulta, informes, exportación y auditoría", permissions: ["read", "reports", "export", "audit.read"] },
  { key: "viewer", name: "Consulta", description: "Solo lectura", permissions: ["read"] },
];

export function hasPermission(perms: ReadonlySet<string> | readonly string[], p: Permission): boolean {
  return Array.isArray(perms) ? perms.includes(p) : (perms as ReadonlySet<string>).has(p);
}
