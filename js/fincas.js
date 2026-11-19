// Fincas y sectores: lista, ficha, alta con SIGPAC y mapa
import { guardar, borrar } from './db.js';
import { D, finca, sector, sectoresDe, registrosDe, registrosFinca } from './estado.js';
import { CAT, MES3, MESES, FASE, fases, variedadDe, especieDe, recoleccion, arboles, edad, meteo, balanceRiego, abonadoMes, plagasMes, hoyISO, areaArbol } from './calc.js';
import { recintoEnPunto, recintosPorReferencia, centro, comunidad, PROVINCIA, USOS, buscarLugar, capas } from './sigpac.js';
import { esc, campos, leerForm, toast, confirmar, num, fecha, diaSemana, opcionesAgrupadas, dialogo, $ } from './ui.js';
import { listaRegistros, TIPOS } from './registros.js';

const ESPANA = [40.0, -3.7];

function mapa(el, centroIni, zoom) {
  const L = window.L, c = capas(L);
  const m = L.map(el, { center: centroIni || ESPANA, zoom: zoom || (centroIni ? 16 : 6), layers: [centroIni ? c.orto : c.base] });
  L.control.layers({ 'Foto aérea': c.orto, 'Mapa': c.base }, { 'Recintos SIGPAC': c.sigpac }).addTo(m);
  setTimeout(() => m.invalidateSize(), 50);
  return m;
}
const ESTILO = { color: '#f39a3d', weight: 2, fillOpacity: 0.15 };

// ---------- Lista de fincas ----------
export function pantallaFincas(main) {
  if (!D.fincas.length) {
    main.innerHTML = `<h1>Mis fincas</h1><div class="card vacio"><div class="ico">🍊</div><p>Todavía no tienes ninguna finca.</p><p class="mu">Da de alta la primera: solo necesitas el nombre y el pueblo. Después podrás buscar las parcelas en SIGPAC.</p><a class="btn pri" href="#/finca-editar/nueva">Añadir mi primera finca</a></div>`;
    return;
  }
  const filas = D.fincas.map(f => {
    const ss = sectoresDe(f.id), ha = ss.reduce((a, s) => a + (+s.sup_ha || 0), 0), arb = ss.reduce((a, s) => a + arboles(s), 0);
    return `<li><a class="li" href="#/finca/${f.id}"><span style="font-size:26px">🏡</span><span class="t"><b>${esc(f.nombre)}</b><small>${esc(f.municipio || '')} · ${ss.length} sector${ss.length === 1 ? '' : 'es'} · ${num(ha, 2)} ha · ${num(arb)} árboles</small></span><span class="mu">›</span></a></li>`;
  }).join('');
  main.innerHTML = `<div class="fila"><h1 class="sp">Mis fincas</h1><a class="btn pri" href="#/finca-editar/nueva">+ Finca</a></div>
    <div class="card"><ul class="lista">${filas}</ul></div><div id="mp" class="mapa"></div>`;
  const f0 = D.fincas.find(f => f.lat), m = mapa($('#mp', main), f0 ? [f0.lat, f0.lng] : null, 14), grupo = [];
  for (const s of D.sectores) if (s.geo) { const p = window.L.polygon(s.geo, ESTILO).addTo(m).bindPopup(`<a href="#/sector/${s.id}">${esc(s.nombre)}</a>`); grupo.push(p); }
  for (const f of D.fincas) if (f.lat && !sectoresDe(f.id).some(s => s.geo)) grupo.push(window.L.marker([f.lat, f.lng]).addTo(m).bindPopup(`<a href="#/finca/${f.id}">${esc(f.nombre)}</a>`));
  if (grupo.length) { const b = window.L.featureGroup(grupo).getBounds(); m.fitBounds(b, { maxZoom: 17, padding: [20, 20] }); }
}

