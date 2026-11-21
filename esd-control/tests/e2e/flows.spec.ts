import { expect, test } from "@playwright/test";
import { hidScan, login } from "./helpers";

test.describe.configure({ mode: "serial" });

test("1. inicio de sesión: credenciales erróneas y correctas", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Correo electrónico").fill("responsable@demo.local");
  await page.getByLabel("Contraseña").fill("incorrecta");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Credenciales no válidas" })).toBeVisible();
  await login(page, "responsable@demo.local");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Organización de DEMOSTRACIÓN")).toBeVisible();
});

test("2-3. crear activo e imprimir su etiqueta", async ({ page }) => {
  await login(page, "responsable@demo.local");
  await page.goto("/inventario/nuevo");
  await page.getByLabel("ID legible").fill("TAP-E2E-01");
  await page.getByLabel("Nombre").fill("Tapete creado por E2E");
  await page.getByLabel("Categoría").selectOption({ label: "Tapetes ESD" });
  await page.getByLabel("Ubicación").selectOption({ index: 3 });
  await page.getByRole("button", { name: "Crear activo" }).click();
  await expect(page).toHaveURL(/\/inventario\/[0-9a-f-]{36}$/);
  await expect(page.getByText("TAP-E2E-01").first()).toBeVisible();
  // Duplicado: el ID ya existe
  await page.goto("/inventario/nuevo");
  await page.getByLabel("ID legible").fill("TAP-E2E-01");
  await page.getByLabel("Nombre").fill("Duplicado");
  await page.getByLabel("Categoría").selectOption({ label: "Tapetes ESD" });
  await page.getByRole("button", { name: "Crear activo" }).click();
  await expect(page.getByText("El ID TAP-E2E-01 ya existe", { exact: true }).first()).toBeVisible();
  // Etiqueta
  await page.goto("/inventario?q=TAP-E2E-01");
  await page.getByRole("link", { name: "TAP-E2E-01", exact: true }).click();
  await page.getByRole("link", { name: "Etiqueta", exact: true }).click();
  await expect(page.getByText("Activos a imprimir (1)")).toBeVisible();
  const [res] = await Promise.all([page.waitForResponse((r) => r.url().includes("/api/labels/pdf")), page.getByRole("button", { name: "Generar PDF" }).click()]);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
});

test("4-7. escanear, medir, obtener resultado y ver historial", async ({ page }) => {
  await login(page, "tecnico@demo.local");
  await page.goto("/medicion");
  await hidScan(page, "TAP-E2E-01");
  await expect(page.locator("p.font-mono", { hasText: "TAP-E2E-01" })).toBeVisible();
  // Categoría con criterio ilustrativo: 1e4 ≤ v < 1e9 Ω
  await page.getByLabel("Instrumento").selectOption({ label: "MEG-01 · Medidor de resistencia (RM-100)" });
  await page.getByLabel("Valor medido").fill("3,3");
  await page.getByLabel("Unidad").selectOption("MΩ");
  await expect(page.getByText("Resultado previsto")).toBeVisible();
  await page.keyboard.press("Control+Enter");
  await expect(page.getByText("Medición registrada")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Medición registrada" })).toContainText("Conforme");
  // Entrada manual de otro activo y valor no conforme
  await page.getByLabel("Código del activo").fill("tap-e2e-01");
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/medicion"),
    page.getByLabel("Código del activo").press("Enter"),
  ]);
  await expect(page.getByLabel("Valor medido")).toHaveValue("");
  await page.getByLabel("Valor medido").fill("2.5");
  await page.getByLabel("Unidad").selectOption("GΩ");
  await page.getByRole("button", { name: "Guardar medición" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Medición registrada" })).toContainText("No conforme");
  await expect(page.getByText(/No conformidad creada: NC-\d{4}-\d{4}/)).toBeVisible();
  // Historial
  await page.goto("/historial?q=TAP-E2E-01");
  await expect(page.getByRole("row").filter({ hasText: "TAP-E2E-01" })).toHaveCount(2);
  await page.getByRole("row").filter({ hasText: "No conforme" }).getByRole("link").first().click();
  await expect(page.getByText("2,5 GΩ").or(page.getByText("2.5 GΩ"))).toBeVisible();
  await expect(page.getByText("2500000000 Ω")).toBeVisible();
});

test("8. no conformidad: no se cierra sin verificación", async ({ page }) => {
  await login(page, "responsable@demo.local");
  await page.goto("/no-conformidades?status=all_open");
  await page.getByRole("row").filter({ hasText: "TAP-E2E-01" }).getByRole("link").first().click();
  await page.getByLabel("Acción correctiva").fill("Sustituir el tapete y revisar el cable de tierra");
  await page.getByRole("button", { name: "Guardar" }).first().click();
  await expect(page.getByText("Cambios guardados")).toBeVisible();
  await page.getByRole("button", { name: "Solicitar verificación" }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByText("Pendiente de verificación").first()).toBeVisible();
  await page.getByRole("button", { name: "Verificar y cerrar" }).click();
  await expect(page.getByRole("button", { name: "Confirmar" })).toBeDisabled();
  await page.getByLabel(/Verificación realizada/).fill("Remedición conforme: 2,1 MΩ");
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByText(/Cerrada el .* verificada por Rubén Responsable ESD/)).toBeVisible();
});

