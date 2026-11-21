# Despliegue en Railway

La aplicación se despliega en Railway con una imagen Docker (`Dockerfile`, que Railway detecta en el
directorio raíz del servicio). Configurado como se indica abajo, cada despliegue:

1. construye la imagen (`npm ci` + `next build`);
2. ejecuta **antes de publicar** las migraciones (`npm run db:migrate`): si fallan, el despliegue se
   detiene y sigue sirviendo la versión anterior;
3. arranca la app en el puerto `PORT` que asigna Railway y no la publica hasta que
   `GET /api/health` responde 200 (la app responde y la base de datos acepta consultas).

Todo el proceso se ha probado en local con la misma imagen contra una base de datos vacía:
migraciones, alta del administrador, arranque, comprobación de salud, tarea de alertas y
repetición de la migración (que no hace nada si la base ya está al día).

## Qué se necesita

- Una cuenta de Railway con acceso a este repositorio de GitHub.
- Un servicio **PostgreSQL** de Railway (16 o superior).
- Un **volumen** para los archivos subidos (planos, fotos, documentos).

## Paso 1 · Proyecto y base de datos

1. En Railway: **New Project → Deploy from GitHub repo** y elija `Sento79/mi-campito`.
2. En el mismo proyecto: **+ New → Database → PostgreSQL**. El servicio se llamará `Postgres`
   (si le pone otro nombre, cámbielo también en las referencias `${{Postgres.…}}` de abajo).

## Paso 2 · Servicio de la aplicación

En el servicio creado desde el repositorio, **Settings**:

| Ajuste | Valor |
|---|---|
| Source → Root Directory | `/esd-control` |
| Source → Branch | la rama que quiera desplegar (p. ej. `main` cuando se fusione el PR) |
| Deploy → Pre-deploy Command | `npm run db:migrate` |
| Deploy → Healthcheck Path | `/api/health` |
| Deploy → Restart Policy | *On Failure* (5 reintentos) |
| Networking → Public Networking | **Generate Domain** |

Railway construye con el `Dockerfile` al encontrarlo en el Root Directory; no hay que elegir builder.
El **Pre-deploy Command** es imprescindible: sin él no se aplican las migraciones y la app no
arranca contra una base vacía.

El repositorio incluye además `railway.json` con esos mismos ajustes (y `railway.cron.json` para el
Paso 6), para servicios que admitan configuración desde archivo (*Settings → Config-as-code →
Railway Config File*, con la ruta completa `/esd-control/railway.json`: no sigue al Root Directory).
Railway ha anunciado cambios en esa función; si su servicio no ofrece la opción, use los ajustes del
panel de la tabla, que dan el mismo resultado. Si la usa, el archivo prevalece sobre el panel.

## Paso 3 · Volumen de archivos

En el servicio de la aplicación: **clic derecho → Attach Volume** (o `Ctrl/⌘ K` → *volume*), con
punto de montaje **`/data/storage`**. La imagen ya usa `STORAGE_DIR=/data/storage`.

Sin volumen, los archivos subidos se perderían en cada despliegue. Con un volumen montado, Railway
para la versión anterior antes de arrancar la nueva: hay unos segundos sin servicio en cada
despliegue.

## Paso 4 · Variables

En el servicio de la aplicación, **Variables → Raw Editor**, pegue esto y sustituya lo marcado:

```env
# Contraseña del rol esd_app: genérela con `openssl rand -hex 24`. Solo letras, dígitos y . _ ~ -
# (se inserta sin codificar en DATABASE_URL; la migración rechaza otros caracteres)
APP_DB_PASSWORD=SUSTITUIR_por_una_contraseña_aleatoria

# Migraciones: el usuario propietario de la base de datos de Railway
MIGRATION_DATABASE_URL=${{Postgres.DATABASE_URL}}

# La aplicación se conecta con el rol esd_app (sin BYPASSRLS): las políticas RLS se aplican siempre
DATABASE_URL=postgresql://esd_app:${{APP_DB_PASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}

APP_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
COOKIE_SECURE=true
SESSION_TTL_HOURS=12
STORAGE_DRIVER=local
STORAGE_DIR=/data/storage
MAX_UPLOAD_MB=20

# Solo si va a llamar a POST /api/cron/alerts desde fuera (mínimo 16 caracteres; `openssl rand -hex 32`)
CRON_SECRET=
```

Notas:

- `DATABASE_URL` usa la red privada de Railway (`PGHOST` es el host interno), sin pasar por Internet.
- La primera migración **crea** el rol `esd_app` con `APP_DB_PASSWORD`. Editar la variable después
  no cambia la contraseña del rol. Para rotarla:
  1. Genere la nueva (`openssl rand -hex 24`).
  2. Abra una consola en el servicio con `railway ssh` (Paso 5; `railway run` no sirve) y pase el
     valor nuevo explícitamente, porque el contenedor aún tiene el anterior:
     `APP_DB_PASSWORD=<nueva> npm run db:migrate -- --rotate-app-password`
  3. Guarde ese mismo valor en la variable `APP_DB_PASSWORD` del servicio; Railway redespliega con
     la nueva `DATABASE_URL`. Entre el paso 2 y el final del redespliegue, la versión en marcha no
     puede abrir conexiones nuevas: hágalo en un momento sin uso.
