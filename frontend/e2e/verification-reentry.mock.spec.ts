import { test, expect, openLogin, expectNoSession, login } from './fixtures/auth-mock';

test('unverified login can resume verification after close and reload without sending email', async ({ page, authMock }) => {
  authMock.unverified = true;
  for (const step of ['initial', 'close', 'reload']) {
    if (step === 'initial') await openLogin(page);
    if (step === 'close') {
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('button', { name: 'Login', exact: true }).click();
    }
    if (step === 'reload') await openLogin(page);
    await page.getByPlaceholder('name@company.com').fill(authMock.user.email);
    await page.locator('input[autocomplete="current-password"]').fill(authMock.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resend code', exact: true })).toBeVisible();
    await expectNoSession(page);
  }
  expect(authMock.calls).toEqual(['auth.login', 'auth.login', 'auth.login']);
  await page.route('**/api/auth.verifyEmail*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([
    { error: { message: 'The code is invalid or has expired.', code: -32600, data: { code: 'BAD_REQUEST', httpStatus: 400, path: 'auth.verifyEmail' } } },
  ]) }));
  await page.getByPlaceholder('123456').fill('123456');
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('The code is invalid or has expired.');
  await expectNoSession(page);
});

test('wrong password for unverified user remains rejected without opening verification', async ({ page, authMock }) => {
  authMock.unverified = true;
  await openLogin(page);
  await page.getByPlaceholder('name@company.com').fill(authMock.user.email);
  await page.locator('input[autocomplete="current-password"]').fill('incorrect');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Wrong password. Please try again.');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expectNoSession(page);
});

test('verified users retain normal login', async ({ page, authMock }) => {
  await login(page, authMock);
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeHidden();
});
