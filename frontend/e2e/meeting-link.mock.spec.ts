import { test, expect } from './fixtures/auth-mock';

test('shared meeting link opens homepage signup and survives refresh', async ({ page, authMock }) => {
  await page.goto('/meet/YLM-1234-ABC');
  await expect(page).toHaveURL(/\/?join=YLM-1234-ABC$/);
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  expect(authMock.calls).toEqual([]);
});

test('invited participant returns to the original meeting after login', async ({ page, authMock }) => {
  await page.route('**/api/meetings.getByCode*', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{ result: { data: { meeting: { meetingCode: 'YLM-1234-ABC', title: 'Invited meeting', hostUserId: 'another-user' } } } }]),
  }));
  await page.goto('/meet/YLM-1234-ABC');
  await page.getByRole('button', { name: 'Already have an account? Sign in' }).click();
  await page.getByPlaceholder('name@company.com').fill(authMock.user.email);
  await page.locator('input[autocomplete="current-password"]').fill(authMock.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/meet\/YLM-1234-ABC$/);
  await expect(page.getByText(`Signed in as ${authMock.user.email}`, { exact: true })).toBeVisible();
});
