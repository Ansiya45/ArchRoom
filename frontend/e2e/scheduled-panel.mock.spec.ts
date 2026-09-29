import { test, expect, login } from './fixtures/auth-mock';

async function openScheduledPanel(page: import('@playwright/test').Page, mobile = false) {
  const navigation = mobile
    ? page.getByRole('navigation', { name: 'Mobile dashboard navigation' })
    : page.getByRole('complementary');
  await navigation.getByRole('button', { name: 'Scheduled Meetings', exact: true }).click();
  await expect(page.getByTestId('dashboard-scroll').getByText('Scheduled Meetings', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your Upcoming Conferences' })).toBeVisible();
  const toggle = page.getByRole('button', { name: 'Calendar, invitations & reminders' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('textbox', { name: 'Invite by email' })).toBeEnabled();
  return toggle;
}

test.describe('scheduled meeting expanded controls — isolated API', () => {
  test('host can type, queue an invitation, opt into reminders, and use the panel by keyboard', async ({ page, authMock }) => {
    authMock.notificationsEnabled = true;
    await login(page, authMock);
    const toggle = await openScheduledPanel(page);

    const email = page.getByRole('textbox', { name: 'Invite by email' });
    await email.focus();
    await page.keyboard.type('name@example.com');
    await expect(email).toHaveValue('name@example.com');
    const send = page.getByRole('button', { name: 'Send invitations' });
    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.getByRole('status')).toHaveText('Invitation request processed. New addresses receive one invitation; previously invited addresses are not sent another.');
    expect(authMock.notificationCalls.find(call => call.path === 'meetingNotifications.invite')?.input.emails).toEqual(['name@example.com']);

    const invitees = page.getByRole('button', { name: 'View invited people (1)' });
    await expect(invitees).toHaveAttribute('aria-expanded', 'false');
    await invitees.click();
    const hideInvitees = page.getByRole('button', { name: 'Hide invited people (1)' });
    await expect(hideInvitees).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('name@example.com', { exact: true })).toBeVisible();
    await hideInvitees.click();
    await expect(page.getByText('name@example.com', { exact: true })).toBeHidden();

    const reminder = page.getByRole('checkbox', { name: 'Email me 10 minutes before each scheduled occurrence' });
    await expect(reminder).toBeEnabled();
    await reminder.click();
    await expect(reminder).toBeChecked();
    expect(authMock.notificationCalls.some(call => call.path === 'meetingNotifications.myReminder' && call.input.enabled === true)).toBe(true);

    const scroll = page.getByTestId('dashboard-scroll');
    await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(page.getByRole('button', { name: 'Start Call' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh delivery status' })).toBeVisible();
    await expect(page.getByText(/ALL RIGHTS RESERVED/)).toBeVisible();
    await scroll.evaluate(element => { element.scrollTop = 0; });
    await expect(scroll.getByText('Scheduled Meetings', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your Upcoming Conferences' })).toBeVisible();

    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('heading', { name: 'Your Upcoming Conferences' })).toBeVisible();
  });

  for (const viewport of [
    { name: 'small laptop', width: 1024, height: 600, mobile: false },
    { name: 'mobile', width: 390, height: 844, mobile: true },
  ]) {
    test(`expanded panel retains one usable scroll surface on ${viewport.name}`, async ({ page, authMock }) => {
      authMock.notificationsEnabled = true;
      await login(page, authMock);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const toggle = await openScheduledPanel(page, viewport.mobile);
      const scroll = page.getByTestId('dashboard-scroll');
      const geometry = await scroll.evaluate(element => ({
        clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
        clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
      }));
      expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);

      await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      await expect(page.getByRole('button', { name: 'Start Call' })).toBeVisible();
      await scroll.evaluate(element => { element.scrollTop = 0; });
      await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(0);
      await expect(scroll.getByText('Scheduled Meetings', { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Your Upcoming Conferences' })).toBeVisible();

      for (let count = 0; count < 3; count++) {
        await toggle.click();
        await toggle.click();
      }
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const finalWidth = await scroll.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
      expect(finalWidth.scroll).toBeLessThanOrEqual(finalWidth.client + 1);
    });
  }
});
