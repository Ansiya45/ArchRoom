import { randomUUID } from 'node:crypto';
import { test, expect, login } from './fixtures/auth-mock';

function meeting(hostUserId: string) {
  return { id: randomUUID(), title: 'Training class', meetingCode: 'YLM-ABC234', hostUserId,
    status: 'scheduled', scheduleType: 'one_time', scheduledAt: '2026-09-29T05:00:00.000Z',
    timeZone: 'Asia/Calcutta', recurrenceRule: null, recordingFolderId: null,
    recordingAccessPolicy: 'private', createdAt: '2026-09-28T05:00:00.000Z', updatedAt: '2026-09-28T05:00:00.000Z' };
}

async function openEdit(page: import('@playwright/test').Page) {
  await page.getByRole('complementary').getByRole('button', { name: 'Scheduled Meetings' }).click();
  await page.getByRole('button', { name: 'Reschedule', exact: true }).click();
  return page.getByRole('dialog', { name: 'Reschedule Meeting' });
}

test('recording preference saves independently and reloads without changing the schedule', async ({ page, authMock }) => {
  authMock.editableMeeting = meeting(authMock.user.id);
  await login(page, authMock);
  let dialog = await openEdit(page);
  await dialog.getByRole('button', { name: /Settings Recording preview/ }).click();
  await dialog.getByRole('radio', { name: /Restricted/ }).check();
  await dialog.getByRole('button', { name: 'Save Recording Settings' }).click();
  await expect(dialog.getByRole('status')).toContainText('Preference saved');
  await expect(page.getByText('Recording settings saved.', { exact: true })).toBeVisible();
  await expect(page.getByText('Meeting "Training class" rescheduled. The link is unchanged.')).toHaveCount(0);
  expect(authMock.recordingSettingsCalls).toEqual([{
    meetingId: authMock.editableMeeting.id, recordingFolderId: null, recordingAccessPolicy: 'restricted',
  }]);
  expect(authMock.rescheduleCalls).toHaveLength(0);
  expect(authMock.editableMeeting.scheduledAt).toBe('2026-09-29T05:00:00.000Z');
  await dialog.getByRole('button', { name: 'Close meeting form' }).click();
  await page.reload();
  dialog = await openEdit(page);
  await dialog.getByRole('button', { name: /Settings Recording preview/ }).click();
  await expect(dialog.getByRole('radio', { name: /Restricted/ })).toBeChecked();
});

test('rescheduling sends only the existing schedule payload', async ({ page, authMock }) => {
  authMock.editableMeeting = meeting(authMock.user.id);
  await login(page, authMock);
  const dialog = await openEdit(page);
  await dialog.locator('input[type=date]').fill('2026-09-30');
  await dialog.getByRole('button', { name: 'Save Schedule' }).click();
  await expect.poll(() => authMock.rescheduleCalls.length).toBe(1);
  expect(authMock.rescheduleCalls[0]).toEqual({ meetingId: authMock.editableMeeting.id,
    schedule: { localDateTime: '2026-09-30T10:30', timeZone: 'Asia/Calcutta' } });
  expect(authMock.recordingSettingsCalls).toHaveLength(0);
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Meeting "Training class" rescheduled. The link is unchanged.')).toBeVisible();
  await expect(page.getByText('Recording settings saved.', { exact: true })).toHaveCount(0);
});

test('disconnected Drive offers only the central root and keeps batch creation unavailable', async ({ page, authMock }) => {
  authMock.editableMeeting = meeting(authMock.user.id);
  await login(page, authMock);
  const dialog = await openEdit(page);
  await dialog.getByRole('button', { name: /Settings Recording preview/ }).click();
  await expect(dialog.getByText(/Google Drive is not connected or the recording root is not verified/)).toBeVisible();
  await expect(dialog.getByLabel('Select batch/course folder')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Create New Batch Folder' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Save Recording Settings' }).click();
  await expect.poll(() => authMock.recordingSettingsCalls.length).toBe(1);
  expect(authMock.recordingSettingsCalls[0].recordingFolderId).toBeNull();
});

