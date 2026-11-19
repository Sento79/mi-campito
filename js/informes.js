// Hoy, calendario, riego, abonado, cuaderno, cosecha y cuentas
import { cache } from './db.js';
import { D, finca, sector, sectoresDe, registrosDe, nombreSector, fincaDeRegistro } from './estado.js';
import { CAT, MESES, MES3, meteo, balanceRiego, abonadoMes, abonadoAnual, plagasMes, recoleccion, variedadDe, especieDe, arboles, hoyISO, mesesEntre, indiceMadurez, litrosRiego } from './calc.js';
import { comunidad } from './sigpac.js';
import { esc, num, eur, fecha, csv, descargar, $ } from './ui.js';
import { barraCalendario, leyendaFases, tablaAbonado, tarjetaRiego, iconoTiempo } from './fincas.js';
import { TIPOS, resumen, donde } from './registros.js';

const aviso = (cls, i, t, txt, href) => `<div class="aviso ${cls}"><span class="i">${i}</span><div><b>${href ? `<a href="${href}" style="color:inherit">${esc(t)}</a>` : esc(t)}</b>${txt}</div></div>`;
const sumarDias = (iso, n) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return hoyISO(d); };

// ---------- HOY ----------
export async function pantallaHoy(main) {
  const hoy = hoyISO(), mes = new Date().getMonth();
  if (!D.fincas.length) {
    main.innerHTML = `<h1>Bienvenido a Mi Campito</h1>
    <div class="card ac"><h2>Empieza en tres pasos</h2><ol><li>Da de alta tu finca (nombre y pueblo).</li><li>Añade sus parcelas: tócalas en el mapa y SIGPAC rellena el linde y la superficie.</li><li>Elige la variedad, el año y el riego.</li></ol>
    <p>Con eso, cada día verás aquí qué toca hacer: <b>riego</b> según el tiempo real, <b>abonado</b> del mes, <b>plagas</b> que vigilar y cuándo empezar a <b>recolectar</b>.</p>
    <a class="btn pri" href="#/finca-editar/nueva">Añadir mi finca</a></div>
    <div class="card"><h2>Tus datos son tuyos</h2><p class="mu">Todo se guarda en este dispositivo. Nadie más lo ve. Haz copias de seguridad desde Ajustes.</p></div>`;
    return;
  }
  const gen = [];
  const tareas = D.registros.filter(r => r.tipo === 'tarea' && !r.hecha && r.fecha <= sumarDias(hoy, 7));
  for (const t of tareas) gen.push(aviso(t.fecha < hoy ? 'rojo' : 'ama', '✅', t.texto, `${t.fecha < hoy ? 'Atrasada · ' : ''}${fecha(t.fecha)} · ${esc(donde(t))}`, `#/registro/${t.id}`));
  if (D.ajustes.ropo_cad) { const dd = (new Date(D.ajustes.ropo_cad) - new Date()) / 864e5; if (dd < 60) gen.push(aviso(dd < 0 ? 'rojo' : 'ama', '🪪', dd < 0 ? 'El carné de aplicador ha caducado' : 'El carné de aplicador caduca pronto', ` Caduca el ${fecha(D.ajustes.ropo_cad)}. Renuévalo para poder tratar.`, '#/ajustes')); }
  const uc = D.ajustes.ultimaCopia;
  if (D.registros.length > 5 && (!uc || (Date.now() - new Date(uc)) > 30 * 864e5)) gen.push(aviso('azul', '💾', 'Haz una copia de seguridad', ` ${uc ? 'La última fue el ' + fecha(uc) : 'Todavía no has hecho ninguna'}. Si pierdes el móvil, la copia es lo único que guarda tus datos.`, '#/ajustes'));
  // Plazos de seguridad vigentes
  for (const r of D.registros.filter(r => r.tipo === 'tratamiento' && +r.plazo > 0)) {
    const fin = sumarDias(r.fecha, +r.plazo);
    if (fin >= hoy && r.fecha <= hoy) gen.push(aviso('rojo', '⛔', `No recolectes ${esc(donde(r))} hasta el ${fecha(fin)}`, ` Plazo de seguridad de ${esc(r.producto)} (${r.plazo} días).`, `#/registro/${r.id}`));
  }
  main.innerHTML = `<h1>Hoy · ${fecha(hoy, true)}</h1>${gen.join('')}<div id="fincas"></div><div id="gva"></div>`;
  const cont = $('#fincas', main);
  for (const f of D.fincas) {
    const div = document.createElement('div'); div.className = 'card';
    div.innerHTML = `<h2><a href="#/finca/${f.id}" style="color:inherit">🏡 ${esc(f.nombre)}</a></h2><p class="mu">Cargando…</p>`;
    cont.appendChild(div);
    tarjetaFincaHoy(f, mes, hoy).then(h => div.innerHTML = h).catch(e => div.innerHTML += `<p class="mu">${esc(e.message)}</p>`);
  }
  avisosOficiales().then(h => { if (h) $('#gva', main).innerHTML = h; });
}

