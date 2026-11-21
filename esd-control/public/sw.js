/*
 * Service worker de ESD Control.
 * Estrategia: precachea la página de medición rápida y los recursos estáticos
 * (_next/static) para poder abrir la app sin conexión. Las respuestas de API y
 * de datos NUNCA se cachean aquí (privacidad y frescura); los datos offline
 * viven en IndexedDB (src/lib/client/outbox.ts), limitados a lo consultado.
 */
const CACHE = "esd-shell-v1";
const SHELL = ["/medicion", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // nunca cachear datos
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })));
    return;
  }
  if (req.mode === "navigate" && url.pathname === "/medicion") {
    // Red primero; si no hay conexión, la última versión de la página de medición
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("/medicion", copy)); return res; })
        .catch(() => caches.match("/medicion").then((r) => r || new Response("Sin conexión", { status: 503 }))),
    );
  }
});
