import { test as base, expect } from '@playwright/test';
import { realCredentials } from './fixtures/real-credentials';

const credentials = realCredentials();
const test = base.extend<{ readOnlyDashboard: void }>({
  readOnlyDashboard: [async ({ context, baseURL }, use) => {
    const origin = new URL(baseURL!).origin;
    const blocked: string[] = [];
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === origin && url.pathname.startsWith('/api/')) {
        const paths = decodeURIComponent(url.pathname.slice(5)).split(',');
        if ((request.method() === 'POST' && paths.every(path => path === 'auth.login')) ||
          (request.method() === 'GET' && paths.every(path => ['auth.me', 'meetings.list'].includes(path)))) return route.continue();
        blocked.push('unapproved API request'); return route.abort('blockedbyclient');
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
    expect(blocked, 'Dashboard test permits login and account reads only').toEqual([]);
  }, { auto: true }],
});

test('real account reaches a read-only dashboard and reloads safely', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  try {
    await page.getByPlaceholder('name@company.com').fill(credentials.email);
    await page.locator('input[autocomplete="current-password"]').fill(credentials.password);
  } catch { throw new Error('Unable to fill dedicated credentials; values withheld'); }
  const accountResponse = page.waitForResponse(response => new URL(response.url()).pathname.includes('auth.me'));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const response = await accountResponse;
  const paths = decodeURIComponent(new URL(response.url()).pathname.slice(5)).split(',');
  const body = await response.json();
  const replies = Array.isArray(body) ? body : [body];
  const account = replies[paths.indexOf('auth.me')]?.result?.data?.user;
  const meetings = replies[paths.indexOf('meetings.list')]?.result?.data?.meetings;
  expect(account?.email).toBe(credentials.email);
  expect(Array.isArray(meetings)).toBe(true);
  await expect(page.getByRole('banner').getByRole('button', { name: account.fullName })).toBeVisible();

  await page.getByRole('button', { name: 'Scheduled Meetings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your Upcoming Conferences' })).toBeVisible();
  if (meetings.length === 0) await expect(page.getByRole('heading', { name: 'No Meetings Found' })).toBeVisible();
  else await expect(page.getByRole('heading', { name: meetings[0].title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No Favorites Saved Yet' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Audio, Video & AI Intelligence' })).toBeVisible();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Meet Without/ })).toBeVisible();

  const reloadReads = page.waitForResponse(result => new URL(result.url()).pathname.includes('auth.me'));
  await page.reload();
  await reloadReads;
  await expect(page.getByRole('banner').getByRole('button', { name: account.fullName })).toBeVisible();
});
