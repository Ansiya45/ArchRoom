import { test, expect } from '@playwright/test';
import { parse } from 'dotenv';
import { readFileSync } from 'node:fs';
import { inspectSignup, signupSettings, securePassword } from './fixtures/signup-data';
const settings = signupSettings();
const local = parse(readFileSync(new URL('../.env.e2e.local', import.meta.url)));
const code = process.env.E2E_PASSWORD_RESET_CODE || local.E2E_PASSWORD_RESET_CODE || '';
const password = process.env.E2E_FINAL_PASSWORD || local.E2E_FINAL_PASSWORD || process.env.E2E_NEW_PASSWORD || local.E2E_NEW_PASSWORD || '';
const oldPassword = process.env.E2E_OLD_PASSWORD || local.E2E_OLD_PASSWORD ||
  ((process.env.E2E_FINAL_PASSWORD || local.E2E_FINAL_PASSWORD) ? (process.env.E2E_NEW_PASSWORD || local.E2E_NEW_PASSWORD) : settings.password);

test('received reset code changes only the dedicated account and permits login, reload and logout', async ({ page, request, baseURL }) => {
  const before = await inspectSignup(settings.email);
  expect(Boolean(before?.user.full_name?.startsWith('YLAAM E2E signup ') && before?.user.email_verified_at), 'Dedicated verified account required').toBe(true);
  if (process.env.E2E_RESET_ACTION === 'request') {
    try {
      const response = await request.post(`${baseURL}/api/auth.requestPasswordReset`, { data: { email: settings.email } });
      expect(Boolean((await response.json()).result?.data?.ok)).toBe(true);
    } catch { throw new Error('Reset request failed; details withheld. Do not retry automatically.'); }
    const afterRequest = await inspectSignup(settings.email);
    const pending = afterRequest!.codes.filter(c => c.purpose === 'reset_password');
    expect(pending.length).toBe(1);
    expect(before!.codes.every(c => c.id !== pending[0].id), 'No fresh code was committed: cooldown or provider failure; no automatic retry').toBe(true);
    expect(afterRequest!.user.password_hash === before!.user.password_hash).toBe(true);
    console.log('One fresh reset code committed after normal email send. Password unchanged. STOP for received mailbox code.');
    return;
  }
  expect(/^\d{6}$/.test(code), 'Configure E2E_PASSWORD_RESET_CODE').toBe(true);
  expect(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password), 'Configure a policy-compliant E2E_NEW_PASSWORD').toBe(true);
  expect(await securePassword(before!.user.password_hash, password), 'Choose a password different from the current password').toBe(false);
  if (oldPassword) expect(await securePassword(before!.user.password_hash, oldPassword), 'Configured old password must match before reset').toBe(true);
  expect(before!.codes.some(c => c.purpose === 'reset_password' && new Date(c.expires_at) > new Date()), 'Received code has expired; stop and request one fresh email').toBe(true);
  const forbidden: string[] = [];
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== baseURL) return route.abort();
    if (url.pathname.startsWith('/api/')) {
      if (req.method() === 'POST' && ['/api/auth.resetPassword', '/api/auth.login'].includes(url.pathname)) {
        const body = req.postDataJSON(), value = url.searchParams.get('batch') === '1' ? body?.[0] : body;
        if (value?.email === settings.email) return route.continue();
      }
      const paths = decodeURIComponent(url.pathname.slice(5)).split(',');
      if (req.method() === 'GET' && paths.every(p => ['auth.me', 'meetings.list'].includes(p))) {
        let account: any;
        if (paths.includes('auth.me')) {
          account = await (await route.fetch({ url: `${baseURL}/api/auth.me` })).json();
          expect(account.result?.data?.user?.email === settings.email).toBe(true);
        }
        const results = paths.map(p => p === 'auth.me' ? account : { result: { data: { ok: true, meetings: [] } } });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(url.searchParams.get('batch') === '1' ? results : results[0]) });
      }
      forbidden.push('unexpected API request'); return route.abort();
    }
    if (req.method() === 'GET' && !['xhr', 'fetch'].includes(req.resourceType())) return route.continue();
    forbidden.push('unexpected request'); return route.abort();
  });
  await page.routeWebSocket('**/*', socket => {
    const url = new URL(socket.url());
    if (url.host === new URL(baseURL!).host && url.pathname === '/') socket.connectToServer(); else socket.close();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.getByRole('button', { name: 'Forgot password?', exact: true }).click();
  try { await page.getByPlaceholder('name@company.com').fill(settings.email); }
  catch { throw new Error('Unable to fill dedicated email; value withheld'); }
  await page.getByRole('button', { name: 'I already have a reset code', exact: true }).click();
  try {
    await page.getByPlaceholder('123456').fill(code);
    for (const input of await page.locator('input[autocomplete="new-password"]').all()) await input.fill(password);
  } catch { throw new Error('Unable to fill reset credentials; values withheld'); }
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByText('Password updated. You can now sign in.', { exact: true })).toBeVisible();
  const after = await inspectSignup(settings.email);
  expect(await securePassword(after!.user.password_hash, password)).toBe(true);
  expect(after!.user.password_hash !== before!.user.password_hash).toBe(true);
  expect(String(after!.user.email_verified_at) === String(before!.user.email_verified_at)).toBe(true);
  expect(after!.codes.filter(c => c.purpose === 'reset_password').length).toBe(0);
  const call = async (path: string, data: object) => {
    try { return await (await request.post(`${baseURL}/api/auth.${path}`, { data })).json(); }
    catch { throw new Error('Auth regression request failed; sensitive details withheld'); }
  };
  const replay = await call('resetPassword', { email: settings.email, code, password });
  expect(replay.error?.data?.code === 'BAD_REQUEST').toBe(true);
  if (oldPassword) {
    const old = await call('login', { email: settings.email, password: oldPassword });
    expect(old.error?.data?.code === 'UNAUTHORIZED' && !old.result?.data?.token).toBe(true);
  } else test.info().annotations.push({ type: 'NOT RUN', description: 'Original password unavailable: real old-password login rejection is not claimed.' });
  try {
    await page.getByPlaceholder('name@company.com').fill(settings.email);
    await page.locator('input[autocomplete="current-password"]').fill(password);
  } catch { throw new Error('Unable to fill new login credentials; values withheld'); }
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('banner').getByRole('button', { name: after!.user.full_name })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('banner').getByRole('button', { name: after!.user.full_name })).toBeVisible();
  await page.getByRole('banner').getByRole('button', { name: after!.user.full_name }).click();
  await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !localStorage.getItem('ylaam_meet_token') && !localStorage.getItem('ylaam_meet_user'))).toBe(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
  expect(forbidden).toEqual([]);
  console.log(`Real password reset, bcrypt storage, replay rejection, new login, reload and logout passed. Old-password login tested=${Boolean(oldPassword)}. No email sent.`);
});
