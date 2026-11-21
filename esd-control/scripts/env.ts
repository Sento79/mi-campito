// Carga .env para los scripts ejecutados con tsx (Next.js lo hace por sí mismo).
import { existsSync } from "node:fs";
// Requiere Node ≥ 20.12 (process.loadEnvFile). Solo se ignora la ausencia del archivo.
if (existsSync(".env")) process.loadEnvFile(".env");
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Falta la variable de entorno ${name} (ver .env.example)`);
    process.exit(1);
  }
  return v;
}