// ---------- Ficha de finca ----------
export async function pantallaFinca(id, main) {
  const f = finca(id); if (!f) return main.innerHTML = '<p>No encontrada.</p>';
  const ss = sectoresDe(id), ha = ss.reduce((a, s) => a + (+s.sup_ha || 0), 0), arb = ss.reduce((a, s) => a + arboles(s), 0);
  main.innerHTML = `<div class="fila"><h1 class="sp">🏡 ${esc(f.nombre)}</h1><a class="btn" href="#/finca-editar/${id}">Editar</a></div>
   <p class="mu">${esc(f.municipio || '')}${f.provincia ? ' · ' + esc(PROVINCIA[f.provincia] || '') : ''}</p>
   <div class="kpi"><div><b>${ss.length}</b><span>sectores</span></div><div><b>${num(ha, 2)}</b><span>hectáreas</span></div><div><b>${num(arb)}</b><span>árboles</span></div></div>
   <div class="card" id="clima"><h2>El tiempo</h2><p class="mu">Cargando…</p></div>
   <div class="card"><div class="fila"><h2 class="sp">Sectores</h2><a class="btn pri" href="#/sector-editar/nuevo?finca=${id}">+ Sector</a></div>
   ${ss.length ? `<ul class="lista">${ss.map(s => { const v = variedadDe(s); return `<li><a class="li" href="#/sector/${s.id}"><span style="font-size:24px">🌳</span><span class="t"><b>${esc(s.nombre)}</b><small>${esc(v.nombre)} · ${s.anyo ? 'plantado en ' + s.anyo + ' · ' : ''}${num(s.sup_ha, 2)} ha · ${num(arboles(s))} árboles</small></span><span class="mu">›</span></a></li>`; }).join('')}</ul>` :
     '<p class="mu">Un sector es un trozo de la finca con la misma variedad y el mismo riego (normalmente un recinto SIGPAC). Añade el primero.</p>'}
   </div>
   <div id="mp" class="mapa"></div>
   <div class="card"><div class="fila"><h2 class="sp">Últimas anotaciones</h2><a href="#/historial?finca=${id}">Ver todo</a></div>${listaRegistros(registrosFinca(id), 8)}</div>`;
  const conGeo = ss.filter(s => s.geo);
  const m = mapa($('#mp', main), f.lat ? [f.lat, f.lng] : null, 16);
  if (conGeo.length) m.fitBounds(window.L.featureGroup(conGeo.map(s => window.L.polygon(s.geo, ESTILO).addTo(m).bindTooltip(esc(s.nombre), { permanent: true, direction: 'center' }))).getBounds(), { maxZoom: 18, padding: [20, 20] });
  if (f.lat) climaFinca(f, $('#clima', main));
  else $('#clima', main).innerHTML = '<h2>El tiempo</h2><p class="mu">Pon la ubicación de la finca (Editar) para ver el tiempo y calcular el riego.</p>';
}

export function iconoTiempo(c) {
  if (c == null) return '';
  if (c >= 95) return '⛈️'; if (c >= 71 && c <= 77) return '🌨️'; if (c >= 51) return '🌧️'; if (c >= 45) return '🌫️'; if (c >= 3) return '☁️'; if (c >= 1) return '⛅'; return '☀️';
}
export async function climaFinca(f, el) {
  try {
    const w = await meteo(f.lat, f.lng), d = w.daily, hoy = hoyISO(), i0 = d.time.indexOf(hoy);
    const dias = d.time.map((t, i) => i).filter(i => i >= i0 && i < i0 + 7);
    const lluvia7 = d.time.reduce((a, t, i) => a + (t < hoy && i >= i0 - 7 ? d.precipitation_sum[i] || 0 : 0), 0);
    const helada = dias.filter(i => d.temperature_2m_min[i] <= 1);
    el.innerHTML = `<h2>El tiempo <span class="mu">· Open-Meteo</span></h2>
      <div class="scroll"><table class="tabla"><tr>${dias.map(i => `<th class="n">${i === i0 ? 'Hoy' : diaSemana(d.time[i])}</th>`).join('')}</tr>
      <tr>${dias.map(i => `<td class="n" style="font-size:20px">${iconoTiempo(d.weather_code[i])}</td>`).join('')}</tr>
      <tr>${dias.map(i => `<td class="n">${num(d.temperature_2m_max[i])}°<br><small>${num(d.temperature_2m_min[i])}°</small></td>`).join('')}</tr>
      <tr>${dias.map(i => `<td class="n"><small>${d.precipitation_sum[i] ? num(d.precipitation_sum[i], 1) + ' mm' : '—'}</small></td>`).join('')}</tr></table></div>
      <p class="mu">Lluvia de los últimos 7 días: ${num(lluvia7, 1)} mm. ETo de hoy: ${num(d.et0_fao_evapotranspiration[i0], 1)} mm.</p>
      ${helada.length ? `<div class="aviso rojo"><span class="i">🥶</span><div><b>Riesgo de helada</b>Mínima de ${num(Math.min(...helada.map(i => d.temperature_2m_min[i])), 1)} °C el ${fecha(d.time[helada[0]], true)}. Si tienes riego, regar la víspera ayuda a proteger.</div></div>` : ''}`;
  } catch (e) { el.innerHTML = `<h2>El tiempo</h2><p class="mu">No se ha podido cargar (${esc(e.message)}).</p>`; }
}

