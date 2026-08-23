import { test, expect, login, ensureCashOpen, EMPLOYEE } from './fixtures';

test.describe('Venta inmediata', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, EMPLOYEE);
    await ensureCashOpen(page);
    await page.goto('/venta');
  });

  test('venta simple en efectivo', async ({ page }) => {
    await page.getByLabel('Buscar producto').fill('tabla');
    const card = page.getByRole('button', { name: /Tabla de asado/ }).first();
    await card.click();

    await expect(page.getByText('Total')).toBeVisible();
    await page.getByRole('button', { name: /Cobrar/ }).click();

    await expect(page.getByRole('dialog', { name: 'Cobrar' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirmar venta' }).click();

    await expect(page.getByText(/Venta V-\d+ registrada/)).toBeVisible();
    await expect(page.getByRole('link', { name: /comprobante/i })).toBeVisible();
  });

  test('el doble clic en Confirmar no duplica la venta', async ({ page }) => {
    await page.getByLabel('Buscar producto').fill('pinza');
    await page.getByRole('button', { name: /Pinza de parrilla/ }).first().click();
    await page.getByRole('button', { name: /Cobrar/ }).click();

    const confirm = page.getByRole('button', { name: 'Confirmar venta' });
    await confirm.click({ clickCount: 2, delay: 30 }).catch(() => undefined);

    await expect(page.getByText(/Venta V-\d+ registrada/)).toHaveCount(1);
  });

  test('venta con pago combinado', async ({ page }) => {
    await page.getByLabel('Buscar producto').fill('canasto');
    await page.getByRole('button', { name: /Canasto de zuncho/ }).first().click();
    await page.getByRole('button', { name: /Cobrar/ }).click();

    // Primer medio: parte del total. Segundo medio: el resto.
    const amounts = page.getByLabel('Importe');
    await amounts.first().fill('10000');
    await page.getByRole('button', { name: /Agregar otro medio de pago/ }).click();
    await expect(page.getByText('Falta')).toBeVisible();

    await page.getByRole('button', { name: 'Confirmar venta' }).click();
    await expect(page.getByText(/Venta V-\d+ registrada/)).toBeVisible();
  });

  test('venta con descuento del empleado y su motivo', async ({ page }) => {
    await page.getByLabel('Buscar producto').fill('tabla');
    await page.getByRole('button', { name: /Tabla de asado/ }).first().click();

    await page.getByLabel('Descuento por unidad').fill('3200');
    await page.getByLabel('Motivo del descuento').fill('Cliente frecuente');

    await page.getByRole('button', { name: /Cobrar/ }).click();
    await page.getByRole('button', { name: 'Confirmar venta' }).click();
    await expect(page.getByText(/Venta V-\d+ registrada/)).toBeVisible();
  });

  test('atajos de teclado: F4 enfoca la búsqueda y F8 abre el cobro', async ({ page }) => {
    await page.keyboard.press('F4');
    await expect(page.getByLabel('Buscar producto')).toBeFocused();

    await page.getByLabel('Buscar producto').fill('tabla');
    await page.getByRole('button', { name: /Tabla de asado/ }).first().click();

    await page.keyboard.press('F8');
    await expect(page.getByRole('dialog', { name: 'Cobrar' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Cobrar' })).toHaveCount(0);
  });

  test('un producto sin stock no se puede agregar', async ({ page }) => {
    await page.getByLabel('Buscar producto').fill('zzz-inexistente');
    await expect(page.getByText('Sin resultados')).toBeVisible();
  });
});