async function tarjetaFincaHoy(f, mes, hoy) {
  const ss = sectoresDe(f.id), out = [];
  let w = null;
  if (f.lat) try { w = await meteo(f.lat, f.lng); } catch { }
  let cab = '';
  if (w) {
    const d = w.daily, i = d.time.indexOf(hoy);
    const prox = [0, 1, 2].map(k => i + k).filter(k => k < d.time.length);
    cab = `<p>${prox.map(k => `${k === i ? 'Hoy' : k === i + 1 ? 'Mañana' : 'Pasado'} ${iconoTiempo(d.weather_code[k])} ${num(d.temperature_2m_min[k])}–${num(d.temperature_2m_max[k])}°${d.precipitation_sum[k] >= 1 ? ` · ${num(d.precipitation_sum[k])} mm` : ''}`).join(' &nbsp;·&nbsp; ')}</p>`;
    const hel = d.time.map((t, k) => k).filter(k => k >= i && k < i + 7 && d.temperature_2m_min[k] <= 1);
    if (hel.length) out.push(aviso('rojo', '🥶', 'Riesgo de helada', ` ${num(Math.min(...hel.map(k => d.temperature_2m_min[k])), 1)} °C el ${fecha(d.time[hel[0]], true)}.`));
    const viento = d.time.map((t, k) => k).filter(k => k >= i && k < i + 3 && d.wind_gusts_10m_max[k] >= 60);
    if (viento.length) out.push(aviso('ama', '💨', 'Viento fuerte', ` Rachas de ${num(d.wind_gusts_10m_max[viento[0]])} km/h el ${fecha(d.time[viento[0]], true)}: no trates ese día.`));
  } else if (!f.lat) cab = '<p class="mu">Sin ubicación: no hay tiempo ni cálculo de riego.</p>';
  if (!ss.length) out.push(`<p class="mu">Añade un sector para ver recomendaciones. <a href="#/sector-editar/nuevo?finca=${f.id}">Añadir sector</a></p>`);
  for (const s of ss) {
    const v = variedadDe(s), r = recoleccion(s), dentro = mesesEntre(r[0], r[1]).includes(mes + 1), antes = (r[0] + 10) % 12 === mes;
    const items = [];
    if (w) {
      const b = balanceRiego(s, w, registrosDe(s.id, 'riego'));
      const h = x => x < 1 ? `${num(x * 60)} min` : `${num(x, 1)} h`;
      if (b.urgente) items.push(aviso('rojo', '💧', `Regar ${h(b.reponer_h)}`, ` El suelo ha gastado ${num(b.Dr)} de ${num(b.TAW)} mm de agua útil.`, `#/sector/${s.id}`));
      else items.push(aviso('ver', '💧', `Riego: unas ${h(b.diario_h)} al día`, ` Esta semana necesita ${num(b.semana_l / 7)} litros por árbol y día.${b.lluviaProx >= 5 ? ` Se esperan ${num(b.lluviaProx)} mm de lluvia.` : ''}`, `#/sector/${s.id}`));
    }
    const ab = abonadoMes(s, mes, { n: D.ajustes.abono_n, p: D.ajustes.abono_p, k: D.ajustes.abono_k }, registrosDe(s.id, 'analisis'));
    if (ab.u.N > 0.05) {
      const ym = hoyISO().slice(0, 7), echado = registrosDe(s.id, 'abonado').filter(x => x.fecha.startsWith(ym)).reduce((a, x) => a + (x.uf?.N || 0), 0);
      const falta = ab.u.N - echado;
      if (falta > ab.u.N * 0.1) items.push(aviso('ama', '🧪', `Abonado: faltan ${num(falta, 1)} kg de N este mes`, ` ${ab.cant.map(c => `${num(c.v, 1)} ${c.u} de ${esc(c.nombre)}`).join(', ')} en total para el mes.`, `#/registro/nuevo?tipo=abonado&sector=${s.id}`));
    }
    if (antes) items.push(aviso('azul', '📏', 'Empieza a muestrear la madurez', ` ${esc(v.nombre)} se recoge de ${MESES[r[0] - 1]} a ${MESES[r[1] - 1]}. Mide Brix y acidez cada 10-15 días.`, `#/registro/nuevo?tipo=madurez&sector=${s.id}`));
    if (dentro) {
      const m = registrosDe(s.id, 'madurez')[0], im = m ? indiceMadurez(m.brix, m.acidez) : null, min = especieDe(s).im_min;
      items.push(aviso('azul', '🍊', 'Época de recolección', m && min ? ` Último índice de madurez: ${num(im, 1)} (${fecha(m.fecha)}); mínimo recomendable ${min}.${im >= min ? ' Ya se puede recoger.' : ''}` : ` ${esc(v.rasgos[2] || v.rasgos[0] || '')}`, `#/sector/${s.id}`));
    }
    const pl = plagasMes(s, mes + 1).filter(p => p.clave).slice(0, 3);
    if (pl.length) items.push(`<p class="mu" style="margin:6px 0 0">🔎 Vigila: ${pl.map(p => esc(p.nombre)).join(', ')}.</p>`);
    out.push(`<h3><a href="#/sector/${s.id}" style="color:inherit">🌳 ${esc(s.nombre)}</a> <span class="mu" style="font-weight:400">· ${esc(v.nombre)}</span></h3>${items.join('')}`);
  }
  return `<h2><a href="#/finca/${f.id}" style="color:inherit">🏡 ${esc(f.nombre)}</a></h2>${cab}${out.join('')}`;
}

