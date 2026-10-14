import { defineConfig } from '@playwright/test';
import base from './playwright.meeting-link.config';

// Built SPA direct-route and refresh coverage; never targets production.
export default defineConfig({
  ...base,
  testMatch: '**/privacy-policy.mock.spec.ts',
  outputDir: './test-results/privacy-preview',
});
