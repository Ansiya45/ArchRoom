import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { realCredentials } from './e2e/fixtures/real-credentials';

realCredentials(); // Fail before starting servers if credentials are missing.
const backendDir = fileURLToPath(new URL('../backend/', import.meta.url));
const backend = parse(readFileSync(new URL('../backend/.env', import.meta.url)));
if (!backend.DATABASE_URL || !backend.JWT_SECRET) throw new Error('Backend DATABASE_URL and JWT_SECRET must be configured.');

// Do not inherit provider credentials or real .env loading into the test backend.
// Keep the authorized database and JWT settings in child-process memory only.
const safeEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined &&
  !/^(DATABASE_|JWT_|SUPABASE_|RESEND_|LIVEKIT_|OPENAI_|E2E_|DOTENV_|EMAIL_|MEETING_EMAIL_|TRANSCRIPT_EMAIL_|APP_PUBLIC_URL)/.test(key))) as Record<string, string>;
// Playwright merges webServer env with process.env, so clear inherited providers
// before spawning either server; this only affects this test runner process.
for (const key of Object.keys(process.env)) {
  if (/^(SUPABASE_|RESEND_|LIVEKIT_|OPENAI_|DOTENV_)/.test(key)) delete process.env[key];
}
export default defineConfig({
  testDir: './e2e', testMatch: '**/auth.real.spec.ts',
  workers: 1, fullyParallel: false, retries: 0,
  forbidOnly: Boolean(process.env.CI), timeout: 60_000,
  expect: { timeout: 15_000 }, reporter: 'list',
  outputDir: './test-results-real',
  use: {
    baseURL: 'http://127.0.0.1:5175', storageState: { cookies: [], origins: [] },
    serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev', cwd: backendDir, url: 'http://127.0.0.1:3002/health',
      reuseExistingServer: false, timeout: 60_000, stdout: 'ignore', stderr: 'ignore',
      env: { ...safeEnvironment, DOTENV_CONFIG_PATH: fileURLToPath(new URL('./e2e/.no-backend-env', import.meta.url)),
        DATABASE_URL: backend.DATABASE_URL, JWT_SECRET: backend.JWT_SECRET,
        JWT_EXPIRES_IN: backend.JWT_EXPIRES_IN || '1h', NODE_ENV: 'test', PORT: '3002',
        CORS_ALLOWED_ORIGINS: 'http://127.0.0.1:5175' },
    },
    {
      command: 'npm run dev -- --config vite.e2e.config.ts --host 127.0.0.1 --port 5175 --strictPort --mode e2e',
      url: 'http://127.0.0.1:5175', reuseExistingServer: false, timeout: 60_000,
      env: { VITE_API_BASE_URL: '/api' },
    },
  ],
});