test('verified batch folder can be selected and persisted; administrator can create one', async ({ page, authMock }) => {
  authMock.editableMeeting = meeting(authMock.user.id);
  authMock.driveConnected = true;
  authMock.driveAdmin = true;
  authMock.recordingFolders = [{ id: 'mock-folder-existing', name: 'SAP MM' }];
  await login(page, authMock);
  const dialog = await openEdit(page);
  await dialog.getByRole('button', { name: /Settings Recording preview/ }).click();
  await expect(dialog.getByRole('option', { name: 'SAP MM' })).toHaveCount(1);
  await dialog.getByLabel('Select batch/course folder').selectOption('mock-folder-existing');
  await dialog.getByRole('button', { name: 'Save Recording Settings' }).click();
  await expect.poll(() => authMock.recordingSettingsCalls.length).toBe(1);
  expect(authMock.recordingSettingsCalls[0].recordingFolderId).toBe('mock-folder-existing');
  await dialog.getByLabel('New batch folder name').fill('SAP FICO');
  await dialog.getByRole('button', { name: 'Create New Batch Folder' }).click();
  await expect(dialog.getByRole('option', { name: 'SAP FICO' })).toHaveCount(1);
  expect(authMock.folderCreateCalls).toEqual(['SAP FICO']);
});

test('Google connection controls appear only for the integration administrator', async ({ page, authMock }) => {
  await login(page, authMock);
  await page.getByRole('complementary').getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('region', { name: 'Google Drive integration' })).toHaveCount(0);
  expect(authMock.calls).not.toContain('googleDriveIntegration.start');
  authMock.driveAdmin = true;
  authMock.drivePending = true;
  await page.getByRole('complementary').getByRole('button', { name: 'Scheduled Meetings' }).click();
  await page.getByRole('complementary').getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('region', { name: 'Google Drive integration' })).toContainText('Select the configured recording root');
  await expect(page.getByRole('button', { name: 'Select recording root' })).toBeVisible();
});

test('explicit batch creator can create a folder without Google integration controls', async ({ page, authMock }) => {
  authMock.editableMeeting = meeting(authMock.user.id);
  authMock.driveConnected = true;
  authMock.driveCanCreate = true;
  await login(page, authMock);
  const dialog = await openEdit(page);
  await dialog.getByRole('button', { name: /Settings Recording preview/ }).click();
  await dialog.getByLabel('New batch folder name').fill('Python Batch');
  await dialog.getByRole('button', { name: 'Create New Batch Folder' }).click();
  await expect(dialog.getByRole('option', { name: 'Python Batch' })).toHaveCount(1);
  expect(authMock.folderCreateCalls).toEqual(['Python Batch']);
  await dialog.getByRole('button', { name: 'Close meeting form' }).click();
  await page.getByRole('complementary').getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('region', { name: 'Google Drive integration' })).toHaveCount(0);
  expect(authMock.calls).not.toContain('googleDriveIntegration.start');
});

test('connected ordinary user cannot create a protected batch folder', async ({ page, authMock }) => {
  authMock.editableMeeting = meeting(authMock.user.id);
  authMock.driveConnected = true;
  await login(page, authMock);
  const dialog = await openEdit(page);
  await dialog.getByRole('button', { name: /Settings Recording preview/ }).click();
  await expect(dialog.getByRole('button', { name: 'Create New Batch Folder' })).toHaveCount(0);
  await expect(dialog.getByLabel('Select batch/course folder')).toHaveValue('');
});

test('integration administrator starts OAuth through a top-level authenticated backend form', async ({ page, authMock }) => {
  authMock.driveAdmin = true;
  await login(page, authMock);
  await page.getByRole('complementary').getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Authorize Google account' }).click();
  await expect(page.getByText('Mocked Google setup navigation')).toBeVisible();
  expect(authMock.oauthStartForms).toEqual([{ method: 'POST', origin: new URL(page.url()).origin, token: authMock.token }]);
});
