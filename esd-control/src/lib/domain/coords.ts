/**
 * Coordenadas de planos. Los puntos se guardan normalizados (0..1) respecto a
 * la imagen de la página del plano, independientemente del zoom, del tamaño
 * de la ventana o de la resolución a la que se renderice.
 *
 * Vista: la imagen (anchura W, altura H en px "naturales") se dibuja con una
 * transformación  pantalla = offset + R(rot) · (escala · imagen).
 */
export interface Viewport {
  scale: number; // px de pantalla por px de imagen
  offsetX: number;
  offsetY: number;
  rotation: 0 | 90 | 180 | 270;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Redondeo a 8 decimales (precisión de la columna numeric(9,8)). */
export const round8 = (v: number) => Math.round(v * 1e8) / 1e8;

/** Tamaño de la imagen tras rotar. */
export function rotatedSize(img: Size, rotation: Viewport["rotation"]): Size {
  return rotation === 90 || rotation === 270 ? { width: img.height, height: img.width } : img;
}

/** Normalizado (0..1) → pantalla. */
export function normToScreen(p: Point, img: Size, vp: Viewport): Point {
  const ix = p.x * img.width * vp.scale;
  const iy = p.y * img.height * vp.scale;
  const w = img.width * vp.scale;
  const h = img.height * vp.scale;
  let rx: number, ry: number;
  switch (vp.rotation) {
    case 0:
      rx = ix; ry = iy; break;
    case 90:
      rx = h - iy; ry = ix; break;
    case 180:
      rx = w - ix; ry = h - iy; break;
    case 270:
      rx = iy; ry = w - ix; break;
  }
  return { x: vp.offsetX + rx, y: vp.offsetY + ry };
}

/** Pantalla → normalizado (0..1). Devuelve null si cae fuera de la imagen. */
export function screenToNorm(s: Point, img: Size, vp: Viewport): Point | null {
  const rx = s.x - vp.offsetX;
  const ry = s.y - vp.offsetY;
  const w = img.width * vp.scale;
  const h = img.height * vp.scale;
  let ix: number, iy: number;
  switch (vp.rotation) {
    case 0:
      ix = rx; iy = ry; break;
    case 90:
      ix = ry; iy = h - rx; break;
    case 180:
      ix = w - rx; iy = h - ry; break;
    case 270:
      ix = w - ry; iy = rx; break;
  }
  const x = ix / w;
  const y = iy / h;
  if (x < 0 || x > 1 || y < 0 || y > 1 || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: round8(x), y: round8(y) };
}

/** Escala y desplazamiento para encajar la imagen en el contenedor. */
export function fitToContainer(img: Size, container: Size, rotation: Viewport["rotation"], padding = 16): Viewport {
  const r = rotatedSize(img, rotation);
  const scale = Math.max(0.01, Math.min((container.width - 2 * padding) / r.width, (container.height - 2 * padding) / r.height));
  return {
    scale,
    rotation,
    offsetX: (container.width - r.width * scale) / 2,
    offsetY: (container.height - r.height * scale) / 2,
  };
}

/** Zoom manteniendo fijo el punto de pantalla `anchor`. */
export function zoomAt(vp: Viewport, factor: number, anchor: Point, min = 0.02, max = 40): Viewport {
  const scale = Math.min(max, Math.max(min, vp.scale * factor));
  const k = scale / vp.scale;
  return { ...vp, scale, offsetX: anchor.x - (anchor.x - vp.offsetX) * k, offsetY: anchor.y - (anchor.y - vp.offsetY) * k };
}

/**
 * Matriz CSS (a, b, c, d, e, f) que dibuja la imagen (en px naturales, con
 * transform-origin 0 0) exactamente donde normToScreen sitúa los puntos.
 */
export function imageMatrix(img: Size, vp: Viewport): [number, number, number, number, number, number] {
  const s = vp.scale;
  switch (vp.rotation) {
    case 0:
      return [s, 0, 0, s, vp.offsetX, vp.offsetY];
    case 90:
      return [0, s, -s, 0, vp.offsetX + s * img.height, vp.offsetY];
    case 180:
      return [-s, 0, 0, -s, vp.offsetX + s * img.width, vp.offsetY + s * img.height];
    case 270:
      return [0, -s, s, 0, vp.offsetX, vp.offsetY + s * img.width];
  }
}

export function applyMatrix(m: [number, number, number, number, number, number], p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}
