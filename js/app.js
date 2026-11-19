// Mi Campito · arranque y navegación
import { alCambiar } from './db.js';
import { D, recargar } from './estado.js';
import { cargarCatalogo } from './calc.js';
import { ico, esc, $ } from './ui.js';
import { pantallaFincas, pantallaFinca, pantallaEditarFinca, pantallaEditarSector, pantallaSector } from './fincas.js';
import { pantallaAnotar, pantallaRegistro, pantallaHistorial } from './registros.js';
import { pantallaHoy, pantallaCalendario, pantallaRiego, pantallaAbonado, pantallaCuaderno, pantallaCosecha, pantallaCuentas, pantallaAvisos } from './informes.js';
import { pantallaVariedades, pantallaVariedad, pantallaPlagas, pantallaPatrones } from './catalogo.js';
import { pantallaAjustes, pantallaAyuda, aplicarTema, refrescarSync } from './ajustes.js';
import { iniciarSync, alSincronizar, estado as sync, sesion } from './sync.js';

const main = $('main');

const MAS = [
  ['riego', '💧', 'Riego', 'Cuánto regar con el tiempo real'], ['abonado', '🧪', 'Abonado', 'Plan del año por meses'],
  ['cuaderno', '📒', 'Cuaderno de campo', 'Tratamientos, imprimir o PDF'], ['cosecha', '🍊', 'Cosecha y madurez', 'Kilos, precios y muestreos'],
  ['cuentas', '💶', 'Cuentas', 'Gastos e ingresos por finca'], ['historial', '🗂️', 'Historial', 'Todo lo anotado'],
  ['avisos', '📢', 'Avisos oficiales', 'Sanidad vegetal'], ['variedades', '🌳', 'Variedades', 'Catálogo de cítricos'],
  ['plagas', '🔎', 'Plagas', 'Qué vigilar cada mes'], ['patrones', '🌱', 'Patrones', 'Portainjertos y suelo'],
  ['ajustes', '⚙️', 'Ajustes', 'Copia de seguridad y datos'], ['ayuda', '❓', 'Ayuda', 'Cómo funciona']
];
const pantallaMas = () => main.innerHTML = `<h1>Más</h1><div class="menu">${MAS.map(([k, e, n, d]) => `<a href="#/${k}"><span class="e">${e}</span><b>${n}</b><small class="mu">${d}</small></a>`).join('')}</div>`;

const RUTAS = {
  hoy: () => pantallaHoy(main),
  fincas: () => pantallaFincas(main),
  finca: id => pantallaFinca(id, main),
  'finca-editar': id => pantallaEditarFinca(id, main),
  sector: id => pantallaSector(id, main),
  'sector-editar': (id, q) => pantallaEditarSector(id, q, main),
  anotar: (id, q) => main.innerHTML = pantallaAnotar(q),
  registro: (id, q) => pantallaRegistro(id, q, main),
  historial: (id, q) => main.innerHTML = pantallaHistorial(q),
  calendario: () => pantallaCalendario(main),
  riego: () => pantallaRiego(main),
  abonado: () => pantallaAbonado(main),
  cuaderno: (id, q) => pantallaCuaderno(main, q),
  cosecha: () => pantallaCosecha(main),
  cuentas: (id, q) => pantallaCuentas(main, q),
  avisos: () => pantallaAvisos(main),
  variedades: (id, q) => pantallaVariedades(main, q),
  variedad: id => pantallaVariedad(id, main),
  plagas: () => pantallaPlagas(main),
  patrones: () => pantallaPatrones(main),
  ajustes: () => pantallaAjustes(main),
  ayuda: () => pantallaAyuda(main),
  mas: pantallaMas
};
const PESTANA = { hoy: 'hoy', fincas: 'fincas', finca: 'fincas', sector: 'fincas', 'finca-editar': 'fincas', 'sector-editar': 'fincas', anotar: 'anotar', registro: 'anotar', calendario: 'calendario' };

function ruta() {
  const h = location.hash.replace(/^#\/?/, '').split('#')[0];
  const [camino, qs] = h.split('?');
  const [nombre, id] = camino.split('/');
  return { nombre: nombre || 'hoy', id: id && decodeURIComponent(id), q: Object.fromEntries(new URLSearchParams(qs || '')) };
}

// Pantallas con formularios: no se repintan solas al llegar datos de otro dispositivo
const EDITANDO = ['registro', 'finca-editar', 'sector-editar', 'ajustes', 'anotar'];
// Icono de la nube en la cabecera
function nube() {
  const a = $('#nube'); if (!a) return;
  a.hidden = !sesion();
  a.textContent = sync.ocupado ? '🔄' : sync.error ? '⚠️' : '☁️';
  a.title = sync.ocupado ? 'Sincronizando…' : sync.error || 'Sincronizado';
  a.setAttribute('aria-label', a.title);
}

let pintando = false;
async function pintar() {
  const r = ruta(), f = RUTAS[r.nombre] || RUTAS.hoy;
  const tab = PESTANA[r.nombre] || 'mas';
  document.querySelectorAll('nav.tabs a').forEach(a => a.classList.toggle('on', a.dataset.t === tab));
  pintando = true;
  try { await f(r.id, r.q); }
  catch (e) { console.error(e); main.innerHTML = `<div class="card"><h2>Algo ha fallado</h2><p class="mu">${esc(e.message)}</p><a class="btn" href="#/hoy">Volver al inicio</a></div>`; }
  pintando = false;
}

function navegacion() {
  const t = [['hoy', 'hoy', 'Hoy'], ['fincas', 'fincas', 'Fincas'], ['anotar', 'mas', 'Anotar'], ['calendario', 'cal', 'Calendario'], ['mas', 'menu', 'Más']];
  $('nav.tabs').innerHTML = t.map(([k, i, n]) => k === 'anotar'
    ? `<a href="#/anotar" data-t="anotar" class="mas" aria-label="Anotar"><span class="ico">${ico(i)}</span>${n}</a>`
    : `<a href="#/${k}" data-t="${k}">${ico(i)}${n}</a>`).join('');
}

async function arrancar() {
  navegacion();
  await Promise.all([cargarCatalogo(), recargar()]);
  aplicarTema();
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); pintar(); });
  // Si cambian los datos en otra pestaña o tras importar, recargar la memoria
  alCambiar(async () => { await recargar(); });
  await iniciarSync();
  alSincronizar(n => {
    nube();
    refrescarSync();
    if (n) { aplicarTema(); if (!EDITANDO.includes(ruta().nombre)) pintar(); }
  });
  nube();
  await pintar();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => { });
}
arrancar().catch(e => { main.innerHTML = `<div class="card"><h2>No se ha podido arrancar</h2><p>${esc(e.message)}</p></div>`; });
