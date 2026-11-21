import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { getSql, withCtx, type Ctx } from "./db";
import { parseSettings, type OrgSettings } from "@/lib/domain/settings";
import type { Permission } from "@/lib/domain/permissions";
import { ForbiddenError } from "./errors";
import { logger } from "./logger";

export const SESSION_COOKIE = "esd_session";
// Hash ficticio para igualar tiempos cuando el usuario no existe.
let dummyHash: string | null = null;
const getDummyHash = () => (dummyHash ??= bcrypt.hashSync(randomBytes(16).toString("hex"), 12));

export interface SessionInfo extends Ctx {
  sessionId: string;
  user: { id: string; email: string; fullName: string };
  org: { id: string; name: string; isDemo: boolean; settings: OrgSettings };
  role: { key: string; name: string };
  permissions: Set<string>;
  orgs: { org_id: string; org_name: string; is_demo: boolean; role_name: string }[];
}

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

function sessionTtlHours() {
  const n = Number(process.env.SESSION_TTL_HOURS ?? 12);
  return Number.isFinite(n) && n > 0 && n <= 720 ? n : 12;
}

// Limitador sencillo en memoria por IP (complementa el bloqueo por usuario en BD).
const attempts = new Map<string, { n: number; reset: number }>();
function rateLimited(key: string, max = 20, windowMs = 10 * 60_000): boolean {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.reset < now) {
    attempts.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  a.n++;
  return a.n > max;
}

async function clientInfo() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
  return { ip, ua: h.get("user-agent") ?? "" };
}

export type LoginResult = { ok: true } | { ok: false; error: string };

export async function login(email: string, password: string, orgId?: string): Promise<LoginResult> {
  const sql = getSql();
  const { ip, ua } = await clientInfo();
  if (rateLimited(`ip:${ip}`)) return { ok: false, error: "Demasiados intentos. Espere unos minutos." };
  const [u] = await sql`select * from app_auth_find_user(${email.trim().toLowerCase()})`;
  const ok = await bcrypt.compare(password, u?.password_hash ?? getDummyHash());
  if (!u) return { ok: false, error: "Credenciales no válidas" };
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    return { ok: false, error: "Cuenta bloqueada temporalmente por intentos fallidos. Inténtelo más tarde." };
  }
  if (!ok || !u.is_active) {
    await sql`select app_auth_register_attempt(${u.id}, false)`;
    logger.warn("auth.login_failed", { userId: u.id });
    return { ok: false, error: "Credenciales no válidas" };
  }
  const orgs = await sql`select * from app_auth_user_orgs(${u.id})`;
  if (orgs.length === 0) return { ok: false, error: "Su usuario no tiene acceso a ninguna organización" };
  const org = (orgId && orgs.find((o) => o.org_id === orgId)) || orgs[0];
  await sql`select app_auth_register_attempt(${u.id}, true)`;
  await createSession(u.id, org.org_id, ip, ua);
  await withCtx({ orgId: org.org_id, userId: u.id }, (tx) =>
    tx`insert into audit_log(org_id, user_id, action, entity_type, entity_id, summary, ip) values (${org.org_id}, ${u.id}, 'login', 'user', ${u.id}, 'Inicio de sesión', ${ip})`,
  );
  return { ok: true };
}

async function createSession(userId: string, orgId: string, ip: string, ua: string) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + sessionTtlHours() * 3600_000);
  await getSql()`select app_session_create(${userId}, ${orgId}, ${hashToken(token)}, ${expires}, ${ip}, ${ua})`;
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    expires,
  });
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const s = await getSession();
    if (s) {
      await withCtx(s, (tx) => tx`insert into audit_log(org_id, user_id, action, entity_type, entity_id, summary) values (${s.orgId}, ${s.userId}, 'logout', 'user', ${s.userId}, 'Cierre de sesión')`);
    }
    await getSql()`select app_session_revoke(${hashToken(token)})`;
  }
  jar.delete(SESSION_COOKIE);
}

export async function switchOrganization(orgId: string) {
  const s = await requireSession();
  if (!s.orgs.some((o) => o.org_id === orgId)) throw new ForbiddenError("No pertenece a esa organización");
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await getSql()`select app_session_revoke(${hashToken(token)})`;
  const { ip, ua } = await clientInfo();
  await createSession(s.userId, orgId, ip, ua);
}

/** Resuelve la sesión actual (memorizada por petición). */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const sql = getSql();
  const [s] = await sql`select * from app_session_resolve(${hashToken(token)})`;
  if (!s) return null;
  const ctx = { orgId: s.org_id as string, userId: s.user_id as string };
  return withCtx(ctx, async (tx) => {
    const [row] = await tx`
      select u.id as user_id, u.email, u.full_name, o.id as org_id, o.name as org_name, o.is_demo, o.settings, r.key as role_key, r.name as role_name, m.role_id
        from users u
        join memberships m on m.user_id = u.id and m.org_id = ${ctx.orgId}
        join organizations o on o.id = m.org_id
        join roles r on r.id = m.role_id
       where u.id = ${ctx.userId}`;
    if (!row) return null;
    const perms = await tx`select permission_key from role_permissions where role_id = ${row.role_id}`;
    const orgs = await sql`select * from app_auth_user_orgs(${ctx.userId})`;
    return {
      ...ctx,
      sessionId: s.session_id,
      user: { id: row.user_id, email: row.email, fullName: row.full_name },
      org: { id: row.org_id, name: row.org_name, isDemo: row.is_demo, settings: parseSettings(row.settings) },
      role: { key: row.role_key, name: row.role_name },
      permissions: new Set(perms.map((p) => p.permission_key as string)),
      orgs: orgs.map((o) => ({ org_id: o.org_id, org_name: o.org_name, is_demo: o.is_demo, role_name: o.role_name })),
    } satisfies SessionInfo;
  });
});

export async function requireSession(): Promise<SessionInfo> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

export function can(s: SessionInfo | null, p: Permission): boolean {
  return !!s && s.permissions.has(p);
}

/** Para páginas: redirige si no hay sesión y lanza 403 si falta el permiso. */
export async function requirePermission(p: Permission): Promise<SessionInfo> {
  const s = await requireSession();
  if (!s.permissions.has(p)) redirect(`/sin-permiso?p=${encodeURIComponent(p)}`);
  return s;
}
