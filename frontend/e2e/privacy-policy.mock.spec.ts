import { test, expect, login } from './fixtures/auth-mock';

const titles = ['About this policy', 'Information we collect and process', 'Account registration and authentication', 'Meeting participation', 'Microphone, camera, and screen sharing', 'Meeting recordings', 'AI transcription and meeting summaries', 'Chat, attachments, and whiteboards', 'How personal information is used', 'Third-party services and integrations', 'Google Drive integration', 'Browser storage and authentication', 'Data security and access', 'Data retention and deletion', 'User privacy choices and requests', 'International data processing', 'Children', 'Changes to this policy', 'Contact information'];

test('public policy renders all sections and contact without authentication, including refresh', async ({ page, authMock }) => {
  await page.goto('/privacy-policy');
  await expect(page).toHaveTitle('Privacy Policy | YLAAM Meet');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy Policy');
  await expect(page.locator('main')).toContainText('owned and operated by Archon Solutions');
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(19);
  for (const title of titles) await expect(page.getByRole('heading', { level: 2 }).filter({ hasText: title })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'noreply@archonsolution.in', exact: true })).toHaveAttribute('href', 'mailto:noreply@archonsolution.in');
  await expect(page.locator('main')).toContainText('AI speech capture and transcription are currently unavailable.');
  await expect(page.locator('main')).not.toContainText('[Company review');
  await expect(page.locator('main')).toContainText('Effective date: 14 October 2026');
  await page.reload();
  await expect(page).toHaveTitle('Privacy Policy | YLAAM Meet');
  expect(authMock.calls).toEqual([]);
});

test('footer and return-home navigation work', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy Policy' }).click();
  await expect(page).toHaveURL(/\/privacy-policy$/);
  await page.getByRole('link', { name: 'Return home' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page).not.toHaveTitle('Privacy Policy | YLAAM Meet');
});

for (const mode of ['Login', 'Sign Up']) {
  test(`${mode} opens policy without submitting or losing form input`, async ({ page, context, authMock }) => {
    await page.goto('/');
    await page.getByRole('banner').getByRole('button', { name: mode, exact: true }).click();
    await page.getByPlaceholder('name@company.com').fill('privacy-test@example.invalid');
    const calls = [...authMock.calls];
    const popupPromise = context.waitForEvent('page');
    await page.getByRole('link', { name: 'Privacy Policy (opens in a new tab)', exact: true }).click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(/\/privacy-policy$/);
    await expect(popup).toHaveTitle('Privacy Policy | YLAAM Meet');
    await expect(page.getByPlaceholder('name@company.com')).toHaveValue('privacy-test@example.invalid');
    expect(authMock.calls).toEqual(calls);
    await popup.close();
  });
}

test('signed-in policy access preserves the session', async ({ page, authMock }) => {
  await login(page, authMock);
  const before = await page.evaluate(() => localStorage.getItem('ylaam_meet_token'));
  await page.goto('/privacy-policy');
  await expect(page).toHaveTitle('Privacy Policy | YLAAM Meet');
  expect(await page.evaluate(() => localStorage.getItem('ylaam_meet_token'))).toBe(before);
});

for (const width of [320, 768, 1440]) {
  test(`policy fits ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/privacy-policy');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('link', { name: 'noreply@archonsolution.in', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('link', { name: 'noreply@archonsolution.in', exact: true })).toBeVisible();
  });
}

test('keyboard users can skip navigation and follow a section link', async ({ page }) => {
  await page.goto('/privacy-policy');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to policy' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  const section = page.getByRole('navigation', { name: 'Policy sections' }).getByRole('link', { name: '19. Contact information', exact: true });
  await section.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#policy-section-19$/);
  await expect(page.getByRole('heading', { name: '19. Contact information', exact: true })).toBeInViewport();
});


test('Drive disclosures explain actual access, retention, revocation and separate copies', async ({ page }) => {
  await page.goto('/privacy-policy');
  const drive = page.locator('#policy-section-11');
  for (const text of ['https://www.googleapis.com/auth/drive.file', 'does not implement Drive file deletion', 'Drive account identifier', 'parent-folder metadata', 'browser memory', 'not persisted', 'no in-app Disconnect Google Drive button', 'does not itself revoke', 'does not send information obtained from Google Drive to OpenAI', 'separate Supabase upload']) {
    await expect(drive).toContainText(text);
  }
  await expect(drive.getByRole('link', { name: 'Manage Google Account connections' })).toHaveAttribute('href', 'https://myaccount.google.com/connections');
});