// Avisos oficiales (publicados por la tarea automática del repositorio)
export async function avisosOficiales(todos) {
  const ccaa = new Set(D.fincas.map(f => comunidad(f.provincia)).filter(Boolean));
  if (!todos && !ccaa.has('Comunitat Valenciana')) return '';
  let a;
  try { a = await cache('avisos-gva', 6, async () => (await fetch('data/avisos-gva.json', { cache: 'no-cache' })).json()); } catch { return ''; }
  if (!a?.av?.length) return '';
  const l = a.av.slice(0, todos ? 30 : 4);
  return `<div class="card"><h2>📢 Avisos de la Generalitat Valenciana</h2><ul class="lista">${l.map(x => `<li><span class="t"><b><a href="${esc(x.u)}" target="_blank" rel="noopener">${esc(x.t)}</a></b><small>${fecha(x.d)}${x.p ? ' · ' + esc(x.p) : ''}</small></span></li>`).join('')}</ul>
   <p class="mu">Fuente: <a href="${esc(a.src)}" target="_blank" rel="noopener">Servicio de Sanidad Vegetal (GVA)</a> · actualizado ${fecha(a.upd)}${todos ? '' : ' · <a href="#/avisos">ver todos</a>'}</p></div>`;
}
export async function pantallaAvisos(main) {
  main.innerHTML = '<h1>Avisos oficiales</h1><div id="a"><p class="mu">Cargando…</p></div>';
  $('#a', main).innerHTML = (await avisosOficiales(true)) || '<div class="card"><p class="mu">No hay avisos disponibles ahora mismo. De momento solo se recogen los de la Comunitat Valenciana.</p></div>';
}

