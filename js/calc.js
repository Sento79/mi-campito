// Catálogo y cálculos agronómicos (orientativos). Fuentes: FAO-56, IVIA.
import { cache } from './db.js';

export let CAT = null;
export async function cargarCatalogo() {
  if (CAT) return CAT;
  const r = await fetch('data/catalogo.json');
  CAT = await r.json();
  CAT.V = Object.fromEntries(CAT.variedades.map(v => [v.id, v]));
  CAT.P = Object.fromEntries(CAT.patrones.map(v => [v.id, v]));
  CAT.PL = Object.fromEntries(CAT.plagas.map(v => [v.id, v]));
  CAT.F = Object.fromEntries(CAT.fertilizantes.map(v => [v.id, v]));
  return CAT;
}

export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const MES3 = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Meses (1-12) de a a b, dando la vuelta al año si hace falta
export function mesesEntre(a, b) { const o = []; let m = a; for (let i = 0; i < 12; i++) { o.push(m); if (m === b) break; m = m % 12 + 1; } return o; }

export function variedadDe(s) { return CAT.V[s.variedad] || CAT.V['otra-naranja']; }
export function especieDe(s) { return CAT.especies[variedadDe(s).especie]; }
export function recoleccion(s) { return (s.rec_ini && s.rec_fin) ? [+s.rec_ini, +s.rec_fin] : variedadDe(s).rec; }

// ---------- Fases del cultivo ----------
// Devuelve para cada mes (índice 0-11) la fase principal
export function fases(s) {
  const e = especieDe(s), r = recoleccion(s), f = new Array(12).fill('reposo');
  const [fa, fb] = e.flor;
  mesesEntre(fb % 12 + 1, (fb + 1) % 12 + 1).forEach(m => f[m - 1] = 'cuajado');
  mesesEntre((fb + 2) % 12 + 1, r[0]).forEach(m => f[m - 1] = 'crece');
  mesesEntre(fa, fb).forEach(m => f[m - 1] = 'flor');
  const cambio = (r[0] + 10) % 12 + 1; // mes antes de recolectar
  if (f[cambio - 1] === 'crece') f[cambio - 1] = 'color';
  if (!(r[0] === 1 && r[1] === 12)) mesesEntre(r[0], r[1]).forEach(m => { if (f[m - 1] !== 'flor') f[m - 1] = 'cosecha'; else f[m - 1] = 'flor+cosecha'; });
  else for (let i = 0; i < 12; i++) f[i] = f[i] === 'flor' ? 'flor+cosecha' : 'cosecha';
  return f;
}
export const FASE = {
  reposo: ['Reposo', '#8c8f7a'], flor: ['Brotación y flor', '#d9a6c8'], cuajado: ['Cuajado', '#9ccf6a'],
  crece: ['Crece el fruto', '#4f9a4a'], color: ['Cambio de color', '#e8b13a'], cosecha: ['Recolección', '#e07b16'], 'flor+cosecha': ['Flor y recolección', '#d98a5a']
};

// ---------- Árboles y superficie ----------
export function areaArbol(s) { return (+s.marco_x || 6) * (+s.marco_y || 4); }
export function arboles(s) {
  if (+s.arboles) return +s.arboles;
  if (+s.sup_ha) return Math.round(+s.sup_ha * 1e4 / areaArbol(s));
  return 0;
}
export function edad(s, fecha = new Date()) { return +s.anyo ? fecha.getFullYear() - +s.anyo : 12; }