- El usuario de `Postgres.DATABASE_URL` debe poder crear roles. El usuario `postgres` de la plantilla
  de Railway puede; si usa otra base de datos, créele antes el rol `esd_app` o dele `CREATEROLE`.
- Si cambia `APP_URL` (por ejemplo, a un dominio propio), las etiquetas QR ya impresas seguirán
  apuntando al dominio anterior. Fije el dominio definitivo antes de imprimir etiquetas.

Al guardar las variables, Railway despliega. En **Deployments → View logs** debe ver
`Aplicada 0001_core.sql` … `8 migración(es) aplicada(s)` y, después, `Ready`.

## Paso 5 · Primer administrador (una sola vez)

No hay usuarios ni datos de demostración: hay que dar de alta la organización y su administrador.
Con la [CLI de Railway](https://docs.railway.com/guides/cli) instalada y el proyecto enlazado
(`railway link`), abra una consola dentro del servicio y ejecute el alta:

```bash
railway ssh            # consola dentro del contenedor de la aplicación
BOOTSTRAP_ORG_NAME="Mi planta" BOOTSTRAP_ORG_SLUG=mi-planta \
BOOTSTRAP_ADMIN_EMAIL=admin@empresa.com BOOTSTRAP_ADMIN_NAME="Nombre Apellido" \
BOOTSTRAP_ADMIN_PASSWORD='Una-Contraseña-Larga-2026' npm run db:bootstrap
exit
```

`railway run` **no** sirve aquí: ejecuta el comando en su ordenador, que no llega a la red privada
de Railway. Sin la CLI, puede hacerlo con un despliegue temporal:

1. Añada las cinco variables `BOOTSTRAP_*` al servicio.
2. Cambie el *Pre-deploy Command* a `npm run db:migrate && npm run db:bootstrap` y despliegue.
   Si el servicio usa `railway.json` (Config-as-code), el archivo prevalece sobre el panel: el
   cambio hay que hacerlo en `preDeployCommand` de ese archivo (en la rama desplegada), no en el panel.
3. Cuando el registro muestre `Organización … lista con administrador …`, **borre** las variables
   `BOOTSTRAP_*` y restaure `npm run db:migrate`.

Entre en `https://<su-dominio>/login` con esa cuenta y cambie la contraseña desde su perfil. Los
criterios de aceptación, categorías, ubicaciones y usuarios se configuran desde **Administración**.

## Paso 6 · Alertas periódicas (opcional, recomendado)

Las notificaciones de vencimientos y calibraciones se generan con `npm run jobs:alerts`. En Railway:

1. **+ New → GitHub Repo** con el mismo repositorio (un segundo servicio, p. ej. `alertas`).
2. Settings: Root Directory `/esd-control`; *Deploy → Custom Start Command* `npm run jobs:alerts`;
   *Cron Schedule* `17 5 * * *` (todos los días a las 05:17 UTC); *Restart Policy* *Never*; sin
   Pre-deploy Command ni Healthcheck Path. (Equivale a `railway.cron.json` si usa Config-as-code.)
3. Variables: `DATABASE_URL=${{esd-control.DATABASE_URL}}` (sustituya `esd-control` por el nombre
   del servicio de la aplicación). No necesita volumen ni dominio.

El servicio arranca, genera las notificaciones (la función es idempotente) y termina. Como
alternativa, un programador externo puede llamar a `POST /api/cron/alerts` con la cabecera
`Authorization: Bearer <CRON_SECRET>`.

## Copias de seguridad

La base de datos (en el volumen del servicio Postgres) y los archivos (en el volumen
`/data/storage` de la app) se copian por separado. Dos copias programadas de forma independiente
**no** forman un par coherente: si se sube un plano entre una y otra, al restaurar quedará el
registro sin su archivo, o el archivo sin su registro. Para una copia restaurable:

1. Detenga las escrituras parando el servicio de la **aplicación** (por ejemplo, retirando su
   despliegue activo en *Deployments*); el servicio Postgres sigue en marcha.
2. Haga las dos copias: **Postgres → Backups → Create backup** (o `pg_dump`, ver
   `docs/OPERACION.md`) y **volumen de la app → Backups → Create backup**.
3. Anote juntas las dos copias (fecha y hora, mismo nombre) y vuelva a levantar la aplicación.
4. Para restaurar, use siempre **ese par**, con la aplicación parada.

Las copias automáticas de Railway siguen siendo útiles ante desastres, pero tras restaurarlas puede
haber documentos sin archivo (o archivos sin registro). Guarde además volcados fuera de Railway.

## Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| El despliegue falla en *Pre-deploy* con `Falta la variable de entorno …` | Faltan `MIGRATION_DATABASE_URL` o `APP_DB_PASSWORD`. |
| `password authentication failed for user "esd_app"` | `APP_DB_PASSWORD` cambió después de crear el rol: rote la contraseña (Paso 4, notas). |
| La comprobación de salud no pasa y los registros dicen `Base de datos no disponible` | `DATABASE_URL` mal formada o el servicio Postgres no se llama `Postgres`. |
| No se puede iniciar sesión (la cookie no se guarda) | `COOKIE_SECURE=true` con `APP_URL` en `http://`: use el dominio `https://`. |
| Los planos o fotos desaparecen tras desplegar | No hay volumen montado en `/data/storage`. |
| Error `permission denied` al subir archivos | El volumen está montado en otra ruta: debe ser exactamente `STORAGE_DIR`. |
