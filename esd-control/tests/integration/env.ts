import { existsSync } from "node:fs";
// Requiere Node ≥ 20.12 (process.loadEnvFile). Solo se ignora la ausencia del archivo.
if (existsSync(".env.test")) process.loadEnvFile(".env.test");
export const TEST_OWNER_URL = process.env.TEST_MIGRATION_DATABASE_URL ?? "postgres://esd_owner:esd_owner_dev@localhost:5432/esd_test";
export const TEST_APP_PASSWORD = process.env.TEST_APP_DB_PASSWORD ?? "esd_app_dev";
export const TEST_APP_URL = process.env.TEST_DATABASE_URL ?? `postgres://esd_app:${encodeURIComponent(TEST_APP_PASSWORD)}@localhost:5432/esd_test`;
export const dbTestsEnabled = () => process.env.SKIP_DB_TESTS !== "1";
