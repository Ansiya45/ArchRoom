import { test, expect, login, expectNoSession } from './fixtures/auth-mock';

test.use({ hasTouch: true });

test('account dropdown closes outside and on Escape while preserving internal actions', async ({ page, authMock }) => {
  await login(page, authMock);
  const trigger = page.getByRole('banner').getByRole('button', { name: new RegExp(authMock.user.fullName) });
  const signOut = page.getByRole('button', { name: 'Sign Out', exact: true });
  const email = page.getByRole('banner').getByText(authMock.user.email, { exact: true });
  const outside = page.getByRole('heading', { name: /Meet Without/ });

  await trigger.click();
  await expect(signOut).toBeVisible();
  await email.click();
  await expect(signOut).toBeVisible();
  await outside.click();
  await expect(signOut).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  await trigger.click();
  await trigger.click();
  await expect(signOut).toBeHidden();

  await trigger.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(signOut).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(signOut).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.tap();
  await email.tap();
  await expect(signOut).toBeVisible();
  await outside.tap();
  await expect(signOut).toBeHidden();

  // Reopening after repeated dismissals must not accumulate listeners or break logout.
  await trigger.focus();
  await page.keyboard.press('Space');
  await expect(signOut).toBeVisible();
  await signOut.click();
  await expect(signOut).toBeHidden();
  await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
  await expectNoSession(page);
});
