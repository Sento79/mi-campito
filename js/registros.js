// Anotaciones: riego, abonado, tratamientos, cosecha, gastos…
import { guardar, borrar, guardarFoto, leerFoto, nuevoId } from './db.js';
import { D, sector, finca, nombreSector, fincaDeRegistro } from './estado.js';
import { CAT, ufDeAbonos, litrosRiego, indiceMadurez, hoyISO } from './calc.js';
import { esc, campos, leerForm, toast, confirmar, num, eur, fecha, reducirFoto, $ } from './ui.js';

const GASTOS = ['Abonos', 'Fitosanitarios', 'Agua y luz del riego', 'Mano de obra', 'Recolección', 'Maquinaria y gasoil', 'Seguro agrario', 'Cuotas (comunidad de regantes, cooperativa)', 'Planta y replantes', 'Reparaciones', 'Impuestos', 'Otros'];
const LABORES = ['Poda', 'Desbroce o siega', 'Laboreo', 'Herbicida', 'Aclareo de frutos', 'Injerto o replante', 'Mantenimiento del riego', 'Otra'];

export const TIPOS = {
  riego: { n: 'Riego', e: '💧', d: 'Horas o litros por árbol' },
  abonado: { n: 'Abonado', e: '🧪', d: 'Abonos echados con el riego o a mano' },
  tratamiento: { n: 'Tratamiento', e: '🛡️', d: 'Para el cuaderno de campo' },
  plaga: { n: 'Plaga vista', e: '🔎', d: 'Lo que has visto en el campo' },
  labor: { n: 'Labor', e: '✂️', d: 'Poda, desbroce, aclareo…' },
  madurez: { n: 'Madurez', e: '📏', d: 'Grados Brix, acidez y color' },
  cosecha: { n: 'Cosecha', e: '🍊', d: 'Kilos vendidos y precio' },
  gasto: { n: 'Gasto', e: '💶', d: 'Abonos, agua, jornales…' },
  ingreso: { n: 'Ingreso', e: '💰', d: 'Ayudas PAC, seguro, otros' },
  analisis: { n: 'Análisis', e: '🧾', d: 'Hoja, suelo o agua' },
  tarea: { n: 'Tarea', e: '✅', d: 'Algo que tienes que hacer' },
  nota: { n: 'Nota o foto', e: '📝', d: 'Lo que quieras apuntar' }
};

function opcionesSector(conFinca) {
  const o = [];
  for (const f of D.fincas) {
    o.push([null, null, f.nombre]);
    if (conFinca) o.push(['f:' + f.id, 'Toda la finca']);
    for (const s of D.sectores.filter(s => s.finca === f.id)) o.push([s.id, s.nombre || 'Sector']);
  }
  return o;
}
function opcionesPlaga() { return [...CAT.plagas.map(p => [p.id, p.nombre]), ['otra', 'Otra']]; }

