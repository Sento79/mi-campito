import { defineConfig, devices } from "@playwright/test";

/**
 * E2E contra una base de datos dedicada (por defecto esd_e2e) que global-setup
 * recrea, migra y llena con el seed de demostración en cada ejecución.
 * Requiere `npm run build` previo (se arranca `next start`).
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const OWNER = process.env.E2E_MIGRATION_DATABASE_URL ?? "postgres://esd_owner:esd_owner_dev@localhost:5432/esd_e2e";
const APP_PW = process.env.E2E_APP_DB_PASSWORD ?? "esd_app_dev";
const APP = process.env.E2E_DATABASE_URL ?? `postgres://esd_app:${APP_PW}@localhost:5432/esd_e2e`;

export const E2E_ENV = {
  DATABASE_URL: APP,
  MIGRATION_DATABASE_URL: OWNER,
  APP_DB_PASSWORD: APP_PW,
  APP_URL: `http://localhost:${PORT}`,
  STORAGE_DIR: "./storage-e2e",
  DEMO_SEED_ENABLED: "true",
  DEMO_PASSWORD: "Demo-ESD-2026!",
  CRON_SECRET: "e2e-cron-secret-0123456789",
  COOKIE_SECURE: "false",
};
for (const [k, v] of Object.entries(E2E_ENV)) process.env[`E2E__${k}`] = v;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, trace: "off", locale: "es-ES", timezoneId: "Europe/Madrid", viewport: { width: 1366, height: 900 } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } }],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: E2E_ENV,
  },
});
