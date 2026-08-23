import { defineConfig, devices } from '@playwright/test';

/**
 * Las pruebas end-to-end necesitan una instancia de Supabase con las
 * migraciones y la semilla aplicadas (`supabase start && npm run db:reset`),
 * y las variables de `.env.local` cargadas.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 45_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000',
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'escritorio-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'movil-chromium', use: { ...devices['Pixel 7'] } },
    // La especificación pide al menos las pruebas críticas en WebKit.
    {
      name: 'webkit-critico',
      use: { ...devices['Desktop Safari'] },
      testMatch: /(login|venta)\.spec\.ts/,
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run build && npm run start',
        url: 'http://127.0.0.1:3000/ingresar',
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
