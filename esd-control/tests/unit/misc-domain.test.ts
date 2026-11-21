import { describe, expect, it } from "vitest";
import { addPeriod, dueStatus, describePeriod } from "@/lib/domain/periodicity";
import { fitToContainer, normToScreen, screenToNorm, zoomAt, type Viewport } from "@/lib/domain/coords";
import { ScanBuffer, DEFAULT_SCANNER_CONFIG, normalizeScanValue } from "@/lib/domain/scanner";
import { toZpl, zplText, sheetGrid, DEFAULT_LABEL_LAYOUT, labelLayoutSchema } from "@/lib/domain/labels";
import { validateImport } from "@/lib/domain/asset-import";

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("periodicidad", () => {
  it("suma meses recortando a fin de mes (igual que PostgreSQL)", () => {
    expect(iso(addPeriod(new Date("2026-01-31T10:00:00Z"), "month", 1))).toBe("2026-02-28");
    expect(iso(addPeriod(new Date("2028-01-31T10:00:00Z"), "month", 1))).toBe("2028-02-29");
    expect(iso(addPeriod(new Date("2026-08-31T10:00:00Z"), "quarter", 1))).toBe("2026-11-30");
    expect(iso(addPeriod(new Date("2026-03-15T10:00:00Z"), "semester", 1))).toBe("2026-09-15");
    expect(iso(addPeriod(new Date("2028-02-29T10:00:00Z"), "year", 1))).toBe("2029-02-28");
    expect(iso(addPeriod(new Date("2026-12-15T10:00:00Z"), "month", 1))).toBe("2027-01-15");
  });
  it("semanas y días", () => {
    expect(iso(addPeriod(new Date("2026-12-28T00:00:00Z"), "week", 1))).toBe("2027-01-04");
    expect(iso(addPeriod(new Date("2026-01-01T00:00:00Z"), "day", 45))).toBe("2026-02-15");
  });
  it("rechaza cantidades no válidas", () => {
    expect(() => addPeriod(new Date(), "month", 0)).toThrow();
    expect(() => addPeriod(new Date(), "month", 1.5)).toThrow();
  });
  it("estado de vencimiento", () => {
    const now = new Date("2026-06-10T00:00:00Z");
    expect(dueStatus(new Date("2026-06-01T00:00:00Z"), new Date("2026-05-01"), now, 7)).toBe("overdue");
    expect(dueStatus(new Date("2026-06-15T00:00:00Z"), new Date("2026-05-15"), now, 7)).toBe("due_soon");
    expect(dueStatus(new Date("2026-07-15T00:00:00Z"), new Date("2026-06-01"), now, 7)).toBe("ok");
    expect(dueStatus(null, null, now, 7)).toBe("never_measured");
    expect(dueStatus(null, null, now, 7, false)).toBe("unscheduled");
  });
  it("describe", () => {
    expect(describePeriod("month", 1)).toBe("Mensual");
    expect(describePeriod("month", 2)).toBe("Cada 2 meses");
    expect(describePeriod(null, null)).toBe("Sin periodicidad");
  });
});

describe("coordenadas del plano", () => {
  const img = { width: 2000, height: 1000 };
  const rotations: Viewport["rotation"][] = [0, 90, 180, 270];
  it.each(rotations)("ida y vuelta normalizado↔pantalla estable con rotación %i", (rotation) => {
    const vp: Viewport = { scale: 0.37, offsetX: 12.5, offsetY: -40, rotation };
    for (const p of [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.25, y: 0.75 }, { x: 0.123456789, y: 0.987654321 }]) {
      const s = normToScreen(p, img, vp);
      const back = screenToNorm(s, img, vp)!;
      expect(back.x).toBeCloseTo(p.x, 7);
      expect(back.y).toBeCloseTo(p.y, 7);
    }
  });
  it("las coordenadas normalizadas no dependen del zoom ni del tamaño del contenedor", () => {
    const p = { x: 0.3, y: 0.6 };
    const vp1 = fitToContainer(img, { width: 800, height: 600 }, 0);
    const vp2 = zoomAt(fitToContainer(img, { width: 1920, height: 1080 }, 0), 3.7, { x: 400, y: 300 });
    const s1 = normToScreen(p, img, vp1);
    const s2 = normToScreen(p, img, vp2);
    expect(screenToNorm(s1, img, vp1)).toEqual({ x: 0.3, y: 0.6 });
    expect(screenToNorm(s2, img, vp2)).toEqual({ x: 0.3, y: 0.6 });
  });
  it("fuera de la imagen devuelve null", () => {
    const vp = fitToContainer(img, { width: 800, height: 600 }, 0);
    expect(screenToNorm({ x: -100, y: -100 }, img, vp)).toBeNull();
  });
  it("zoom mantiene fijo el punto de anclaje", () => {
    const vp = fitToContainer(img, { width: 800, height: 600 }, 0);
    const anchor = { x: 333, y: 222 };
    const before = screenToNorm(anchor, img, vp)!;
    const after = screenToNorm(anchor, img, zoomAt(vp, 2.5, anchor))!;
    expect(after.x).toBeCloseTo(before.x, 7);
    expect(after.y).toBeCloseTo(before.y, 7);
  });
});

