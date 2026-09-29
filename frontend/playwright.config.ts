import { defineConfig, devices } from '@playwright/test';

// A dedicated, strictly bound local server avoids reusing a developer session
// whose environment or auth state might point at production.
const baseURL = 'http://127.0.0.1:5174';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  testIgnore: '**/*.real.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  outputDir: './test-results',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    storageState: { cookies: [], origins: [] },
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort --mode e2e',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      // Process env wins over Vite's .env files; no real .env is changed.
      VITE_API_BASE_URL: '/api',
    },
  },
});
