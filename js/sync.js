// Sincronización opcional con Supabase (servidores en la UE, Fráncfort).
// Sin cuenta la app funciona igual y nada sale del dispositivo.
// Cada fila de 'datos' es un objeto de la app; gana siempre el que tenga 'mod' más reciente.
import { todos, fusionar, leerAjuste, ponerAjuste, todasFotos, guardarFoto, alCambiar, TABLAS } from './db.js';
import { D, recargar } from './estado.js';

// Clave pública del proyecto (hecha para ir dentro de la app; los permisos los pone la base de datos)
export const SB = { url: 'https://kkhrtdzhndgtradqgetf.supabase.co', key: 'sb_publishable_XMvPvtSOLWPL5sOyxAEqSw_lkDulz3S' };
const VOLVER = location.origin + location.pathname;
const AJ_SYNC = ['titular', 'nif', 'ropo', 'ropo_cad', 'abono_n', 'abono_p', 'abono_k', 'tema'];
const LOTE = 500;

let ses = null; // { access_token, refresh_token, expires_at, id, email }
let pendiente = null; // mensaje al volver de un enlace del correo
export const sesion = () => ses;
export const estado = { ocupado: false, ultima: '', error: '' };
const oyentes = new Set();
export const alSincronizar = f => oyentes.add(f);
const avisar = n => oyentes.forEach(f => { try { f(n); } catch (e) { console.error(e); } });