describe("lector HID", () => {
  const typeSeq = (buf: ScanBuffer, s: string, start: number, gap: number) => {
    let t = start;
    let ev = null;
    for (const ch of s) {
      const r = buf.push(ch, t);
      if (r.type === "scan") ev = r;
      t += gap;
    }
    return { ev, t };
  };
  it("detecta una lectura rápida terminada en Enter", () => {
    const b = new ScanBuffer(DEFAULT_SCANNER_CONFIG);
    const { t } = typeSeq(b, "TAP-0001", 1000, 8);
    expect(b.push("Enter", t)).toEqual({ type: "scan", code: "TAP-0001" });
  });
  it("ignora escritura humana lenta", () => {
    const b = new ScanBuffer(DEFAULT_SCANNER_CONFIG);
    const { t } = typeSeq(b, "TAP-0001", 1000, 180);
    expect(b.push("Enter", t).type).toBe("none");
  });
  it("sufijo Tab y prefijo configurable", () => {
    const b = new ScanBuffer({ ...DEFAULT_SCANNER_CONFIG, suffix: "Tab", prefix: "]Q" });
    const { t } = typeSeq(b, "]QABC123", 0, 5);
    expect(b.push("Tab", t)).toEqual({ type: "scan", code: "ABC123" });
  });
  it("sin sufijo: cierra por inactividad", () => {
    const b = new ScanBuffer({ ...DEFAULT_SCANNER_CONFIG, suffix: "none" });
    const { t } = typeSeq(b, "XYZ987", 0, 5);
    expect(b.idle(t + 10).type).toBe("none");
    expect(b.idle(t + 200)).toEqual({ type: "scan", code: "XYZ987" });
  });
  it("código demasiado corto no cuenta", () => {
    const b = new ScanBuffer(DEFAULT_SCANNER_CONFIG);
    const { t } = typeSeq(b, "AB", 0, 5);
    expect(b.push("Enter", t).type).toBe("none");
  });
  it("normaliza valores escaneados y enlaces QR de la app", () => {
    expect(normalizeScanValue("  TAP-01\r\n")).toBe("TAP-01");
    expect(normalizeScanValue("https://esd.example.com/a/TAP-01")).toBe("TAP-01");
    expect(normalizeScanValue("https://esd.example.com/a/SILLA%2F7")).toBe("SILLA/7");
  });
});

describe("etiquetas", () => {
  const data = { code: "TAP-0001", name: "Tapete línea 1", scanCode: "TAP-0001", url: "https://esd.example.com/a/TAP-0001", location: "Línea 1", category: "Tapetes ESD", nextDue: "2026-12-01" };
  it("ZPL contiene estructura y QR con el enlace", () => {
    const z = toZpl(data, 50, 30, DEFAULT_LABEL_LAYOUT);
    expect(z.startsWith("^XA")).toBe(true);
    expect(z.trim().endsWith("^XZ")).toBe(true);
    expect(z).toContain("^CI28");
    expect(z).toContain("^BQN");
    expect(z).toContain("https://esd.example.com/a/TAP-0001");
    expect(z).toContain(`^PW${Math.round((50 / 25.4) * 203)}`);
  });
  it("ZPL escapa caracteres de control y no ASCII", () => {
    expect(zplText("a^b~c")).toBe("a_5Eb_7Ec");
    expect(zplText("Línea")).toBe("L_C3_ADnea");
  });
  it("código de barras opcional", () => {
    const z = toZpl(data, 100, 50, labelLayoutSchema.parse({ code: "barcode" }));
    expect(z).toContain("^BC");
    expect(z).not.toContain("^BQN");
  });
  it("rejilla de hoja A4", () => {
    const g = sheetGrid(50, 30, DEFAULT_LABEL_LAYOUT);
    expect(g.cols).toBe(3);
    expect(g.rows).toBe(8);
  });
});

describe("importación de activos", () => {
  const lookups = {
    categoryCodes: new Set(["TAP", "SIL"]),
    locationCodes: new Set(["L1"]),
    existingCodes: new Set(["TAP-EXIST"]),
    existingScanCodes: new Set(["SCAN-EXIST"]),
  };
  it("valida filas y detecta duplicados", () => {
    const rows = [
      ["codigo", "nombre", "categoria", "ubicacion", "codigo_escaneo", "periodo_unidad", "periodo_cantidad"],
      ["TAP-1", "Tapete 1", "TAP", "L1", "", "month", "3"],
      ["TAP-1", "Tapete dup", "TAP", "", "", "", ""],
      ["TAP-EXIST", "Ya existe", "TAP", "", "", "", ""],
      ["X-2", "Categoría mala", "NOPE", "", "", "", ""],
      ["X-3", "", "TAP", "", "", "", ""],
      ["X-4", "Periodo a medias", "SIL", "", "", "month", ""],
      ["X-5", "Escaneo usado", "SIL", "", "SCAN-EXIST", "", ""],
      ["", "", "", "", "", "", ""],
      ["sil-9", "Silla 9", "sil", "l1", "", "", ""],
    ];
    const p = validateImport(rows, lookups);
    expect(p.valid.map((v) => v.code)).toEqual(["TAP-1", "sil-9"]);
    expect(p.valid[0].period_count).toBe(3);
    expect(p.valid[0].scan_code).toBe("TAP-1");
    const msgs = p.issues.map((i) => `${i.row}:${i.message}`);
    expect(msgs.some((m) => m.startsWith("3:ID duplicado"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("4:El ID TAP-EXIST ya existe"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("5:Categoría"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("6:Nombre obligatorio"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("7:Indique unidad"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("8:El código de escaneo"))).toBe(true);
  });
  it("exige columnas obligatorias", () => {
    const p = validateImport([["nombre"], ["x"]], lookups);
    expect(p.valid).toHaveLength(0);
    expect(p.issues[0].message).toMatch(/codigo/);
  });
});
