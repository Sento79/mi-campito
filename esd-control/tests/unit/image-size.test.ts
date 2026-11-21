import { describe, expect, it } from "vitest";
import { imageSize } from "@/lib/server/image-size";
import { Canvas } from "../../scripts/lib/png";

describe("lectura de dimensiones de imagen", () => {
  it("PNG generado", () => {
    const png = new Canvas(123, 45).toPng();
    expect(imageSize(png)).toEqual({ width: 123, height: 45 });
  });
  it("JPEG mínimo (cabecera SOF0)", () => {
    // SOI, APP0 (len 16), SOF0 con alto 300 y ancho 400
    const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
    const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
    expect(imageSize(jpg)).toEqual({ width: 400, height: 300 });
  });
  it("JPEG con bytes de relleno FF antes de los marcadores", () => {
    const app0 = Buffer.from([0xff, 0xff, 0xe0, 0x00, 0x10, ...Buffer.from("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
    const sof = Buffer.from([0xff, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x64, 0x00, 0xc8, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    expect(imageSize(Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]))).toEqual({ width: 200, height: 100 });
  });
  it("devuelve null con datos no válidos", () => {
    expect(imageSize(Buffer.from("hola"))).toBeNull();
  });
});