// ---------- CALENDARIO ----------
export function pantallaCalendario(main) {
  const mes = new Date().getMonth();
  const tareas = [
    [0, 'Poda de limpieza tras la cosecha (ramas secas, chupones)'], [0, 'Revisar filtros y goteros'], [1, 'Terminar la poda antes de la brotación'], [1, 'Análisis del agua de riego'],
    [2, 'Empezar el abonado con el riego'], [2, 'Vigilar pulgón en brotes tiernos'], [3, 'Floración: no tratar con productos dañinos para las abejas'],
    [4, 'Vigilar trips y cotonet en fruto recién cuajado'], [5, 'Primera generación de piojo rojo'], [6, 'Riego deficitario si lo usas (julio y mitad de agosto)'],
    [7, 'Segunda generación de piojo rojo; vigilar cotonet'], [7, 'Análisis foliar (hojas de primavera de 6-7 meses)'], [8, 'Trampas de mosca de la fruta en variedades tempranas'],
    [9, 'Muestreos de madurez en variedades de otoño'], [9, 'Cuidado con el aguado tras las lluvias'], [10, 'Recolección y limpieza de frutos caídos'], [11, 'Proteger de heladas a los árboles jóvenes']
  ];
  main.innerHTML = `<h1>Calendario</h1>${leyendaFases()}
   ${D.sectores.length ? D.sectores.map(s => `<div class="card"><h2><a href="#/sector/${s.id}" style="color:inherit">${esc(nombreSector(s))}</a> <span class="mu">· ${esc(variedadDe(s).nombre)}</span></h2>${barraCalendario(s, mes)}</div>`).join('') : '<p class="mu">Añade sectores para ver su calendario.</p>'}
   <div class="card"><h2>Tareas del año (generales)</h2>${MESES.map((m, i) => { const t = tareas.filter(x => x[0] === i); return t.length ? `<h3${i === mes ? ' style="color:var(--ac2)"' : ''}>${m[0].toUpperCase() + m.slice(1)}${i === mes ? ' · este mes' : ''}</h3><ul>${t.map(x => `<li>${esc(x[1])}</li>`).join('')}</ul>` : ''; }).join('')}
   <p class="mu">Orientativo para la Comunitat Valenciana. En zonas más cálidas o frías, adelanta o retrasa unas semanas.</p></div>`;
}

// ---------- RIEGO (todos los sectores) ----------
export async function pantallaRiego(main) {
  main.innerHTML = `<h1>Riego</h1><div id="r"><p class="mu">Calculando…</p></div>`;
  const out = [];
  for (const f of D.fincas) {
    for (const s of sectoresDe(f.id)) {
      if (!f.lat) { out.push(`<div class="card"><h2>${esc(nombreSector(s))}</h2><p class="mu">La finca no tiene ubicación.</p></div>`); continue; }
      try {
        const b = balanceRiego(s, await meteo(f.lat, f.lng), registrosDe(s.id, 'riego'));
        const mes30 = registrosDe(s.id, 'riego').filter(r => r.fecha >= hoyISO(new Date(Date.now() - 30 * 864e5)));
        const m3 = mes30.reduce((a, r) => a + litrosRiego(s, r), 0) * arboles(s) / 1000;
        out.push(`<div class="card"><h2><a href="#/sector/${s.id}" style="color:inherit">${esc(nombreSector(s))}</a></h2>${tarjetaRiego(s, b)}
          <p>Últimos 30 días: ${mes30.length} riegos anotados, ${num(m3, 1)} m³.</p>
          ${graficoAgua(b)}<a class="btn" href="#/registro/nuevo?tipo=riego&sector=${s.id}">💧 Anotar riego</a></div>`);
      } catch (e) { out.push(`<div class="card"><h2>${esc(nombreSector(s))}</h2><p class="mu">Sin datos del tiempo (${esc(e.message)}).</p></div>`); }
    }
  }
  $('#r', main).innerHTML = out.join('') || '<p class="mu">Añade fincas y sectores para calcular el riego.</p>';
}
function graficoAgua(b) {
  const d = b.dias.slice(-21), mx = Math.max(1, ...d.map(x => Math.max(x.etc, x.lluvia, x.riego)));
  return `<h3>Últimos días y previsión</h3><div class="barras" style="height:90px">${d.map(x => `<div title="${x.t}: ETc ${num(x.etc, 1)} mm, lluvia ${num(x.lluvia, 1)} mm" style="height:${x.etc / mx * 100}%;background:${x.t > hoyISO() ? 'var(--bd)' : 'var(--ac)'}"></div>`).join('')}</div>
   <div class="ejes">${d.map((x, i) => `<span>${i % 3 === 0 ? x.t.slice(8) : ''}</span>`).join('')}</div><p class="mu">Gasto de agua del árbol (ETc) cada día. En gris, la previsión.</p>`;
}

