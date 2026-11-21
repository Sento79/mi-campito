# Arquitectura de ESD Control

## Visión general

```
Navegador (tablet / PC / móvil)
 ├─ Next.js App Router (React 19, Server Components + Client Components)
 │   ├─ Páginas de servidor: consultan PostgreSQL con contexto RLS
 │   ├─ Server Actions (defineAction): sesión → permiso → Zod → transacción RLS → auditoría
 │   └─ Rutas /api: exportaciones, PDF, etiquetas, archivos, sincronización offline, cron
 ├─ IndexedDB: cola de mediciones offline + caché de activos consultados
 └─ Service worker: solo estáticos (_next/static); nunca páginas ni datos

PostgreSQL
 ├─ Rol propietario (migraciones/scripts)  ── crea ──►  rol esd_app (LOGIN, sin BYPASSRLS)
 ├─ RLS en todas las tablas con org_id
 ├─ Funciones SECURITY DEFINER acotadas (auth, sesiones, contadores, resúmenes, alertas)
 └─ Disparadores de integridad (mediciones, criterios, NC, campañas, planos, auditoría)

Almacenamiento de archivos (local, fuera de /public) ── servido por /api/files/[id] tras RLS
```

## Estructura del código

```
db/migrations/           SQL versionado (checksum verificado por scripts/migrate.ts)
scripts/                 migrate, bootstrap-admin, seed-demo, run-alerts, png (plano demo)
src/lib/domain/          Lógica pura y probada: decimal, unidades, criterios, periodicidad,
                         coordenadas, lector HID, etiquetas/ZPL, importación, permisos, ajustes
src/lib/server/          db (pool + withCtx), auth, action, api, audit, storage, pdf, labels,
                         reports, alerts, parse-sheet, services/*, queries/*
src/lib/client/outbox.ts Cola offline (IndexedDB)
src/components/          UI (core/client), shell (sidebar, cabecera, búsqueda, avisos), gráficas
src/app/(app)/           Páginas autenticadas por módulo
src/app/api/             Rutas API
tests/unit|integration|e2e
```

## Decisiones principales

### PostgreSQL + RLS con rol de aplicación sin privilegios
La aplicación nunca se conecta como propietaria. Cada petición abre una transacción y ejecuta
`set_config('app.org_id', …, true)` y `set_config('app.user_id', …, true)`. Las políticas exigen
`org_id = app_current_org()` y pertenencia activa (`app_is_member()`), y las de escritura
`app_any_permission(...)`. Falsear `app.org_id` no sirve: la pertenencia se comprueba en BD.
Con RLS, una actualización no autorizada afecta 0 filas sin error: los servicios lo comprueban
(`returning id`) y devuelven 403.

**Regla importante**: dentro de `withCtx` usar siempre la `tx` recibida. Pedir otra conexión al
pool desde dentro de una transacción provocó interbloqueos con peticiones concurrentes (corregido;
además hay `statement_timeout` e `idle_in_transaction_session_timeout`).

### Mediciones inalterables
- `measurements_guard`: una medición `final` solo puede pasar a `invalidated` rellenando los
  campos de invalidación; cualquier otro cambio o borrado falla (incluso para el propietario).
- `measurement_values_guard`: valores inmutables.
- Cada medición guarda: valor original tecleado y su unidad, valor normalizado y unidad del
  criterio, `criterion_version_id`, **copia de las reglas** (`rules_snapshot`), procedimiento y
  revisión, instantánea de calibración del instrumento, hora del servidor y del dispositivo,
  explicación del resultado e ID de idempotencia.
- Repetición = nueva medición con `repeats_measurement_id` y `attempt_number`.

### Motor de criterios (src/lib/domain/criteria.ts)
- Números como `coef × 10^-scale` con BigInt: sin errores de coma flotante.
- Formatos aceptados: `1500000`, `1.5e6`, `1,5E+6`, `1,5·10^6`, `1.5x10^6`. Texto libre → incompleto.
- Unidades: solo conversiones exactas por potencias de 10 dentro de la misma magnitud; cada
  criterio declara qué unidades de entrada acepta.
- Conservador: sin criterio → «Requiere revisión»; datos ausentes → «Incompleto»; instrumento
  no válido → bloqueo, revisión o aviso según política (un no conforme nunca se oculta).