const jwt = t => { try { return JSON.parse(decodeURIComponent(escape(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch { return {}; } };

async function guardarSesion(s) {
  if (s) { const p = jwt(s.access_token); s = { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: +s.expires_at || p.exp, id: p.sub, email: p.email }; }
  ses = s || null;
  await ponerAjuste('sb_sesion', ses);
}

const TXT = {
  invalid_credentials: 'Correo o contraseña incorrectos.',
  email_not_confirmed: 'Todavía no has confirmado el correo. Busca el mensaje de Supabase en tu bandeja de entrada (o en spam).',
  user_already_exists: 'Ya hay una cuenta con ese correo. Pulsa «Entrar».',
  weak_password: 'La contraseña es muy corta: usa al menos 8 caracteres.',
  over_email_send_rate_limit: 'Se han enviado demasiados correos. Prueba dentro de una hora.',
  over_request_rate_limit: 'Demasiados intentos. Espera unos minutos.',
  email_address_invalid: 'Ese correo no es válido.',
  otp_expired: 'El enlace del correo ha caducado o ya se usó. Pide otro.',
  same_password: 'La contraseña nueva es igual que la anterior.',
  refresh_token_not_found: 'Tu sesión ha caducado. Vuelve a entrar.',
  session_not_found: 'Tu sesión ha caducado. Vuelve a entrar.'
};
const error = (j, status) => { const e = new Error(TXT[j.error_code] || TXT[j.code] || j.msg || j.error_description || j.message || 'El servidor ha dado un error (' + status + ').'); e.status = status; e.code = j.error_code || j.code; return e; };

async function auth(camino, cuerpo, token, metodo = 'POST') {
  const r = await fetch(SB.url + '/auth/v1/' + camino, { method: metodo, headers: { apikey: SB.key, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(cuerpo || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw error(j, r.status);
  return j;
}

async function token() {
  if (!ses) throw new Error('No has entrado en tu cuenta.');
  if ((ses.expires_at || 0) - 60 < Date.now() / 1000) {
    try { await guardarSesion(await auth('token?grant_type=refresh_token', { refresh_token: ses.refresh_token })); }
    catch (e) { if (e.status >= 400 && e.status < 500) await guardarSesion(null); throw e; }
  }
  return ses.access_token;
}

async function pedir(metodo, camino, cuerpo, extra = {}) {
  const blob = cuerpo instanceof Blob;
  const h = { apikey: SB.key, Authorization: 'Bearer ' + await token(), ...(cuerpo !== undefined && !blob ? { 'Content-Type': 'application/json' } : {}), ...extra };
  const r = await fetch(SB.url + camino, { method: metodo, headers: h, body: cuerpo === undefined ? undefined : blob ? cuerpo : JSON.stringify(cuerpo) });
  if (!r.ok) throw error(await r.json().catch(() => ({})), r.status);
  return r;
}

// ---- Cuenta ----
export async function crearCuenta(email, password) {
  const j = await auth('signup?redirect_to=' + encodeURIComponent(VOLVER), { email, password });
  if (j.access_token) { await guardarSesion(j); await sincronizar(); return true; }
  return false; // hay que confirmar el correo
}
export async function entrar(email, password) {
  await guardarSesion(await auth('token?grant_type=password', { email, password }));
  await sincronizar();
}
export const recordarClave = email => auth('recover?redirect_to=' + encodeURIComponent(VOLVER), { email });
export const cambiarClave = async password => auth('user', { password }, await token(), 'PUT');

async function olvidarMarcas() { for (const k of ['sb_ultimo', 'sb_push', 'sb_fotos', 'sb_ultima']) await ponerAjuste(k, ''); estado.ultima = ''; }
export async function salir() {
  try { await auth('logout', {}, ses?.access_token); } catch { }
  await guardarSesion(null); await olvidarMarcas(); estado.error = ''; avisar(0);
}
// Borra fotos, datos y cuenta del servidor. Lo del dispositivo se queda.
export async function borrarCuenta() {
  const lista = await (await pedir('POST', '/storage/v1/object/list/fotos', { prefix: ses.id, limit: 10000 })).json();
  if (lista.length) await pedir('DELETE', '/storage/v1/object/fotos', { prefixes: lista.map(f => ses.id + '/' + f.name) });
  try { await pedir('POST', '/rest/v1/rpc/borrar_mi_cuenta', {}); }
  catch (e) { if (e.status !== 404) throw e; await pedir('DELETE', '/rest/v1/datos?user_id=eq.' + ses.id); }
  await guardarSesion(null); await olvidarMarcas(); avisar(0);
}

// ---- Sincronizar ----
export async function sincronizar(manual) {
  if (!ses || estado.ocupado) return;
  if (!navigator.onLine) { estado.error = 'Sin conexión: se sincronizará cuando vuelva.'; avisar(0); return; }
  estado.ocupado = true; estado.error = ''; avisar(0);
  let n = 0;
  try {
    n = await bajar();
    await subir();
    await fotos();
    estado.ultima = new Date().toISOString(); await ponerAjuste('sb_ultima', estado.ultima);
  } catch (e) {
    console.warn('Sincronización', e);
    estado.error = e instanceof TypeError ? 'No se ha podido conectar con el servidor.' : e.message;
  }
  estado.ocupado = false;
  if (n) await recargar();
  avisar(n);
  if (manual && estado.error) throw new Error(estado.error);
  return n;
}

async function bajar() {
  const ini = await leerAjuste('sb_ultimo', '');
  // Margen de un minuto por si una subida de otro dispositivo terminó a la vez: lo repetido no cambia nada
  const desde = ini ? new Date(Date.parse(ini) - 60e3).toISOString() : '';
  let max = ini ? Date.parse(ini) : 0, n = 0;
  for (let off = 0; ; off += LOTE) {
    const q = `/rest/v1/datos?select=tabla,datos,subido&order=subido.asc,id.asc&limit=${LOTE}&offset=${off}` + (desde ? '&subido=gt.' + encodeURIComponent(desde) : '');
    const filas = await (await pedir('GET', q)).json();
    const por = {};
    for (const x of filas) { (por[x.tabla] ||= []).push(x.datos); max = Math.max(max, Date.parse(x.subido)); }
    for (const [t, l] of Object.entries(por)) {
      if (t === 'ajustes') n += await ajustesDeNube(l[l.length - 1]);
      else if (TABLAS.includes(t)) n += await fusionar(t, l);
    }
    if (filas.length < LOTE) break;
  }
  if (max) await ponerAjuste('sb_ultimo', new Date(max).toISOString());
  return n;
}
async function ajustesDeNube(d) {
  if (!d || (d.mod || '') <= await leerAjuste('ajustes_mod', '')) return 0;
  for (const k of AJ_SYNC) if (k in d) { await ponerAjuste(k, d[k]); D.ajustes[k] = d[k]; }
  await ponerAjuste('ajustes_mod', d.mod);
  return 1;
}

async function subir() {
  const desde = await leerAjuste('sb_push', '');
  let max = desde; const filas = [];
  const fila = (t, o, mod) => { filas.push({ user_id: ses.id, id: o.id, tabla: t, datos: o, mod, borrado: !!o.borrado }); if (mod > max) max = mod; };
  for (const t of TABLAS) for (const o of await todos(t, true)) if ((o.mod || '') > desde) fila(t, o, o.mod);
  const am = await leerAjuste('ajustes_mod', '');
  if (am > desde) { const d = { id: 'ajustes', mod: am }; for (const k of AJ_SYNC) d[k] = await leerAjuste(k, D.ajustes[k] ?? ''); fila('ajustes', d, am); }
  for (let i = 0; i < filas.length; i += 200)
    await pedir('POST', '/rest/v1/datos?on_conflict=user_id,id', filas.slice(i, i + 200), { Prefer: 'resolution=merge-duplicates,return=minimal' });
  if (max !== desde) await ponerAjuste('sb_push', max);
}

async function fotos() {
  const desde = await leerAjuste('sb_fotos', '');
  let max = desde;
  const locales = await todasFotos(), tengo = new Set(locales.map(f => f.id));
  for (const f of locales) if (f.mod && f.mod > desde) {
    await pedir('POST', `/storage/v1/object/fotos/${ses.id}/${f.id}`, f.blob, { 'x-upsert': 'true', 'Content-Type': f.blob.type || 'image/jpeg' });
    if (f.mod > max) max = f.mod;
  }
  if (max !== desde) await ponerAjuste('sb_fotos', max);
  // Fotos que vienen de otro dispositivo (se guardan sin fecha para no volver a subirlas)
  for (const r of D.registros) if (r.foto && !tengo.has(r.foto)) {
    try { await guardarFoto(r.foto, await (await pedir('GET', `/storage/v1/object/authenticated/fotos/${ses.id}/${r.foto}`)).blob(), ''); }
    catch (e) { if (e.status !== 400 && e.status !== 404) throw e; }
  }
}

// ---- Arranque y sincronización automática ----
let temp;
export function programar(ms = 4000) { if (!ses) return; clearTimeout(temp); temp = setTimeout(() => sincronizar(), ms); }
export async function ajustesCambiados() { await ponerAjuste('ajustes_mod', new Date().toISOString()); programar(1000); }
export const mensajePendiente = () => { const m = pendiente; pendiente = null; return m; };

async function recibirEnlace() {
  const h = location.hash;
  if (!/access_token=|error_description=/.test(h)) return;
  const p = new URLSearchParams(h.replace(/^#\/?/, ''));
  history.replaceState(null, '', location.pathname + location.search + '#/ajustes');
  if (p.get('error_description')) { pendiente = { error: TXT[p.get('error_code')] || p.get('error_description') }; return; }
  await guardarSesion({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_at: p.get('expires_at') });
  pendiente = { tipo: p.get('type') }; // signup, recovery, magiclink
}

export async function iniciarSync() {
  ses = await leerAjuste('sb_sesion', null);
  estado.ultima = await leerAjuste('sb_ultima', '');
  await recibirEnlace();
  alCambiar(t => {
    if (t === '*') { ses = null; clearTimeout(temp); return; } // «Borrar todo» cierra también la sesión en este dispositivo
    if (!estado.ocupado) programar();
  });
  addEventListener('online', () => programar(500));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') programar(1500); });
  setInterval(() => { if (document.visibilityState === 'visible') programar(0); }, 15 * 60e3);
  if (ses) programar(800);
}