// ---------- ABONADO (plan anual) ----------
export function pantallaAbonado(main) {
  const sel = { n: D.ajustes.abono_n, p: D.ajustes.abono_p, k: D.ajustes.abono_k }, mes = new Date().getMonth(), y = new Date().getFullYear();
  main.innerHTML = `<h1>Abonado</h1><p class="mu">Plan orientativo según el IVIA, por meses y para todo el sector. Los abonos que se usan para el cálculo se cambian en <a href="#/ajustes">Ajustes</a>.</p>` +
    (D.sectores.map(s => {
      const a = abonadoAnual(s, registrosDe(s.id, 'analisis'));
      const echado = registrosDe(s.id, 'abonado').filter(r => r.fecha.startsWith(y)).reduce((o, r) => ({ N: o.N + (r.uf?.N || 0), P: o.P + (r.uf?.P || 0), K: o.K + (r.uf?.K || 0) }), { N: 0, P: 0, K: 0 });
      const n = a.arboles / 1000;
      const filas = MESES.map((m, i) => ({ i, m, ab: abonadoMes(s, i, sel, registrosDe(s.id, 'analisis')) })).filter(x => x.ab.cant.length);
      return `<div class="card"><h2><a href="#/sector/${s.id}" style="color:inherit">${esc(nombreSector(s))}</a></h2>
       <div class="kpi"><div><b>${num(a.N)} g</b><span>N por árbol y año</span></div><div><b>${num(a.N * n, 1)} kg</b><span>N para el sector</span></div><div><b>${num(a.P * n, 1)} / ${num(a.K * n, 1)} kg</b><span>P₂O₅ / K₂O al año</span></div><div><b>${num(echado.N, 1)} kg</b><span>N echado en ${y}</span></div></div>
       ${a.notas.map(x => `<p class="mu">${esc(x)}</p>`).join('')}
       <div class="scroll"><table class="tabla"><tr><th>Mes</th><th class="n">N</th><th class="n">P₂O₅</th><th class="n">K₂O</th><th>Abonos (total del mes)</th></tr>
       ${filas.map(x => `<tr${x.i === mes ? ' style="background:var(--ama2)"' : ''}><td>${x.m}</td><td class="n">${num(x.ab.u.N, 1)}</td><td class="n">${num(x.ab.u.P, 1)}</td><td class="n">${num(x.ab.u.K, 1)}</td><td>${x.ab.cant.map(c => `${num(c.v, 1)} ${c.u} ${esc(c.nombre)}`).join('<br>')}</td></tr>`).join('')}</table></div>
       <a class="btn" href="#/registro/nuevo?tipo=abonado&sector=${s.id}">🧪 Anotar abonado</a></div>`;
    }).join('') || '<p class="mu">Añade sectores para ver el plan de abonado.</p>');
}

// ---------- CUADERNO DE CAMPO ----------
export function pantallaCuaderno(main, q) {
  const y = q.y || String(new Date().getFullYear());
  const l = D.registros.filter(r => r.tipo === 'tratamiento' && r.fecha.startsWith(y)).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const anyos = [...new Set(D.registros.filter(r => r.tipo === 'tratamiento').map(r => r.fecha.slice(0, 4)).concat(y))].sort().reverse();
  const filas = l.map(r => { const s = sector(r.sector); return [r.fecha, nombreSector(s), s?.ref || '', variedadDe(s || {}).nombre, CAT.PL[r.plaga]?.nombre || 'Otra', r.producto, r.n_registro, r.materia, r.dosis != null ? `${r.dosis} ${r.dosis_u}` : '', r.caldo, r.sup_ha, r.equipo, r.aplicador, r.ropo, r.plazo]; });
  const cab = ['Fecha', 'Parcela', 'Ref. SIGPAC', 'Cultivo', 'Problema', 'Producto', 'Nº registro', 'Materia activa', 'Dosis', 'Caldo (l)', 'Sup. (ha)', 'Equipo', 'Aplicador', 'ROPO', 'Plazo (días)'];
  main.innerHTML = `<div class="fila noimp"><h1 class="sp">Cuaderno de campo</h1><select id="y">${anyos.map(a => `<option${a === y ? ' selected' : ''}>${a}</option>`).join('')}</select></div>
  <div class="card"><h2>Registro de tratamientos fitosanitarios ${y}</h2><p>Titular: <b>${esc(D.ajustes.titular || '—')}</b>${D.ajustes.nif ? ' · NIF ' + esc(D.ajustes.nif) : ''}</p>
  ${l.length ? `<div class="scroll"><table class="tabla"><tr>${cab.map(c => `<th>${c}</th>`).join('')}</tr>${filas.map(f => `<tr>${f.map((v, i) => `<td${i === 0 ? ' style="white-space:nowrap"' : ''}>${esc(i === 0 ? fecha(v) : v ?? '')}</td>`).join('')}</tr>`).join('')}</table></div>` : '<p class="mu">No hay tratamientos anotados este año.</p>'}
  <p class="mu">Ayuda para llevar el cuaderno de explotación. El oficial (CUE) lo firma y presenta el titular. Comprueba que cada producto está autorizado en cítricos en el Registro de Productos Fitosanitarios del MAPA.</p></div>
  <div class="acciones"><a class="btn pri" href="#/registro/nuevo?tipo=tratamiento">🛡️ Anotar tratamiento</a><button id="imp">🖨️ Imprimir o PDF</button><button id="csv">⬇️ Descargar Excel (CSV)</button></div>`;
  $('#y', main).onchange = e => location.hash = '#/cuaderno?y=' + e.target.value;
  $('#imp', main).onclick = () => print();
  $('#csv', main).onclick = () => descargar(`cuaderno-${y}.csv`, csv([cab, ...filas]), 'text/csv;charset=utf-8');
}

