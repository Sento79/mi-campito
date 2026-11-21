/**
 * Alta de organizaciones y usuarios con la conexión de propietario
 * (scripts de administración, seed y tests). No se usa desde el servidor web.
 */
import type postgres from "postgres";
import bcrypt from "bcryptjs";
import { DEFAULT_ROLES } from "@/lib/domain/permissions";
import { orgSettingsSchema } from "@/lib/domain/settings";
import { DEFAULT_LABEL_LAYOUT } from "@/lib/domain/labels";

export const DEFAULT_CATEGORIES = [
  { code: "TAP", name: "Tapetes ESD", method: "numeric", quantity: "Resistencia a tierra (RTG)", unit: "Ω" },
  { code: "SIL", name: "Sillas ESD", method: "numeric", quantity: "Resistencia a tierra (RTG)", unit: "Ω" },
  { code: "CAR", name: "Carros ESD", method: "numeric", quantity: "Resistencia a tierra (RTG)", unit: "Ω" },
  { code: "SUE", name: "Suelos ESD", method: "numeric", quantity: "Resistencia a tierra (RTG)", unit: "Ω" },
  { code: "MES", name: "Mesas ESD", method: "numeric", quantity: "Resistencia a tierra (RTG)", unit: "Ω" },
  { code: "PUL", name: "Pulseras ESD", method: "numeric", quantity: "Resistencia del sistema pulsera-cable", unit: "Ω" },
  { code: "CAL", name: "Calzado ESD", method: "numeric", quantity: "Resistencia persona-calzado", unit: "Ω" },
  { code: "EST", name: "Estanterías", method: "numeric", quantity: "Resistencia a tierra (RTG)", unit: "Ω" },
  { code: "PAT", name: "Equipos de puesta a tierra", method: "numeric", quantity: "Resistencia/continuidad a tierra", unit: "Ω" },
  { code: "OTR", name: "Otros", method: "checklist", quantity: null, unit: null },
] as const;

export const DEFAULT_SEVERITIES = [
  { key: "minor", name: "Menor", rank: 1, due_days: 60 },
  { key: "major", name: "Mayor", rank: 2, due_days: 30 },
  { key: "critical", name: "Crítica", rank: 3, due_days: 7 },
];

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 12);
}

export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 10) return "La contraseña debe tener al menos 10 caracteres";
  if (pw.length > 128) return "La contraseña es demasiado larga";
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (classes < 3) return "Use al menos tres de: minúsculas, mayúsculas, números y símbolos";
  return null;
}

/**
 * Crea una organización con roles del sistema, categorías base (SIN criterios:
 * los límites los define el responsable autorizado), gravedades de NC,
 * plantilla de etiqueta por defecto y la ubicación raíz "Empresa".
 */
export async function createOrganization(sql: postgres.Sql, o: { name: string; slug: string; isDemo?: boolean }) {
  return sql.begin(async (tx) => {
    const settings = orgSettingsSchema.parse({ company: { displayName: o.name } });
    const [org] = await tx`insert into organizations(name, slug, is_demo, settings) values (${o.name}, ${o.slug}, ${o.isDemo ?? false}, ${tx.json(settings as never)}) returning id`;
    const orgId = org.id as string;
    for (const r of DEFAULT_ROLES) {
      const [role] = await tx`insert into roles(org_id, key, name, description, is_system) values (${orgId}, ${r.key}, ${r.name}, ${r.description}, true) returning id`;
      for (const p of r.permissions) {
        await tx`insert into role_permissions(role_id, org_id, permission_key) values (${role.id}, ${orgId}, ${p})`;
      }
    }
    for (const c of DEFAULT_CATEGORIES) {
      await tx`insert into categories(org_id, code, name, record_method, quantity, unit, period_unit, period_count, instrument_required)
               values (${orgId}, ${c.code}, ${c.name}, ${c.method}, ${c.quantity}, ${c.unit}, null, null, ${c.method === "numeric"})`;
    }
    for (const s of DEFAULT_SEVERITIES) {
      await tx`insert into nc_severities(org_id, key, name, rank, due_days) values (${orgId}, ${s.key}, ${s.name}, ${s.rank}, ${s.due_days})`;
    }
    await tx`insert into label_templates(org_id, name, width_mm, height_mm, layout, is_default)
             values (${orgId}, 'Estándar 50 × 30', 50, 30, ${tx.json(DEFAULT_LABEL_LAYOUT as never)}, true)`;
    await tx`insert into locations(org_id, kind, code, name) values (${orgId}, 'company', 'EMPRESA', ${o.name})`;
    await tx`insert into audit_log(org_id, action, entity_type, entity_id, summary) values (${orgId}, 'create', 'organization', ${orgId}, ${"Organización creada: " + o.name})`;
    return orgId;
  });
}

export async function createUserWithRole(
  sql: postgres.Sql,
  orgId: string,
  u: { email: string; fullName: string; password: string; roleKey: string },
): Promise<string> {
  const err = validatePasswordStrength(u.password);
  if (err) throw new Error(err);
  const hash = await hashPassword(u.password);
  return sql.begin(async (tx) => {
    const [existing] = await tx`select id from users where email = ${u.email}`;
    const userId: string = existing
      ? existing.id
      : (await tx`insert into users(email, full_name, password_hash) values (${u.email}, ${u.fullName}, ${hash}) returning id`)[0].id;
    const [role] = await tx`select id from roles where org_id = ${orgId} and key = ${u.roleKey}`;
    if (!role) throw new Error(`Rol ${u.roleKey} no existe`);
    await tx`insert into memberships(org_id, user_id, role_id) values (${orgId}, ${userId}, ${role.id})
             on conflict (org_id, user_id) do update set role_id = excluded.role_id, is_active = true`;
    await tx`insert into audit_log(org_id, action, entity_type, entity_id, summary) values (${orgId}, 'create', 'user', ${userId}, ${"Usuario dado de alta por script: " + u.email + " (" + u.roleKey + ")"})`;
    return userId;
  }) as Promise<string>;
}
