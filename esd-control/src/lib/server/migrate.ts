import postgres from "postgres";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const APP_ROLE = "esd_app";

/**
 * Aplica las migraciones SQL versionadas de db/migrations en orden.
 * - Cada archivo se aplica en una transacción.
 * - Se guarda la suma SHA-256: si una migración ya aplicada cambia, se aborta.
 * - Crea/actualiza el rol de aplicación esd_app (LOGIN, sin BYPASSRLS).
 */
export async function runMigrations(opts: { ownerUrl: string; appPassword: string; dir?: string; log?: (m: string) => void; rotateAppPassword?: boolean }) {
  const log = opts.log ?? (() => {});
  const dir = opts.dir ?? path.join(process.cwd(), "db", "migrations");
  // max_lifetime null: el bloqueo consultivo de sesión debe vivir en una única conexión
  const sql = postgres(opts.ownerUrl, { max: 1, max_lifetime: null, onnotice: () => {} });
  try {
    // Un único ejecutor a la vez (bloqueo de sesión, en la única conexión de este cliente)
    await sql`select pg_advisory_lock(hashtext('esd-control:migrations'))`;
    // Antes de crear funciones: que no sean ejecutables por PUBLIC aunque una migración falle a medias
    // Global (sin IN SCHEMA): un ajuste por esquema no puede quitar el EXECUTE a PUBLIC que concede el valor global
    await sql`alter default privileges revoke execute on functions from public`;
    await sql`create table if not exists schema_migrations (version text primary key, checksum text not null, applied_at timestamptz not null default now())`;

    if (!/^[\x20-\x7e]{8,128}$/.test(opts.appPassword) || opts.appPassword.includes("'")) {
      throw new Error("APP_DB_PASSWORD debe tener entre 8 y 128 caracteres ASCII imprimibles y sin comillas simples");
    }
    const [role] = await sql`select 1 from pg_roles where rolname = ${APP_ROLE}`;
    if (!role) {
      await sql.unsafe(`create role ${APP_ROLE} login password '${opts.appPassword}' nosuperuser nocreatedb nocreaterole nobypassrls`);
      log(`Rol ${APP_ROLE} creado`);
    } else if (opts.rotateAppPassword) {
      // Solo con rotación explícita: el rol es global al clúster y puede compartirlo otra base de datos
      await sql.unsafe(`alter role ${APP_ROLE} with login password '${opts.appPassword}'`);
      log(`Contraseña de ${APP_ROLE} actualizada: actualice DATABASE_URL y reinicie la aplicación`);
    }
    const [attrs] = await sql`select rolsuper, rolbypassrls from pg_roles where rolname = ${APP_ROLE}`;
    if (attrs.rolsuper || attrs.rolbypassrls) {
      throw new Error(`El rol ${APP_ROLE} no puede ser superusuario ni tener BYPASSRLS: las políticas RLS no se aplicarían`);
    }
    const [{ db }] = await sql`select current_database() as db`;
    await sql.unsafe(`grant connect on database "${db}" to ${APP_ROLE}`);

    const files = (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    const applied = new Map((await sql`select version, checksum from schema_migrations`).map((r) => [r.version as string, r.checksum as string]));
    let count = 0;
    for (const f of files) {
      const content = await readFile(path.join(dir, f), "utf8");
      const checksum = createHash("sha256").update(content).digest("hex");
      const version = f.replace(/\.sql$/, "");
      const prev = applied.get(version);
      if (prev) {
        if (prev !== checksum) throw new Error(`La migración ${f} ya aplicada ha sido modificada. Cree una nueva migración en lugar de editarla.`);
        continue;
      }
      await sql.begin(async (tx) => {
        await tx.unsafe(content);
        await tx`insert into schema_migrations(version, checksum) values (${version}, ${checksum})`;
      });
      log(`Aplicada ${f}`);
      count++;
    }
    // Permisos idempotentes (también repara una base restaurada desde otra instalación)
    const grants = await readFile(path.join(dir, "..", "grants.sql"), "utf8"); // obligatorio: si falta, error
    await sql.unsafe(grants);
    log(count ? `${count} migración(es) aplicada(s)` : "Base de datos al día");
    return count;
  } finally {
    await sql`select pg_advisory_unlock(hashtext('esd-control:migrations'))`.catch(() => {});
    await sql.end();
  }
}
