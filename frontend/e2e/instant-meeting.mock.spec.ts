import { test, expect, login } from './fixtures/auth-mock';

async function keepMeetingRoomOutOfScope(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const pushState = history.pushState.bind(history);
    history.pushState = (data: unknown, unused: string, url?: string | URL | null) => {
      const destination = String(url ?? '');
      if (destination.startsWith('/meet/')) {
        sessionStorage.setItem('e2e_instant_navigation', destination);
        return;
      }
      pushState(data, unused, url);
    };
  });
}

async function openInstantMeeting(page: import('@playwright/test').Page) {
  await page.getByRole('complementary').getByRole('button', { name: 'Create Meeting', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create or Schedule Meeting' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Start Now/ })).toHaveAttribute('aria-pressed', 'true');
  return dialog;
}

test.describe('instant meeting creation — isolated API', () => {
  test.beforeEach(async ({ authMock }) => {
    authMock.instantCreationEnabled = true;
  });

  test('authenticated host creates one live instant meeting and hands off a local session', async ({ page, authMock }) => {
    await keepMeetingRoomOutOfScope(page);
    await login(page, authMock);
    const dialog = await openInstantMeeting(page);
    const link = await dialog.getByLabel('Meeting Link').inputValue();
    const meetingCode = link.split('/').pop()!;
    expect(meetingCode).toMatch(/^YLM-[A-Z2-9]{6}$/);

    await dialog.getByLabel('Meeting Topic / Title').fill('E2E instant product sync');
    await dialog.getByRole('button', { name: 'Start Meeting' }).click();
    await expect(dialog).toBeHidden();

    expect(authMock.instantCreateCalls).toHaveLength(1);
    expect(authMock.instantCreateCalls[0]).toEqual({
      title: 'E2E instant product sync', meetingCode, startNow: true, reusable: false,
    });
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('e2e_instant_navigation')))
      .toBe(`/meet/${meetingCode}`);
    const meetingSession = await page.evaluate(code => localStorage.getItem(`ylaam_meet_participant_${code}`), meetingCode);
    expect(JSON.parse(meetingSession!)).toEqual({ displayName: authMock.user.fullName });
    expect(authMock.calls.filter(path => path === 'meetings.create')).toHaveLength(1);
  });

  test('blank title uses the product fallback and rapid submits create only once', async ({ page, authMock }) => {
    await keepMeetingRoomOutOfScope(page);
    await login(page, authMock);
    const dialog = await openInstantMeeting(page);
    await dialog.locator('form').evaluate(form => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await expect(dialog).toBeHidden();
    expect(authMock.instantCreateCalls).toHaveLength(1);
    expect(authMock.instantCreateCalls[0].title).toBe('Quick YLAAM-MEET Meeting');
  });

  test('code conflict stays in the form, regenerates the link, and retries safely', async ({ page, authMock }) => {
    await keepMeetingRoomOutOfScope(page);
    authMock.instantCreateError = true;
    await login(page, authMock);
    const dialog = await openInstantMeeting(page);
    const firstLink = await dialog.getByLabel('Meeting Link').inputValue();
    await dialog.getByLabel('Meeting Topic / Title').fill('Retryable instant meeting');
    await dialog.getByRole('button', { name: 'Start Meeting' }).click();

    await expect(dialog.getByRole('alert')).toContainText('Meeting code is already in use');
    const secondLink = await dialog.getByLabel('Meeting Link').inputValue();
    expect(secondLink).not.toBe(firstLink);
    expect(await page.evaluate(() => sessionStorage.getItem('e2e_instant_navigation'))).toBeNull();

    authMock.instantCreateError = false;
    await dialog.getByRole('button', { name: 'Start Meeting' }).click();
    await expect(dialog).toBeHidden();
    expect(authMock.instantCreateCalls).toHaveLength(2);
    expect(authMock.instantCreateCalls[1].meetingCode).not.toBe(authMock.instantCreateCalls[0].meetingCode);
  });

  test('closing resets draft mode and keyboard submission remains accessible', async ({ page, authMock }) => {
    await keepMeetingRoomOutOfScope(page);
    await login(page, authMock);
    let dialog = await openInstantMeeting(page);
    await dialog.getByRole('button', { name: /Schedule Later/ }).click();
    await expect(dialog.getByRole('button', { name: /Schedule Later/ })).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByLabel('Meeting Topic / Title').fill('Discarded draft');
    await dialog.getByRole('button', { name: 'Close meeting form' }).click();

    dialog = await openInstantMeeting(page);
    await expect(dialog.getByLabel('Meeting Topic / Title')).toHaveValue('');
    await dialog.getByLabel('Meeting Topic / Title').fill('Keyboard instant meeting');
    await dialog.getByLabel('Meeting Topic / Title').press('Enter');
    await expect(dialog).toBeHidden();
    expect(authMock.instantCreateCalls).toHaveLength(1);
  });

  test('mobile dialog fits the viewport and preserves the instant controls', async ({ page, authMock }) => {
    await login(page, authMock);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('navigation', { name: 'Mobile dashboard navigation' })
      .getByRole('button', { name: 'Create Meeting' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create or Schedule Meeting' });
    await expect(dialog.getByRole('button', { name: 'Start Meeting' })).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await expect(dialog.getByLabel('Meeting Link')).toBeEditable({ editable: false });
  });
});
