# Mi Campito · Diseño (fase 0)

Fecha: 19/11/2026 · Estado: borrador para revisar

## 1. Qué es

Una app para llevar **cualquier finca de cítricos** de España: naranjas, mandarinas, limones, pomelos y limas. Cada agricultor da de alta sus fincas y la app le dice qué toca hacer en cada momento (riego, abonado, plagas, recolección) según **su variedad, su patrón, su zona y su clima**.

Es independiente de «Control Finca», que sigue igual. Se reutilizan ideas y cálculos que ya funcionan allí, reescritos de forma genérica.

Decisiones tomadas:
- **Usuarios:** cualquier agricultor (opción A) con sincronización opcional (opción B).
- **Cultivos:** naranjo, mandarino, limonero, pomelo y lima.
- **Nombre:** Mi Campito.

## 2. Arquitectura

| Pieza | Decisión |
|---|---|
| App | Web instalable (PWA): se abre en el navegador y se añade a la pantalla de inicio. Funciona sin cobertura. |
| Datos | En el propio móvil u ordenador (IndexedDB). Cada usuario solo ve lo suyo. |
| Copia de seguridad | Exportar e importar un archivo `.micampito` (JSON comprimido), con fotos incluidas. |
| Sincronización (B) | Opcional y posterior (fase 5). Cada registro lleva `id`, fecha de cambio y borrado lógico desde el principio, para poder sincronizar sin rehacer nada. **Decidido: Supabase, región UE (Fráncfort).** Ofrece inicio de sesión, base de datos con permisos por usuario y almacenamiento de fotos, y no obliga a abrir puertos en casa. Plan gratuito al empezar; si crece, se pasa al de pago o se migra a PocketBase en un servidor alquilado. |
| Catálogos | Ficheros de datos aparte: `variedades.json`, `patrones.json`, `plagas.json`, `regiones.json`. Una variedad nueva = una ficha nueva, sin programar. |
| Alojamiento | Para que otros la usen hace falta una dirección pública con HTTPS. **Decidido: GitHub Pages** (gratis, con historial público del código y publicación automática en cada cambio). El servidor de casa solo sirve para pruebas. |
| Código | HTML, CSS y JavaScript sin dependencias pesadas, igual que Control Finca, pero en varios archivos (núcleo, pantallas y cálculos). |

## 3. Servicios externos (comprobados el 19/11/2026)

Prueba con un punto cualquiera de la Comunitat Valenciana, simulando un navegador de otra web.

| Servicio | Para qué | ¿Funciona desde el navegador? |
|---|---|---|
| **SIGPAC** (FEGA): consulta por punto y por referencia; OGC API `recintos` y `cultivo_declarado` | Linde oficial, superficie, uso, pendiente y altitud a partir de la referencia catastral agraria o de un toque en el mapa | ✅ Sí (CORS `*`) |
| **PNOA** (IGN), servicio WMS | Foto aérea actual de la parcela | ✅ Sí (CORS `*`) |
| **Open-Meteo**, histórico y previsión | ETo FAO-56, lluvia, temperaturas, heladas y horas frío para las coordenadas de cada finca | ✅ Sí (CORS `*`) |
| **Avisos de tratamientos GVA** | Avisos oficiales de plagas | ❌ No (página web). Hace falta un pequeño proceso en un servidor que publique un `avisos.json`, como ya hace Control Finca. |
| Avisos de Murcia (SIAM), Andalucía (RAIF) y Cataluña | Avisos de otras regiones | Por estudiar en la fase 4 |
| Sentinel-2 (NDVI) | Vigor por satélite | Necesita servidor. Fase 5. |

Conclusión: **la app puede funcionar entera sin servidor** (opción A), salvo los avisos oficiales de plagas y el NDVI.

## 4. Modelo de datos