test("9. crear una campaña por categoría e iniciarla", async ({ page }) => {
  await login(page, "responsable@demo.local");
  await page.goto("/campanas/nueva");
  await page.getByLabel("Nombre").fill("Campaña E2E sillas");
  await page.getByText("Por categoría").click();
  await page.getByRole("checkbox", { name: "Sillas ESD" }).check();
  await page.getByRole("checkbox", { name: /Teresa Técnica/ }).check();
  await page.getByRole("button", { name: "Previsualizar" }).click();
  await expect(page.getByText(/La campaña incluirá 8 activo\(s\)/)).toBeVisible();
  await page.getByRole("button", { name: "Crear campaña" }).click();
  await expect(page).toHaveURL(/\/campanas\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Iniciar" }).click();
  await expect(page.getByText("En curso").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Iniciar ruta de medición" })).toBeVisible();
});

test("10. registrar medición sobre un punto del plano", async ({ page }) => {
  await login(page, "tecnico@demo.local");
  await page.goto("/planos");
  await page.getByText("Nave 1 – Planta baja (DEMO)").click();
  await page.getByRole("button", { name: /S-03/ }).click();
  await page.getByRole("link", { name: "Medir", exact: true }).click();
  await expect(page.locator("p.font-mono", { hasText: "S-03" })).toBeVisible();
  await page.getByLabel("Instrumento").selectOption({ label: "MEG-01 · Medidor de resistencia (RM-100)" });
  await page.getByLabel("Valor medido").fill("4.4e7");
  await page.getByRole("button", { name: "Guardar medición" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Medición registrada" })).toContainText("Conforme");
  await page.goBack();
  await page.goto(page.url());
  await expect(page.getByRole("button", { name: /S-03/ })).toContainText("S-03");
});

test("11. exportar informe PDF y XLSX", async ({ page }) => {
  await login(page, "responsable@demo.local");
  const pdf = await page.request.get("/api/reports/summary");
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const xlsx = await page.request.get("/api/export/measurements?format=xlsx");
  expect(xlsx.status()).toBe(200);
  expect((await xlsx.body()).subarray(0, 2).toString()).toBe("PK");
});

test("permisos: el rol Consulta no puede medir ni exportar", async ({ page }) => {
  await login(page, "consulta@demo.local");
  await page.goto("/medicion");
  await expect(page).toHaveURL(/\/sin-permiso/);
  await expect(page.getByRole("navigation", { name: "Navegación principal" }).getByText("Medición rápida")).toHaveCount(0);
  const r = await page.request.post("/api/measurements", { data: { clientId: "8f14e45f-ceea-4e7a-9c3e-1a2b3c4d5e6f", input: { kind: "numeric", value: "1" } }, headers: { origin: "http://localhost:3100" } });
  expect(r.status()).toBe(403);
  const e = await page.request.get("/api/export/assets?format=csv");
  expect(e.status()).toBe(403);
});

test("QR de etiqueta: exige sesión y resuelve la ficha", async ({ page, context }) => {
  await context.clearCookies();
  await page.goto("/a/TAP-0001");
  await expect(page).toHaveURL(/\/login\?next=%2Fa%2FTAP-0001/);
  await page.getByLabel("Correo electrónico").fill("auditor@demo.local");
  await page.getByLabel("Contraseña").fill("Demo-ESD-2026!");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/inventario\/[0-9a-f-]{36}$/);
  await expect(page.getByText("TAP-0001").first()).toBeVisible();
});

test.describe("móvil (360 px)", () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

  test("ninguna página es más ancha que la pantalla", async ({ page }) => {
    await login(page, "responsable@demo.local");
    const widths = async () => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }));
    const pages = ["/", "/medicion?asset=TAP-0001", "/inventario", "/planos", "/campanas", "/campanas/nueva", "/no-conformidades", "/instrumentos", "/etiquetas", "/informes", "/alertas", "/historial", "/admin/configuracion"];
    for (const url of pages) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      const { sw, vw } = await widths();
      expect(sw, `${url} desborda: ${sw}px > ${vw}px`).toBeLessThanOrEqual(vw);
    }
    // Detalle de activo, campaña y plano (enlaces desde los listados)
    for (const [list, link] of [["/inventario", /\/inventario\/[0-9a-f-]{36}$/], ["/campanas", /\/campanas\/[0-9a-f-]{36}$/], ["/planos", /\/planos\/[0-9a-f-]{36}$/]] as const) {
      await page.goto(list);
      const href = await page.locator("a[href]").evaluateAll((as, re) => as.map((a) => a.getAttribute("href")).find((h) => h && new RegExp(re).test(h)), link.source);
      expect(href, `sin enlace de detalle en ${list}`).toBeTruthy();
      await page.goto(href!);
      await page.waitForLoadState("networkidle");
      const { sw, vw } = await widths();
      expect(sw, `${href} desborda: ${sw}px > ${vw}px`).toBeLessThanOrEqual(vw);
    }
  });
});
