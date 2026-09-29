import { test, expect, login, logout, expectNoSession } from './fixtures/auth-mock';

test.describe('application dashboard — isolated API', () => {
  test('unauthenticated account sections are gated without exposing private data', async ({ page, authMock }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Meet Without/ })).toBeVisible();
    const sidebar = page.getByRole('complementary');
    for (const section of ['Create Meeting', 'Scheduled Meetings', 'Favorites', 'Settings']) {
      await sidebar.getByRole('button', { name: section, exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
      await expect(page.getByText('Please sign in to access your dashboard.')).toBeVisible();
      await expect(page.getByRole('heading', { name: authMock.privateTitle })).toBeHidden();
      await page.getByRole('button', { name: 'Close' }).click();
    }
    expect(authMock.calls).toEqual([]);
  });

  test('authenticated navigation renders each section without starting a workflow', async ({ page, authMock }) => {
    await login(page, authMock);
    await expect(page.getByRole('heading', { name: /Meet Without/ })).toBeVisible();
    await page.evaluate(() => history.pushState({}, '', '/?dashboard=home'));
    const sidebar = page.getByRole('complementary');

    await sidebar.getByRole('button', { name: 'Create Meeting', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Create or Schedule Meeting' })).toBeVisible();
    await page.getByRole('button', { name: 'Close meeting form' }).click();

    await page.getByRole('button', { name: 'Scheduled Meetings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your Upcoming Conferences' })).toBeVisible();
    await expect(page.getByRole('heading', { name: authMock.privateTitle })).toBeVisible();
    await page.getByRole('button', { name: 'Favorites', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'No Favorites Saved Yet' })).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Audio, Video & AI Intelligence' })).toBeVisible();
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Meet Without/ })).toBeVisible();

    await page.goBack();
    await expect(page.getByRole('heading', { name: /Meet Without/ })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole('heading', { name: /Meet Without/ })).toBeVisible();
  });

  test('empty account response has stable Scheduled and Favorites empty states', async ({ page, authMock }) => {
    await page.route('**/api/auth.me*', async route => {
      const paths = decodeURIComponent(new URL(route.request().url()).pathname.slice(5)).split(',');
      authMock.calls.push(...paths);
      const replies = paths.map(path => ({ result: { data: path === 'auth.me'
        ? { ok: true, user: authMock.user } : { ok: true, meetings: [] } } }));
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(replies) });
    });
    await login(page, authMock);
    await page.getByRole('button', { name: 'Scheduled Meetings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'No Meetings Found' })).toBeVisible();
    await page.getByRole('button', { name: 'Favorites', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'No Favorites Saved Yet' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: /Meet Without/ })).toBeVisible();
  });

  test('slow account load shows a boundary and never exposes cached account content', async ({ page, authMock }) => {
    await page.addInitScript(({ token, user }) => {
      localStorage.setItem('ylaam_meet_token', token);
      localStorage.setItem('ylaam_meet_user', JSON.stringify(user));
    }, { token: authMock.token, user: authMock.user });
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/auth.me*', async route => {
      await held;
      const paths = decodeURIComponent(new URL(route.request().url()).pathname.slice(5)).split(',');
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(paths.map(path => ({ result: { data: path === 'auth.me'
        ? { ok: true, user: authMock.user } : { ok: true, meetings: [] } } }))) });
    });
    await page.goto('/');
    try {
      await expect(page.getByRole('status')).toHaveText('Loading your dashboard...');
      await expect(page.getByText(authMock.privateTitle)).toBeHidden();
    } finally { release(); }
    await expect(page.getByRole('status')).toBeHidden();
    await expect(page.getByRole('heading', { name: /Meet Without/ })).toBeVisible();
  });

  test('failed account validation removes private state and reports the session error', async ({ page, authMock }) => {
    await login(page, authMock);
    authMock.expired = true;
    await page.reload();
    await expect(page.getByText('Your session expired. Please sign in again.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
    await expect(page.getByText(authMock.privateTitle)).toBeHidden();
    await expectNoSession(page);
  });

  test('dashboard toast is singular, nonblocking, and expires', async ({ page, authMock }) => {
    await login(page, authMock);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const save = page.getByRole('button', { name: 'Save & Apply Settings' });
    await save.click();
    await save.click();
    await expect(page.getByText('Settings saved successfully!')).toHaveCount(1);
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Meet Without/ })).toBeVisible();
    await expect(page.getByText('Settings saved successfully!')).toBeHidden({ timeout: 5_000 });
  });

  test('logout and browser navigation cannot restore dashboard data', async ({ page, authMock }) => {
    await login(page, authMock);
    await page.getByRole('button', { name: 'Scheduled Meetings', exact: true }).click();
    await expect(page.getByRole('heading', { name: authMock.privateTitle })).toBeVisible();
    await logout(page, authMock);
    await page.goBack();
    await expect(page.getByRole('heading', { name: authMock.privateTitle })).toBeHidden();
    await page.goForward();
    await expect(page.getByRole('heading', { name: authMock.privateTitle })).toBeHidden();
    await page.reload();
    await expectNoSession(page);
  });

  test('mobile navigation reaches account sections without leaving the dashboard', async ({ page, authMock }) => {
    await login(page, authMock);
    await page.setViewportSize({ width: 390, height: 844 });
    const navigation = page.getByRole('navigation', { name: 'Mobile dashboard navigation' });
    await navigation.getByRole('button', { name: 'Scheduled Meetings' }).click();
    await expect(page.getByRole('heading', { name: 'Your Upcoming Conferences' })).toBeVisible();
    await navigation.getByRole('button', { name: 'Favorites' }).click();
    await expect(page.getByRole('heading', { name: 'No Favorites Saved Yet' })).toBeVisible();
    await navigation.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Audio, Video & AI Intelligence' })).toBeVisible();
    await navigation.getByRole('button', { name: 'Home' }).click();
    await expect(page.getByRole('heading', { name: /Meet Without/ })).toBeVisible();
  });
});
