// Ajustes, copia de seguridad y ayuda
import { todos, fusionar, guardarFoto, todasFotos, ponerAjuste, borrarTodo, TABLAS } from './db.js';
import { D, recargar } from './estado.js';
import { CAT } from './calc.js';
import { esc, campos, leerForm, toast, confirmar, dialogo, descargar, fecha, $ } from './ui.js';
import * as S from './sync.js';

const b64 = blob => new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });
async function comprimir(txt) {
  if (!window.CompressionStream) return new Blob([txt], { type: 'application/json' });
  return new Response(new Blob([txt]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
}
async function descomprimir(file) {
  const buf = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) return new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return file.text();
}

export async function exportar() {
  const o = { app: 'micampito', version: 1, fecha: new Date().toISOString(), ajustes: D.ajustes, fotos: [] };
  for (const t of TABLAS) o[t] = await todos(t, true);
  for (const f of await todasFotos()) o.fotos.push({ id: f.id, mod: f.mod, d: await b64(f.blob) });
  const blob = await comprimir(JSON.stringify(o));
  descargar(`mi-campito-${new Date().toISOString().slice(0, 10)}.micampito`, blob);
  await ponerAjuste('ultimaCopia', o.fecha); D.ajustes.ultimaCopia = o.fecha;
  toast('Copia descargada');
}
export async function importar(file) {
  let o;
  try { o = JSON.parse(await descomprimir(file)); } catch { return toast('Ese archivo no es una copia de Mi Campito'); }
  if (o.app !== 'micampito') return toast('Ese archivo no es una copia de Mi Campito');
  let n = 0;
  for (const t of TABLAS) n += await fusionar(t, o[t] || []);
  for (const f of o.fotos || []) await guardarFoto(f.id, await (await fetch(f.d)).blob());
  for (const [k, v] of Object.entries(o.ajustes || {})) if (v && !D.ajustes[k]) await ponerAjuste(k, v);
  await recargar();
  toast(`Copia cargada: ${n} datos nuevos o más recientes`);
}

export function pantallaAjustes(main) {
  const A = D.ajustes, F = CAT.fertilizantes;
  const op = k => F.filter(f => f[k]).map(f => [f.id, f.nombre]);
  const ses = S.sesion(), pend = S.mensajePendiente();
  main.innerHTML = `<h1>Ajustes</h1>
  <div class="card" id="sb"></div>
  <div class="card"><h2>💾 Copia de seguridad</h2><p>${ses ? 'Tus datos están en este dispositivo y en tu cuenta.' : 'Tus datos solo están en este dispositivo.'} Descarga una copia de vez en cuando y guárdala en otro sitio (correo, nube, USB). Con ella puedes pasar todo a otro móvil u ordenador.</p>
   <p class="mu">${A.ultimaCopia ? 'Última copia: ' + fecha(A.ultimaCopia) : 'Todavía no has hecho ninguna copia.'}</p>
   <div class="acciones"><button class="pri" id="exp">⬇️ Descargar copia</button><label class="btn" style="flex-direction:row;color:var(--tx)">⬆️ Cargar copia<input type="file" id="imp" accept=".micampito,application/json,application/gzip" hidden></label></div>
   <p class="mu">Al cargar una copia se juntan los datos: no se pierde nada de lo que ya tienes.</p></div>
  <form class="card" id="fa"><h2>👤 Titular de la explotación</h2><p class="mu">Para el cuaderno de campo.</p>
   ${campos([['titular', 'Nombre y apellidos o empresa', 'text'], ['nif', 'NIF', 'text'], ['ropo', 'Nº de carné de aplicador (ROPO)', 'text'], ['ropo_cad', 'El carné caduca el', 'date']], A)}
   <h2 style="margin-top:16px">🧪 Abonos para el cálculo</h2>
   ${campos([['abono_n', 'Abono nitrogenado', 'select', { o: op('N').filter(([i]) => !['map', 'nk'].includes(i)) }], ['abono_p', 'Abono fosfórico', 'select', { o: op('P') }], ['abono_k', 'Abono potásico', 'select', { o: op('K') }]], A)}
   <h2 style="margin-top:16px">🎨 Aspecto</h2>
   ${campos([['tema', 'Tema', 'select', { o: [['auto', 'Como el dispositivo'], ['light', 'Claro'], ['dark', 'Oscuro']] }]], A)}
   <div class="acciones"><button class="pri">Guardar ajustes</button></div></form>
  <div class="card"><h2>🔒 Privacidad</h2><p>Si no creas una cuenta, nada sale de tu dispositivo. Si la creas, tu correo y tus datos se guardan cifrados en tránsito en <b>Supabase</b>, en servidores de la Unión Europea (Fráncfort), y solo tú puedes leerlos. No se usan para nada más ni se ceden a nadie. Puedes borrar la cuenta y todo lo subido cuando quieras desde aquí.</p><p>Para funcionar, consulta servicios públicos con la ubicación de tus parcelas: <b>SIGPAC</b> (FEGA) para los lindes, el <b>IGN</b> para la foto aérea y <b>Open-Meteo</b> para el tiempo. No se les envía ningún dato tuyo más.</p></div>
  <div class="card"><h2>⚠️ Borrar todo</h2><p class="mu">Elimina todas las fincas y anotaciones de este dispositivo. Haz antes una copia.</p><button class="pel" id="bor">Borrar todos los datos</button></div>
  <p class="pie">Mi Campito · código abierto en <a href="https://github.com/Sento79/mi-campito" target="_blank" rel="noopener">GitHub</a> · catálogo ${esc(CAT.version)}</p>`;
  $('#exp', main).onclick = exportar;
  $('#imp', main).onchange = e => e.target.files[0] && importar(e.target.files[0]).then(() => pantallaAjustes(main));
  $('#fa', main).onsubmit = async e => {
    e.preventDefault();
    const o = leerForm(e.target);
    for (const [k, v] of Object.entries(o)) { await ponerAjuste(k, v); D.ajustes[k] = v; }
    await S.ajustesCambiados();
    aplicarTema(); toast('Ajustes guardados');
  };
  $('#bor', main).onclick = async () => { if (await confirmar('Se borrarán todas tus fincas, sectores y anotaciones de este dispositivo. No se puede deshacer.', 'Borrar todo')) { await borrarTodo(); await recargar(); toast('Datos borrados'); location.hash = '#/hoy'; } };
  pintarSync();
  if (pend?.error) dialogo('No se ha podido completar', `<p>${esc(pend.error)}</p><div class="acciones"><button class="pri" data-cerrar>Vale</button></div>`);
  else if (pend?.tipo === 'recovery') nuevaClave();
  else if (pend?.tipo) toast('Correo confirmado: ya estás dentro de tu cuenta');
}

// ---- Tarjeta de sincronización ----
const cuando = iso => iso ? new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'nunca';
export function refrescarSync() { const c = $('#sb'); if (c && !c.querySelector('form')) pintarSync(); }
function pintarSync() {
  const c = $('#sb'); if (!c) return;
  const ses = S.sesion(), e = S.estado;
  if (!ses) {
    c.innerHTML = `<h2>☁️ Usar en varios dispositivos</h2>
    <p>Opcional y gratis. Con una cuenta, tus fincas y anotaciones se guardan también en un servidor de la Unión Europea y se juntan solas en tu móvil, tu tableta y tu ordenador. Solo tú puedes verlas.</p>
    <form id="sbf" autocomplete="on">${campos([['email', 'Correo electrónico', 'email', { req: true }], ['clave', 'Contraseña (8 caracteres o más)', 'password', { req: true }]])}
    <div class="acciones"><button class="pri" name="entrar">Entrar</button><button name="crear">Crear cuenta</button><button type="button" class="min" id="sbo">He olvidado la contraseña</button></div></form>
    <p class="mu">Lo que ya tengas en este dispositivo se sube a tu cuenta al entrar; no se pierde nada.</p>`;
    const f = $('#sbf', c);
    f.elements.email.autocomplete = 'email'; f.elements.clave.autocomplete = 'current-password'; f.elements.clave.minLength = 8;
    f.onsubmit = async ev => {
      ev.preventDefault();
      const { email, clave } = leerForm(f), crear = ev.submitter?.name === 'crear', bs = [...f.querySelectorAll('button')];
      bs.forEach(b => b.disabled = true);
      try {
        if (crear) {
          if (await S.crearCuenta(email, clave)) toast('Cuenta creada');
          else return dialogo('Mira tu correo', `<p>Te hemos enviado un correo a <b>${esc(email)}</b> (de Supabase). Pulsa el enlace que trae para confirmar la cuenta y volverás aquí ya dentro.</p><p class="mu">Si no llega en unos minutos, mira en la carpeta de spam.</p><div class="acciones"><button class="pri" data-cerrar>Vale</button></div>`);
        } else { await S.entrar(email, clave); toast(S.estado.error || 'Dentro: datos sincronizados'); }
      } catch (er) { toast(er instanceof TypeError ? 'Sin conexión con el servidor' : er.message); }
      finally { bs.forEach(b => b.disabled = false); }
      pintarSync();
    };
    $('#sbo', c).onclick = async () => {
      const email = f.elements.email.value.trim();
      if (!email) return toast('Escribe primero tu correo');
      try { await S.recordarClave(email); dialogo('Mira tu correo', `<p>Si hay una cuenta con <b>${esc(email)}</b>, te llegará un enlace para poner una contraseña nueva.</p><div class="acciones"><button class="pri" data-cerrar>Vale</button></div>`); }
      catch (er) { toast(er.message); }
    };
    return;
  }
  c.innerHTML = `<h2>☁️ Varios dispositivos</h2><p>Dentro como <b>${esc(ses.email || '')}</b>. Lo que anotes se sincroniza solo cuando hay conexión.</p>
   <p class="mu">${e.ocupado ? '🔄 Sincronizando…' : e.error ? '⚠️ ' + esc(e.error) : 'Última sincronización: ' + cuando(e.ultima)}</p>
   <div class="acciones"><button class="pri" id="sbs"${e.ocupado ? ' disabled' : ''}>🔄 Sincronizar ahora</button><button id="sbx">Salir de la cuenta</button></div>
   <details><summary>Más opciones</summary><div class="acciones"><button id="sbc">Cambiar la contraseña</button><button class="pel" id="sbb">Borrar mi cuenta</button></div></details>`;
  $('#sbs', c).onclick = () => S.sincronizar(true).then(n => toast(n ? `Sincronizado: ${n} cambios recibidos` : 'Todo al día')).catch(er => toast(er.message));
  $('#sbx', c).onclick = async () => { if (await confirmar('Dejarás de sincronizar este dispositivo. Tus datos se quedan aquí y en tu cuenta.', 'Salir')) { await S.salir(); toast('Has salido de la cuenta'); } };
  $('#sbc', c).onclick = nuevaClave;
  $('#sbb', c).onclick = async () => {
    if (!await confirmar('Se borrarán del servidor tu cuenta, tus datos y tus fotos. En este dispositivo se queda todo. No se puede deshacer.', 'Borrar mi cuenta')) return;
    try { await S.borrarCuenta(); toast('Cuenta borrada del servidor'); } catch (er) { toast(er.message); }
  };
}
function nuevaClave() {
  dialogo('Contraseña nueva', `<form id="nc">${campos([['clave', 'Contraseña nueva (8 caracteres o más)', 'password', { req: true }]])}<div class="acciones"><button class="pri">Guardar</button></div></form>`, d => {
    const f = $('#nc', d); f.elements.clave.minLength = 8; f.elements.clave.autocomplete = 'new-password';
    f.onsubmit = async ev => { ev.preventDefault(); try { await S.cambiarClave(f.elements.clave.value); toast('Contraseña cambiada'); d.close(); } catch (er) { toast(er.message); } };
  });
}

export function aplicarTema() {
  const t = D.ajustes.tema;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}

export function pantallaAyuda(main) {
  main.innerHTML = `<h1>Ayuda</h1>
  <div class="card"><h2>Cómo empezar</h2><ol><li><b>Finca:</b> en «Fincas», pulsa «+ Finca», pon el nombre y busca el pueblo.</li>
   <li><b>Sectores:</b> dentro de la finca, «+ Sector». Toca tu parcela en la foto aérea: SIGPAC rellena el linde, la superficie y la pendiente. También puedes escribir la referencia (provincia-municipio-polígono-parcela-recinto), que está en la PAC o en la escritura.</li>
   <li><b>Plantación:</b> elige la variedad, el año, el marco y el riego (goteros y caudal).</li></ol></div>
  <div class="card"><h2>Qué te dice la app</h2><ul>
   <li><b>Riego:</b> calcula lo que gastan tus árboles con el tiempo real de tu zona (Open-Meteo) y la fórmula de la FAO. Anota los riegos para que lleve la cuenta del agua del suelo.</li>
   <li><b>Abonado:</b> cuánto nitrógeno, fósforo y potasio toca cada mes según el IVIA, y en kilos de abono comercial. Si anotas un análisis foliar o del agua, corrige la dosis.</li>
   <li><b>Plagas:</b> qué vigilar cada mes según tu variedad. En la Comunitat Valenciana, también los avisos oficiales de la Generalitat.</li>
   <li><b>Recolección:</b> te avisa cuándo empezar a medir la madurez y calcula el índice de madurez.</li>
   <li><b>Cuaderno de campo:</b> anota los tratamientos y descárgalos o imprímelos.</li>
   <li><b>Cuentas:</b> gastos, ventas y lo que te queda por finca y por hectárea.</li></ul></div>
  <div class="card"><h2>Instalarla en el móvil</h2><p><b>Android (Chrome):</b> menú ⋮ → «Añadir a pantalla de inicio» o «Instalar aplicación».<br><b>iPhone (Safari):</b> botón Compartir → «Añadir a pantalla de inicio».</p><p>Una vez instalada funciona sin cobertura; el tiempo y los mapas se actualizan cuando vuelve la conexión.</p></div>
  <div class="card"><h2>Aviso importante</h2><p class="mu">Las recomendaciones son orientativas y no sustituyen el consejo de un técnico. Comprueba siempre que los productos fitosanitarios están autorizados en cítricos y respeta la etiqueta (dosis y plazo de seguridad).</p></div>`;
}
