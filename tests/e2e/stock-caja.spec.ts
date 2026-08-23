import { test, expect, login, ensureCashOpen, EMPLOYEE, OWNER } from './fixtures';

test.describe('Stock', () => {
  test('transferir entre Salón y Altillo', async ({ page }) => {
    await login(page, EMPLOYEE);
    await page.goto('/stock');

    const card = page.locator('section', { hasText: 'Transferir entre ubicaciones' });
    await card.getByLabel('Producto').selectOption({ index: 1 });
    await card.getByLabel('Desde').selectOption({ label: 'Altillo' });
    await card.getByLabel('Hacia').selectOption({ label: 'Salón' });
    await card.getByLabel('Cantidad').fill('1');
    await card.getByRole('button', { name: 'Transferir' }).click();

    await expect(page.getByText('Transferencia registrada.')).toBeVisible();
  });

  test('salida por venta online no genera ingreso en caja', async ({ page }) => {
    await login(page, EMPLOYEE);
    await page.goto('/stock');

    const card = page.locator('section', { hasText: 'Salida por venta online' });
    await card.getByLabel('Producto').selectOption({ index: 1 });
    await card.getByLabel('Cantidad').fill('1');
    await card.getByLabel('Referencia').fill('ML-TEST-1');
    await card.getByRole('button', { name: 'Registrar salida' }).click();

    await expect(page.getByText('Salida online registrada.')).toBeVisible();
  });

  test('el empleado no ve el ajuste manual ni el valor inmovilizado', async ({ page }) => {
    await login(page, EMPLOYEE);
    await page.goto('/stock');
    await expect(page.getByText('Ajuste manual')).toHaveCount(0);
    await expect(page.getByText(/Inmovilizado/)).toHaveCount(0);
  });

  test('el dueño sí ve el ajuste manual y el inmovilizado', async ({ page }) => {
    await login(page, OWNER);
    await page.goto('/stock');
    await expect(page.getByText('Ajuste manual')).toBeVisible();
    await expect(page.getByText(/Inmovilizado/).first()).toBeVisible();
  });
});

test.describe('Caja', () => {
  test('abrir, mover y cerrar la caja', async ({ page }) => {
    await login(page, EMPLOYEE);
    await ensureCashOpen(page);

    // Registrar un gasto del día.
    const movements = page.locator('section', { hasText: 'Ingreso, retiro o gasto' });
    await movements.getByLabel('Importe').fill('1500');
    await movements.getByLabel('Descripción').fill('Bolsas');
    await movements.getByRole('button', { name: 'Registrar movimiento' }).click();

    // Cerrar declarando lo esperado.
    await expect(page.getByText('Cierre de caja')).toBeVisible();
    await page.getByRole('button', { name: 'Cerrar caja' }).click();
    await expect(page.getByRole('button', { name: 'Abrir caja' })).toBeVisible();
  });

  test('una diferencia declarada exige motivo', async ({ page }) => {
    await login(page, EMPLOYEE);
    await ensureCashOpen(page);

    const declared = page.getByLabel(/Declarado Efectivo/);
    await declared.fill('1');
    // Al haber diferencia, el campo de motivo aparece.
    await expect(page.getByLabel(/Motivo de la diferencia en Efectivo/)).toBeVisible();

    await page.getByRole('button', { name: 'Cerrar caja' }).click();
    await expect(page.getByRole('alert')).toContainText('motivo');
  });

  test('el empleado no puede reabrir una caja cerrada', async ({ page }) => {
    await login(page, EMPLOYEE);
    await page.goto('/caja');
    await expect(page.getByRole('button', { name: 'Reabrir' })).toHaveCount(0);
  });
});
