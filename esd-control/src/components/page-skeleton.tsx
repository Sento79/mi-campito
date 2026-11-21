import { Skeleton } from "@/components/ui/core";

/**
 * Esqueleto de carga. Cada sección y cada segmento de detalle tiene su propio
 * loading.tsx: además de dar respuesta inmediata, crea un límite de Suspense
 * por segmento. Sin él, en el build de producción se observaron navegaciones
 * lista → detalle dentro de la misma sección que no llegaban a confirmarse.
 */
export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Cargando">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}
