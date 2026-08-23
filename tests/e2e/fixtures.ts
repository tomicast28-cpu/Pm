import { test as base, expect, type Page } from '@playwright/test';

export const OWNER = {
  email: process.env.E2E_OWNER_EMAIL ?? 'dueno@puntomadera.test',
  password: process.env.E2E_OWNER_PASSWORD ?? 'punto-madera-demo',
};

export const EMPLOYEE = {
  email: process.env.E2E_EMPLOYEE_EMAIL ?? 'empleado@puntomadera.test',
  password: process.env.E2E_EMPLOYEE_PASSWORD ?? 'punto-madera-demo',
};

export async function login(page: Page, user: { email: string; password: string }) {
  await page.goto('/ingresar');
  await page.getByLabel('Correo').fill(user.email);
  await page.getByLabel('Contraseña').fill(user.password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/(?!ingresar)/);
}

/** Deja la caja abierta si no lo estaba, para poder cobrar. */
export async function ensureCashOpen(page: Page) {
  await page.goto('/caja');
  const openButton = page.getByRole('button', { name: 'Abrir caja' });
  if (await openButton.isVisible().catch(() => false)) {
    await page.getByLabel('Efectivo inicial').fill('10000');
    await openButton.click();
    await expect(page.getByText('Cierre de caja')).toBeVisible();
  }
}

export const test = base;
export { expect };
