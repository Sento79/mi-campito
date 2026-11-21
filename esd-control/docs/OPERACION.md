# Operación: despliegue, tareas, copias de seguridad y recuperación

## Despliegue de una versión

```bash
git pull
npm ci
npm run build
npm run db:migrate         # con MIGRATION_DATABASE_URL (propietario)
# reiniciar el proceso (systemd, pm2, contenedor…) que ejecuta: npm start
```

- Las migraciones son incrementales y se registran en `schema_migrations` con su SHA-256. Si un
  archivo ya aplicado cambia, el script se detiene: cree siempre una migración nueva.
- El script garantiza que `esd_app` no es superusuario ni tiene BYPASSRLS.
- Ejecute las migraciones **antes** de arrancar la nueva versión.

### Ejemplo systemd

```ini
[Service]
WorkingDirectory=/opt/esd-control
EnvironmentFile=/opt/esd-control/.env
ExecStart=/usr/bin/npm start
Restart=always
User=esd
```

Delante: Nginx/Caddy con HTTPS, `client_max_body_size 25m`, y `X-Forwarded-For` hacia la app.

## Tareas programadas

| Tarea | Frecuencia | Comando |
|---|---|---|
| Notificaciones de alertas | cada hora | `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://esd.example.com/api/cron/alerts` o `npm run jobs:alerts` |
| Copia de BD | diaria | `pg_dump -Fc` (ver abajo) |
| Copia de archivos | diaria | rsync/restic de `STORAGE_DIR` |
| Archivado de auditoría (opcional) | anual | `psql "$MIGRATION_DATABASE_URL" -c "select audit_archive_before(now() - interval '3 years')"` |
| Limpieza de sesiones caducadas (opcional) | semanal | `psql "$MIGRATION_DATABASE_URL" -c "delete from sessions where expires_at < now() - interval '30 days'"` |

## Copias de seguridad

### Base de datos
```bash
pg_dump -Fc -d "$MIGRATION_DATABASE_URL" -f "esd-$(date +%F).dump"
```
- Conservación recomendada: diarias 30 días, mensuales 12 meses, anuales según su política de calidad
  (los registros de medición suelen tener requisitos de conservación largos).
- Si el proveedor lo ofrece, active PITR (archivado WAL) para recuperar a un instante concreto.
- Copie los volcados fuera del sitio y cifrados.

### Archivos
`STORAGE_DIR` contiene planos, fotos, certificados, logos y documentos (`<org>/<año>/<uuid>.<ext>`).
Los archivos nunca se sobrescriben (escritura `wx`), por lo que una copia incremental es suficiente.

Verificación de integridad tras restaurar:
```sql
select storage_key, sha256 from documents;  -- compare con sha256sum de cada archivo
```

## Recuperación

1. Cree una base de datos vacía y el rol propietario.
2. `pg_restore -d "$MIGRATION_DATABASE_URL" --no-owner esd-AAAA-MM-DD.dump`
3. `npm run db:migrate` (crea/actualiza `esd_app`, aplica migraciones pendientes si las hay y reasigna
   permisos si el volcado procede de otra instalación — revise los GRANT de `0003`).
4. Restaure `STORAGE_DIR`.
5. Arranque la app y verifique: inicio de sesión, un activo con historial, un plano y un certificado.
6. Revise la auditoría: los eventos posteriores al volcado se habrán perdido; documente el incidente.

Realice un **simulacro de restauración** al menos semestralmente.

## Seguridad operativa

- `MIGRATION_DATABASE_URL` solo en el equipo/CI que ejecuta migraciones, nunca en el servidor web.
- Rote `APP_DB_PASSWORD` y `CRON_SECRET` periódicamente (cambie `.env` y ejecute `npm run db:migrate`).
- Elimine `BOOTSTRAP_ADMIN_PASSWORD` del entorno tras el alta inicial.
- Revise usuarios inactivos y la auditoría (Administración › Auditoría).
- Logs: JSON por línea en stdout/stderr; envíelos a su sistema de logs. No contienen contraseñas ni tokens.
