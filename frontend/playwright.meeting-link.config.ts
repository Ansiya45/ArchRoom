import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Exercise direct paths and refresh against the built SPA, with the same
// isolated API fixtures used by the development-server tests.
export default defineConfig({
  ...base,
  testMatch: '**/meeting-link.mock.spec.ts',
  outputDir: './test-results/meeting-link-preview',
  use: { ...base.use, baseURL: 'http://127.0.0.1:5175' },
  webServer: {
    command: 'npm run build && npm run start -- --host 127.0.0.1 --port 5175 --strictPort',
    url: 'http://127.0.0.1:5175',
    reuseExistingServer: false,
    timeout: 120000,
    env: { VITE_API_BASE_URL: '/api' },
  },
});
