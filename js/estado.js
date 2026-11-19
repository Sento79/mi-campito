// Datos cargados en memoria y accesos rápidos
import { todos, leerAjuste } from './db.js';

export const D = { fincas: [], sectores: [], registros: [], ajustes: {} };

const AJ = { titular: '', nif: '', ropo: '', ropo_cad: '', abono_n: 'nam', abono_p: 'fos', abono_k: 'nk', tema: 'auto', ultimaCopia: '' };

export async function recargar() {
  [D.fincas, D.sectores, D.registros] = await Promise.all(['fincas', 'sectores', 'registros'].map(t => todos(t)));
  D.fincas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  D.sectores.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { numeric: true }));
  D.registros.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.mod || '').localeCompare(a.mod || ''));
  for (const k of Object.keys(AJ)) D.ajustes[k] = await leerAjuste(k, AJ[k]);
}

export const finca = id => D.fincas.find(f => f.id === id);
export const sector = id => D.sectores.find(s => s.id === id);
export const sectoresDe = fid => D.sectores.filter(s => s.finca === fid);
export const registrosDe = (sid, tipo) => D.registros.filter(r => (!sid || r.sector === sid) && (!tipo || r.tipo === tipo));
export const registrosFinca = (fid, tipo) => { const ids = new Set(sectoresDe(fid).map(s => s.id)); return D.registros.filter(r => (ids.has(r.sector) || r.finca === fid) && (!tipo || r.tipo === tipo)); };
export const nombreSector = s => { if (!s) return '—'; const f = finca(s.finca); return (f ? f.nombre + ' · ' : '') + (s.nombre || 'Sector'); };
export function fincaDeRegistro(r) { const s = sector(r.sector); return s ? finca(s.finca) : finca(r.finca); }