// ---------- Editar finca ----------
export function pantallaEditarFinca(id, main) {
  const f = id === 'nueva' ? {} : finca(id); if (!f) return main.innerHTML = '<p>No encontrada.</p>';
  main.innerHTML = `<h1>${id === 'nueva' ? 'Nueva finca' : 'Editar finca'}</h1><form class="card" id="ff">
   ${campos([['nombre', 'Nombre de la finca', 'text', { req: true, ph: 'El campo de la Foia, Los naranjos…' }], ['municipio', 'Pueblo', 'text', { ph: 'Escribe y pulsa Buscar' }]], f)}
   <div class="fila" style="margin-top:8px"><button type="button" id="bus">🔎 Buscar pueblo</button><button type="button" id="gps">📍 Estoy en la finca</button><span class="mu" id="pos">${f.lat ? `Ubicación: ${(+f.lat).toFixed(4)}, ${(+f.lng).toFixed(4)}` : 'Sin ubicación'}</span></div>
   <div id="res"></div>
   <p class="mu">También puedes tocar en el mapa donde está la finca.</p><div id="mp" class="mapa"></div>
   ${campos([['notas', 'Notas', 'textarea', { full: true }]], f)}
   <div class="acciones"><button class="pri">Guardar</button><button type="button" onclick="history.back()">Cancelar</button>${id === 'nueva' ? '' : '<button type="button" class="pel" id="del">Borrar finca</button>'}</div></form>`;
  const fr = $('#ff', main); let pos = f.lat ? [f.lat, f.lng] : null, mk;
  const m = mapa($('#mp', main), pos, pos ? 15 : 6);
  const poner = (lat, lng, zoom) => { pos = [lat, lng]; if (mk) mk.setLatLng(pos); else mk = window.L.marker(pos).addTo(m); if (zoom) m.setView(pos, zoom); $('#pos', main).textContent = `Ubicación: ${lat.toFixed(4)}, ${lng.toFixed(4)}`; };
  if (pos) poner(pos[0], pos[1]);
  m.on('click', e => poner(e.latlng.lat, e.latlng.lng));
  $('#bus', main).onclick = async () => {
    const q = fr.elements.municipio.value.trim(); if (!q) return toast('Escribe el nombre del pueblo');
    try {
      const r = await buscarLugar(q);
      $('#res', main).innerHTML = r.length ? '<ul class="lista">' + r.map((x, i) => `<li><button type="button" class="min" data-i="${i}">Elegir</button><span class="t"><b>${esc(x.nombre)}</b><small>${esc(x.zona)}</small></span></li>`).join('') + '</ul>' : '<p class="mu">No encontrado.</p>';
      $('#res', main).onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; const x = r[+b.dataset.i]; fr.elements.municipio.value = x.nombre; poner(x.lat, x.lng, 14); $('#res', main).innerHTML = ''; };
    } catch { toast('Sin conexión para buscar'); }
  };
  $('#gps', main).onclick = () => navigator.geolocation ? navigator.geolocation.getCurrentPosition(p => poner(p.coords.latitude, p.coords.longitude, 17), () => toast('No se ha podido obtener la ubicación'), { enableHighAccuracy: true, timeout: 15000 }) : toast('Este dispositivo no da la ubicación');
  fr.onsubmit = async e => {
    e.preventDefault();
    const o = { ...f, ...leerForm(fr) };
    if (pos) { o.lat = +pos[0].toFixed(5); o.lng = +pos[1].toFixed(5); }
    const g = await guardar('fincas', o);
    toast('Finca guardada');
    location.replace(id === 'nueva' ? `#/sector-editar/nuevo?finca=${g.id}` : `#/finca/${g.id}`);
  };
  const del = $('#del', main);
  if (del) del.onclick = async () => {
    if (!await confirmar(`Se borrará «${f.nombre}» con sus ${sectoresDe(id).length} sectores. Las anotaciones se conservan en el historial.`, 'Borrar')) return;
    for (const s of sectoresDe(id)) await borrar('sectores', s.id);
    await borrar('fincas', id); toast('Finca borrada'); location.replace('#/fincas');
  };
}

