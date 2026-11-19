// Almacén local (IndexedDB). Cada registro lleva id, creado, mod y borrado (para sincronizar sin rehacer nada).
const NOMBRE = 'micampito', VERSION = 1;
export const TABLAS = ['fincas', 'sectores', 'registros'];
let _db;

function abrir() {
  if (_db) return Promise.resolve(_db);
  return new Promise((ok, mal) => {
    const r = indexedDB.open(NOMBRE, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const t of TABLAS) if (!d.objectStoreNames.contains(t)) d.createObjectStore(t, { keyPath: 'id' });
      if (!d.objectStoreNames.contains('fotos')) d.createObjectStore('fotos', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('ajustes')) d.createObjectStore('ajustes', { keyPath: 'k' });
      if (!d.objectStoreNames.contains('cache')) d.createObjectStore('cache', { keyPath: 'k' });
    };
    r.onsuccess = () => { _db = r.result; ok(_db); };
    r.onerror = () => mal(r.error);
  });
}

function tx(tabla, modo, fn) {
  return abrir().then(d => new Promise((ok, mal) => {
    const t = d.transaction(tabla, modo), s = t.objectStore(tabla);
    let res;
    Promise.resolve(fn(s)).then(v => { res = v; });
    t.oncomplete = () => ok(res);
    t.onerror = () => mal(t.error);
  }));
}
const req = r => new Promise((ok, mal) => { r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error); });

export const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const ahora = () => new Date().toISOString();

// Cambios en memoria para repintar sin recargar
const oyentes = new Set();
export const alCambiar = f => oyentes.add(f);
const avisar = t => Promise.all([...oyentes].map(f => f(t)));

export async function todos(tabla, conBorrados = false) {
  const v = await tx(tabla, 'readonly', s => req(s.getAll()));
  return conBorrados ? v : v.filter(x => !x.borrado);
}
export const uno = (tabla, id) => tx(tabla, 'readonly', s => req(s.get(id)));

export async function guardar(tabla, obj) {
  const o = { ...obj };
  if (!o.id) { o.id = nuevoId(); o.creado = ahora(); }
  o.mod = ahora();
  await tx(tabla, 'readwrite', s => req(s.put(o)));
  await avisar(tabla);
  return o;
}
export async function borrar(tabla, id) {
  const o = await uno(tabla, id);
  if (!o) return;
  o.borrado = true; o.mod = ahora();
  await tx(tabla, 'readwrite', s => req(s.put(o)));
  await avisar(tabla);
}
// Escribe tal cual (importación y sincronización): gana la versión con 'mod' más reciente
export async function fusionar(tabla, lista) {
  let n = 0;
  await tx(tabla, 'readwrite', async s => {
    for (const o of lista) {
      const a = await req(s.get(o.id));
      if (!a || (o.mod || '') > (a.mod || '')) { s.put(o); n++; }
    }
  });
  if (n) await avisar(tabla);
  return n;
}

// Ajustes (clave-valor)
export const leerAjuste = async (k, def) => { const r = await tx('ajustes', 'readonly', s => req(s.get(k))); return r ? r.v : def; };
export const ponerAjuste = (k, v) => tx('ajustes', 'readwrite', s => req(s.put({ k, v })));

// Caché de servicios externos (clima, avisos)
export async function cache(k, horas, cargar) {
  const r = await tx('cache', 'readonly', s => req(s.get(k)));
  if (r && Date.now() - r.t < horas * 3600e3) return r.v;
  try {
    const v = await cargar();
    await tx('cache', 'readwrite', s => req(s.put({ k, t: Date.now(), v })));
    return v;
  } catch (e) {
    if (r) return r.v; // sin conexión: devuelve lo último que hubo
    throw e;
  }
}

// Fotos (Blob)
export const guardarFoto = (id, blob, mod = ahora()) => tx('fotos', 'readwrite', s => req(s.put({ id, blob, mod })));
export const leerFoto = async id => { const r = await tx('fotos', 'readonly', s => req(s.get(id))); return r && r.blob; };
export const todasFotos = () => tx('fotos', 'readonly', s => req(s.getAll()));

export async function borrarTodo() {
  const d = await abrir();
  for (const t of [...TABLAS, 'fotos', 'ajustes', 'cache'])
    await new Promise(ok => { const x = d.transaction(t, 'readwrite'); x.objectStore(t).clear(); x.oncomplete = ok; });
  await avisar("*");
}
