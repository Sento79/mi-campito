// Consulta del catálogo: variedades, patrones y plagas
import { CAT, MESES, MES3, mesesEntre, fases, FASE } from './calc.js';
import { D } from './estado.js';
import { esc, $ } from './ui.js';
import { leyendaFases } from './fincas.js';

const ORDEN = ['mandarino', 'naranjo', 'limonero', 'pomelo', 'lima'];

export function pantallaVariedades(main, q) {
  const esp = q.esp || '', txt = (q.q || '').toLowerCase();
  const l = CAT.variedades.filter(v => (!esp || v.especie === esp) && (!txt || (v.nombre + ' ' + v.grupo).toLowerCase().includes(txt)))
    .sort((a, b) => ORDEN.indexOf(a.especie) - ORDEN.indexOf(b.especie) || a.rec[0] - b.rec[0]);
  const grupos = {}; for (const v of l) (grupos[v.grupo] = grupos[v.grupo] || []).push(v);
  const mesHoy = new Date().getMonth() + 1;
  main.innerHTML = `<h1>Variedades</h1>
  <div class="fila" style="margin-bottom:10px"><div class="seg">${[['', 'Todas'], ...ORDEN.map(e => [e, CAT.especies[e].nombre])].map(([k, n]) => `<button class="${k === esp ? 'on' : ''}" data-e="${k}">${n}</button>`).join('')}</div>
  <input id="bq" placeholder="Buscar…" value="${esc(q.q || '')}" style="max-width:200px"></div>
  <p class="mu">${esc(CAT.nota)} En naranja, la época de recolección.</p>
  ${Object.entries(grupos).map(([g, vs]) => `<div class="card"><h2>${esc(g)}</h2>${vs.map(v => {
    const r = mesesEntre(v.rec[0], v.rec[1]);
    return `<a href="#/variedad/${v.id}" style="color:inherit;text-decoration:none;display:block;margin:8px 0"><div class="fila"><b class="sp">${esc(v.nombre)}</b>${v.conf !== 'orientativo' ? `<small class="mu">${esc(v.conf)}</small>` : ''}</div>
     <div class="cal" style="margin-top:2px">${MES3.map((m, i) => `<div class="${i + 1 === mesHoy ? 'hoy' : ''}" style="height:16px;background:${r.includes(i + 1) ? 'var(--ac)' : 'var(--ca2)'}"></div>`).join('')}</div></a>`;
  }).join('')}<div class="cal">${MES3.map(m => `<small class="mu" style="text-align:center;color:var(--mu);text-shadow:none">${m[0]}</small>`).join('')}</div></div>`).join('') || '<p class="mu">Nada encontrado.</p>'}
  <div class="card"><h2>Patrones</h2><a href="#/patrones">Ver los patrones (portainjertos) y para qué suelo sirve cada uno</a></div>`;
  main.querySelectorAll('[data-e]').forEach(b => b.onclick = () => location.hash = '#/variedades?esp=' + b.dataset.e);
  $('#bq', main).onchange = e => location.hash = `#/variedades?esp=${esp}&q=${encodeURIComponent(e.target.value)}`;
}

export function pantallaVariedad(id, main) {
  const v = CAT.V[id]; if (!v) return main.innerHTML = '<p>No encontrada.</p>';
  const e = CAT.especies[v.especie], f = fases({ variedad: id });
  const mios = D.sectores.filter(s => s.variedad === id);
  main.innerHTML = `<h1>${esc(v.nombre)}</h1><p class="mu">${esc(e.nombre)} · ${esc(v.grupo)} · datos ${esc(v.conf)}</p>
  <div class="card"><h2>Ciclo del año</h2><div class="cal">${f.map((x, i) => `<div style="background:${FASE[x][1]}" title="${FASE[x][0]}">${MES3[i][0].toUpperCase()}</div>`).join('')}</div>${leyendaFases()}
   <p>Recolección orientativa: <b>de ${MESES[v.rec[0] - 1]} a ${MESES[v.rec[1] - 1]}</b>. Floración: ${MESES[e.flor[0] - 1]} a ${MESES[e.flor[1] - 1]}.</p></div>
  <div class="card"><h2>Rasgos</h2><ul>${v.rasgos.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
  <div class="card"><h2>Plagas a las que es más sensible</h2><ul>${v.plagas.map(p => CAT.PL[p] ? `<li><a href="#/plagas#${p}">${esc(CAT.PL[p].nombre)}</a></li>` : '').join('')}</ul></div>
  <div class="card"><h2>Datos para los cálculos</h2><table class="tabla">
   <tr><td>Kc de riego (ene → dic)</td><td>${e.kc.map(k => k.toFixed(2)).join(' · ')}</td></tr>
   <tr><td>Nitrógeno en árbol adulto</td><td>~${e.N_ha} kg N/ha y año para ~${e.t_ha} t/ha (IVIA)</td></tr>
   <tr><td>Riego deficitario</td><td>${e.rdc ? `del ${e.rdc.ini.split('-').reverse().join('/')} al ${e.rdc.fin.split('-').reverse().join('/')} al ${e.rdc.f * 100} %` : 'No recomendado'}</td></tr>
   <tr><td>Índice de madurez mínimo</td><td>${e.im_min ?? 'No aplica (se recoge por tamaño y color)'}</td></tr></table>
   <p class="mu">Fuentes: FAO-56 (Kc), IVIA (abonado y riego deficitario), normas de comercialización (madurez). Ajusta lo que haga falta en cada sector.</p></div>
  ${mios.length ? `<div class="card"><h2>En tus fincas</h2><ul>${mios.map(s => `<li><a href="#/sector/${s.id}">${esc(s.nombre)}</a></li>`).join('')}</ul></div>` : ''}`;
}

