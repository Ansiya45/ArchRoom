import { defineConfig } from '@playwright/test';
import realConfig from './playwright.real.config';

export default defineConfig(realConfig, {
  testMatch: '**/instant-meeting.real.spec.ts',
  outputDir: './test-results-instant-real',
});
