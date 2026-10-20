import { defineConfig } from '@playwright/test';
import config from './playwright.auth-local.config';

const servers = Array.isArray(config.webServer) ? config.webServer : [config.webServer!];
export default defineConfig({
  ...config,
  testMatch: '**/meeting-local.real.spec.ts',
  webServer: servers.map((server, index) => index === 0
    ? { ...server, env: { ...server.env, RESEND_API_KEY: '', EMAIL_FROM: '' } }
    : server),
});
