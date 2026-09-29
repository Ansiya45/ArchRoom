import { randomUUID } from 'node:crypto';
import { test as base, expect, type Page } from '@playwright/test';
import { realCredentials } from './fixtures/real-credentials';

const credentials = realCredentials();
const test = base.extend<{ protectReal: void }>({
  protectReal: [async ({ context, baseURL }, use) => {
    const origin = new URL(baseURL!).origin;
    const blocked: string[] = [];
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === origin && url.pathname.startsWith('/api/')) {
        const paths = decodeURIComponent(url.pathname.slice(5)).split(',');
        const allowed = paths.every(path => request.method() === 'POST' ? path === 'auth.login' :
          request.method() === 'GET' && ['auth.me', 'meetings.list'].includes(path));
        if (allowed) return route.continue(); // Real Vite proxy -> backend -> PostgreSQL.
        blocked.push('unapproved API');
        return route.abort('blockedbyclient');
      }
      if (['xhr', 'fetch'].includes(request.resourceType()) || !['GET', 'HEAD'].includes(request.method())) {
        blocked.push('unapproved data request'); return route.abort('blockedbyclient');
      }
      if (url.origin !== origin) return route.abort('blockedbyclient');
      return route.continue();
    });
    await context.routeWebSocket('**/*', socket => {
      const url = new URL(socket.url());
      if (url.host === new URL(origin).host && url.pathname === '/') socket.connectToServer();
      else { blocked.push('WebSocket'); socket.close(); }
    });
    await use();
    expect(blocked, 'Only login and account reads are authorized').toEqual([]);
  }, { auto: true }],
});

async function openLogin(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
}
async function submit(page: Page, email: string, password: string) {
  // Never include a Playwright fill error (which can print its argument) in logs.
  try {
    await page.getByPlaceholder('name@company.com').fill(email);
    await page.locator('input[autocomplete="current-password"]').fill(password);
  } catch { throw new Error('Unable to fill the login form; credential values withheld.'); }
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth.login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const result = await (await response).json();
  return (Array.isArray(result) ? result[0] : result) as any;
}
async function accountLoaded(page: Page) {
  // Capture actual backend replies, including tRPC batching, without logging data.
  const response = await page.waitForResponse(r => new URL(r.url()).pathname.includes('auth.me'));
  const paths = decodeURIComponent(new URL(response.url()).pathname.slice(5)).split(',');
  const body = await response.json();
  const replies = Array.isArray(body) ? body : [body];
  const me = replies[paths.indexOf('auth.me')];
  expect(Boolean(me?.result?.data?.ok), 'Real auth.me must succeed').toBe(true);
  expect(me?.result?.data?.user?.email === credentials.email, 'auth.me must identify the dedicated account').toBe(true);
  const listIndex = paths.indexOf('meetings.list');
  expect(listIndex >= 0, 'Homepage must request its account data').toBe(true);
  expect(Array.isArray(replies[listIndex]?.result?.data?.meetings), 'Real account data must load').toBe(true);
}
async function noSession(page: Page) {
  await expect.poll(() => page.evaluate(() => !localStorage.getItem('ylaam_meet_token') && !localStorage.getItem('ylaam_meet_user'))).toBe(true);
}

test('real verified login, account reads, reload, logout, and login again', async ({ page }) => {
  await openLogin(page);
  const loaded = accountLoaded(page);
  const result = await submit(page, credentials.email, credentials.password);
  if (result.error) throw new Error(`Dedicated-account login rejected (${result.error.data?.code || 'unknown'}). Check account/password/verified status.`);
  expect(Boolean(result.result?.data?.token), 'Real login must issue a session').toBe(true);
  await loaded;
  await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeHidden();
  expect(await page.evaluate(() => Boolean(localStorage.getItem('ylaam_meet_token') && localStorage.getItem('ylaam_meet_user')))).toBe(true);
  const reloadLoaded = accountLoaded(page);
  await page.reload();
  await reloadLoaded;
  await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeHidden();
  // Desktop header has exactly one authenticated profile button.
  await page.getByRole('banner').locator('div.hidden.md\\:flex button').click();
  await expect(page.getByRole('button', { name: 'Sign Out', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign Out', exact: true })).toBeHidden();
  await noSession(page);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
  await noSession(page);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  const againLoaded = accountLoaded(page);
  const again = await submit(page, credentials.email, credentials.password);
  expect(Boolean(again.result?.data?.token), 'Login after logout must succeed').toBe(true);
  await againLoaded;
});

test('real backend rejects an incorrect password', async ({ page }) => {
  await openLogin(page);
  const result = await submit(page, credentials.email, `${credentials.password}-${randomUUID()}`);
  expect(result.error?.data?.code).toBe('UNAUTHORIZED');
  await expect(page.getByRole('alert')).toHaveText('Wrong password. Please try again.');
  await noSession(page);
});

test('real backend rejects the configured nonexistent email', async ({ page }) => {
  await openLogin(page);
  const result = await submit(page, credentials.nonexistent, randomUUID());
  expect(result.error?.data?.code).toBe('NOT_FOUND');
  await expect(page.getByRole('alert')).toHaveText('Email ID is not registered.');
  await noSession(page);
});