- El cliente evalúa como **vista previa**; el servidor recalcula siempre con el criterio vigente.
  Si el criterio cambió entre pantalla y guardado, el resultado pasa a «Requiere revisión».

### Criterios versionados
`criteria` (familia) + `criterion_versions` (borrador → vigente → sustituida/retirada). Las
versiones publicadas son inmutables (disparador) y solo una puede estar vigente (índice único
parcial). Publicar registra aprobador, fecha y motivo.

### Referencias entre organizaciones
Las claves foráneas comprueban existencia pero **no** ven RLS. El disparador genérico
`app_check_refs('columna:tabla', …)` (migración 0006) exige que toda referencia apunte a una fila de la
misma organización. Las funciones `SECURITY DEFINER` internas (recálculo de resúmenes) no son ejecutables
por `esd_app`; `db/grants.sql` define la lista exacta de funciones invocables.

### Periodicidad
`app_period_interval` en SQL y `addPeriod` en TS siguen la misma regla (fin de mes recortado).
`next_due_at` = última medición conforme + periodo; si el último resultado no es conforme, la
medición vence inmediatamente. Lo mantienen disparadores `SECURITY DEFINER`, de modo que el técnico
no necesita permiso de edición sobre activos.

### Planos
Las páginas se guardan como imagen (PDF rasterizado en el navegador con pdf.js; se conserva el
original). Los puntos usan coordenadas normalizadas 0–1 de la imagen de página, independientes de
zoom, ventana y resolución. `normToScreen`/`screenToNorm`/`imageMatrix` (probadas en 4 rotaciones)
garantizan que imagen y marcadores coinciden. Durante una campaña en curso, crear/mover/archivar
puntos exige `app.layout_override` (la app solo lo activa tras confirmación con motivo, auditado).

### Navegación (Next.js)
- `src/components/link.tsx`: enlaces sin precarga automática (páginas dinámicas por sesión).
- Cada sección y cada segmento de detalle tiene `loading.tsx`. En el build de producción se observó
  que algunas navegaciones lista → detalle dentro de la misma sección no llegaban a confirmarse
  (sin errores, con la respuesta RSC recibida). Con un límite de Suspense por segmento no se
  reproduce (24/24 navegaciones verificadas). No se ha identificado la causa interna exacta.

### Alertas
- En vivo: `computeAlerts` (página /alertas, dashboard).
- Notificaciones: `app_generate_alert_notifications()` (SECURITY DEFINER) genera avisos para
  responsables (o administradores/responsables ESD si no hay responsable), con deduplicación
  semanal. Se invoca desde `/api/cron/alerts` (secreto) o `npm run jobs:alerts`.

### Multi-organización
Todas las tablas llevan `org_id`. Un usuario puede pertenecer a varias organizaciones y cambiar
desde el menú de perfil (la sesión se recrea). Los datos de demostración viven en su propia
organización marcada `is_demo`.

## Modelo de datos (resumen)

| Área | Tablas |
|---|---|
| Identidad | organizations, users, memberships, roles, role_permissions, permissions, sessions |
| Estructura | locations (árbol), categories, point_templates, point_template_items |
| Criterios | procedures, criteria, criterion_versions |
| Activos | assets, documents |
| Instrumentos | instruments, calibrations |
| Planos | floor_plans, floor_plan_versions, floor_plan_pages, plan_points |
| Campañas | campaigns, campaign_items, campaign_technicians, campaign_categories |
| Mediciones | measurements, measurement_values |
| NC | nc_severities, nonconformities, nc_links, nc_actions, nc_status_history |
| Otros | label_templates, notifications, org_counters, audit_log, audit_log_archive |

JSON solo para configuración flexible validada con Zod: `organizations.settings`,
`criterion_versions.rules`, `measurements.rules_snapshot/instrument_snapshot/result_explanation`,
`label_templates.layout` y los antes/después de auditoría.

## Archivado y conservación

- Activos, instrumentos, planos y puntos se **archivan** (`archived_at`), nunca se borran si tienen historial
  (restricciones `on delete restrict`).
- Mediciones: nunca se borran; se invalidan.
- Auditoría: solo inserción; `audit_archive_before(fecha)` mueve eventos a `audit_log_archive`
  (también de solo lectura) para mantener ágil la tabla principal.
