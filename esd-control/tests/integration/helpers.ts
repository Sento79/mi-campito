import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { createOrganization, createUserWithRole } from "../../src/lib/server/bootstrap";
import { createAppSql, withCtx, type Ctx, type Tx } from "../../src/lib/server/db";
import { TEST_APP_URL, TEST_OWNER_URL } from "./env";

export const owner = () => postgres(TEST_OWNER_URL, { max: 2, onnotice: () => {} });
export const app = () => createAppSql(TEST_APP_URL, 4);

export interface Fixture {
  orgId: string;
  admin: Ctx;
  manager: Ctx;
  tech: Ctx;
  viewer: Ctx;
}

const PW = "Prueba-Integracion-2026!";

export async function makeOrg(o: postgres.Sql, label: string): Promise<Fixture> {
  const slug = `${label}-${randomUUID().slice(0, 8)}`.toLowerCase();
  const orgId = await createOrganization(o, { name: `Org ${label}`, slug });
  const mk = async (role: string) => ({
    orgId,
    userId: await createUserWithRole(o, orgId, { email: `${role}.${slug}@test.local`, fullName: `${role} ${label}`, password: PW, roleKey: role }),
  });
  return { orgId, admin: await mk("admin"), manager: await mk("esd_manager"), tech: await mk("technician"), viewer: await mk("viewer") };
}

export const as = <T>(sql: postgres.Sql, ctx: Ctx, fn: (tx: Tx) => Promise<T>) => withCtx(ctx, fn, sql);

/** Crea criterio numérico activo (valores ilustrativos de test, no normativos). */
export async function makeCriterion(sql: postgres.Sql, ctx: Ctx, rules: unknown, code = "CRIT-" + randomUUID().slice(0, 6)) {
  return as(sql, ctx, async (tx) => {
    const [c] = await tx`insert into criteria(org_id, code, name) values (${ctx.orgId}, ${code}, 'Criterio test') returning id`;
    const [v] = await tx`insert into criterion_versions(org_id, criterion_id, version, status, rules, unit, change_reason, approved_by, approved_at, created_by)
                         values (${ctx.orgId}, ${c.id}, 1, 'active', ${tx.json(rules as never)}, 'Ω', 'Alta inicial (test)', ${ctx.userId}, now(), ${ctx.userId}) returning id`;
    return { criterionId: c.id as string, versionId: v.id as string };
  });
}
