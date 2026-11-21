# ESD Control

Plataforma web para gestionar el programa de control de descargas electrostáticas (ESD) de una instalación industrial: inventario de elementos ESD, medición rápida con lector de códigos, planos de planta con puntos de medición, campañas, criterios de aceptación versionados, instrumentos y calibración, no conformidades, etiquetas, informes, alertas y auditoría.

> **Criterios de aceptación**: la aplicación **no incluye límites normativos predefinidos**. Cada organización define y aprueba sus criterios (vinculados a sus procedimientos y a la revisión de norma que aplique). Sin criterio vigente, las mediciones quedan como «Requiere revisión».

Este directorio es un proyecto independiente dentro del repositorio `mi-campito`; no comparte código ni despliegue con la app de la raíz.

---

## Índice

1. [Qué incluye](#qué-incluye)
2. [Arquitectura](#arquitectura)
3. [Arranque local](#arranque-local)
4. [Variables de entorno](#variables-de-entorno)
5. [Datos de demostración](#datos-de-demostración)
6. [Pruebas y calidad](#pruebas-y-calidad)
7. [Despliegue](#despliegue)
8. [Lector de códigos, etiquetas y Zebra](#lector-de-códigos-etiquetas-y-zebra)
9. [Trabajo sin conexión](#trabajo-sin-conexión)
10. [Seguridad](#seguridad)
11. [Copias de seguridad y recuperación](#copias-de-seguridad-y-recuperación)
12. [Limitaciones conocidas](#limitaciones-conocidas)

Documentación complementaria: [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md), [`docs/OPERACION.md`](docs/OPERACION.md) y [`PROGRESS.md`](PROGRESS.md).

---

## Qué incluye

| Módulo | Funcionalidad |
|---|---|
| **Dashboard** | KPI enlazados a listados filtrados (activos, planificadas, realizadas, vencidas, conformes/no conformes, cumplimiento, campañas, NC, calibración), tendencia semanal, estado por categoría, próximas tareas, actividad reciente, filtros por planta/zona, categoría, campaña y periodo, bloques personalizables. |
| **Medición rápida** | Lector HID (USB/Bluetooth) sin hacer clic, campo visible, cámara (QR/códigos de barras), entrada manual; ficha con instrucciones, criterio, unidad, últimas mediciones, periodicidad e instrumento; numérico con unidades, selección, checklist, multipunto y combinado; No medible / No aplica con motivo; repetición conservando intentos; borradores locales; resultado previsto y explicación; modo ruta de campaña; cola sin conexión. |
| **Motor de criterios** | Aritmética decimal exacta (BigInt), límites inclusivos/exclusivos, conversión de unidades solo por potencias de 10, selección, checklist, multipunto (todos conformes, peor caso, mínimo N, media solo con justificación), combinado; resultados Conforme / No conforme / Pendiente / Incompleto / No medible / No aplica / Requiere revisión con explicación; reglas de instrumento (bloquear / revisión / aviso). |
| **Inventario** | Listado con búsqueda, filtros, orden, paginación, acciones masivas (etiquetas, campaña, mover, archivar); alta, edición, duplicado, archivado/reactivación (nunca borrado), fotos y documentos, historial y trazabilidad; importación CSV/XLSX con plantilla, previsualización, informe de errores, detección de duplicados y transacción atómica; exportación. |
| **Categorías y ubicaciones** | Categorías con método de registro, magnitud, unidad, procedimiento, criterio, periodicidad, requisitos de instrumento, campos obligatorios, instrucciones y plantillas multipunto. Jerarquía flexible empresa › planta › edificio › piso › área › zona › línea › ubicación. |
| **Planos** | PDF (convertido a imagen en el navegador con pdf.js, multipágina), PNG, JPG; versiones con historial; visor con zoom, desplazamiento, pellizco, ajuste y rotación; puntos en coordenadas normalizadas 0–1; añadir/editar/mover/archivar con confirmación y auditoría; bloqueo de disposición durante campañas en curso; rutas de medición; vista de campaña; filtros por estado y fecha; lista sincronizada; exportación PNG y PDF con leyenda. |
| **Campañas** | Manual, por categoría, por ubicación, desde plano, por vencimientos o desde selección; estados borrador → planificada → en curso (pausa/reanudar) → revisión → completada → cerrada / cancelada; progreso, técnicos, actividad; omisión de elementos con motivo; cierre que registra pendientes, no conformes y NC abiertas. |
| **No conformidades** | Creación automática o manual desde mediciones, gravedad configurable, responsable, contención, causa, acciones correctiva/preventiva con plazos, adjuntos, verificación obligatoria y permiso de validación para cerrar, reapertura, historial de estados. |
| **Instrumentos** | Alta, estado, calibraciones con certificado, vigencia, aviso previo y política de uso fuera de calibración; instantánea de calibración guardada con cada medición. |
| **Etiquetas** | Diseñador con vista previa a escala real, 50×30 / 60×40 / 70×50 / 100×50 mm o personalizado, QR y/o Code 128, campos configurables, plantillas, PDF en hoja (A4/Carta) o rollo, ZPL para Zebra (203/300/600 dpi, densidad). |
| **Informes y exportación** | PDF: resumen global, mediciones/historial (incl. multipunto), vencidos y pendientes, instrumentos, NC, campaña, activo y plano; con logo, empresa, filtros, fecha, responsable, criterios y versiones aplicados, firmas y numeración. XLSX/CSV de activos, historial, instrumentos, NC y auditoría. |
| **Alertas** | Medición próxima/vencida, incompleta o en revisión, activo bloqueado, calibración próxima/vencida, NC abierta o fuera de plazo, acción vencida, campaña atrasada. Centro de notificaciones y generación programada idempotente. |
| **Administración** | Plantas y zonas, criterios versionados (editor, simulador, borrador → publicación), procedimientos con revisiones, usuarios y roles con matriz de permisos, configuración, auditoría con filtros y exportación, perfil y cambio de contraseña. |

## Arquitectura

- **Next.js 15 (App Router) + React 19 + TypeScript**, Tailwind CSS 4, componentes propios accesibles (`src/components/ui`), iconos Lucide, Recharts, React Hook Form + Zod.
- **PostgreSQL 16** (compatible con cualquier PostgreSQL ≥ 14, incluido el de Supabase) con el driver `postgres`.
- **Seguridad en la base de datos**: RLS en todas las tablas con datos; la app se conecta con el rol `esd_app` (sin BYPASSRLS ni propiedad de tablas) y fija `app.org_id`/`app.user_id` por transacción. Los permisos se comprueban en el servidor **y** en las políticas.
- **Integridad**: mediciones inalterables (disparadores), versiones de criterio inmutables, auditoría de solo inserción, cierres de NC y campañas reforzados en base de datos.
- **Autenticación propia**: contraseñas bcrypt (coste 12), sesiones con token aleatorio (cookie `httpOnly`, `SameSite=Lax`, `Secure` en producción) cuyo hash SHA-256 se guarda en BD; bloqueo por intentos fallidos.
- **Archivos**: almacenamiento local fuera de `/public`, servido solo tras comprobar sesión y organización; tipo detectado por firma de bytes.
- **PDF**: PDFKit con fuente DejaVu (incluye «Ω»). **Códigos**: bwip-js. **XLSX**: ExcelJS. **CSV**: PapaParse.

Detalle y decisiones en [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

### Sobre Supabase

El prompt sugería Supabase (PostgreSQL, Auth y Storage). En el entorno de desarrollo no había un proyecto Supabase disponible, así que se ha construido sobre **PostgreSQL estándar** de forma que:

- **Base de datos**: funciona tal cual sobre el PostgreSQL de un proyecto Supabase (use la cadena de conexión directa del rol `postgres` como `MIGRATION_DATABASE_URL`; el script crea el rol `esd_app`).
- **Auth**: se usa autenticación propia (no Supabase Auth). Integrar Supabase Auth requeriría mapear `auth.uid()` a `app.user_id` en las políticas; no está hecho.
- **Storage**: solo existe el driver local. Un driver S3/Supabase Storage es un punto de extensión documentado (`src/lib/server/storage.ts`), **no implementado**.

No se ha verificado contra ningún servicio Supabase real.

## Arranque local

Requisitos: Node.js ≥ 20.12 (probado con 22), PostgreSQL ≥ 14 (probado con 16).

```bash
cd esd-control
npm install

# 1) Base de datos (una vez). Ejemplo con un superusuario local:
sudo -u postgres psql -c "CREATE ROLE esd_owner LOGIN PASSWORD 'cambie-esto' CREATEROLE;"
sudo -u postgres psql -c "CREATE DATABASE esd OWNER esd_owner;"

# 2) Configuración
cp .env.example .env        # y edite contraseñas/URL

# 3) Esquema (crea el rol esd_app con APP_DB_PASSWORD y aplica migraciones)
npm run db:migrate

# 4a) Primera organización y administrador (producción)
BOOTSTRAP_ORG_NAME="Mi Empresa" BOOTSTRAP_ORG_SLUG=mi-empresa \
BOOTSTRAP_ADMIN_EMAIL=admin@empresa.com BOOTSTRAP_ADMIN_NAME="Admin" \
BOOTSTRAP_ADMIN_PASSWORD='Una-Contraseña-Larga-1' npm run db:bootstrap
#   o 4b) datos de demostración (solo desarrollo)
DEMO_SEED_ENABLED=true DEMO_PASSWORD='Demo-ESD-2026!' npm run db:seed:demo

# 5) Desarrollo
npm run dev                 # http://localhost:3000
```

La organización nueva incluye roles del sistema, categorías base **sin criterios**, gravedades de NC, una plantilla de etiqueta y la ubicación raíz. Siguiente paso: Administración › Criterios y procedimientos.

## Variables de entorno

Ver [`.env.example`](.env.example). Resumen:

| Variable | Uso |
|---|---|
| `DATABASE_URL` | Conexión de la app con el rol `esd_app`. |
| `MIGRATION_DATABASE_URL` | Propietario del esquema; solo scripts (migraciones, bootstrap, seed). Nunca en el servidor web. |
| `APP_DB_PASSWORD` | Contraseña que el script asigna a `esd_app` (debe coincidir con `DATABASE_URL`). |
| `APP_URL` | URL pública; se codifica en los QR (`<APP_URL>/a/<código>`). |
| `COOKIE_SECURE` | `true` en producción (HTTPS). |
| `SESSION_TTL_HOURS` | Duración de la sesión (por defecto 12 h). |
| `STORAGE_DRIVER` / `STORAGE_DIR` | `local` y ruta del almacenamiento (persistente y con copia de seguridad). |
| `MAX_UPLOAD_MB` | Tamaño máximo de subida (por defecto 20). |
| `CRON_SECRET` | Secreto (≥16 caracteres) de `POST /api/cron/alerts`. |
| `DB_POOL_MAX` | Conexiones máximas del pool (por defecto 15). |
| `BOOTSTRAP_*` | Alta inicial de organización y administrador. |
| `DEMO_SEED_ENABLED`, `DEMO_PASSWORD` | Seed de demostración (desactivado por defecto). |

## Datos de demostración

`npm run db:seed:demo` crea una organización **separada** («Demo Electrónica S.A. (DEMO)», `is_demo = true`) con 41 activos, ~110 mediciones históricas, instrumentos (uno caducado), un plano con 16 puntos y ruta, dos campañas y NC. La interfaz muestra un aviso permanente y los PDF llevan la marca «DATOS DE DEMOSTRACIÓN». Los criterios del seed son **ilustrativos**. Usuarios: `admin@`, `responsable@`, `tecnico@`, `tecnico2@`, `auditor@`, `consulta@demo.local` con `DEMO_PASSWORD`.

No ejecute el seed en producción (requiere `DEMO_SEED_ENABLED=true` explícito).

## Pruebas y calidad

```bash
npm run lint          # ESLint (next/core-web-vitals + TypeScript)
npm run typecheck     # tsc --noEmit
npm test              # Vitest: unitarias + integración contra PostgreSQL (esd_test)
npm run build
npm run test:e2e      # Playwright: requiere build; recrea la BD esd_e2e y aplica el seed demo
```

- **Unitarias** (`tests/unit`): decimal exacto, unidades, motor de criterios (límites, inclusivos/exclusivos, multipunto, combinado, instrumento, sin criterio), periodicidad (igual que PostgreSQL), coordenadas de plano y matriz de imagen en 4 rotaciones, lector HID, normalización de QR, etiquetas/ZPL, validación de importación, dimensiones de imagen.
- **Integración** (`tests/integration`, BD real): aislamiento RLS entre organizaciones, permisos por rol, inmutabilidad de mediciones y auditoría, invalidación, idempotencia offline, NC automática, política de instrumento, criterio cambiado, cierre de NC y de campaña, bloqueo de plano, importación atómica, multipunto con plantilla, campañas, informes PDF y etiquetas.
- **E2E** (`tests/e2e`): login, alta de activo y etiqueta, lectura HID y entrada manual, medición y resultado, historial, NC con verificación, campaña, medición sobre plano, exportación PDF/XLSX, permisos del rol Consulta y QR protegido.

Bases de datos de prueba (créelas una vez; sus esquemas se recrean en cada ejecución):

```bash
sudo -u postgres psql -c "CREATE DATABASE esd_test OWNER esd_owner;"
sudo -u postgres psql -c "CREATE DATABASE esd_e2e OWNER esd_owner;"
```

Por defecto los tests usan `esd_owner` / `esd_owner_dev` y `esd_app` / `esd_app_dev` en localhost; configúrelos con `TEST_MIGRATION_DATABASE_URL`, `TEST_APP_DB_PASSWORD`, `TEST_DATABASE_URL` y `E2E_*` (ver `tests/integration/env.ts` y `playwright.config.ts`, o un archivo `.env.test`). El rol `esd_app` es común al clúster: use la misma contraseña en desarrollo y tests o clústeres distintos. `SKIP_DB_TESTS=1` omite la integración.

## Despliegue

Cualquier plataforma Node.js con disco persistente (VM, contenedor, PaaS con volumen) y un PostgreSQL gestionado.

**Railway:** guía paso a paso en [`docs/DESPLIEGUE_RAILWAY.md`](docs/DESPLIEGUE_RAILWAY.md). Incluye `Dockerfile`, `railway.json` (migración previa al despliegue y comprobación de salud en `/api/health`) y `railway.cron.json` (alertas diarias).

Pasos genéricos:

1. `npm ci && npm run build`
2. Variables de entorno de producción (`COOKIE_SECURE=true`, `APP_URL` con https, secretos fuertes, `DEMO_SEED_ENABLED=false`).
3. `npm run db:migrate` (con `MIGRATION_DATABASE_URL`) en cada despliegue; las migraciones aplicadas no se pueden editar (se verifica su checksum).
4. `npm run db:bootstrap` la primera vez.
5. `npm start` (escucha en `PORT`, 3000 por defecto) detrás de un proxy inverso con HTTPS. `GET /api/health` sirve como comprobación de salud.
6. Tarea programada (p. ej. cada hora): `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://.../api/cron/alerts` o `npm run jobs:alerts`.
7. Copias de seguridad de la BD **y** de `STORAGE_DIR` (ver abajo).

Plataformas sin disco persistente (p. ej. funciones serverless) requieren implementar antes un driver de almacenamiento externo.

## Lector de códigos, etiquetas y Zebra

- **Lectores HID**: en Medición rápida la captura global detecta secuencias rápidas (por defecto ≤ 50 ms entre teclas) terminadas en el sufijo configurado (Enter, Tab o ninguno), elimina un prefijo opcional y **no actúa cuando el foco está en otro campo**. Siempre está disponible el campo visible. El botón ⚙ permite ajustar el lector y probar una lectura en el propio dispositivo.
- **Cámara**: `@zxing/browser` (requiere HTTPS o localhost y permiso). No se ha probado con cámaras físicas en este entorno.
- **QR**: contiene solo `<APP_URL>/a/<código de escaneo>`; abrirlo exige iniciar sesión y solo resuelve activos de la organización del usuario.
- **Zebra/ZPL**: «ZPL» descarga un archivo `.zpl` (ZPL II, UTF-8 con `^CI28`). Envíelo a la impresora, por ejemplo `nc <ip-impresora> 9100 < etiquetas.zpl` o con la utilidad del fabricante. La generación está cubierta por tests; **no se ha probado con una impresora física**.

## Trabajo sin conexión

- Las mediciones que no pueden enviarse se guardan en una **cola en IndexedDB** con un `clientId` (UUID); el servidor es idempotente por ese ID, así que reenviar nunca duplica.
- La interfaz indica claramente «Guardada en este dispositivo — NO registrada todavía» y muestra un contador en la cabecera. Solo se elimina de la cola cuando el servidor confirma; los rechazos (4xx) quedan marcados para reintentar o descartar.
- El resultado mostrado sin conexión es **provisional**; el servidor recalcula y, si el criterio vigente cambió, lo marca «Requiere revisión».
- La cola es de cada técnico: solo se envían (y se muestran) las mediciones del usuario y organización con sesión iniciada; si otra persona entra en el mismo dispositivo, no se le atribuyen.
- Solo se guardan sin conexión los activos ya consultados en el dispositivo (se borran al cerrar sesión). Las mediciones con foto requieren conexión (la foto no se guarda en la cola).
- El service worker solo cachea recursos estáticos; **no** guarda páginas ni respuestas de API (evita mostrar datos de un usuario a otro). Por eso la página de medición debe estar abierta antes de perder la conexión.
- **Limitación**: no se puede abrir la aplicación desde cero sin conexión, y no hay descarga masiva previa de inventario para trabajar sin conexión desde cero, ni sincronización de otros módulos.

## Seguridad

- RLS por organización en todas las tablas; permisos por rol aplicados en servidor y en políticas (`app_has_permission`).
- Sesiones y hashes de contraseña inaccesibles para el rol de la app (funciones `SECURITY DEFINER` acotadas).
- CSRF: Server Actions protegidas por Next.js (Origin/Host); las rutas API mutables comprueban `Origin`.
- Cabeceras: CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- Subidas: límite de tamaño, tipo por firma de bytes (PDF/PNG/JPG), nombres saneados, claves de almacenamiento generadas por el servidor, descarga con `Content-Disposition` y CSP `sandbox`.
- CSV/XLSX: neutralización de fórmulas (`=`, `+`, `-`, `@`).
- Logs JSON sin contraseñas, tokens ni valores de formularios.
- Bloqueo de cuenta tras 5 intentos fallidos (15 min) y limitador por IP.

## Copias de seguridad y recuperación

Resumen (detalle en [`docs/OPERACION.md`](docs/OPERACION.md)):

- **Base de datos**: `pg_dump -Fc` diario + WAL/PITR del proveedor gestionado; conservar ≥ 30 días y copia fuera del sitio. Para restaurar: crear el rol `esd_app` **antes** de `pg_restore` (para que se restauren sus permisos), restaurar en una BD vacía y ejecutar `npm run db:migrate`, que además reaplica siempre `db/grants.sql`. Pasos completos en `docs/OPERACION.md`.
- **Archivos** (`STORAGE_DIR`): copia incremental diaria (rsync/restic). La tabla `documents` guarda el SHA-256 de cada archivo para verificar integridad tras restaurar.
- **Auditoría**: solo inserción; los eventos antiguos pueden moverse a `audit_log_archive` con `select audit_archive_before('AAAA-MM-DD')` (rol propietario), sin perder la consulta.
- Pruebe la restauración periódicamente en un entorno aislado.

## Limitaciones conocidas

- Correo electrónico de notificaciones **no implementado** (solo notificaciones en la aplicación; no se simulan envíos).
- Almacenamiento solo local; sin driver S3/Supabase Storage.
- Sin Supabase Auth ni SSO; autenticación propia por correo y contraseña. Sin 2FA.
- Ámbito de permisos por organización (no por planta dentro de la organización).
- Cámara y ZPL no probados con hardware real.
- Sin borradores de medición en servidor (los borradores son locales al dispositivo, 24 h).
- Offline parcial (ver sección correspondiente).
- Interfaz solo en español; zona horaria de presentación Europe/Madrid.
- Los planos PDF se rasterizan en el navegador (2400 px de ancho por página); PDFs con más de 30 páginas se rechazan.
