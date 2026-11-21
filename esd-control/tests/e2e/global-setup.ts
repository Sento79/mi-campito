import postgres from "postgres";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { runMigrations } from "../../src/lib/server/migrate";

export default async function globalSetup() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("E2E__")).map(([k, v]) => [k.slice(5), v!]));
  const owner = postgres(env.MIGRATION_DATABASE_URL, { max: 1, onnotice: () => {} });
  await owner.unsafe("drop schema if exists public cascade; create schema public;");
  await owner.end();
  rmSync(env.STORAGE_DIR, { recursive: true, force: true });
  await runMigrations({ ownerUrl: env.MIGRATION_DATABASE_URL, appPassword: env.APP_DB_PASSWORD });
  execFileSync("npx", ["tsx", "scripts/seed-demo.ts"], { env: { ...process.env, ...env }, stdio: "inherit" });
}
