import { defineConfig } from '@playwright/test';
import real from './playwright.real.config';

export default defineConfig({
  ...real,
  testMatch: '**/dashboard.real.spec.ts',
  outputDir: './test-results-dashboard-real',
});
