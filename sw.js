// Funciona sin conexión: la app se guarda en el dispositivo; mapas y clima se guardan al verlos.
const V = 'micampito-v2';
const APP = ['./', 'index.html', 'manifest.webmanifest', 'css/app.css', 'data/catalogo.json',
  'js/app.js', 'js/db.js', 'js/estado.js', 'js/calc.js', 'js/ui.js', 'js/sigpac.js', 'js/fincas.js', 'js/registros.js', 'js/informes.js', 'js/catalogo.js', 'js/ajustes.js', 'js/sync.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png', 'vendor/leaflet/images/marker-shadow.png', 'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png'];
const TESELAS = 'micampito-teselas';

self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(APP)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V && x !== TESELAS).map(x => caches.delete(x)))).then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Teselas de mapa: primero la guardada; se guardan hasta ~1500
  if (/ign\.es|sigpac-hubcloud\.es\/wms/.test(u.host + u.pathname)) {
    e.respondWith(caches.open(TESELAS).then(async c => {
      const r = await c.match(e.request);
      if (r) return r;
      const n = await fetch(e.request);
      if (n.ok) { c.put(e.request, n.clone()); c.keys().then(k => { if (k.length > 1500) k.slice(0, 200).forEach(x => c.delete(x)); }); }
      return n;
    }));
    return;
  }
  if (u.origin !== location.origin) return; // clima y SIGPAC: la app guarda su propia copia
  // Avisos: red primero
  if (u.pathname.endsWith('avisos-gva.json')) { e.respondWith(fetch(e.request).catch(() => caches.match(e.request))); return; }
  // App: la guardada primero y se actualiza por detrás
  e.respondWith(caches.open(V).then(async c => {
    const r = await c.match(e.request, { ignoreSearch: true });
    const n = fetch(e.request).then(x => { if (x.ok) c.put(e.request, x.clone()); return x; }).catch(() => r);
    return r || n;
  }));
});