// ---------- Riego (FAO-56 simplificado) ----------
const SUELO = { arenoso: 80, franco: 150, arcilloso: 170 }; // agua útil, mm por metro
export function sombreado(s) {
  const d = +s.copa || Math.min(4, 0.5 + edad(s) * 0.35);
  return Math.min(1, Math.PI * (d / 2) ** 2 / areaArbol(s));
}
// Kc de la ficha (pensado para ~70 % de suelo sombreado), reducido si la copa cubre poco
export function kcSector(s, mes) {
  const k = especieDe(s).kc[mes];
  return k * Math.min(1, 2 * sombreado(s));
}
export function rdcFactor(s, fechaISO) {
  const r = especieDe(s).rdc;
  if (!s.rdc || !r || edad(s) < 5) return 1;
  const md = fechaISO.slice(5, 10);
  return md >= r.ini && md <= r.fin ? (+s.rdc_f || r.f) : 1;
}
export function caudalArbol(s) { return (+s.goteros || 4) * (+s.caudal || 4); } // l/h
const EF = 0.9;

// riegos: registros de riego del sector. meteo: datos diarios de Open-Meteo
export function balanceRiego(s, meteo, riegos) {
  const A = areaArbol(s), TAW = (SUELO[s.suelo] || 150) * 0.6 * 0.4, hoy = hoyISO();
  const lit = {};
  for (const r of riegos) lit[r.fecha] = (lit[r.fecha] || 0) + litrosRiego(s, r);
  let Dr = 0; const dias = [];
  const d = meteo.daily;
  // Solo se lleva la cuenta del agua del suelo desde el primer riego anotado (si no, no sabemos cómo riega)
  const inicio = Object.keys(lit).filter(t => t >= d.time[0] && t <= hoy).sort()[0];
  const seguimiento = !!inicio;
  for (let i = 0; i < d.time.length; i++) {
    const t = d.time[i], m = +t.slice(5, 7) - 1;
    const etc = (d.et0_fao_evapotranspiration[i] || 0) * kcSector(s, m);
    const lluvia = Math.max(0, (d.precipitation_sum[i] || 0) - 2) * 0.75;
    const riego = t <= hoy ? (lit[t] || 0) / A * EF : 0;
    const necesita = etc * rdcFactor(s, t) * A / EF; // litros/árbol ese día
    if (seguimiento && t >= inicio && t <= hoy) Dr = Math.min(TAW, Math.max(0, Dr + etc - lluvia - riego));
    dias.push({ t, et0: d.et0_fao_evapotranspiration[i], etc, lluvia: d.precipitation_sum[i] || 0, riego, necesita, Dr, tmin: d.temperature_2m_min[i], tmax: d.temperature_2m_max[i] });
  }
  const RAW = TAW * (rdcFactor(s, hoy) < 1 ? 0.65 : 0.5);
  const futuros = dias.filter(x => x.t > hoy);
  const lluviaProx = futuros.slice(0, 3).reduce((a, x) => a + x.lluvia, 0);
  const semana = futuros.reduce((a, x) => a + Math.max(0, x.necesita - Math.max(0, x.lluvia - 2) * 0.75 * A / EF), 0);
  const q = caudalArbol(s);
  return {
    dias, TAW, RAW, Dr, A, q, seguimiento,
    reponer_l: Dr * A / EF, reponer_h: Dr * A / EF / q,
    semana_l: semana, semana_h: semana / q,
    diario_h: semana / q / Math.max(1, futuros.length),
    lluviaProx, urgente: seguimiento && Dr > RAW && lluviaProx < 5
  };
}
export function litrosRiego(s, r) {
  if (+r.litros) return +r.litros;
  if (+r.horas) return +r.horas * caudalArbol(s);
  return 0;
}

