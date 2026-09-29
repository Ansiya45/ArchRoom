import { defineConfig } from '@playwright/test';
import verification from './playwright.signup.config';
export default defineConfig({
  ...verification,
  testMatch: '**/verification.real.spec.ts',
  retries: 0,
  // Reuse the already ignored real-test directory; never retain credentials.
  outputDir: './test-results-real',
  use: { ...verification.use, trace: 'off', screenshot: 'off', video: 'off' },
});
