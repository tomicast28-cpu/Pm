import { test, expect, login, OWNER, EMPLOYEE } from './fixtures';

test.describe('Ingreso y separación de roles', () => {
  test('el dueño entra y ve las secciones reservadas', async ({ page }) => {
    await login(page, OWNER);
    await expect(page.getByRole('link', { name: 'Reportes' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Auditoría' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Configuración' })).toBeVisible();
    await expect(page.getByText('Margen estimado de hoy')).toBeVisible();
  });

  test('el empleado entra y NO ve costos ni secciones reservadas', async ({ page }) => {
    await login(page, EMPLOYEE);
    await expect(page.getByRole('link', { name: 'Nueva venta' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Reportes' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Auditoría' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Configuración' })).toHaveCount(0);
    await expect(page.getByText('Margen estimado de hoy')).toHaveCount(0);
  });

  test('la sección reservada redirige al empleado', async ({ page }) => {
    await login(page, EMPLOYEE);
    await page.goto('/auditoria');
    await expect(page).toHaveURL(/sin-permiso/);
  });

  test('rechaza credenciales incorrectas sin revelar si el usuario existe', async ({ page }) => {
    await page.goto('/ingresar');
    await page.getByLabel('Correo').fill('nadie@puntomadera.test');
    await page.getByLabel('Contraseña').fill('contrasena-incorrecta');
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await expect(page.getByRole('alert')).toContainText('Correo o contraseña incorrectos');
  });

  test('sin sesión, la aplicación redirige al ingreso', async ({ page }) => {
    await page.goto('/venta');
    await expect(page).toHaveURL(/ingresar/);
  });
});

test.describe('Restricción de costos en la interfaz', () => {
  test('la lista de productos oculta costo y margen al empleado', async ({ page }) => {
    await login(page, EMPLOYEE);
    await page.goto('/productos');
    await expect(page.getByRole('columnheader', { name: 'Precio' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Costo' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Margen' })).toHaveCount(0);
  });

  test('el dueño sí ve costo y margen', async ({ page }) => {
    await login(page, OWNER);
    await page.goto('/productos');
    await expect(page.getByRole('columnheader', { name: 'Costo' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Margen' })).toBeVisible();
  });
});