// ---------- Editar sector (asistente con SIGPAC) ----------
export function pantallaEditarSector(id, q, main) {
  const s = id === 'nuevo' ? { finca: q.finca, goteros: 4, caudal: 4, suelo: 'franco', marco_x: 6, marco_y: 4 } : sector(id);
  if (!s) return main.innerHTML = '<p>No encontrado.</p>';
  const f = finca(s.finca);
  const vars = opcionesAgrupadas([...CAT.variedades].sort((a, b) => a.especie.localeCompare(b.especie) || 0), v => CAT.especies[v.especie].nombre + ' · ' + v.grupo);
  const mesesO = [['', 'Según la variedad'], ...MESES.map((m, i) => [i + 1, m])];
  main.innerHTML = `<h1>${id === 'nuevo' ? 'Nuevo sector' : 'Editar sector'}</h1><p class="mu">${esc(f?.nombre || '')}</p>
  <form class="card" id="fs">
   <h2>1 · Dónde está</h2>
   <p class="mu">Toca la parcela en el mapa o escribe su referencia SIGPAC (provincia-municipio-polígono-parcela-recinto). Así se rellenan solos el linde, la superficie y la pendiente.</p>
   <div class="fila"><input id="ref" class="sp" placeholder="46-149-89-5-1" value="${esc(s.ref || '')}" style="max-width:260px"><button type="button" id="bref">Buscar</button><span class="mu" id="est"></span></div>
   <div id="lst"></div>
   <div id="mp" class="mapa alto"></div>
   <div id="info"></div>
   <h2 style="margin-top:16px">2 · Qué hay plantado</h2>
   ${campos([
    ['nombre', 'Nombre del sector', 'text', { req: true, ph: 'Parcela de abajo, Sector 1…' }],
    ['variedad', 'Variedad', 'select', { o: vars, req: true, vacio: 'Elige la variedad' }],
    ['patron', 'Patrón (portainjerto)', 'select', { o: CAT.patrones.map(p => [p.id, p.nombre]) , def: 'desconocido' }],
    ['anyo', 'Año de plantación', 'number', { ph: '2005' }],
    ['sup_ha', 'Superficie (ha)', 'number'],
    ['marco_x', 'Marco: entre filas (m)', 'number'], ['marco_y', 'Marco: entre árboles (m)', 'number'],
    ['arboles', 'Número de árboles', 'number', { ayuda: 'Si lo dejas vacío se calcula con la superficie y el marco' }],
    ['copa', 'Diámetro de copa (m)', 'number', { ayuda: 'Para ajustar el riego en árboles jóvenes' }],
    ['prod_esp', 'Producción esperada (t/ha)', 'number', { ayuda: 'Ajusta el abonado. Vacío = media de la especie' }],
    ['rec_ini', 'Empiezo a recoger en', 'select', { o: mesesO }], ['rec_fin', 'Termino de recoger en', 'select', { o: mesesO }]
   ], s)}
   <h2 style="margin-top:16px">3 · Riego y suelo</h2>
   ${campos([
    ['goteros', 'Goteros por árbol', 'number'], ['caudal', 'Caudal de cada gotero (l/h)', 'number'],
    ['suelo', 'Tipo de suelo', 'select', { o: [['arenoso', 'Arenoso (suelto)'], ['franco', 'Franco (normal)'], ['arcilloso', 'Arcilloso (pesado)']] }],
    ['rdc', 'Riego deficitario en verano (ahorra agua)', 'check'],
    ['notas', 'Notas', 'textarea', { full: true }]
   ], s)}
   <div class="acciones"><button class="pri">Guardar</button><button type="button" onclick="history.back()">Cancelar</button>${id === 'nuevo' ? '' : '<button type="button" class="pel" id="del">Borrar sector</button>'}</div>
  </form>`;
  const fr = $('#fs', main);
  let rec = s.geo ? { geo: s.geo, ref: s.ref, sup_ha: s.sup_ha, pendiente: s.pendiente, altitud: s.altitud, uso: s.uso, provincia: s.provincia } : null, capa;
  const cIni = s.geo ? centro(s.geo) : (f?.lat ? [f.lat, f.lng] : null);
  const m = mapa($('#mp', main), cIni, 17);
  const pintar = (r, ajustar) => {
    rec = r; if (capa) capa.remove();
    if (r.geo) { capa = window.L.polygon(r.geo, { ...ESTILO, weight: 3 }).addTo(m); if (ajustar) m.fitBounds(capa.getBounds(), { maxZoom: 19, padding: [20, 20] }); }
    $('#ref', main).value = r.ref;
    if (!fr.elements.sup_ha.value) fr.elements.sup_ha.value = r.sup_ha ? +r.sup_ha.toFixed(4) : '';
    $('#info', main).innerHTML = `<div class="aviso ${/^C/.test(r.uso) ? 'ver' : 'ama'}"><span class="i">${/^C/.test(r.uso) ? '✅' : 'ℹ️'}</span><div><b>Recinto ${esc(r.ref)}</b>${num(r.sup_ha, 4)} ha · uso ${esc(USOS[r.uso] || r.uso)}${r.pendiente != null ? ` · pendiente ${num(r.pendiente, 1)} %` : ''}${r.altitud != null ? ` · ${num(r.altitud)} m de altitud` : ''}${r.regadio ? ` · regadío ${r.regadio} %` : ''}${/^C/.test(r.uso) ? '' : '<br>Este recinto no figura como cítricos en SIGPAC.'}</div></div>`;
  };
  if (rec) pintar(rec, false);
  const est = t => $('#est', main).textContent = t;
  m.on('click', async e => {
    est('Consultando SIGPAC…');
    try { const r = await recintoEnPunto(e.latlng.lat, e.latlng.lng); fr.elements.sup_ha.value = ''; pintar(r, false); est(''); }
    catch (err) { est(err.message); }
  });
  $('#bref', main).onclick = async () => {
    est('Consultando SIGPAC…');
    try {
      const l = await recintosPorReferencia($('#ref', main).value); est('');
      if (l.length === 1) { fr.elements.sup_ha.value = ''; return pintar(l[0], true); }
      $('#lst', main).innerHTML = `<p>La parcela tiene ${l.length} recintos. Elige uno:</p><ul class="lista">${l.map((r, i) => `<li><button type="button" class="min" data-i="${i}">Elegir</button><span class="t"><b>Recinto ${r.ref.split('-').pop()}</b><small>${num(r.sup_ha, 4)} ha · ${esc(USOS[r.uso] || r.uso)}</small></span></li>`).join('')}</ul>`;
      $('#lst', main).onclick = ev => { const b = ev.target.closest('[data-i]'); if (!b) return; fr.elements.sup_ha.value = ''; pintar(l[+b.dataset.i], true); $('#lst', main).innerHTML = ''; };
    } catch (err) { est(err.message); }
  };
  fr.onsubmit = async e => {
    e.preventDefault();
    const o = { ...s, ...leerForm(fr) };
    if (rec) Object.assign(o, { geo: rec.geo, ref: rec.ref, pendiente: rec.pendiente, altitud: rec.altitud, uso: rec.uso, provincia: rec.provincia });
    else o.ref = $('#ref', main).value.trim();
    if (!o.rec_ini || !o.rec_fin) { o.rec_ini = ''; o.rec_fin = ''; }
    const g = await guardar('sectores', o);
    // La finca toma la provincia y, si no la tiene, la ubicación del sector
    if (f && rec) { const c = centro(rec.geo); const fo = { ...f }; let cambia = false; if (!f.provincia && rec.provincia) { fo.provincia = rec.provincia; cambia = true; } if (!f.lat && c) { fo.lat = +c[0].toFixed(5); fo.lng = +c[1].toFixed(5); cambia = true; } if (cambia) await guardar('fincas', fo); }
    toast('Sector guardado'); location.replace(`#/sector/${g.id}`);
  };
  const del = $('#del', main);
  if (del) del.onclick = async () => { if (await confirmar(`Se borrará el sector «${s.nombre}». Sus anotaciones se conservan.`, 'Borrar')) { await borrar('sectores', id); toast('Borrado'); location.replace(`#/finca/${s.finca}`); } };
}

