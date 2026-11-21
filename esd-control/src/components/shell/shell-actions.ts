"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { logout, switchOrganization, requireSession } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";

export async function logoutAction() {
  await logout();
  redirect("/login");
}

export async function switchOrgAction(orgId: string) {
  const id = z.string().uuid().parse(orgId);
  await switchOrganization(id);
}

export async function markNotificationsReadAction(ids: string[] | "all") {
  const s = await requireSession();
  const list = ids === "all" ? null : z.array(z.string().uuid()).max(200).parse(ids);
  await withCtx(s, (tx) =>
    list
      ? tx`update notifications set read_at = now() where user_id = ${s.userId} and id = any(${list}) and read_at is null`
      : tx`update notifications set read_at = now() where user_id = ${s.userId} and read_at is null`,
  );
}

export async function listNotificationsAction() {
  const s = await requireSession();
  return withCtx(s, (tx) => tx`select id, kind, title, body, link, created_at, read_at from notifications where user_id = ${s.userId} order by created_at desc limit 15`);
}
