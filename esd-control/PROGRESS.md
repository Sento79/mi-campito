# Estado del proyecto ESD Control

Última actualización: 2026-11-21.

## Resumen

Primera versión funcional completa del MVP y de la mayoría de módulos del alcance. Todo el código
está en `esd-control/` (proyecto independiente dentro del repositorio `mi-campito`).

## Completado

- [x] Proyecto Next.js 15 + TypeScript + Tailwind 4; ESLint, Vitest, Playwright.
- [x] Esquema PostgreSQL versionado (5 migraciones), RLS en todas las tablas, rol `esd_app`.
- [x] Autenticación propia, sesiones, bloqueo por intentos, roles y permisos granulares.
- [x] Motor de criterios exacto (numérico, selección, checklist, multipunto, combinado) + unidades.
- [x] Dashboard con KPI enlazados, gráficas, filtros y bloques personalizables.
- [x] Inventario (CRUD, archivado, duplicado, documentos, importación atómica, exportación).
- [x] Categorías con plantillas multipunto; jerarquía flexible de ubicaciones.
- [x] Medición rápida (HID, cámara, manual, vista previa, repetición, NC automática, modo ruta).
- [x] Cola offline idempotente + service worker + caché de activos consultados.
- [x] Historial inalterable con invalidación y exportación.
- [x] Planos (PDF/PNG/JPG, versiones, visor, puntos, rutas, bloqueo por campaña, PNG/PDF).
- [x] Campañas (6 modos de creación, estados, pausa, omisión, cierre trazable).
- [x] No conformidades (flujo, acciones, adjuntos, verificación obligatoria).
- [x] Instrumentos y calibraciones con certificados y política de uso.
- [x] Etiquetas (diseñador, PDF hoja/rollo, QR protegido, Code 128, ZPL).
- [x] Informes PDF (8 tipos) y exportaciones XLSX/CSV.
- [x] Alertas en vivo + notificaciones programadas idempotentes.
- [x] Administración: criterios versionados, procedimientos, usuarios/roles, configuración, auditoría, perfil.
- [x] Seed de demostración en organización separada.
- [x] Tests: 129 unitarios/integración, 9 E2E; lint, typecheck y build limpios.
- [x] Documentación: README, ARQUITECTURA, OPERACION.

## Pendiente / siguientes pasos sugeridos

1. **Notificaciones por correo** con un proveedor real (SMTP/API) detrás de la configuración existente.
2. **Driver de almacenamiento S3/Supabase Storage** para despliegues sin disco persistente.
3. **Ámbito de permisos por planta** (además de por organización).
4. **Offline ampliado**: descarga previa de campaña/inventario para trabajar sin conexión desde cero.
5. **SSO / 2FA** (OIDC) y política de caducidad de contraseñas.
6. Pruebas con hardware real: cámaras de tablets, lectores HID concretos e impresoras Zebra.
7. Firma electrónica avanzada en informes si su sistema de calidad la requiere.
8. Investigar la causa interna del bloqueo de navegación de Next.js 15.5 (mitigado con `loading.tsx`).

## Comandos verificados en esta sesión

```bash
npm run db:migrate            # 5 migraciones aplicadas
npm run db:seed:demo          # 41 activos, 108 mediciones, 16 puntos
npm run lint                  # sin avisos
npm run typecheck             # sin errores
npm test                      # 129 tests OK (unit + integración con PostgreSQL 16)
npm run build                 # OK
npm run test:e2e              # 9 tests OK (ejecutado varias veces)
```

## Entorno usado

Node 22, PostgreSQL 16 local (bases `esd`, `esd_test`, `esd_e2e`, propietario `esd_owner`),
Chromium de Playwright 1.63. No se ha verificado contra Supabase ni otros servicios externos.

## Revisión PR #1 — ronda 2 (migración 0007)

- Funciones nuevas no ejecutables por PUBLIC por defecto; `grants.sql` es obligatorio en cada migración.
- Contraseñas de cuentas compartidas entre organizaciones: solo las cambia su titular. Revocar sesiones de otro usuario afecta solo a la organización actual.
- Comprobación de organización también en actualizaciones de tablas de enlace; `role_permissions` sin UPDATE.
- Resúmenes con `FOR NO KEY UPDATE` (sin interbloqueos con FK); punto de tipo activo solo con mediciones directas; recálculo al cambiar el activo o tipo del punto.
- Se guarda la entrada original (`measurements.raw_input`) aunque no haya criterio vigente.
- Cola offline: el servidor rechaza (409) mediciones guardadas por otro usuario/organización.
- Medición rápida: el reintento tras un resultado incierto reutiliza el `clientId`; la carga del siguiente elemento de ruta no pisa búsquedas posteriores.
- `next` de login: rechaza arrays y rutas que normalizan a `//host`.
- Altas/ediciones/importación de activos serializadas por organización; importación detecta ID igual a un código de escaneo anterior; ambigüedad de categoría y ubicación por separado.
- ZPL Code 128 con `>` literal.
- Verificado: lint, typecheck, 150 tests Vitest, build y 9 E2E.