```
Explotación (titular, NIF opcional, región)
 └─ Finca (nombre, municipio, coordenadas, clima de la zona)
     └─ Sector o recinto (referencia SIGPAC, linde, superficie, suelo, pendiente)
         ├─ Plantación: variedad, patrón, año, marco (m × m), nº de filas, árboles por fila
         ├─ Riego: goteros por árbol, caudal, sector de riego, programa
         └─ Filas (opcional): árboles vivos, faltas, replantes, ancho de copa
Registros (todos con fecha, sector y, si se quiere, fila):
  riego · abonado · tratamiento (cuaderno de campo) · plaga vista · cosecha (kg, precio)
  gasto e ingreso · tarea · nota y foto · análisis (suelo, hoja, agua) · madurez (muestreo)
Catálogos: variedades · patrones · plagas y enfermedades · productos · regiones
```

## 5. Ficha de variedad (ejemplo de estructura)

```json
{
  "id": "clemenules",
  "nombre": "Clemenules",
  "especie": "mandarino",
  "grupo": "clementina",
  "floracion": [3, 4],
  "recoleccion": [11, 1],
  "madurez": { "im_min": null, "color_min": null, "fuente": "norma de comercialización" },
  "kc": [0.70, 0.70, 0.70, 0.68, 0.65, 0.65, 0.65, 0.65, 0.65, 0.68, 0.70, 0.70],
  "rdc": { "meses": [7, 8], "factor": 0.6 },
  "abonado": { "N": [...], "P": [...], "K": [...] },
  "rendimiento_ref_kg_ha": null,
  "rasgos": ["semillas con polinización cruzada", "sensible a clareta"],
  "plagas_clave": ["trips", "araña roja", "mosca de la fruta"],
  "fuentes": ["IVIA", "GVA", "MAPA"],
  "confianza": "orientativo"
}
```

Cada dato lleva su fuente. Lo que no esté bien documentado se marca como **«orientativo»**, y el usuario o su técnico pueden ajustar cualquier valor para su finca.

## 6. Catálogo inicial (≈55 variedades)

Meses de recolección **orientativos para la Comunitat Valenciana**; se verificarán uno a uno en la fase 2 y se ajustarán por zona.

| Grupo | Variedad | Recolección aprox. |
|---|---|---|
| Satsuma | Iwasaki | sep |
| | Okitsu | sep–oct |
| | Clausellina | sep–oct |
| | Owari | oct–nov |
| Clementina | Clemenrubí | sep–oct |
| | Oronules | oct |
| | Marisol | oct |
| | Arrufatina | oct–nov |
| | Esbal | oct–nov |
| | Clemenules | nov–ene |
| | Clemenpons | nov–dic |
| | Orogrande | nov–ene |
| | Hernandina | dic–feb |
| Híbridos de mandarina | Clemenvilla (Nova) | dic–ene |
| | Moncada | por verificar |
| | Tango | ene–mar |
| | Fortune | feb–mar |
| | Ortanique | feb–abr |
| | Nadorcott / Afourer | feb–abr |
| | Murcott | feb–mar |
| | Orri | feb–abr |
| | Leanri, Safor, Garbí | por verificar |
| Naranja Navel | Fukumoto | oct–nov |
| | Navelina | oct–ene |
| | Newhall | oct–dic |
| | Washington Navel | dic–feb |
| | Cara Cara | dic–feb |
| | Navel Late | feb–abr |
| | Lane Late | feb–may |
| | Powell, Chislett, Barnfield | mar–may |
| Naranja blanca | Salustiana | dic–mar |
| | Delta Seedless | mar–may |
| | Valencia Late | abr–jun |
| | Midknight | abr–jun |
| Naranja sanguina | Doble Fina | ene–mar |
| | Sanguinelli | feb–abr |
| Limón | Fino (Primofiori) | oct–feb |
| | Verna | feb–jul |
| | Eureka, Lisbon | casi todo el año |
| Pomelo | Star Ruby, Rio Red, Ruby Red, Marsh | nov–mar |
| Lima | Tahití (Persian) | jun–dic |

