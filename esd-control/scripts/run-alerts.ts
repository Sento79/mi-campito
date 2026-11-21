/** Genera notificaciones de alerta (para cron del sistema). Usa DATABASE_URL (rol de aplicación). */
import { requireEnv } from "./env";
import postgres from "postgres";

const sql = postgres(requireEnv("DATABASE_URL"), { max: 1, onnotice: () => {} });
sql`select app_generate_alert_notifications() as n`
  .then(([r]) => console.log(`${r.n} notificación(es) nuevas`))
  .catch((e) => {
    console.error("Error:", e.message);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
