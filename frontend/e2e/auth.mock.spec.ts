import { randomUUID } from 'node:crypto';
import { test, expect, openLogin, login, logout, expectNoSession } from './fixtures/auth-mock';

// Browser UI tests with mocked tRPC responses, NOT live credential verification.
test.describe('authentication UI — mocked API', () => {
  test('a delayed account response cannot restore private state after logout', async ({ page, authMock }) => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let requested = false;
    await page.route('**/api/auth.me*', async route => {
      requested = true; await held;
      const paths = decodeURIComponent(new URL(route.request().url()).pathname.slice(5)).split(',');
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(paths.map(path => ({ result: { data: path === 'auth.me' ? { ok: true, user: authMock.user } : { ok: true, meetings: [] } } }))) });
    });
    await openLogin(page);
    await page.getByPlaceholder('name@company.com').fill(authMock.user.email);
    await page.locator('input[autocomplete="current-password"]').fill(authMock.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const returned = page.waitForResponse(response => new URL(response.url()).pathname.includes('auth.me'));
    try {
      await expect.poll(() => requested).toBe(true);
      await logout(page, authMock);
    } finally { release(); }
    await (await returned).finished();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expectNoSession(page);
    await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
    await expect(page.getByRole('banner').getByRole('button', { name: authMock.user.fullName })).toBeHidden();
    await page.reload(); await expectNoSession(page);
  });
  test('valid synthetic credentials establish a browser session', async ({ page, authMock }) => {
    await login(page, authMock);
    expect(await page.evaluate(() => localStorage.getItem('ylaam_meet_token'))).toBe(authMock.token);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ylaam_meet_user')!))).toEqual(authMock.user);
  });

  test('incorrect password displays the backend error and permits retry', async ({ page, authMock }) => {
    await openLogin(page);
    await page.getByPlaceholder('name@company.com').fill(authMock.user.email);
    await page.locator('input[autocomplete="current-password"]').fill(randomUUID());
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Wrong password. Please try again.');
    await expectNoSession(page);
    await page.locator('input[autocomplete="current-password"]').fill(authMock.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeHidden();
  });

  test('nonexistent email displays the backend not-registered error', async ({ page, authMock }) => {
    await openLogin(page);
    await page.getByPlaceholder('name@company.com').fill(`${randomUUID()}@example.invalid`);
    await page.locator('input[autocomplete="current-password"]').fill(authMock.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Email ID is not registered.');
    await expectNoSession(page);
  });

  for (const field of ['email', 'password'] as const) {
    test(`required ${field} blocks submission without API calls`, async ({ page, authMock }) => {
      await openLogin(page);
      if (field === 'email') await page.locator('input[autocomplete="current-password"]').fill(authMock.password);
      else await page.getByPlaceholder('name@company.com').fill(authMock.user.email);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      const input = field === 'email' ? page.getByPlaceholder('name@company.com') : page.locator('input[autocomplete="current-password"]');
      expect(await input.evaluate((element: HTMLInputElement) => element.validity.valueMissing)).toBe(true);
      expect(authMock.calls).toEqual([]);
      await expectNoSession(page);
    });
  }

  test('malformed email fails browser validation without API calls', async ({ page, authMock }) => {
    await openLogin(page);
    await page.getByPlaceholder('name@company.com').fill(randomUUID());
    await page.locator('input[autocomplete="current-password"]').fill(authMock.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    expect(await page.getByPlaceholder('name@company.com').evaluate((element: HTMLInputElement) => element.validity.typeMismatch)).toBe(true);
    expect(authMock.calls).toEqual([]);
  });

  test('logout clears local session and remains logged out on reload', async ({ page, authMock }) => {
    await login(page, authMock);
    await logout(page, authMock);
    await expectNoSession(page);
    const count = authMock.calls.length;
    await page.reload();
    await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
    expect(authMock.calls.length).toBe(count);
  });

  test('logout discards retained auth form details and permits a fresh login', async ({ page, authMock }) => {
    await login(page, authMock);
    await logout(page, authMock);
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await expect(page.getByPlaceholder('name@company.com')).toHaveValue('');
    await expect(page.locator('input[autocomplete="current-password"]')).toHaveValue('');
    await page.getByPlaceholder('name@company.com').fill(authMock.user.email);
    await page.locator('input[autocomplete="current-password"]').fill(authMock.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('banner').getByRole('button', { name: authMock.user.fullName })).toBeVisible();
  });

  test('session survives navigation and revalidates on reload', async ({ page, authMock }) => {
    await login(page, authMock);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Audio, Video & AI Intelligence' })).toBeVisible();
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    const count = authMock.calls.filter(path => path === 'auth.me').length;
    await page.reload();
    await expect.poll(() => authMock.calls.filter(path => path === 'auth.me').length).toBeGreaterThan(count);
    await expect(page.getByRole('banner').getByRole('button', { name: authMock.user.fullName })).toBeVisible();
  });

  test('rejected session is cleared on reload', async ({ page, authMock }) => {
    await login(page, authMock);
    authMock.expired = true;
    await page.reload();
    await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
    await expect(page.getByText('Your session expired. Please sign in again.')).toBeVisible();
    await expectNoSession(page);
  });

  test('private cached account data must disappear after logout @privacy', async ({ page, authMock }) => {
    await login(page, authMock);
    // Only display a synthetic account-list item to verify logout privacy.
    // No meeting is created, started, edited, or deleted.
    await page.getByRole('button', { name: 'Scheduled Meetings', exact: true }).click();
    await expect(page.getByRole('heading', { name: authMock.privateTitle })).toBeVisible();
    await logout(page, authMock);
    await expectNoSession(page);
    await expect(page.getByRole('heading', { name: authMock.privateTitle })).toBeHidden();
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: 'Scheduled Meetings', exact: true }).click();
    await expect(page.getByRole('heading', { name: authMock.privateTitle })).toBeHidden();
  });

  test('logout must update another open tab @privacy', async ({ page, context, authMock }) => {
    await login(page, authMock);
    const other = await context.newPage();
    await other.goto('/');
    await expect(other.getByRole('banner').getByRole('button', { name: authMock.user.fullName })).toBeVisible();
    await other.getByRole('button', { name: 'Scheduled Meetings', exact: true }).click();
    await expect(other.getByRole('heading', { name: authMock.privateTitle })).toBeVisible();
    await logout(page, authMock);
    await expectNoSession(other);
    await expect(other.getByRole('heading', { name: authMock.privateTitle })).toBeHidden();
    await expect(other.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
  });

  for (const removal of ['token', 'clear'] as const) {
    test(`session ${removal} removal in another tab clears private UI`, async ({ page, context, authMock }) => {
      await login(page, authMock);
      await page.getByRole('button', { name: 'Scheduled Meetings', exact: true }).click();
      await expect(page.getByRole('heading', { name: authMock.privateTitle })).toBeVisible();
      const other = await context.newPage();
      await other.goto('/');
      await other.evaluate(mode => {
        if (mode === 'clear') localStorage.clear();
        else localStorage.removeItem('ylaam_meet_token');
      }, removal);
      await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: authMock.privateTitle })).toBeHidden();
      await page.reload();
      await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
    });
  }

  test('signup validates password strength and confirmation locally', async ({ page, authMock }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    await page.getByPlaceholder('Jordan Miller').fill(authMock.user.fullName);
    await page.getByPlaceholder('name@company.com').fill(authMock.user.email);
    const passwords = page.locator('input[autocomplete="new-password"]');
    const weak = randomUUID().replace(/[^a-z]/g, '').slice(0, 4);
    await passwords.nth(0).fill(weak);
    await passwords.nth(1).fill(weak);
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Use 8+ characters with uppercase, lowercase, and a number.');
    await passwords.nth(0).fill(authMock.password);
    await passwords.nth(1).fill(randomUUID());
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Passwords do not match.');
    expect(authMock.calls).toEqual([]);
  });

  test('mocked signup response opens verification UI without creating an account or sending mail', async ({ page, authMock }) => {
    authMock.allowSignup = true;
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
    await page.getByPlaceholder('Jordan Miller').fill(authMock.user.fullName);
    await page.getByPlaceholder('name@company.com').fill(authMock.user.email);
    for (const input of await page.locator('input[autocomplete="new-password"]').all()) await input.fill(authMock.password);
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify email', exact: true })).toBeVisible();
    await expectNoSession(page);
    expect(authMock.calls).toEqual(['auth.signup']);
  });
});