// ---------- Ficha de sector ----------
export function barraCalendario(s, mesHoy = new Date().getMonth()) {
  const f = fases(s);
  return `<div class="cal">${f.map((x, i) => `<div class="${i === mesHoy ? 'hoy' : ''}" style="background:${FASE[x][1]}" title="${MESES[i]}: ${FASE[x][0]}">${MES3[i][0].toUpperCase()}</div>`).join('')}</div>`;
}
export const leyendaFases = () => `<div class="ley">${Object.values(FASE).map(([n, c]) => `<span><i style="background:${c}"></i>${n}</span>`).join('')}</div>`;

export async function pantallaSector(id, main) {
  const s = sector(id); if (!s) return main.innerHTML = '<p>No encontrado.</p>';
  const f = finca(s.finca), v = variedadDe(s), e = especieDe(s), p = CAT.P[s.patron], mes = new Date().getMonth(), r = recoleccion(s);
  const anot = Object.entries(TIPOS).slice(0, 8).map(([k, t]) => `<a class="btn" href="#/registro/nuevo?tipo=${k}&sector=${id}">${t.e} ${t.n}</a>`).join('');
  const ab = abonadoMes(s, mes, { n: D.ajustes.abono_n, p: D.ajustes.abono_p, k: D.ajustes.abono_k }, registrosDe(id, 'analisis'));
  const pl = plagasMes(s, mes + 1);
  main.innerHTML = `<div class="fila"><h1 class="sp">🌳 ${esc(s.nombre)}</h1><a class="btn" href="#/sector-editar/${id}">Editar</a></div>
  <p class="mu"><a href="#/finca/${s.finca}">${esc(f?.nombre || '')}</a>${s.ref ? ' · SIGPAC ' + esc(s.ref) : ''}</p>
  <div class="kpi"><div><b>${esc(v.nombre)}</b><span>${esc(e.nombre)} · ${esc(v.grupo)}</span></div><div><b>${num(s.sup_ha, 2)} ha</b><span>${num(arboles(s))} árboles</span></div>
   <div><b>${s.anyo ? edad(s) + ' años' : '—'}</b><span>${s.anyo ? 'plantado en ' + s.anyo : 'edad desconocida'}</span></div><div><b>${num(s.marco_x, 2)} × ${num(s.marco_y, 2)}</b><span>marco (m)</span></div></div>
  <div class="card"><h2>Anotar</h2><div class="fila">${anot}<a class="btn" href="#/anotar?sector=${id}">Más…</a></div></div>
  <div class="card"><h2>Calendario <span class="mu">· recolección de ${MESES[r[0] - 1]} a ${MESES[r[1] - 1]}</span></h2>${barraCalendario(s)}${leyendaFases()}</div>
  <div class="card" id="riego"><h2>💧 Riego</h2><p class="mu">Calculando…</p></div>
  <div class="card"><h2>🧪 Abonado de ${MESES[mes]}</h2>${tablaAbonado(ab)}<p><a href="#/abonado">Plan de todo el año</a></p></div>
  <div class="card"><h2>🔎 Qué vigilar en ${MESES[mes]}</h2>${pl.length ? pl.map(x => `<p><b>${esc(x.nombre)}</b>${x.clave ? ' <span class="chip ac">clave en ' + esc(v.nombre) + '</span>' : ''}<br><small>${esc(x.umbral)}</small></p>`).join('') : '<p class="mu">Nada especial este mes.</p>'}<p><a href="#/plagas">Todas las plagas</a></p></div>
  <div class="card"><h2>Sobre la variedad</h2><ul>${v.rasgos.map(x => `<li>${esc(x)}</li>`).join('')}</ul>${p && p.id !== 'desconocido' ? `<p><b>Patrón ${esc(p.nombre)}:</b> ${esc(p.nota)}</p>` : ''}<p><a href="#/variedad/${v.id}">Ficha completa</a></p></div>
  <div class="card"><div class="fila"><h2 class="sp">Historial</h2></div>${listaRegistros(registrosDe(id), 15)}</div>
  ${s.geo ? '<div id="mp" class="mapa"></div>' : ''}`;
  if (s.geo) { const m = mapa($('#mp', main), centro(s.geo), 18); m.fitBounds(window.L.polygon(s.geo, ESTILO).addTo(m).getBounds(), { maxZoom: 19, padding: [16, 16] }); }
  const el = $('#riego', main);
  if (!f?.lat) return el.innerHTML = '<h2>💧 Riego</h2><p class="mu">Pon la ubicación de la finca para calcular el riego con el clima real.</p>';
  try { el.innerHTML = '<h2>💧 Riego</h2>' + tarjetaRiego(s, balanceRiego(s, await meteo(f.lat, f.lng), registrosDe(id, 'riego'))); }
  catch (err) { el.innerHTML = `<h2>💧 Riego</h2><p class="mu">Sin datos del tiempo (${esc(err.message)}).</p>`; }
}

