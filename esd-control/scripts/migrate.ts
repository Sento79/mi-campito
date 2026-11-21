import { requireEnv } from "./env";
import { runMigrations } from "../src/lib/server/migrate";

runMigrations({
  ownerUrl: requireEnv("MIGRATION_DATABASE_URL"),
  appPassword: requireEnv("APP_DB_PASSWORD"),
  rotateAppPassword: process.argv.includes("--rotate-app-password"),
  log: (m) => console.log(m),
})
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Error de migración:", e.message);
    process.exit(1);
  });
