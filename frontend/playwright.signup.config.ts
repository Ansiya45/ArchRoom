import { defineConfig } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import existing from './playwright.real.config';

const backend = parse(readFileSync(new URL('../backend/.env', import.meta.url)));
const servers = Array.isArray(existing.webServer) ? existing.webServer : [existing.webServer!];
export default defineConfig({
  ...existing,
  testMatch: ['**/signup.validation.spec.ts', '**/signup.real.spec.ts'],
  outputDir: './test-results-signup',
  // Signup keeps the application's actual verification-email behavior.
  webServer: servers.map((server, index) => index !== 0 ? server : {
    ...server, env: { ...server.env, RESEND_API_KEY: backend.RESEND_API_KEY || '',
      EMAIL_FROM: backend.EMAIL_FROM || 'YLAAM-MEET <onboarding@resend.dev>' },
  }),
});
