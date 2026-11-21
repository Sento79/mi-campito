/**
 * Codificador PNG mínimo (RGB, sin dependencias) para generar un plano de
 * planta de DEMOSTRACIÓN y fixtures de test.
 */
import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export class Canvas {
  data: Buffer;
  constructor(public w: number, public h: number, bg: [number, number, number] = [255, 255, 255]) {
    this.data = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) bg.forEach((v, j) => (this.data[i * 3 + j] = v));
  }
  rect(x: number, y: number, w: number, h: number, c: [number, number, number]) {
    for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy++)
      for (let xx = Math.max(0, x); xx < Math.min(this.w, x + w); xx++) {
        const i = (yy * this.w + xx) * 3;
        this.data[i] = c[0];
        this.data[i + 1] = c[1];
        this.data[i + 2] = c[2];
      }
  }
  frame(x: number, y: number, w: number, h: number, t: number, c: [number, number, number]) {
    this.rect(x, y, w, t, c);
    this.rect(x, y + h - t, w, t, c);
    this.rect(x, y, t, h, c);
    this.rect(x + w - t, y, t, h, c);
  }
  toPng(): Buffer {
    const raw = Buffer.alloc((this.w * 3 + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 3 + 1)] = 0;
      this.data.copy(raw, y * (this.w * 3 + 1) + 1, y * this.w * 3, (y + 1) * this.w * 3);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8; // bits
    ihdr[9] = 2; // RGB
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  }
}

/** Plano esquemático de una nave con zonas y líneas (ficticio). */
export function demoFloorPlan(): { png: Buffer; width: number; height: number } {
  const W = 1600, H = 1000;
  const c = new Canvas(W, H, [250, 251, 252]);
  const wall: [number, number, number] = [60, 70, 85];
  const zone: [number, number, number] = [228, 236, 244];
  const bench: [number, number, number] = [190, 200, 212];
  c.frame(40, 40, W - 80, H - 80, 8, wall);
  // Zonas EPA
  c.rect(80, 80, 680, 400, zone);
  c.frame(80, 80, 680, 400, 3, [11, 95, 127]);
  c.rect(840, 80, 680, 400, zone);
  c.frame(840, 80, 680, 400, 3, [11, 95, 127]);
  c.rect(80, 560, 1440, 360, [240, 244, 248]);
  c.frame(80, 560, 1440, 360, 3, [120, 130, 145]);
  // Líneas / bancos
  for (let i = 0; i < 4; i++) c.rect(130, 130 + i * 85, 580, 28, bench);
  for (let i = 0; i < 4; i++) c.rect(890, 130 + i * 85, 580, 28, bench);
  for (let i = 0; i < 6; i++) c.rect(140 + i * 230, 620, 160, 240, bench);
  // Pasillo y puertas
  c.rect(760, 40, 80, 8, [250, 251, 252]);
  c.rect(40, 500, 8, 50, [250, 251, 252]);
  return { png: c.toPng(), width: W, height: H };
}
