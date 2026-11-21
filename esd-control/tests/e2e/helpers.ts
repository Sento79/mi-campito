import { expect, type Page } from "@playwright/test";

export const PASSWORD = "Demo-ESD-2026!";

export async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Simula un lector HID: tecleo muy rápido seguido de Enter, sin foco en campos. */
export async function hidScan(page: Page, code: string) {
  await page.locator('[data-hid-ready="1"]').waitFor();
  await page.locator("main h1").first().click();
  await page.keyboard.type(code, { delay: 6 });
  await page.keyboard.press("Enter");
}
