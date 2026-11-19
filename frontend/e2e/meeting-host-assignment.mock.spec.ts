import { test, expect, login } from './fixtures/auth-mock';

test('super admin chooses a session host without replacing meeting ownership', async ({ page, authMock }) => {
  authMock.driveAdmin = true;
  authMock.instantCreationEnabled = true;
  await page.addInitScript(() => {
    const original = history.pushState.bind(history);
    history.pushState = (data, unused, url) => {
      if (String(url ?? '').startsWith('/meet/')) return;
      original(data, unused, url);
    };
  });
  await login(page, authMock);
  await page.getByRole('complementary').getByRole('button', { name: 'Create Meeting', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create or Schedule Meeting' });
  await dialog.getByLabel('Session host', { exact: true }).selectOption('22222222-2222-4222-8222-222222222222');
  await dialog.getByLabel('Meeting Topic / Title').fill('Delegated session');
  await dialog.locator('button[type="submit"]').click();
  await expect.poll(() => authMock.instantCreateCalls.length).toBe(1);
  expect(authMock.instantCreateCalls[0]).toMatchObject({ assignedHostUserId: '22222222-2222-4222-8222-222222222222', startNow: false, reusable: true });
});
