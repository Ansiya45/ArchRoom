import { test, expect, expectNoSession } from './fixtures/auth-mock';

test.beforeEach(async ({ page, authMock }) => {
  authMock.allowSignup = true;
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
  await page.getByPlaceholder('Jordan Miller').fill(authMock.user.fullName);
  await page.getByPlaceholder('name@company.com').fill(authMock.user.email);
  for (const input of await page.locator('input[autocomplete="new-password"]').all()) await input.fill(authMock.password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
});

test('verification UI appears after isolated signup with no session', async ({ page }) => {
  await expect(page.getByPlaceholder('123456')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resend code', exact: true })).toBeVisible();
  await expectNoSession(page);
});

for (const code of ['', '12345']) {
  test(`verification blocks ${code ? 'incomplete' : 'missing'} code locally`, async ({ page, authMock }) => {
    await page.getByPlaceholder('123456').fill(code);
    await page.getByRole('button', { name: 'Verify email', exact: true }).click();
    expect(await page.getByPlaceholder('123456').evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false);
    expect(authMock.calls).toEqual(['auth.signup']);
    await expectNoSession(page);
  });
}

for (const reason of ['incorrect', 'expired', 'already verified']) {
  test(`verification displays ${reason} backend rejection without storing a session (mocked)`, async ({ page }) => {
    const message = reason === 'already verified' ? 'This email is already verified. Please sign in.' : 'The code is invalid or has expired.';
    await page.route('**/api/auth.verifyEmail*', route => route.fulfill({
      contentType: 'application/json', body: JSON.stringify([{ error: { message, code: -32600,
        data: { code: 'BAD_REQUEST', httpStatus: 400, path: 'auth.verifyEmail' } } }]),
    }));
    await page.getByPlaceholder('123456').fill('123456');
    await page.getByRole('button', { name: 'Verify email', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(message);
    await expectNoSession(page);
  });
}

test('successful verification stores the returned session and closes the dialog (mocked)', async ({ page, authMock }) => {
  await page.route('**/api/auth.verifyEmail*', route => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify([{ result: { data: { ok: true, token: authMock.token, user: authMock.user } } }]),
  }));
  await page.getByPlaceholder('123456').fill('123456');
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeHidden();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ylaam_meet_token'))).toBe(authMock.token);
  await expect(page.getByRole('banner').getByRole('button', { name: authMock.user.fullName })).toBeVisible();
});

test('resend prevents concurrent clicks and clears the old input on success (mocked)', async ({ page }) => {
  let calls = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/auth.resendVerification*', async route => {
    calls++;
    await pending;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ result: { data: {
      ok: true, message: 'A new verification code was sent to your email.',
    } } }]) });
  });
  await page.getByPlaceholder('123456').fill('123456');
  await page.getByRole('button', { name: 'Resend code', exact: true }).click();
  try {
    await expect.poll(() => calls).toBe(1);
    for (const button of await page.getByRole('button', { name: 'Please wait...', exact: true }).all()) await expect(button).toBeDisabled();
  } finally { release(); }
  await expect(page.getByText('A new verification code was sent to your email.', { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('123456')).toHaveValue('');
  expect(calls).toBe(1);
  await expectNoSession(page);
});
