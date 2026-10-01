import { test, expect, login, logout, expectNoSession } from './fixtures/auth-mock';

const tokenAt = (exp: number) => `e30.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.mock`;

test('returning the next day renews sign-in without asking for credentials', async ({ page, context, authMock }) => {
  authMock.refreshToken = 'a'.repeat(64);
  authMock.token = tokenAt(Math.floor(Date.now() / 1000) + 3600);
  await login(page, authMock);
  await page.close();
  const reopened = await context.newPage();
  await reopened.clock.install({ time: new Date(Date.now() + 25 * 3600_000) });
  await reopened.goto('/');
  await expect(reopened.getByRole('banner').getByRole('button', { name: authMock.user.fullName })).toBeVisible();
  await expect(reopened.getByRole('status')).toBeHidden();
  await expect.poll(() => authMock.calls.filter(path => path === 'auth.refresh').length).toBe(1);
  await expect(reopened.getByRole('button', { name: 'Login', exact: true })).toBeHidden();
  await logout(reopened, authMock);
  await expect.poll(() => authMock.calls.includes('auth.logout')).toBe(true);
  await expectNoSession(reopened);
  await reopened.reload();
  await expect(reopened.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
});

test('temporary dashboard failure preserves sign-in and supports retry', async ({ page, authMock }) => {
  await login(page, authMock);
  const fail = async (route: import('@playwright/test').Route) => route.abort('failed');
  await page.route('**/api/auth.me*', fail);
  await page.reload();
  await expect(page.getByRole('alert')).toHaveText(/You are still signed in/);
  expect(await page.evaluate(() => localStorage.getItem('ylaam_meet_token'))).toBe(authMock.token);
  await page.unroute('**/api/auth.me*', fail);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('alert')).toBeHidden();
  await expect(page.getByRole('banner').getByRole('button', { name: authMock.user.fullName })).toBeVisible();
});

test('temporary renewal failure preserves the device session for retry', async ({ page, authMock }) => {
  authMock.refreshToken = 'b'.repeat(64);
  authMock.token = tokenAt(Math.floor(Date.now() / 1000) + 3600);
  await login(page, authMock);
  await page.evaluate(() => localStorage.setItem('ylaam_meet_token', 'expired'));
  const fail = async (route: import('@playwright/test').Route) => route.abort('failed');
  await page.route('**/api/auth.refresh*', fail);
  await page.reload();
  await expect(page.getByRole('alert')).toHaveText(/You are still signed in/);
  expect(await page.evaluate(() => localStorage.getItem('ylaam_meet_refresh_token'))).toBe(authMock.refreshToken);
  await page.unroute('**/api/auth.refresh*', fail);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('alert')).toBeHidden();
  await expect.poll(() => authMock.calls.includes('auth.refresh')).toBe(true);
});

test('logout wins over a delayed renewal response', async ({ page, authMock }) => {
  authMock.refreshToken = 'c'.repeat(64);
  authMock.token = tokenAt(Math.floor(Date.now() / 1000) + 3600);
  await login(page, authMock);
  await page.evaluate(() => localStorage.setItem('ylaam_meet_token', 'expired'));
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  await page.route('**/api/auth.refresh*', async route => {
    requested = true;
    await held;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ result: { data: { token: authMock.token, user: authMock.user } } }]) });
  });
  await page.reload();
  const returned = page.waitForResponse(response => new URL(response.url()).pathname.includes('auth.refresh'));
  try {
    await expect.poll(() => requested).toBe(true);
    await logout(page, authMock);
  } finally { release(); }
  await (await returned).finished();
  await expectNoSession(page);
  await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
  await page.reload();
  await expectNoSession(page);
});

test('server-rejected access token renews even when the browser thinks it is valid', async ({ page, authMock }) => {
  authMock.refreshToken = 'd'.repeat(64);
  authMock.token = tokenAt(Math.floor(Date.now() / 1000) + 3600);
  await login(page, authMock);
  let rejectOnce = true;
  await page.route('**/api/auth.me*', async route => {
    if (!rejectOnce) return route.fallback();
    rejectOnce = false;
    const paths = decodeURIComponent(new URL(route.request().url()).pathname.slice(5)).split(',');
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(paths.map(path => ({ error: {
      message: 'Authentication required', code: -32001, data: { code: 'UNAUTHORIZED', httpStatus: 401, path },
    } }))) });
  });
  await page.reload();
  await expect.poll(() => authMock.calls.includes('auth.refresh')).toBe(true);
  await expect(page.getByRole('status')).toBeHidden();
  await expect(page.getByRole('banner').getByRole('button', { name: authMock.user.fullName })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeHidden();
});

test('revoked device credential clears sign-in instead of retrying forever', async ({ page, authMock }) => {
  authMock.refreshToken = 'e'.repeat(64);
  authMock.token = tokenAt(Math.floor(Date.now() / 1000) + 3600);
  await login(page, authMock);
  authMock.expired = true;
  await page.evaluate(() => localStorage.setItem('ylaam_meet_token', 'expired'));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
  await expectNoSession(page);
  expect(authMock.calls.filter(path => path === 'auth.refresh')).toHaveLength(1);
});

test('verified signup stores a persistent device session', async ({ page, authMock }) => {
  authMock.allowSignup = true;
  authMock.refreshToken = 'f'.repeat(64);
  authMock.token = tokenAt(Math.floor(Date.now() / 1000) + 3600);
  await page.route('**/api/auth.verifyEmail*', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify([{ result: { data: {
      ok: true, token: authMock.token, refreshToken: authMock.refreshToken, user: authMock.user,
    } } }]),
  }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
  await page.getByPlaceholder('Jordan Miller').fill(authMock.user.fullName);
  await page.getByPlaceholder('name@company.com').fill(authMock.user.email);
  for (const input of await page.locator('input[autocomplete="new-password"]').all()) await input.fill(authMock.password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByPlaceholder('123456').fill('123456');
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.getByRole('banner').getByRole('button', { name: authMock.user.fullName })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('ylaam_meet_refresh_token'))).toBe(authMock.refreshToken);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeHidden();
});
