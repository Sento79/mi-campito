// SIGPAC (FEGA) y mapas del IGN. Servicios públicos sin cuenta.
const BASE = 'https://sigpac-hubcloud.es/servicioconsultassigpac/query/';

export const USOS = {
  CI: 'Cítricos', CF: 'Cítricos-frutales', CS: 'Cítricos-frutales de cáscara', CV: 'Cítricos-viñedo', FY: 'Frutales', FS: 'Frutos secos',
  OV: 'Olivar', VI: 'Viñedo', TA: 'Tierra arable', TH: 'Huerta', PA: 'Pasto arbolado', PR: 'Pasto arbustivo', PS: 'Pastizal',
  FO: 'Forestal', IM: 'Improductivo', ZU: 'Zona urbana', CA: 'Viales', AG: 'Agua', ED: 'Edificaciones', IV: 'Invernaderos', ZC: 'Zona concentrada', MT: 'Matorral'
};

function aRecinto(r) {
  return {
    ref: [r.provincia, r.municipio, r.agregado, r.zona, r.poligono, r.parcela, r.recinto].join('-'),
    provincia: +r.provincia, sup_ha: +r.superficie || 0, pendiente: r.pendiente_media != null ? +r.pendiente_media : null,
    altitud: r.altitud != null ? +r.altitud : null, uso: r.uso_sigpac || '', regadio: r.coef_regadio != null ? +r.coef_regadio : null,
    geo: wktAPoligono(r.wkt)
  };
}

export async function recintoEnPunto(lat, lng) {
  const r = await fetch(`${BASE}recinfobypoint/4258/${lng.toFixed(6)}/${lat.toFixed(6)}.json`);
  if (!r.ok) throw new Error('SIGPAC no responde (' + r.status + ')');
  const d = await r.json();
  if (!d || !d.length) throw new Error('Ahí no hay ningún recinto SIGPAC');
  return aRecinto(d[0]);
}

// ref: "46-149-0-0-89-5-1" (provincia-municipio-agregado-zona-polígono-parcela-recinto). Sin recinto, devuelve todos los de la parcela.
export async function recintosPorReferencia(ref) {
  const p = String(ref).trim().split(/[\s\-\/:.,]+/).filter(Boolean).map(Number);
  if (p.length === 5) p.splice(2, 0, 0, 0); // prov-mun-pol-par-rec
  if (p.length === 4) p.splice(2, 0, 0, 0); // prov-mun-pol-par
  if (p.length < 6 || p.some(isNaN)) throw new Error('La referencia debe ser provincia-municipio-polígono-parcela (y recinto si lo sabes)');
  const url = p.length >= 7 ? `${BASE}recinfo/${p.slice(0, 7).join('/')}.json` : `${BASE}recinfoparc/${p.slice(0, 6).join('/')}.json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('SIGPAC no responde (' + r.status + ')');
  const d = await r.json();
  if (!d || !d.length) throw new Error('No se encuentra esa referencia');
  return d.map(aRecinto);
}

// WKT POLYGON / MULTIPOLYGON -> [[[lat,lng],...]] (anillos exteriores)
export function wktAPoligono(wkt) {
  if (!wkt) return null;
  const anillos = [];
  const re = /\(\(([^()]+)\)/g; let m;
  while ((m = re.exec(wkt))) anillos.push(m[1].split(',').map(par => { const [x, y] = par.trim().split(/\s+/).map(Number); return [+y.toFixed(7), +x.toFixed(7)]; }));
  return anillos.length ? anillos : null;
}
export function centro(geo) {
  if (!geo || !geo[0]) return null;
  const a = geo[0]; let la = 0, ln = 0;
  for (const [y, x] of a) { la += y; ln += x; }
  return [la / a.length, ln / a.length];
}

// Comunidad autónoma por código de provincia
const CCAA = { 'Comunitat Valenciana': [3, 12, 46], 'Región de Murcia': [30], 'Andalucía': [4, 11, 14, 18, 21, 23, 29, 41], 'Cataluña': [8, 17, 25, 43], 'Illes Balears': [7], 'Canarias': [35, 38] };
export function comunidad(prov) { for (const [k, v] of Object.entries(CCAA)) if (v.includes(+prov)) return k; return prov ? 'Otra' : ''; }
export const PROVINCIA = { 3: 'Alicante', 12: 'Castellón', 46: 'Valencia', 30: 'Murcia', 4: 'Almería', 11: 'Cádiz', 14: 'Córdoba', 18: 'Granada', 21: 'Huelva', 23: 'Jaén', 29: 'Málaga', 41: 'Sevilla', 8: 'Barcelona', 17: 'Girona', 25: 'Lleida', 43: 'Tarragona', 7: 'Illes Balears', 35: 'Las Palmas', 38: 'Santa Cruz de Tenerife', 6: 'Badajoz', 10: 'Cáceres', 15: 'A Coruña', 36: 'Pontevedra' };

// Buscar municipio (Open-Meteo geocoding)
export async function buscarLugar(q) {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=es&countryCode=ES`);
  const d = await r.json();
  return (d.results || []).map(x => ({ nombre: x.name, zona: [x.admin2, x.admin1].filter(Boolean).join(', '), lat: x.latitude, lng: x.longitude }));
}

// Capas del mapa
export function capas(L) {
  const orto = L.tileLayer.wms('https://www.ign.es/wms-inspire/pnoa-ma', { layers: 'OI.OrthoimageCoverage', format: 'image/jpeg', maxZoom: 20, attribution: 'PNOA © IGN' });
  const base = L.tileLayer('https://www.ign.es/wmts/ign-base?service=WMTS&request=GetTile&version=1.0.0&format=image/png&layer=IGNBaseTodo&style=default&tilematrixset=GoogleMapsCompatible&tilematrix={z}&tilerow={y}&tilecol={x}', { maxZoom: 19, attribution: '© IGN' });
  const sigpac = L.tileLayer.wms('https://sigpac-hubcloud.es/wms', { layers: 'recinto', format: 'image/png', transparent: true, maxZoom: 20, minZoom: 15, attribution: 'SIGPAC © FEGA' });
  return { orto, base, sigpac };
}
