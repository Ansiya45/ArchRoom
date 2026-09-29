import { defineConfig } from '@playwright/test';
import config from './playwright.verification.config';
export default defineConfig({ ...config, testMatch: ['**/password-reset.real.spec.ts', '**/password-reset-login.real.spec.ts'] });
