import { test, expect, openLogin, expectNoSession, type AuthMock } from './fixtures/auth-mock';
import type { Page } from '@playwright/test';
const message = 'If an account exists for this email, a reset code will be sent. Please wait 60 seconds before requesting another.';
async function forgot(page: Page) {
  await openLogin(page);
  await page.getByRole('button', { name: 'Forgot password?', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
}
async function reset(page: Page, auth: AuthMock) {
  await forgot(page);
  await page.getByPlaceholder('name@company.com').fill(auth.user.email);
  await page.getByRole('button', { name: 'I already have a reset code', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
}
test('forgot UI opens and requires email', async ({ page, authMock }) => {
  await forgot(page); await page.getByRole('button', { name: 'Send reset code', exact: true }).click();
  expect(await page.getByPlaceholder('name@company.com').evaluate((e: HTMLInputElement) => e.validity.valueMissing)).toBe(true);
  expect(authMock.calls).toEqual([]);
});
test('forgot rejects malformed email and prevents reset re-entry with invalid email', async ({ page, authMock }) => {
  await forgot(page); await page.getByPlaceholder('name@company.com').fill('invalid');
  await page.getByRole('button', { name: 'Send reset code', exact: true }).click();
  await page.getByRole('button', { name: 'I already have a reset code', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
  expect(authMock.calls).toEqual([]);
});
for (const kind of ['registered', 'nonexistent']) test(`forgot shows generic response for ${kind} email (mocked)`, async ({ page, authMock }) => {
  await page.route('**/api/auth.requestPasswordReset*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ result: { data: { ok: true, message } } }]) }));
  await forgot(page); await page.getByPlaceholder('name@company.com').fill(kind === 'registered' ? authMock.user.email : 'absent@example.invalid');
  await page.getByRole('button', { name: 'Send reset code', exact: true }).click();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await expectNoSession(page);
});
for (const missing of ['code', 'incomplete code', 'password', 'confirmation']) test(`reset requires ${missing} locally`, async ({ page, authMock }) => {
  await reset(page, authMock);
  const inputs = page.locator('input[autocomplete="new-password"]');
  await page.getByPlaceholder('123456').fill(missing === 'code' ? '' : missing === 'incomplete code' ? '12345' : '123456');
  if (missing !== 'password') await inputs.nth(0).fill(authMock.password);
  if (missing !== 'confirmation') await inputs.nth(1).fill(authMock.password);
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  expect(await page.locator('form').evaluate((form: HTMLFormElement) => form.checkValidity())).toBe(false);
  expect(authMock.calls).toEqual([]); await expectNoSession(page);
});
for (const [rule, value] of [['length', 'Abcdef1'], ['uppercase', 'abcdefg1'], ['lowercase', 'ABCDEFG1'], ['digit', 'Abcdefgh']]) test(`reset enforces password ${rule}`, async ({ page, authMock }) => {
  await reset(page, authMock); await page.getByPlaceholder('123456').fill('123456');
  for (const input of await page.locator('input[autocomplete="new-password"]').all()) await input.fill(value);
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Use 8+ characters with uppercase, lowercase, and a number.');
  expect(authMock.calls).toEqual([]);
});
test('reset rejects confirmation mismatch', async ({ page, authMock }) => {
  await reset(page, authMock); await page.getByPlaceholder('123456').fill('123456');
  const inputs = page.locator('input[autocomplete="new-password"]');
  await inputs.nth(0).fill(authMock.password); await inputs.nth(1).fill(authMock.password + 'other');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Passwords do not match.'); expect(authMock.calls).toEqual([]);
});
for (const reason of ['incorrect', 'expired', 'reused']) test(`reset displays ${reason} code rejection (mocked)`, async ({ page, authMock }) => {
  await page.route('**/api/auth.resetPassword*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ error: { message: 'The code is invalid or has expired.', code: -32600, data: { code: 'BAD_REQUEST', httpStatus: 400, path: 'auth.resetPassword' } } }]) }));
  await reset(page, authMock); await page.getByPlaceholder('123456').fill('123456');
  for (const input of await page.locator('input[autocomplete="new-password"]').all()) await input.fill(authMock.password);
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('The code is invalid or has expired.'); await expectNoSession(page);
});
test('reset returns to login, clears password inputs and accepts new password (mocked)', async ({ page, authMock }) => {
  const replacement = authMock.password + 'New1';
  await page.route('**/api/auth.resetPassword*', async route => {
    authMock.password = replacement;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ result: { data: { ok: true } } }]) });
  });
  await reset(page, authMock); await page.getByPlaceholder('123456').fill('123456');
  for (const input of await page.locator('input[autocomplete="new-password"]').all()) await input.fill(replacement);
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByText('Password updated. You can now sign in.', { exact: true })).toBeVisible();
  await expect(page.locator('input[autocomplete="current-password"]')).toHaveValue(''); await expectNoSession(page);
  await page.locator('input[autocomplete="current-password"]').fill(replacement);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('banner').getByRole('button', { name: authMock.user.fullName })).toBeVisible();
});