function camposDe(tipo, r) {
  const sec = ['sector', 'Dónde', 'select', { o: opcionesSector(['gasto', 'ingreso', 'tarea', 'nota'].includes(tipo)), req: true }];
  const f = ['fecha', 'Fecha', 'date', { req: true }];
  const nota = ['nota', 'Nota', 'textarea', { full: true }];
  switch (tipo) {
    case 'riego': return [f, sec, ['horas', 'Horas de riego', 'number', { ayuda: 'O pon los litros por árbol' }], ['litros', 'Litros por árbol', 'number'], nota];
    case 'abonado': return [f, sec, nota];
    case 'tratamiento': return [f, sec,
      ['plaga', 'Contra', 'select', { o: opcionesPlaga(), req: true }], ['producto', 'Producto (nombre comercial)', 'text', { req: true }],
      ['n_registro', 'Nº de registro', 'text', { ayuda: 'Está en la etiqueta (Registro de Productos Fitosanitarios)' }], ['materia', 'Materia activa', 'text'],
      ['dosis', 'Dosis', 'number'], ['dosis_u', 'Unidad', 'select', { o: [['l/ha', 'l/ha'], ['kg/ha', 'kg/ha'], ['cc/hl', 'cc/hl'], ['g/hl', 'g/hl'], ['%', '%']] }],
      ['caldo', 'Caldo total (litros)', 'number'], ['sup_ha', 'Superficie tratada (ha)', 'number'],
      ['plazo', 'Plazo de seguridad (días)', 'number'], ['equipo', 'Equipo', 'text', { ph: 'Atomizador, mochila…' }],
      ['aplicador', 'Aplicador', 'text'], ['ropo', 'Nº carné (ROPO)', 'text'], nota];
    case 'plaga': return [f, sec, ['plaga', 'Plaga o enfermedad', 'select', { o: opcionesPlaga(), req: true }],
      ['nivel', 'Cuánta hay', 'select', { o: [['bajo', 'Poca'], ['medio', 'Bastante'], ['alto', 'Mucha']] }], ['pct', '% de hojas o frutos con plaga', 'number', { min: 0 }], nota];
    case 'labor': return [f, sec, ['labor', 'Labor', 'select', { o: LABORES.map(x => [x, x]) }], ['horas', 'Horas', 'number'], nota];
    case 'madurez': return [f, sec, ['brix', 'Grados Brix', 'number', { req: true }], ['acidez', 'Acidez (g/l)', 'number', { req: true }],
      ['color', 'Color (escala −10 a +10)', 'number'], ['calibre', 'Calibre medio (mm)', 'number'], ['zumo', '% de zumo', 'number'], nota];
    case 'cosecha': return [f, sec, ['kg', 'Kilos', 'number', { req: true }], ['precio', 'Precio (€/kg)', 'number'], ['comprador', 'Comprador', 'text', { ph: 'Cooperativa, comercio…' }], nota];
    case 'gasto': return [f, sec, ['categoria', 'Tipo de gasto', 'select', { o: GASTOS.map(x => [x, x]) }], ['concepto', 'Concepto', 'text'], ['importe', 'Importe (€)', 'number', { req: true }], nota];
    case 'ingreso': return [f, sec, ['concepto', 'Concepto', 'text', { req: true, ph: 'Ayuda PAC, indemnización del seguro…' }], ['importe', 'Importe (€)', 'number', { req: true }], nota];
    case 'analisis': return [f, sec, ['tipo_analisis', 'Tipo', 'select', { o: [['hoja', 'Hoja (foliar)'], ['suelo', 'Suelo'], ['agua', 'Agua de riego']] }],
      ['N', 'Nitrógeno en hoja (%)', 'number'], ['nitratos', 'Nitratos en el agua (mg/l)', 'number'], ['ph', 'pH', 'number'], ['ce', 'Conductividad (dS/m)', 'number'],
      ['caliza', 'Caliza activa en suelo (%)', 'number'], ['nota', 'Resultados y observaciones', 'textarea', { full: true }]];
    case 'tarea': return [['fecha', 'Para cuándo', 'date', { req: true }], sec, ['texto', 'Qué hay que hacer', 'text', { req: true, full: true }], ['hecha', 'Hecha', 'check']];
    case 'nota': return [f, sec, ['texto', 'Nota', 'textarea', { full: true }]];
  }
  return [f, sec, nota];
}

