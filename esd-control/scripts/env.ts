// Carga .env para los scripts ejecutados con tsx (Next.js lo hace por sí mismo).
try {
  process.loadEnvFile(".env");
} catch {
  /* sin .env: se usan las variables del entorno */
}
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Falta la variable de entorno ${name} (ver .env.example)`);
    process.exit(1);
  }
  return v;
}
