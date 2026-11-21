"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/server/action";
import { audit } from "@/lib/server/audit";
import { AppError } from "@/lib/server/errors";
import { hashPassword, validatePasswordStrength } from "@/lib/server/bootstrap";
import { PERMISSIONS } from "@/lib/domain/permissions";

const pw = z.string().superRefine((v, ctx) => {
  const e = validatePasswordStrength(v);
  if (e) ctx.addIssue({ code: "custom", message: e });
});

export const createUserAction = defineAction(
  { permission: "users.manage", schema: z.object({ email: z.string().trim().toLowerCase().email(), fullName: z.string().trim().min(2).max(200), password: pw, roleId: z.string().uuid() }) },
  async (i, { tx, session }) => {
    const [id] = await tx`select app_user_create(${i.email}, ${i.fullName}, ${await hashPassword(i.password)}, ${i.roleId}) as id`;
    const [role] = await tx`select name from roles where id = ${i.roleId}`;
    await audit(tx, session, { action: "create", entityType: "user", entityId: id.id, summary: `Usuario ${i.email} añadido con rol ${role.name}` });
    revalidatePath("/admin/usuarios");
    return { id: id.id as string };
  },
);

export const updateMembershipAction = defineAction(
  { permission: "users.manage", schema: z.object({ userId: z.string().uuid(), roleId: z.string().uuid(), isActive: z.boolean(), reason: z.string().trim().max(500).nullable() }) },
  async (i, { tx, session }) => {
    if (i.userId === session.userId && (!i.isActive || i.roleId !== (await tx`select role_id from memberships where user_id = ${i.userId}`)[0]?.role_id)) {
      throw new AppError("No puede cambiar su propio rol ni desactivarse a sí mismo", 422);
    }
    const [before] = await tx`select m.role_id, m.is_active, r.name as role, u.email from memberships m join roles r on r.id = m.role_id join users u on u.id = m.user_id where m.user_id = ${i.userId}`;
    if (!before) throw new AppError("Usuario no encontrado", 404);
    const [role] = await tx`select name from roles where id = ${i.roleId}`;
    if (!role) throw new AppError("Rol no válido", 422);
    await tx`update memberships set role_id = ${i.roleId}, is_active = ${i.isActive} where user_id = ${i.userId}`;
    if (!i.isActive) await tx`select app_session_revoke_user(${i.userId})`;
    await audit(tx, session, { action: "update", entityType: "user", entityId: i.userId, summary: `Usuario ${before.email}: ${before.role} → ${role.name}${i.isActive ? "" : " (desactivado)"}`, before: { role: before.role, active: before.is_active }, after: { role: role.name, active: i.isActive }, reason: i.reason });
    revalidatePath("/admin/usuarios");
    return { id: i.userId };
  },
);

export const resetPasswordAction = defineAction({ permission: "users.manage", schema: z.object({ userId: z.string().uuid(), password: pw }) }, async (i, { tx, session }) => {
  await tx`select app_auth_set_password(${i.userId}, ${await hashPassword(i.password)})`;
  await tx`select app_session_revoke_user(${i.userId})`;
  await audit(tx, session, { action: "reset_password", entityType: "user", entityId: i.userId, summary: "Contraseña restablecida por un administrador; sesiones revocadas" });
  return { id: i.userId };
});

export const saveRoleAction = defineAction(
  { permission: "users.manage", schema: z.object({ id: z.string().uuid().nullable(), key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/, "Clave: minúsculas, números y _"), name: z.string().trim().min(2).max(80), description: z.string().max(300).nullable(), permissions: z.array(z.enum(PERMISSIONS)) }) },
  async (i, { tx, session }) => {
    let id = i.id;
    if (id) {
      const [r] = await tx`select key, is_system from roles where id = ${id}`;
      if (!r) throw new AppError("Rol no encontrado", 404);
      if (r.key === "admin") throw new AppError("Los permisos del rol Administrador no se pueden modificar", 422);
      if (!r.is_system) await tx`update roles set name = ${i.name}, description = ${i.description} where id = ${id}`;
    } else {
      id = (await tx`insert into roles(org_id, key, name, description) values (${session.orgId}, ${i.key}, ${i.name}, ${i.description}) returning id`)[0].id as string;
    }
    const before = (await tx`select permission_key from role_permissions where role_id = ${id}`).map((r) => r.permission_key);
    await tx`delete from role_permissions where role_id = ${id}`;
    for (const p of i.permissions) await tx`insert into role_permissions(role_id, org_id, permission_key) values (${id}, ${session.orgId}, ${p})`;
    await audit(tx, session, { action: i.id ? "update" : "create", entityType: "role", entityId: id, summary: `Rol ${i.name}: permisos actualizados`, before, after: i.permissions });
    revalidatePath("/admin/usuarios");
    return { id: id! };
  },
);
