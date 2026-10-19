import { test, expect, login } from './fixtures/auth-mock';

test('saved dashboard device choice survives returning to settings', async ({ page, authMock }) => {
  await page.addInitScript(() => {
    const devices = [
      { deviceId: 'usb-mic', kind: 'audioinput', label: 'External USB Audio Interface', groupId: 'g1' },
      { deviceId: 'camera-1', kind: 'videoinput', label: 'Test Camera', groupId: 'g2' },
    ];
    Object.defineProperty(navigator, 'mediaDevices', { value: { enumerateDevices: async () => devices, addEventListener() {}, removeEventListener() {}, getUserMedia: async () => { throw new DOMException('denied', 'NotAllowedError'); } } });
  });
  await login(page, authMock);
  const sidebar = page.getByRole('complementary');
  await sidebar.getByRole('button', { name: 'Settings', exact: true }).click();
  const device = page.locator('select').first();
  await device.selectOption('usb-mic');
  await page.getByRole('button', { name: 'Save & Apply Settings' }).click();
  await expect(page.getByText(/Device preferences saved/)).toBeVisible();
  await sidebar.getByRole('button', { name: 'Home', exact: true }).click();
  await sidebar.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('select').first()).toHaveValue('usb-mic');
});

test('footer hides unavailable Terms and Security destinations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('contentinfo').getByRole('link', { name: 'TERMS' })).toHaveCount(0);
  await expect(page.getByRole('contentinfo').getByRole('link', { name: 'SECURITY' })).toHaveCount(0);
  await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy-policy');
});
