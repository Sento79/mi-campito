// Utilidades de pantalla
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const NF = {};
export function num(v, dec = 0) {
  if (v == null || isNaN(v)) return '—';
  const k = dec; NF[k] = NF[k] || new Intl.NumberFormat('es-ES', { maximumFractionDigits: dec, minimumFractionDigits: 0 });
  return NF[k].format(v);
}
export const eur = v => v == null || isNaN(v) ? '—' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v);
export function fecha(iso, larga) {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? iso + 'T12:00' : iso);
  return d.toLocaleDateString('es-ES', larga ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'short', year: 'numeric' });
}
export const diaSemana = iso => new Date(iso + 'T12:00').toLocaleDateString('es-ES', { weekday: 'short' });

let tt;
export function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 2600);
}

// Diálogo modal. Devuelve el elemento <dialog>.
export function dialogo(titulo, html, alAbrir) {
  const d = document.createElement('dialog');
  d.innerHTML = `<div class="cab"><h2>${esc(titulo)}</h2><button class="min" data-cerrar aria-label="Cerrar">✕</button></div><div class="cuerpo">${html}</div>`;
  document.body.appendChild(d);
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-cerrar]')) d.close(); });
  d.showModal();
  alAbrir && alAbrir(d);
  return d;
}
export function confirmar(msg, si = 'Sí') {
  return new Promise(ok => {
    const d = dialogo('¿Seguro?', `<p>${esc(msg)}</p><div class="acciones"><button class="pri" data-si>${esc(si)}</button><button data-cerrar>Cancelar</button></div>`);
    d.querySelector('[data-si]').onclick = () => { ok(true); d.close(); };
    d.addEventListener('close', () => ok(false));
  });
}

// Campos de formulario: [nombre, etiqueta, tipo, opciones]
// tipo: text, number, date, select (opciones [[v,t]]), textarea, check, month
export function campos(defs, obj = {}) {
  return '<div class="campos">' + defs.map(([n, et, tipo = 'text', op = {}]) => {
    const v = obj[n] ?? op.def ?? '';
    const req = op.req ? ' required' : '', ph = op.ph ? ` placeholder="${esc(op.ph)}"` : '', ayuda = op.ayuda ? `<small>${esc(op.ayuda)}</small>` : '';
    const full = op.full ? ' style="grid-column:1/-1"' : '';
    if (tipo === 'select') return `<label${full}>${esc(et)}<select name="${n}"${req}>${(op.vacio ? `<option value="">${esc(op.vacio)}</option>` : '') + op.o.map(([a, b, g]) => g ? `<optgroup label="${esc(g)}">` : `<option value="${esc(a)}"${String(a) === String(v) ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>${ayuda}</label>`;
    if (tipo === 'textarea') return `<label${full}>${esc(et)}<textarea name="${n}"${ph}>${esc(v)}</textarea>${ayuda}</label>`;
    if (tipo === 'check') return `<label class="chk"${full}><input type="checkbox" name="${n}"${v ? ' checked' : ''}> ${esc(et)}</label>`;
    const extra = tipo === 'number' ? ` inputmode="decimal" step="${op.step || 'any'}"${op.min != null ? ` min="${op.min}"` : ''}` : '';
    return `<label${full}>${esc(et)}<input type="${tipo}" name="${n}" value="${esc(v)}"${req}${ph}${extra}>${ayuda}</label>`;
  }).join('') + '</div>';
}
// Lee un formulario a objeto (números como número)
export function leerForm(f) {
  const o = {};
  for (const el of f.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'number') o[el.name] = el.value === '' ? null : +el.value.replace(',', '.');
    else o[el.name] = el.value.trim();
  }
  return o;
}

// Opciones de select agrupadas
export function opcionesAgrupadas(lista, grupo, val = x => x.id, txt = x => x.nombre) {
  const o = []; let g;
  for (const x of lista) { if (grupo(x) !== g) { g = grupo(x); o.push([null, null, g]); } o.push([val(x), txt(x)]); }
  return o;
}

// Reduce una foto a 1280 px y la devuelve como Blob JPEG
export function reducirFoto(file, max = 1280) {
  return new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => { URL.revokeObjectURL(img.src); ok(b); }, 'image/jpeg', 0.82);
    };
    img.onerror = mal;
    img.src = URL.createObjectURL(file);
  });
}

export function descargar(nombre, contenido, tipo = 'application/octet-stream') {
  const b = contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo });
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = nombre;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
export function csv(filas) {
  return '﻿' + filas.map(f => f.map(v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';')).join('\r\n');
}

// Iconos (trazo, 24x24)
const P = {
  hoy: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  fincas: '<path d="M3 20h18M5 20V10l7-5 7 5v10"/><circle cx="12" cy="13" r="3"/>',
  mas: '<path d="M12 5v14M5 12h14"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>'
};
export const ico = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`;
