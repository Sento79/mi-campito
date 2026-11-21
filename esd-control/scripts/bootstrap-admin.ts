/**
 * Crea la primera organización y su administrador (producción).
 * Uso: definir BOOTSTRAP_* en el entorno y ejecutar `npm run db:bootstrap`.
 */
import { requireEnv } from "./env";
import postgres from "postgres";
import { createOrganization, createUserWithRole } from "../src/lib/server/bootstrap";

async function main() {
  const sql = postgres(requireEnv("MIGRATION_DATABASE_URL"), { max: 1, onnotice: () => {} });
  try {
    const slug = requireEnv("BOOTSTRAP_ORG_SLUG");
    const [existing] = await sql`select id from organizations where slug = ${slug}`;
    const orgId = existing?.id ?? (await createOrganization(sql, { name: requireEnv("BOOTSTRAP_ORG_NAME"), slug }));
    await createUserWithRole(sql, orgId, {
      email: requireEnv("BOOTSTRAP_ADMIN_EMAIL"),
      fullName: requireEnv("BOOTSTRAP_ADMIN_NAME"),
      password: requireEnv("BOOTSTRAP_ADMIN_PASSWORD"),
      roleKey: "admin",
    });
    console.log(`Organización ${slug} lista con administrador ${process.env.BOOTSTRAP_ADMIN_EMAIL}. Elimine BOOTSTRAP_ADMIN_PASSWORD del entorno.`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