export function resumen(r) {
  const s = sector(r.sector);
  switch (r.tipo) {
    case 'riego': return r.horas ? `${num(r.horas, 1)} h` + (s ? ` · ${num(litrosRiego(s, r))} l/árbol` : '') : `${num(r.litros)} l/árbol`;
    case 'abonado': return (r.productos || []).map(p => `${num(p.v, 1)} ${CAT.F[p.id]?.u || ''} ${CAT.F[p.id]?.nombre || p.id}`).join(', ') || 'Abonado';
    case 'tratamiento': return `${r.producto || ''} · ${CAT.PL[r.plaga]?.nombre || 'otra'}${r.plazo ? ` · plazo ${r.plazo} días` : ''}`;
    case 'plaga': return `${CAT.PL[r.plaga]?.nombre || 'Otra'} · ${({ bajo: 'poca', medio: 'bastante', alto: 'mucha' })[r.nivel] || ''}${r.pct != null ? ` (${num(r.pct)} %)` : ''}`;
    case 'labor': return `${r.labor}${r.horas ? ` · ${num(r.horas, 1)} h` : ''}`;
    case 'madurez': { const im = indiceMadurez(r.brix, r.acidez); return `IM ${num(im, 1)} · ${num(r.brix, 1)} °Bx · ${num(r.acidez, 2)} g/l${r.color != null ? ` · color ${r.color}` : ''}`; }
    case 'cosecha': return `${num(r.kg)} kg${r.precio ? ` × ${num(r.precio, 3)} €/kg = ${eur(r.kg * r.precio)}` : ''}`;
    case 'gasto': return `${r.categoria}${r.concepto ? ' · ' + r.concepto : ''} · ${eur(r.importe)}`;
    case 'ingreso': return `${r.concepto} · ${eur(r.importe)}`;
    case 'analisis': return `${({ hoja: 'Foliar', suelo: 'Suelo', agua: 'Agua' })[r.tipo_analisis]}${r.N ? ` · N ${r.N} %` : ''}${r.nitratos ? ` · nitratos ${r.nitratos} mg/l` : ''}`;
    case 'tarea': return (r.hecha ? '✔ ' : '') + r.texto;
    case 'nota': return (r.texto || '').slice(0, 90) + (r.foto ? ' 📷' : '');
  }
  return '';
}
export function donde(r) {
  if (r.sector) return nombreSector(sector(r.sector));
  const f = finca(r.finca); return f ? f.nombre : '—';
}

// Pantalla de elegir tipo
export function pantallaAnotar(q) {
  if (!D.sectores.length) return `<h1>Anotar</h1><div class="card vacio"><div class="ico">🌱</div><p>Primero da de alta una finca y un sector.</p><a class="btn pri" href="#/finca-editar/nueva">Añadir finca</a></div>`;
  const extra = q.sector ? '&sector=' + encodeURIComponent(q.sector) : '';
  return `<h1>¿Qué quieres anotar?</h1><div class="menu">${Object.entries(TIPOS).map(([k, t]) =>
    `<a href="#/registro/nuevo?tipo=${k}${extra}"><span class="e">${t.e}</span><b>${t.n}</b><small class="mu">${t.d}</small></a>`).join('')}</div>`;
}