// ---------- Abonado (IVIA, orientativo) ----------
export function abonadoAnual(s, analisis = []) {
  const e = especieDe(s), A = areaArbol(s), ed = edad(s);
  let Nha = e.N_ha;
  const prod = +s.prod_esp; // t/ha esperadas
  if (prod > 0) Nha *= Math.min(1.3, Math.max(0.7, Math.sqrt(prod / e.t_ha)));
  let N = Nha * A / 10; // g N por árbol adulto
  const notas = [];
  if (ed < 8) { const j = CAT.joven_N_g.por_edad[Math.max(0, ed)]; if (j < N) { N = j; notas.push(`Árbol joven (${ed} años): dosis reducida.`); } }
  const fol = ultimo(analisis, 'hoja'), agua = ultimo(analisis, 'agua');
  if (fol && +fol.N) {
    if (+fol.N < 2.3) { N *= 1.15; notas.push(`Hoja con poco N (${fol.N} %): +15 %.`); }
    else if (+fol.N > 3.0) { N *= 0.8; notas.push(`Hoja con mucho N (${fol.N} %): −20 %.`); }
  }
  if (agua && +agua.nitratos > 0) {
    const aporte = 5000 * +agua.nitratos * 0.226 / 1000 * A / 10; // g N por árbol con ~5000 m³/ha
    N = Math.max(N * 0.4, N - aporte);
    notas.push(`El agua trae ${agua.nitratos} mg/l de nitrato: se restan unos ${Math.round(aporte)} g de N por árbol.`);
  }
  return { N, P: N * e.P_rel, K: N * e.K_rel, notas, arboles: arboles(s) };
}
function ultimo(lista, tipo) { return lista.filter(a => a.tipo_analisis === tipo).sort((a, b) => b.fecha.localeCompare(a.fecha))[0]; }

// Unidades del mes (kg para todo el sector) y kg/l de cada abono
export function abonadoMes(s, mes, sel, analisis = []) {
  const a = abonadoAnual(s, analisis), n = a.arboles, R = CAT.reparto;
  const u = { N: a.N * R.N[mes] / 100 * n / 1000, P: a.P * R.P[mes] / 100 * n / 1000, K: a.K * R.K[mes] / 100 * n / 1000 };
  const F = CAT.F, fp = F[sel.p || 'fos'], fk = F[sel.k || 'nk'], fn = F[sel.n || 'nam'], kg = {};
  const pk = fp.P ? u.P / (fp.P / 100) : 0, kk = fk.K ? u.K / (fk.K / 100) : 0;
  let nR = u.N - pk * (fp.N || 0) / 100 - kk * (fk.N || 0) / 100;
  const put = (f, v) => { if (v > 0.01) kg[f.id] = (kg[f.id] || 0) + v; };
  put(fp, pk); put(fk, kk); put(fn, Math.max(0, nR) / (fn.N / 100));
  const cant = Object.entries(kg).map(([id, k]) => ({ id, nombre: F[id].nombre, u: F[id].u, v: F[id].d ? k / F[id].d : k }));
  return { u, cant, anual: a };
}
// Unidades fertilizantes de un registro de abonado
export function ufDeAbonos(productos) {
  const o = { N: 0, P: 0, K: 0 };
  for (const p of productos || []) {
    const f = CAT.F[p.id]; if (!f) continue;
    const kg = +p.v * (f.d || 1);
    o.N += kg * (f.N || 0) / 100; o.P += kg * (f.P || 0) / 100; o.K += kg * (f.K || 0) / 100;
  }
  return o;
}

// ---------- Plagas del mes ----------
export function plagasMes(s, mes1) {
  const v = variedadDe(s), esp = v.especie;
  return CAT.plagas.filter(p => p.meses.includes(mes1) && (p.esp === 'todas' || p.esp === esp))
    .map(p => ({ ...p, clave: v.plagas.includes(p.id) }))
    .sort((a, b) => b.clave - a.clave);
}

// ---------- Madurez ----------
export function indiceMadurez(brix, acidez) { return +acidez > 0 ? +brix / +acidez : null; }

// ---------- Clima (Open-Meteo, sin cuenta) ----------
export function meteo(lat, lng) {
  const k = `meteo:${(+lat).toFixed(3)},${(+lng).toFixed(3)}`;
  return cache(k, 3, async () => {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      '&daily=temperature_2m_min,temperature_2m_max,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max,et0_fao_evapotranspiration,weather_code' +
      '&past_days=31&forecast_days=8&timezone=Europe%2FMadrid';
    const r = await fetch(u); if (!r.ok) throw new Error('Open-Meteo ' + r.status);
    return r.json();
  });
}

export function hoyISO(d = new Date()) { return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); }