export function tarjetaRiego(s, b) {
  const h = x => x < 1 ? `${num(x * 60)} min` : `${num(x, 1)} h`;
  const pct = Math.min(100, Math.round(b.Dr / b.TAW * 100));
  const lluv = b.lluviaProx >= 5 ? ` Se esperan ${num(b.lluviaProx)} mm de lluvia en 3 días.` : '';
  const cab = !b.seguimiento
    ? `<div class="aviso azul"><span class="i">💧</span><div><b>Esta semana: unas ${h(b.diario_h)} de riego al día</b>Anota tus riegos y la app llevará la cuenta del agua que queda en el suelo.${lluv}</div></div>`
    : `<div class="aviso ${b.urgente ? 'rojo' : b.Dr > b.RAW * 0.7 ? 'ama' : 'ver'}"><span class="i">${b.urgente ? '🚨' : '💧'}</span><div>
    <b>${b.urgente ? `Hay que regar: ${h(b.reponer_h)} para reponer` : b.Dr > b.RAW * 0.7 ? 'Pronto tocará regar' : 'El suelo tiene agua suficiente'}</b>
    El suelo ha gastado ${num(b.Dr)} de ${num(b.TAW)} mm de agua útil (${pct} %).${lluv}</div></div>`;
  return `${cab}
    <div class="kpi"><div><b>${h(b.diario_h)}</b><span>al día esta semana</span></div><div><b>${num(b.semana_l / 7)} l</b><span>por árbol y día</span></div><div><b>${num(b.semana_l * arboles(s) / 1000, 1)} m³</b><span>agua del sector en 7 días</span></div><div><b>${num(b.q)} l/h</b><span>caudal por árbol</span></div></div>
    <p class="mu">FAO-56 con la ETo de Open-Meteo y el Kc de ${esc(especieDe(s).nombre.toLowerCase())}. Incluye los riegos que has anotado. Orientativo: revisa la humedad del suelo.</p>`;
}
export function tablaAbonado(ab) {
  if (!ab.cant.length) return '<p class="mu">Este mes no toca abonar.</p>';
  return `<p>Para todo el sector (${num(ab.anual.arboles)} árboles): <b>${num(ab.u.N, 1)} kg de N</b>, ${num(ab.u.P, 1)} kg de P₂O₅ y ${num(ab.u.K, 1)} kg de K₂O.</p>
   <ul>${ab.cant.map(c => `<li><b>${num(c.v, 1)} ${c.u}</b> de ${esc(c.nombre)}</li>`).join('')}</ul>${ab.anual.notas.map(n => `<p class="mu">${esc(n)}</p>`).join('')}
   <p class="mu">Repártelo en los riegos del mes. Orientativo según el IVIA: ajústalo con tu análisis foliar.</p>`;
}