**Patrones:** Citrange Carrizo, Citrange Troyer, Citrumelo CPB 4475, Forner-Alcaide 5, Forner-Alcaide 517, Mandarino Cleopatra, Citrus macrophylla, Citrus volkameriana, Naranjo amargo. Datos: vigor, tolerancia a caliza, salinidad, asfixia, tristeza y efecto en tamaño y calidad del fruto.

## 7. Pantallas

1. **Hoy**: qué toca esta semana en cada finca (riego, abonado, plagas, madurez y tareas), con el tiempo.
2. **Mis fincas**: mapa con los lindes y una lista; alta con asistente.
3. **Sector**: ficha de la plantación, filas, árboles, fotos e historial.
4. **Calendario**: fases del cultivo de cada variedad y tareas del año.
5. **Riego**: necesidades FAO-56 con la ETo real de la zona, programa y balance de agua.
6. **Abonado**: plan anual según edad, producción esperada y análisis.
7. **Plagas y cuaderno**: lo visto, los tratamientos y el cuaderno de campo exportable.
8. **Cosecha y madurez**: muestreos, kilos, precios y comparativa por años.
9. **Gastos e ingresos**: rentabilidad por finca y por variedad.
10. **Variedades**: catálogo consultable con fichas y fuentes.
11. **Ajustes**: copia de seguridad, sincronización e idioma (castellano y valenciano).

## 8. Cálculos genéricos

- **Riego:** ETo diaria de Open-Meteo × Kc de la variedad × corrección por cobertura de copa, según el marco y el diámetro. Riego deficitario en la ventana de cada variedad. Balance de agua según el suelo.
- **Abonado:** unidades de N, P y K por árbol según edad y cosecha esperada, repartidas por meses según la ficha y corregidas con el análisis foliar.
- **Calendario:** fases de la ficha, desplazadas según la zona (altitud, latitud y grados-día de Open-Meteo).
- **Madurez:** aviso cuando se acerca la ventana de recolección y registro de muestreos (índice de madurez, color, calibre).
- **Plagas:** vigilancia según la época y la variedad, y avisos oficiales de la región cuando estén disponibles.

## 9. Qué se reutiliza de Control Finca

Riego FAO-56 y balance de agua, abonado con tabla de fertilizantes, cuaderno de campo, cosecha y gastos, alertas de «Hoy», mapa con foto aérea, dictado por voz, modo oscuro y estilo visual.

**No se reutiliza:** nada de lo propio de la finca original (linde, tiras, fotos históricas recortadas, tabla fija de ETo).

## 10. Riesgos y temas abiertos

- **Datos agronómicos:** son la parte más delicada. Hay que contrastar cada ficha con fuentes oficiales y marcar lo dudoso. Es el grueso de la fase 2.
- **Responsabilidad:** las recomendaciones son orientativas. La app debe decirlo, y el cuaderno de campo oficial lo firma el titular.
- **Productos fitosanitarios:** el registro oficial del MAPA cambia a menudo. Al principio se escribirán a mano; después se estudiará conectarlo.
- **Alojamiento y sincronización:** decididos (GitHub Pages y Supabase UE). Antes de activar la sincronización hará falta una política de privacidad, por el RGPD.
- **Privacidad:** los datos de cada agricultor no salen de su dispositivo, salvo que active la sincronización.

## 11. Fases

| Fase | Entrega |
|---|---|
| 0 · Diseño | Este documento y la comprobación de servicios ✅ |
| 1 · Base | App instalable: alta manual de fincas y sectores, registros (riego, abonado, cuaderno, cosecha, gastos, notas), copia de seguridad |
| 2 · Catálogo | Fichas verificadas de variedades, patrones y plagas, con fuentes |
| 3 · Asistente | Alta con SIGPAC, foto PNOA y clima Open-Meteo, y cálculos automáticos |
| 4 · Avisos | Avisos oficiales GVA y después otras regiones |
| 5 · Extras | Sincronización, NDVI, cuaderno oficial en PDF, valenciano |
