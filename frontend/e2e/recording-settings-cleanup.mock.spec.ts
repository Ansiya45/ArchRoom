import { test, expect, login } from './fixtures/auth-mock';

async function openSettings(page: import('@playwright/test').Page) {
  await page.getByRole('complementary').getByRole('button', { name: 'Create Meeting', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create or Schedule Meeting' });
  await dialog.getByRole('button', { name: /Settings Recording preview/ }).click();
  await expect(dialog.getByLabel('Recording destination', { exact: true })).toBeEnabled();
  return dialog;
}

test.beforeEach(async ({ authMock, page }) => {
  authMock.driveConnected = true;
  authMock.driveCanCreate = true;
  authMock.instantCreationEnabled = true;
  authMock.recordingFolders = [{ id: 'mock-root-folder', name: 'Recording Sessions' }, { id: 'mock-sap-folder', name: 'SAP MM' }];
  await page.addInitScript(() => {
    const push = history.pushState.bind(history);
    history.pushState = (data, unused, url) => { if (!String(url).startsWith('/meet/')) push(data, unused, url); };
  });
  await login(page, authMock);
});

for (const scheduled of [false, true]) {
  test(`new folder is selected and saved for ${scheduled ? 'recurring scheduled' : 'instant'} meeting`, async ({ page, authMock }) => {
    const dialog = await openSettings(page);
    if (scheduled) {
      await dialog.getByRole('button', { name: 'Schedule Meeting', exact: true }).first().click();
      await dialog.locator('input[type=date]').fill('2099-01-05');
      await dialog.getByRole('combobox', { name: 'Repeat', exact: true }).selectOption('repeat');
    }
    const destination = dialog.getByLabel('Recording destination', { exact: true });
    await expect(destination.locator('option')).toHaveText(['Choose after recording', 'Recording Sessions', 'SAP MM']);
    await expect(dialog.getByRole('button', { name: 'Refresh Folders' })).toHaveCount(0);
    await expect(dialog.getByLabel('New folder name')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Create New Folder', exact: true }).click();
    await dialog.getByLabel('New folder name').fill('Cancelled');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog.getByLabel('New folder name')).toHaveCount(0);
    expect(authMock.folderCreateCalls).toEqual([]);
    await dialog.getByRole('button', { name: 'Create New Folder', exact: true }).click();
    await dialog.getByLabel('New folder name').fill('SAP FICO');
    await dialog.getByRole('button', { name: 'Create', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect(destination).toHaveValue('mock-folder-1');
    await expect(destination.locator('option:checked')).toHaveText('SAP FICO');
    await expect(destination).toBeEnabled();
    await expect(dialog.getByLabel('New folder name')).toHaveCount(0);
    expect(authMock.folderCreateCalls).toEqual(['SAP FICO']);
    await destination.selectOption('mock-sap-folder');
    await expect(destination).toHaveValue('mock-sap-folder');
    await destination.selectOption('mock-root-folder');
    await expect(destination).toHaveValue('mock-root-folder');
    await destination.selectOption('mock-folder-1');
    await dialog.locator('button[type=submit]').click();
    await expect.poll(() => authMock.instantCreateCalls.length).toBe(1);
    expect(authMock.instantCreateCalls[0]).toMatchObject({ recordingFolderId: 'mock-folder-1', reusable: !scheduled });
    if (scheduled) expect(authMock.instantCreateCalls[0].recurrence).toBeTruthy();
    expect(authMock.calls.some(path => /upload|recordings\./i.test(path))).toBe(false);
  });
}

test('failed creation preserves selection; focus refreshes authorized options', async ({ page, authMock }) => {
  const dialog = await openSettings(page);
  const destination = dialog.getByLabel('Recording destination', { exact: true });
  await destination.selectOption('mock-sap-folder');
  await dialog.getByRole('button', { name: 'Create New Folder', exact: true }).click();
  await dialog.getByLabel('New folder name').fill('Denied');
  authMock.driveCanCreate = false;
  await dialog.getByLabel('New folder name').press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('Folder creation unavailable');
  await expect(destination).toHaveValue('mock-sap-folder');
  expect(authMock.instantCreateCalls).toEqual([]);
  expect(authMock.folderCreateCalls).toEqual([]);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  authMock.recordingFolders.push({ id: 'mock-added-folder', name: 'Added elsewhere' });
  await destination.focus();
  await expect(destination.locator('option')).toContainText(['Choose after recording', 'Recording Sessions', 'SAP MM', 'Added elsewhere']);
});

for (const width of [390, 1280]) {
  test(`description and dropdown fit at ${width}px`, async ({ page }) => {
    const dialog = await openSettings(page);
    await page.setViewportSize({ width, height: 900 });
    const description = dialog.getByText('Optionally choose an authorized company folder. Finalized recordings will upload there automatically; otherwise you can choose a folder after recording.', { exact: true });
    const style = await description.evaluate(el => {
      const s = getComputedStyle(el); return { border: s.borderTopWidth, background: s.backgroundColor, padding: s.padding };
    });
    expect(style).toEqual({ border: '0px', background: 'rgba(0, 0, 0, 0)', padding: '0px' });
    const destination = dialog.getByLabel('Recording destination', { exact: true });
    const field = (await destination.boundingBox())!;
    const arrow = (await destination.locator('..').locator('svg').boundingBox())!;
    expect(arrow.x).toBeGreaterThan(field.x);
    expect(arrow.x + arrow.width).toBeLessThan(field.x + field.width - 8);
    expect(Math.abs(arrow.y + arrow.height / 2 - field.y - field.height / 2)).toBeLessThan(1);
    expect(field.x + field.width).toBeLessThanOrEqual(width);
  });
}

test('existing meeting saves a changed destination through the existing settings API', async ({ page, authMock }) => {
  authMock.editableMeeting = { id: authMock.user.id, title: 'Training class', meetingCode: 'YLM-ABC234', hostUserId: authMock.user.id,
    status: 'scheduled', scheduleType: 'one_time', scheduledAt: '2099-01-05T05:00:00.000Z', timeZone: 'Asia/Calcutta',
    recurrenceRule: null, recordingFolderId: 'mock-root-folder', recordingAccessPolicy: 'private',
    createdAt: '2026-09-28T05:00:00.000Z', updatedAt: '2026-09-28T05:00:00.000Z' };
  await page.reload();
  await page.getByRole('complementary').getByRole('button', { name: 'Scheduled Meetings' }).click();
  await page.getByRole('button', { name: 'Reschedule', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Reschedule Meeting' });
  await dialog.getByRole('button', { name: /Settings Recording preview/ }).click();
  const destination = dialog.getByLabel('Recording destination', { exact: true });
  await expect(destination).toHaveValue('mock-root-folder');
  await destination.selectOption('mock-sap-folder');
  await dialog.getByRole('button', { name: 'Save Schedule', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(authMock.recordingSettingsCalls).toEqual([{ meetingId: authMock.editableMeeting.id, recordingFolderId: 'mock-sap-folder', recordingAccessPolicy: 'private' }]);
});

test('successful creation stays selected even if the following refresh fails', async ({ page, authMock }) => {
  const dialog = await openSettings(page);
  await page.route('**/api/recordingFolders.refresh*', route => route.abort());
  await dialog.getByRole('button', { name: 'Create New Folder', exact: true }).click();
  await dialog.getByLabel('New folder name').fill('Created successfully');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Folder created, but recording folders could not be refreshed.');
  const destination = dialog.getByLabel('Recording destination', { exact: true });
  await expect(destination).toHaveValue('mock-folder-1');
  await expect(destination.locator('option:checked')).toHaveText('Created successfully');
  expect(authMock.folderCreateCalls).toEqual(['Created successfully']);
});
