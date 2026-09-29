import { test, expect } from '@playwright/test';
import { parse } from 'dotenv';
import { readFileSync } from 'node:fs';
import { inspectSignup, signupSettings, securePassword } from './fixtures/signup-data';

const settings = signupSettings();
const local = parse(readFileSync(new URL('../.env.e2e.local', import.meta.url)));
const password = process.env.E2E_FINAL_PASSWORD || local.E2E_FINAL_PASSWORD || '';

test('final reset password logs in again after logout', async ({ page, baseURL }) => {
  const account = await inspectSignup(settings.email);
  expect(Boolean(account?.user.full_name?.startsWith('YLAAM E2E signup ') && account?.user.email_verified_at),
    'Dedicated verified E2E account required').toBe(true);
  expect(Boolean(password), 'E2E_FINAL_PASSWORD is required').toBe(true);
  expect(await securePassword(account!.user.password_hash, password), 'Final password must match the dedicated account').toBe(true);
  expect(account!.codes.length, 'All verification/reset codes must already be consumed').toBe(0);

  const forbidden: string[] = [];
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== baseURL) return route.abort();
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/auth.login' && request.method() === 'POST') {
        const body = request.postDataJSON();
        const input = url.searchParams.get('batch') === '1' ? body?.[0] : body;
        if (input?.email === settings.email) return route.continue();
      }
      const paths = decodeURIComponent(url.pathname.slice(5)).split(',');
      if (request.method() === 'GET' && paths.every(path => ['auth.me', 'meetings.list'].includes(path))) {
        let me: any;
        if (paths.includes('auth.me')) {
          me = await (await route.fetch({ url: `${baseURL}/api/auth.me` })).json();
          expect(me.result?.data?.user?.email === settings.email, 'Real auth.me must identify the reset account').toBe(true);
        }
        const results = paths.map(path => path === 'auth.me' ? me : { result: { data: { ok: true, meetings: [] } } });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(url.searchParams.get('batch') === '1' ? results : results[0]) });
      }
      forbidden.push('unexpected API request'); return route.abort();
    }
    if (request.method() === 'GET' && !['xhr', 'fetch'].includes(request.resourceType())) return route.continue();
    forbidden.push('unexpected request'); return route.abort();
  });
  await page.routeWebSocket('**/*', socket => {
    const url = new URL(socket.url());
    if (url.host === new URL(baseURL!).host && url.pathname === '/') socket.connectToServer(); else socket.close();
  });

  const login = async () => {
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    try {
      await page.getByPlaceholder('name@company.com').fill(settings.email);
      await page.locator('input[autocomplete="current-password"]').fill(password);
    } catch { throw new Error('Unable to fill final credentials; values withheld'); }
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('banner').getByRole('button', { name: account!.user.full_name })).toBeVisible();
  };

  await page.goto('/');
  await login();
  await page.reload();
  await expect(page.getByRole('banner').getByRole('button', { name: account!.user.full_name })).toBeVisible();
  await page.getByRole('banner').getByRole('button', { name: account!.user.full_name }).click();
  await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !localStorage.getItem('ylaam_meet_token') && !localStorage.getItem('ylaam_meet_user'))).toBe(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
  await login();
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('ylaam_meet_token')))).toBe(true);
  expect(forbidden).toEqual([]);
});
