import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const local = parse(readFileSync(new URL('./.env.auth-test.local', import.meta.url)));
const email = parse(readFileSync(new URL('../backend/.env', import.meta.url)));
if (!local.PG_TEST_PASSWORD || !local.E2E_SIGNUP_EMAIL) throw new Error('Complete the local authentication test settings first.');
if (!email.RESEND_API_KEY) throw new Error('The email provider is not configured.');
const database = new URL('postgres://postgres@127.0.0.1:5432/ylaam_auth_test');
database.password = local.PG_TEST_PASSWORD;
const clean = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined &&
  !/^(DATABASE_|JWT_|SUPABASE_|RESEND_|LIVEKIT_|OPENAI_|DOTENV_|EMAIL_|MEETING_EMAIL_|TRANSCRIPT_EMAIL_|APP_PUBLIC_URL)/.test(key))) as Record<string, string>;
for (const key of Object.keys(process.env)) if (/^(SUPABASE_|RESEND_|LIVEKIT_|OPENAI_|DOTENV_)/.test(key)) delete process.env[key];

export default defineConfig({
  testDir: './e2e', testMatch: '**/authentication-local.real.spec.ts', workers: 1, retries: 0,
  timeout: 60_000, expect: { timeout: 15_000 }, reporter: 'list', outputDir: './test-results-real',
  use: { baseURL: 'http://127.0.0.1:5175', storageState: { cookies: [], origins: [] }, serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'node --import tsx src/index.ts', cwd: fileURLToPath(new URL('../backend/', import.meta.url)),
      url: 'http://127.0.0.1:3002/health/ready', reuseExistingServer: false, timeout: 60_000, stdout: 'ignore', stderr: 'ignore',
      env: { ...clean, DOTENV_CONFIG_PATH: fileURLToPath(new URL('./e2e/.no-backend-env', import.meta.url)),
        DATABASE_URL: database.href, JWT_SECRET: randomUUID(), NODE_ENV: 'test', PORT: '3002',
        CORS_ALLOWED_ORIGINS: 'http://127.0.0.1:5175', RESEND_API_KEY: email.RESEND_API_KEY,
        EMAIL_FROM: email.EMAIL_FROM || 'YLAAM-MEET <onboarding@resend.dev>' } },
    { command: 'npm run dev -- --config vite.e2e.config.ts --host 127.0.0.1 --port 5175 --strictPort --mode e2e',
      url: 'http://127.0.0.1:5175', reuseExistingServer: false, timeout: 60_000, env: { VITE_API_BASE_URL: '/api' } },
  ],
});