// ---------- COSECHA ----------
export function pantallaCosecha(main) {
  const l = D.registros.filter(r => r.tipo === 'cosecha'), por = {};
  for (const r of l) { const k = r.fecha.slice(0, 4) + '|' + (r.sector || ''); (por[k] = por[k] || { kg: 0, eur: 0 }); por[k].kg += +r.kg || 0; por[k].eur += (+r.kg || 0) * (+r.precio || 0); }
  const anyos = [...new Set(l.map(r => r.fecha.slice(0, 4)))].sort().reverse();
  const tot = a => Object.entries(por).filter(([k]) => k.startsWith(a)).reduce((o, [, v]) => ({ kg: o.kg + v.kg, eur: o.eur + v.eur }), { kg: 0, eur: 0 });
  const mx = Math.max(1, ...anyos.map(a => tot(a).kg));
  const mad = D.registros.filter(r => r.tipo === 'madurez').slice(0, 12);
  main.innerHTML = `<div class="fila"><h1 class="sp">Cosecha</h1><a class="btn pri" href="#/registro/nuevo?tipo=cosecha">🍊 Anotar</a></div>
  ${anyos.length ? `<div class="card"><h2>Kilos por año</h2><div class="barras">${[...anyos].reverse().map(a => `<div style="height:${tot(a).kg / mx * 100}%"><span>${num(tot(a).kg / 1000, 1)} t</span></div>`).join('')}</div><div class="ejes">${[...anyos].reverse().map(a => `<span>${a}</span>`).join('')}</div></div>` : ''}
  ${anyos.map(a => { const t = tot(a); return `<div class="card"><h2>${a} <span class="mu">· ${num(t.kg)} kg · ${eur(t.eur)}</span></h2><div class="scroll"><table class="tabla"><tr><th>Sector</th><th class="n">kg</th><th class="n">kg/ha</th><th class="n">€/kg medio</th><th class="n">€</th></tr>
    ${Object.entries(por).filter(([k]) => k.startsWith(a)).map(([k, v]) => { const s = sector(k.split('|')[1]); return `<tr><td>${esc(nombreSector(s))}</td><td class="n">${num(v.kg)}</td><td class="n">${s?.sup_ha ? num(v.kg / s.sup_ha) : '—'}</td><td class="n">${v.kg ? num(v.eur / v.kg, 3) : '—'}</td><td class="n">${eur(v.eur)}</td></tr>`; }).join('')}</table></div></div>`; }).join('') || '<div class="card"><p class="mu">Todavía no has anotado ninguna cosecha.</p></div>'}
  <div class="card"><div class="fila"><h2 class="sp">Muestreos de madurez</h2><a class="btn" href="#/registro/nuevo?tipo=madurez">📏 Anotar</a></div>
  ${mad.length ? `<div class="scroll"><table class="tabla"><tr><th>Fecha</th><th>Sector</th><th class="n">°Brix</th><th class="n">Acidez</th><th class="n">IM</th><th class="n">Color</th></tr>${mad.map(r => `<tr><td>${fecha(r.fecha)}</td><td>${esc(donde(r))}</td><td class="n">${num(r.brix, 1)}</td><td class="n">${num(r.acidez, 2)}</td><td class="n"><b>${num(indiceMadurez(r.brix, r.acidez), 1)}</b></td><td class="n">${r.color ?? '—'}</td></tr>`).join('')}</table></div>
   <p class="mu">Índice de madurez (IM) = Brix / acidez. Como referencia, se suele recoger con IM ≥ 6,5 en naranja y ≥ 7 en mandarina, con buen color. Lo exige la norma de comercialización.</p>` : '<p class="mu">Sin muestreos.</p>'}</div>`;
}

