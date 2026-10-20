import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { parse } from 'dotenv';

const local = parse(readFileSync(new URL('../.env.auth-test.local', import.meta.url)));
const requireBackend = createRequire(new URL('../../backend/package.json', import.meta.url));
const postgres = requireBackend('postgres') as typeof import('../../backend/node_modules/postgres');
const bcrypt = requireBackend('bcryptjs') as typeof import('../../backend/node_modules/bcryptjs');
const action = process.env.E2E_AUTH_ACTION;
const email = local.E2E_SIGNUP_EMAIL.trim().toLowerCase();
const password = local.E2E_AUTH_PASSWORD;
const newPassword = local.E2E_AUTH_NEW_PASSWORD;
const sql = () => postgres({ host: '127.0.0.1', port: 5432, database: 'ylaam_auth_test', username: 'postgres', password: local.PG_TEST_PASSWORD, max: 1 });

test('local database and real email authentication', async ({ page }) => {
  expect(['signup', 'verify', 'reset-request', 'reset', 'login'].includes(action || '')).toBe(true);
  const db = sql();
  try {
    const records = async () => {
      const users = await db`select id, email, full_name, password_hash, email_verified_at from users where email = ${email}`;
      const codes = users.length ? await db`select purpose, code_hash, expires_at from auth_codes where user_id = ${users[0].id}` : [];
      return { user: users[0], codes };
    };
    const before = await records();
    if (action === 'signup') expect(before.user, 'The test address must be new in the local database').toBeUndefined();
    else expect(before.user, 'The local test account must exist').toBeTruthy();
    const origin = 'http://127.0.0.1:5175';
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname.startsWith('/api/')) {
        const paths = decodeURIComponent(url.pathname.slice(5)).split(',');
        if (paths.every(p => ['auth.signup', 'auth.login', 'auth.me', 'auth.verifyEmail', 'auth.requestPasswordReset', 'auth.resetPassword', 'auth.logout', 'meetings.list'].includes(p))) return route.continue();
        return route.abort();
      }
      if (!['GET', 'HEAD'].includes(req.method()) || ['fetch', 'xhr'].includes(req.resourceType())) return route.abort();
      return route.continue();
    });
    await page.goto('/');
    const fill = async (selector: ReturnType<typeof page.getByPlaceholder>, value: string) => {
      try { await selector.fill(value); } catch { throw new Error('Could not fill test data; values withheld.'); }
    };
    if (action === 'signup') {
      await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
      await fill(page.getByPlaceholder('Jordan Miller'), 'Local authentication test');
      await fill(page.getByPlaceholder('name@company.com'), email);
      for (const field of await page.locator('input[autocomplete="new-password"]').all()) await fill(field, password);
      await page.getByRole('button', { name: 'Create account', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible({ timeout: 30_000 });
      const after = await records();
      expect(after.user?.full_name).toBe('Local authentication test');
      expect(after.user?.email === email).toBe(true);
      expect(after.user?.email_verified_at).toBeNull();
      expect(await bcrypt.compare(password, after.user.password_hash)).toBe(true);
      expect(after.user.password_hash !== password).toBe(true);
      const code = after.codes.find(c => c.purpose === 'verify_email');
      expect(Boolean(code && /^[a-f0-9]{64}$/.test(code.code_hash) && new Date(code.expires_at) > new Date())).toBe(true);
    } else {
      await page.getByRole('button', { name: 'Login', exact: true }).click();
      if (action === 'verify') {
        const code = local.E2E_AUTH_VERIFY_CODE || '';
        expect(/^\d{6}$/.test(code), 'Enter the received verification code in the local settings file').toBe(true);
        expect(before.codes.some(c => c.purpose === 'verify_email' && c.code_hash === createHash('sha256').update(code).digest('hex'))).toBe(true);
        await fill(page.getByPlaceholder('name@company.com'), email);
        await fill(page.locator('input[autocomplete="current-password"]'), password);
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
        await fill(page.getByPlaceholder('123456'), code);
        await page.getByRole('button', { name: 'Verify email', exact: true }).click();
        await expect(page.getByRole('banner').getByRole('button', { name: 'Local authentication test' })).toBeVisible();
        const after = await records();
        expect(Boolean(after.user.email_verified_at)).toBe(true);
        expect(after.codes.some(c => c.purpose === 'verify_email')).toBe(false);
      } else if (action === 'login') {
        await fill(page.getByPlaceholder('name@company.com'), email);
        await fill(page.locator('input[autocomplete="current-password"]'), password);
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await expect(page.getByRole('alert')).toHaveText('Wrong password. Please try again.');
        await fill(page.locator('input[autocomplete="current-password"]'), newPassword);
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await expect(page.getByRole('banner').getByRole('button', { name: 'Local authentication test' })).toBeVisible();
        await page.reload();
        await expect(page.getByRole('banner').getByRole('button', { name: 'Local authentication test' })).toBeVisible();
        await page.getByRole('banner').getByRole('button', { name: 'Local authentication test' }).click();
        await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
        await expect.poll(() => page.evaluate(() => !localStorage.getItem('ylaam_meet_token') && !localStorage.getItem('ylaam_meet_refresh_token') && !localStorage.getItem('ylaam_meet_user'))).toBe(true);
        await page.reload();
        await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
      } else {
        await page.getByRole('button', { name: 'Forgot password?', exact: true }).click();
        await fill(page.getByPlaceholder('name@company.com'), email);
        if (action === 'reset-request') {
          await page.getByRole('button', { name: 'Send reset code', exact: true }).click();
          await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
          const after = await records();
          expect(after.codes.some(c => c.purpose === 'reset_password' && new Date(c.expires_at) > new Date())).toBe(true);
          expect(after.user.password_hash === before.user.password_hash).toBe(true);
        } else {
          const code = local.E2E_AUTH_RESET_CODE || '';
          expect(/^\d{6}$/.test(code), 'Enter the received reset code in the local settings file').toBe(true);
          expect(before.codes.some(c => c.purpose === 'reset_password' && c.code_hash === createHash('sha256').update(code).digest('hex'))).toBe(true);
          await page.getByRole('button', { name: 'I already have a reset code', exact: true }).click();
          await fill(page.getByPlaceholder('123456'), code);
          for (const field of await page.locator('input[autocomplete="new-password"]').all()) await fill(field, newPassword);
          await page.getByRole('button', { name: 'Reset password', exact: true }).click();
          await expect(page.getByText('Password updated. You can now sign in.', { exact: true })).toBeVisible();
          const after = await records();
          expect(await bcrypt.compare(newPassword, after.user.password_hash)).toBe(true);
          expect(await bcrypt.compare(password, after.user.password_hash)).toBe(false);
          expect(after.codes.some(c => c.purpose === 'reset_password')).toBe(false);
          await fill(page.getByPlaceholder('name@company.com'), email);
          await fill(page.locator('input[autocomplete="current-password"]'), newPassword);
          await page.getByRole('button', { name: 'Sign in', exact: true }).click();
          await expect(page.getByRole('banner').getByRole('button', { name: 'Local authentication test' })).toBeVisible();
          await page.reload();
          await expect(page.getByRole('banner').getByRole('button', { name: 'Local authentication test' })).toBeVisible();
          await page.getByRole('banner').getByRole('button', { name: 'Local authentication test' }).click();
          await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
          await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
        }
      }
    }
  } finally { await db.end({ timeout: 5 }); }
});
