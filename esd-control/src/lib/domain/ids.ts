/** Siguiente identificador `${prefijo}${n}` que no esté ya en uso (evita duplicados tras borrar). */
export function nextFreeId(prefix: string, used: readonly string[]): string {
  const set = new Set(used.map((u) => u.toUpperCase()));
  let n = used.length + 1;
  while (set.has(`${prefix}${n}`.toUpperCase())) n++;
  return `${prefix}${n}`;
}
