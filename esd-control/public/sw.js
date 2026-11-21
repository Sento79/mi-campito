/*
 * Service worker de ESD Control.
 * Solo cachea recursos estáticos con hash (_next/static) e iconos. NUNCA guarda
 * páginas HTML ni respuestas de API: contienen datos de un usuario y organización
 * concretos y podrían mostrarse a otra persona en el mismo dispositivo.
 * Los datos sin conexión viven en IndexedDB (src/lib/client/outbox.ts), separados
 * por usuario y organización.
 */
const CACHE = "esd-static-v2";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/icon.svg", "/manifest.webmanifest"]).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  // Elimina cachés anteriores (incluida la v1, que guardaba la página de medición)
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })));
  }
});