export function pantallaPlagas(main) {
  const mes = new Date().getMonth() + 1;
  const tipos = { insecto: 'Insectos', 'ácaro': 'Ácaros', cochinilla: 'Cochinillas', hongo: 'Hongos', virus: 'Virus', otro: 'Otros' };
  main.innerHTML = `<h1>Plagas y enfermedades</h1><p class="mu">Cuándo vigilar cada una (en naranja los meses de riesgo). Basado en la Guía de Gestión Integrada de Plagas del IVIA. Antes de tratar, consulta a tu técnico y usa solo productos autorizados en cítricos.</p>
  ${Object.entries(tipos).map(([t, n]) => { const l = CAT.plagas.filter(p => p.tipo === t); return l.length ? `<h2 style="margin-top:16px">${n}</h2>` + l.map(p => `<div class="card" id="${p.id}"><h2>${esc(p.nombre)} ${p.meses.includes(mes) ? '<span class="chip ac">vigilar ahora</span>' : ''}</h2><p class="mu"><i>${esc(p.cient)}</i>${p.esp !== 'todas' ? ' · sobre todo en ' + esc(CAT.especies[p.esp]?.nombre.toLowerCase()) : ''}</p>
    ${p.meses.length ? `<div class="cal">${MES3.map((m, i) => `<div class="${i + 1 === mes ? 'hoy' : ''}" style="height:18px;background:${p.meses.includes(i + 1) ? 'var(--ac)' : 'var(--ca2)'};color:${p.meses.includes(i + 1) ? '#fff' : 'var(--mu)'};text-shadow:none">${m[0]}</div>`).join('')}</div>` : ''}
    <p><b>Cómo se ve:</b> ${esc(p.que)}</p><p><b>Cuándo actuar:</b> ${esc(p.umbral)}</p></div>`).join('') : ''; }).join('')}
  <p class="mu">Más información: <a href="https://gipcitricos.ivia.es" target="_blank" rel="noopener">gipcitricos.ivia.es</a></p>`;
  if (location.hash.split('#')[2]) setTimeout(() => document.getElementById(location.hash.split('#')[2])?.scrollIntoView(), 50);
}

export function pantallaPatrones(main) {
  const c = v => !v ? '' : `<span class="chip" style="${/^tolerante/.test(v) ? 'background:var(--ver2)' : /sensible/.test(v) ? 'background:var(--rojo2)' : ''}">${esc(v)}</span>`;
  main.innerHTML = `<h1>Patrones</h1><p class="mu">El patrón (portainjerto) decide cómo aguanta el árbol el suelo calizo, la sal o el encharcamiento, y su vigor.</p>
  ${CAT.patrones.filter(p => p.id !== 'desconocido').map(p => `<div class="card"><h2>${esc(p.nombre)}</h2><p class="mu">Vigor ${esc(p.vigor)}</p>
   <p>Caliza ${c(p.caliza)} Sal ${c(p.sal)} Encharcamiento ${c(p.asfixia)} Tristeza ${c(p.tristeza)} Phytophthora ${c(p.phytophthora)}</p><p>${esc(p.nota)}</p></div>`).join('')}`;
}
