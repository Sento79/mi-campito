import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * Enlace interno sin precarga automática por defecto.
 * Todas las páginas son dinámicas y dependen de la sesión; la precarga por
 * viewport de Next.js lanzaba decenas de peticiones RSC por pantalla (tablas
 * de 30+ filas, menú) y, bajo esa carga, se observaron clics que no llegaban
 * a navegar. Sin precarga, la página se pide al hacer clic (≈30 ms en local).
 */
export default function Link({ prefetch = false, ...props }: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={prefetch} {...props} />;
}
