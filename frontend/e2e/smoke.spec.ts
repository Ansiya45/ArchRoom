import { test, expect } from './fixtures/smoke';

test('application loads and exposes the login form without submitting', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const response = await page.goto('/');
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByRole('banner').getByText('YLAAM-MEET', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign Up', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  await expect(page.getByText('Sign in to access your meetings.', { exact: true })).toBeVisible();
  // Existing Field labels lack htmlFor/id associations. Use native form
  // attributes until that application accessibility issue is addressed separately.
  await expect(page.getByPlaceholder('name@company.com')).toBeVisible();
  await expect(page.locator('input[autocomplete="current-password"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Forgot password?', exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
