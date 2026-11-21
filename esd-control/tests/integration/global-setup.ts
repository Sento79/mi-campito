import postgres from "postgres";
import { runMigrations } from "../../src/lib/server/migrate";
import { TEST_OWNER_URL, TEST_APP_PASSWORD, dbTestsEnabled } from "./env";

/** Recrea el esquema de la base de datos de test y aplica las migraciones. */
export default async function setup() {
  if (!dbTestsEnabled()) return;
  const sql = postgres(TEST_OWNER_URL, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe("drop schema if exists public cascade; create schema public;");
  } finally {
    await sql.end();
  }
  await runMigrations({ ownerUrl: TEST_OWNER_URL, appPassword: TEST_APP_PASSWORD });
}
