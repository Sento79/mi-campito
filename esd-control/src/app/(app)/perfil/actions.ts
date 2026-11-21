"use server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { defineAction } from "@/lib/server/action";
import { audit } from "@/lib/server/audit";
import { AppError } from "@/lib/server/errors";
import { hashPassword, validatePasswordStrength } from "@/lib/server/bootstrap";

export const changePasswordAction = defineAction(
  { schema: z.object({ current: z.string().min(1).max(200), next: z.string().max(200) }) },
  async (i, { tx, session }) => {
    const [u] = await tx`select password_hash from app_auth_find_user(${session.user.email})`;
    if (!u || !(await bcrypt.compare(i.current, u.password_hash))) throw new AppError("La contraseña actual no es correcta", 422, { current: "Incorrecta" });
    const err = validatePasswordStrength(i.next);
    if (err) throw new AppError(err, 422, { next: err });
    await tx`select app_auth_set_password(${session.userId}, ${await hashPassword(i.next)})`;
    await audit(tx, session, { action: "change_password", entityType: "user", entityId: session.userId, summary: "Contraseña cambiada por el usuario" });
    return { ok: true };
  },
);

export const updateProfileAction = defineAction({ schema: z.object({ fullName: z.string().trim().min(2).max(200) }) }, async (i, { tx, session }) => {
  await tx`update users set full_name = ${i.fullName} where id = ${session.userId}`;
  await audit(tx, session, { action: "update", entityType: "user", entityId: session.userId, summary: "Perfil actualizado" });
  return { ok: true };
});