// ---------- CUENTAS ----------
export function pantallaCuentas(main, q) {
  const y = q.y || String(new Date().getFullYear());
  const anyos = [...new Set(D.registros.filter(r => ['gasto', 'ingreso', 'cosecha'].includes(r.tipo)).map(r => r.fecha.slice(0, 4)).concat(y))].sort().reverse();
  const del = D.registros.filter(r => r.fecha.startsWith(y));
  const filasF = D.fincas.map(f => {
    const rs = del.filter(r => fincaDeRegistro(r)?.id === f.id);
    const venta = rs.filter(r => r.tipo === 'cosecha').reduce((a, r) => a + (+r.kg || 0) * (+r.precio || 0), 0);
    const otros = rs.filter(r => r.tipo === 'ingreso').reduce((a, r) => a + (+r.importe || 0), 0);
    const gasto = rs.filter(r => r.tipo === 'gasto').reduce((a, r) => a + (+r.importe || 0), 0);
    const ha = sectoresDe(f.id).reduce((a, s) => a + (+s.sup_ha || 0), 0);
    return { f, venta, otros, gasto, ha, res: venta + otros - gasto };
  });
  const cat = {};
  for (const r of del.filter(r => r.tipo === 'gasto')) cat[r.categoria] = (cat[r.categoria] || 0) + (+r.importe || 0);
  const totG = Object.values(cat).reduce((a, b) => a + b, 0);
  main.innerHTML = `<div class="fila"><h1 class="sp">Cuentas</h1><select id="y">${anyos.map(a => `<option${a === y ? ' selected' : ''}>${a}</option>`).join('')}</select></div>
  <div class="acciones" style="margin:0 0 12px"><a class="btn" href="#/registro/nuevo?tipo=gasto">💶 Gasto</a><a class="btn" href="#/registro/nuevo?tipo=ingreso">💰 Ingreso</a><button id="csv">⬇️ CSV</button></div>
  ${filasF.map(x => `<div class="card"><h2>${esc(x.f.nombre)}</h2><div class="kpi"><div><b>${eur(x.venta)}</b><span>venta de fruta</span></div><div><b>${eur(x.otros)}</b><span>otros ingresos</span></div><div><b>${eur(x.gasto)}</b><span>gastos</span></div><div><b style="color:${x.res >= 0 ? 'var(--ver)' : 'var(--rojo)'}">${eur(x.res)}</b><span>resultado${x.ha ? ' · ' + eur(x.res / x.ha) + '/ha' : ''}</span></div></div></div>`).join('')}
  <div class="card"><h2>Gastos por tipo en ${y}</h2>${totG ? `<table class="tabla">${Object.entries(cat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${eur(v)}</td><td class="n mu">${num(v / totG * 100)} %</td></tr>`).join('')}</table>` : '<p class="mu">Sin gastos anotados.</p>'}</div>`;
  $('#y', main).onchange = e => location.hash = '#/cuentas?y=' + e.target.value;
  $('#csv', main).onclick = () => descargar(`cuentas-${y}.csv`, csv([['Fecha', 'Tipo', 'Dónde', 'Concepto', 'Importe (€)'], ...del.filter(r => ['gasto', 'ingreso', 'cosecha'].includes(r.tipo)).map(r => [r.fecha, TIPOS[r.tipo].n, donde(r), r.tipo === 'cosecha' ? `${r.kg} kg × ${r.precio || 0} €/kg` : (r.categoria ? r.categoria + ' · ' : '') + (r.concepto || ''), String(r.tipo === 'gasto' ? -(+r.importe) : r.tipo === 'cosecha' ? (+r.kg || 0) * (+r.precio || 0) : +r.importe).replace('.', ',')])]), 'text/csv;charset=utf-8');
}