// Formulario de registro (nuevo o existente)
export async function pantallaRegistro(id, q, main) {
  const r = id === 'nuevo' ? { tipo: q.tipo || 'nota', fecha: hoyISO(), sector: q.sector || (D.sectores.length === 1 ? D.sectores[0].id : '') } : D.registros.find(x => x.id === id);
  if (!r) return main.innerHTML = '<p>No encontrado.</p>';
  const t = TIPOS[r.tipo] || TIPOS.nota, nuevo = id === 'nuevo';
  const val = { ...r, sector: r.sector || (r.finca ? 'f:' + r.finca : '') };
  if (r.tipo === 'tratamiento' && nuevo) { val.aplicador = D.ajustes.titular; val.ropo = D.ajustes.ropo; const s = sector(r.sector); if (s) val.sup_ha = s.sup_ha; }
  main.innerHTML = `<h1>${t.e} ${t.n}</h1><form class="card" id="fr">${campos(camposDe(r.tipo, r), val)}
    ${r.tipo === 'abonado' ? `<h3>Abonos</h3><div id="abs"></div><button type="button" class="min" id="addab">+ Añadir abono</button><p class="mu" id="ufs"></p>` : ''}
    ${r.tipo === 'nota' ? `<label>Foto<input type="file" accept="image/*" capture="environment" name="foto_f"></label><div id="fv"></div>` : ''}
    <div class="acciones"><button class="pri">Guardar</button><button type="button" onclick="history.back()">Cancelar</button>${nuevo ? '' : '<button type="button" class="pel" id="del">Borrar</button>'}</div></form>`;
  const fr = $('#fr', main);
  if (r.tipo === 'abonado') {
    const cont = $('#abs', main), opt = CAT.fertilizantes.map(f => `<option value="${f.id}">${esc(f.nombre)} (${f.u})</option>`).join('');
    const fila = (p = {}) => { const d = document.createElement('div'); d.className = 'fila'; d.style.margin = '6px 0';
      d.innerHTML = `<select class="sp" data-ab>${opt}</select><input type="number" step="any" inputmode="decimal" style="width:110px" data-v placeholder="Cantidad" value="${p.v ?? ''}"><button type="button" class="min" aria-label="Quitar">✕</button>`;
      if (p.id) d.querySelector('select').value = p.id; d.querySelector('button').onclick = () => { d.remove(); uf(); }; cont.appendChild(d); };
    const leer = () => [...cont.children].map(d => ({ id: d.querySelector('select').value, v: +d.querySelector('input').value || 0 })).filter(p => p.v > 0);
    const uf = () => { const u = ufDeAbonos(leer()); $('#ufs', main).textContent = `Unidades: ${num(u.N, 1)} kg N · ${num(u.P, 1)} kg P₂O₅ · ${num(u.K, 1)} kg K₂O`; };
    (r.productos?.length ? r.productos : [{}]).forEach(fila);
    $('#addab', main).onclick = () => fila(); cont.addEventListener('input', uf); cont.addEventListener('change', uf); uf();
    fr._productos = leer;
  }
  if (r.tipo === 'nota' && r.foto) leerFoto(r.foto).then(b => { if (b) $('#fv', main).innerHTML = `<img class="foto" src="${URL.createObjectURL(b)}" alt="Foto de la nota">`; });
  fr.onsubmit = async e => {
    e.preventDefault();
    const o = { ...r, ...leerForm(fr) };
    delete o.foto_f;
    if (String(o.sector).startsWith('f:')) { o.finca = o.sector.slice(2); o.sector = ''; } else o.finca = sector(o.sector)?.finca || '';
    if (r.tipo === 'abonado') { o.productos = fr._productos(); Object.assign(o, { uf: ufDeAbonos(o.productos) }); }
    const ff = fr.elements.foto_f?.files?.[0];
    if (ff) { o.foto = o.foto || nuevoId(); await guardarFoto(o.foto, await reducirFoto(ff)); }
    await guardar('registros', o);
    toast('Guardado');
    history.back();
  };
  const del = $('#del', main);
  if (del) del.onclick = async () => { if (await confirmar('Se borrará esta anotación.', 'Borrar')) { await borrar('registros', r.id); toast('Borrado'); history.back(); } };
}

// Lista de anotaciones con filtros
export function listaRegistros(lista, max = 400) {
  if (!lista.length) return '<p class="mu">Todavía no hay nada anotado.</p>';
  return `<ul class="lista">${lista.slice(0, max).map(r => `<li><a class="li" href="#/registro/${r.id}"><span style="font-size:22px">${TIPOS[r.tipo]?.e || '•'}</span>
    <span class="t"><b>${esc(resumen(r))}</b><small>${fecha(r.fecha)} · ${esc(donde(r))}</small></span></a></li>`).join('')}</ul>${lista.length > max ? `<p class="mu">Y ${lista.length - max} más…</p>` : ''}`;
}

export function pantallaHistorial(q) {
  const tipo = q.tipo || '', fid = q.finca || '';
  let l = D.registros.filter(r => (!tipo || r.tipo === tipo) && (!fid || fincaDeRegistro(r)?.id === fid));
  const sel = (n, o, v) => `<select onchange="location.hash='#/historial?'+new URLSearchParams({...Object.fromEntries(new URLSearchParams(location.hash.split('?')[1]||'')),${n}:this.value})">${o.map(([a, b]) => `<option value="${a}"${a === v ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>`;
  return `<h1>Historial</h1><div class="fila" style="margin-bottom:10px">${sel('tipo', [['', 'Todo'], ...Object.entries(TIPOS).map(([k, t]) => [k, t.n])], tipo)}${sel('finca', [['', 'Todas las fincas'], ...D.fincas.map(f => [f.id, f.nombre])], fid)}</div>
  <div class="card">${listaRegistros(l)}</div>`;
}
