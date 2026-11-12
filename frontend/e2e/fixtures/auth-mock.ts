import { randomUUID } from 'node:crypto';
import { test as base, expect, type Page } from '@playwright/test';

// Synthetic, per-test values. These are not credentials for any backend.
// Never read real credentials here: all auth traffic is fulfilled in memory.
export const test = base.extend<{ authMock: AuthMock }>({
  authMock: [async ({ context, baseURL }, use) => {
    const id = randomUUID();
    const auth = {
      user: { id, email: `${id}@example.invalid`, fullName: `E2E ${id.slice(0, 8)}` },
      password: `Aa1-${randomUUID()}`, token: randomUUID() as string, refreshToken: undefined as string | undefined,
      calls: [] as string[], expired: false, allowSignup: false, unverified: false,
      privateTitle: `Private account item ${id}`,
      notificationsEnabled: false, reminderEnabled: false,
      invitedEmails: [] as string[], notificationCalls: [] as Array<{ path: string; input: any }>,
      instantCreationEnabled: false, instantCreateError: false,
      instantCreateCalls: [] as any[],
      editableMeeting: null as any, recordingSettingsCalls: [] as any[], rescheduleCalls: [] as any[],
      driveAdmin: false, driveCanCreate: false, driveConnected: false, drivePending: false,
      driveState: '' as '' | 'authorization_unavailable' | 'root_unverified' | 'status_unavailable',
      recordingFolders: [] as Array<{ id: string; name: string }>, folderCreateCalls: [] as string[],
      oauthStartForms: [] as Array<{ method: string; origin: string | undefined; token: string | null }>,
    };
    const forbidden: string[] = [];
    const origin = new URL(baseURL!).origin;
    const ok = (data: unknown) => ({ result: { data } });
    const error = (message: string, code: string, httpStatus: number, path: string) => ({
      error: { message, code: httpStatus === 404 ? -32004 : httpStatus === 403 ? -32003 : -32001,
        data: { code, httpStatus, path } },
    });
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === origin && url.pathname.startsWith('/api/')) {
        const paths = decodeURIComponent(url.pathname.slice('/api/'.length)).split(',');
        const input = request.method() === 'POST' ? request.postDataJSON() : null;
        const results = paths.map((path, index) => {
          auth.calls.push(path);
          const value = url.searchParams.get('batch') === '1' ? input?.[index] : input;
          // auth.me and public room metadata can be emitted in one tRPC batch.
          // Keep the public item allowed while the meeting fixture owns the
          // standalone room requests used for state-specific tests.
          if (path === 'meetings.getByCode') return ok({ ok: true, meeting: {
            id, meetingCode: 'YLM-W8Z3SE', title: 'Private shared meeting', hostUserId: 'another-user',
            status: 'live', scheduleType: null, recurrenceCancelledAt: null,
          } });
          if (path === 'auth.login' && request.method() === 'POST') {
            if (value?.email?.trim().toLowerCase() !== auth.user.email) return error('Email ID is not registered.', 'NOT_FOUND', 404, path);
            if (value?.password !== auth.password) return error('Wrong password. Please try again.', 'UNAUTHORIZED', 401, path);
            if (auth.unverified) return error('Your registration is incomplete. Complete the email verification from sign up before logging in.', 'FORBIDDEN', 403, path);
            return ok({ ok: true, token: auth.token, refreshToken: auth.refreshToken, user: auth.user });
          }
          if (path === 'auth.refresh' && value?.refreshToken === auth.refreshToken && auth.refreshToken) {
            if (auth.expired) return error('Please sign in again.', 'UNAUTHORIZED', 401, path);
            auth.token = `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 7 * 86400 })).toString('base64url')}.mock`;
            return ok({ token: auth.token, user: auth.user });
          }
          if (path === 'auth.logout' && auth.refreshToken && value?.refreshToken === auth.refreshToken) {
            auth.refreshToken = undefined;
            return ok({ ok: true });
          }
          if (path === 'googleDriveIntegration.status' && request.method() === 'GET') {
            const connectionState = !auth.driveAdmin ? 'not_connected' : auth.driveState || (auth.drivePending ? 'pending' : auth.driveConnected ? 'connected' : 'not_connected');
            return ok({ isAdministrator: auth.driveAdmin, connected: connectionState === 'connected', pending: connectionState === 'pending', connectionState,
              accountEmail: ['connected', 'pending', 'authorization_unavailable', 'root_unverified'].includes(connectionState) ? 'company@example.invalid' : null });
          }
          if (path === 'googleDriveIntegration.start' && request.method() === 'POST') {
            if (!auth.driveAdmin) return error('Integration administrator access is required.', 'FORBIDDEN', 403, path);
            return ok({ startUrl: `${origin}/google-drive/oauth/start` });
          }
          if (path === 'googleDriveIntegration.verifyRoot' && request.method() === 'POST') {
            if (!auth.driveAdmin || value?.selectedFolderId !== 'configured-root-folder') return error('Configured root could not be verified.', 'PRECONDITION_FAILED', 412, path);
            auth.driveConnected = true; auth.drivePending = false;
            return ok({ verified: true });
          }
          if (path === 'googleDriveIntegration.pickerAccess' && request.method() === 'POST') {
            if (!auth.driveAdmin || !auth.drivePending) return error('Integration administrator access is required.', 'FORBIDDEN', 403, path);
            return ok({ accessToken: 'synthetic-picker-token', expiresIn: 300 });
          }
          if (path === 'recordingFolders.list' || path === 'recordingFolders.refresh')
            return ok({ connected: auth.driveConnected, canCreate: auth.driveConnected && (auth.driveAdmin || auth.driveCanCreate),
              folders: auth.driveConnected ? auth.recordingFolders : [] });
          if (path === 'recordingFolders.listStudents')
            return error('Batch management access is required.', 'FORBIDDEN', 403, path);
          if (path === 'batchRegistration.linkStatus') return ok({ active: false, expiresAt: null });
          if (path === 'recordingFolders.create' && request.method() === 'POST') {
            if (!auth.driveConnected || !(auth.driveAdmin || auth.driveCanCreate)) return error('Folder creation unavailable.', 'FORBIDDEN', 403, path);
            auth.folderCreateCalls.push(value.name);
            const folder = { id: `mock-folder-${auth.folderCreateCalls.length}`, name: value.name };
            auth.recordingFolders.push(folder);
            return ok(folder);
          }
          if (path === 'auth.signup' && request.method() === 'POST' && auth.allowSignup) {
            return ok({ ok: true, verificationRequired: true, email: value.email });
          }
          if (['auth.me', 'meetings.list'].includes(path) && request.method() === 'GET') {
            if (auth.expired || request.headers().authorization !== `Bearer ${auth.token}`) return error('Authentication required', 'UNAUTHORIZED', 401, path);
            if (path === 'auth.me') return ok({ ok: true, user: auth.user });
            // Read-only sentinel to detect cached private-data exposure on logout.
            // No scheduling logic or meeting actions are exercised.
            return ok({ ok: true, meetings: auth.editableMeeting ? [auth.editableMeeting] : [{ id, title: auth.privateTitle,
              meetingCode: `E2E-${id.slice(0, 6)}`, hostUserId: auth.user.id,
              status: auth.notificationsEnabled ? 'scheduled' : 'ended', scheduleType: 'one_time',
              scheduledAt: '2026-09-29T05:00:00.000Z',
              timeZone: auth.notificationsEnabled ? 'Asia/Calcutta' : null,
              createdAt: '2026-09-28T05:00:00.000Z', updatedAt: '2026-09-28T05:00:00.000Z' }] });
          }
          if (auth.notificationsEnabled && path === 'meetingNotifications.info' && request.method() === 'GET') {
            auth.notificationCalls.push({ path, input: value });
            const invitations = [
              ...(auth.reminderEnabled ? [{ id: `${id}-host`, email: auth.user.email, remindersEnabled: true }] : []),
              ...auth.invitedEmails.map((email, invitedIndex) => ({ id: `${id}-${invitedIndex}`, email, remindersEnabled: false })),
            ];
            return ok({ invitations, deliveries: [], emailConfigured: true, calendar: {
              googleUrl: 'https://calendar.google.com/calendar/render?action=TEMPLATE', ics: 'BEGIN:VCALENDAR\nEND:VCALENDAR',
              recurring: false, occurrenceStart: '2026-09-29T05:00:00.000Z', timeZone: 'Asia/Calcutta',
            } });
          }
          if (auth.notificationsEnabled && path === 'meetingNotifications.invite' && request.method() === 'POST') {
            auth.notificationCalls.push({ path, input: value });
            auth.invitedEmails.push(...value.emails);
            return ok({ ok: true, message: 'Invitation request processed. New addresses receive one invitation; previously invited addresses are not sent another.' });
          }
          if (auth.notificationsEnabled && path === 'meetingNotifications.myReminder' && request.method() === 'POST') {
            auth.notificationCalls.push({ path, input: value });
            auth.reminderEnabled = value.enabled;
            return ok({ ok: true });
          }
          if (auth.instantCreationEnabled && path === 'meetings.create' && request.method() === 'POST') {
            auth.instantCreateCalls.push(value);
            if (auth.instantCreateError) return error('Meeting code is already in use. Please try again.', 'CONFLICT', 409, path);
            return ok({ ok: true, meeting: {
              id: randomUUID(), title: value.title, meetingCode: value.meetingCode,
              hostUserId: auth.user.id, status: value.startNow ? 'live' : 'scheduled', scheduleType: value.reusable ? 'reusable' : value.recurrence ? 'recurring' : value.schedule ? 'one_time' : null,
              scheduledAt: null, timeZone: null, recurrenceRule: null,
              createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            } });
          }
          if (auth.editableMeeting && path === 'meetings.updateRecordingSettings' && request.method() === 'POST') {
            auth.recordingSettingsCalls.push(value);
            auth.editableMeeting = { ...auth.editableMeeting, recordingFolderId: value.recordingFolderId, recordingAccessPolicy: value.recordingAccessPolicy };
            return ok({ ok: true, meeting: auth.editableMeeting });
          }
          if (auth.editableMeeting && path === 'meetings.reschedule' && request.method() === 'POST') {
            auth.rescheduleCalls.push(value);
            auth.editableMeeting = { ...auth.editableMeeting, scheduledAt: '2026-09-30T05:00:00.000Z', timeZone: value.schedule.timeZone };
            return ok({ ok: true, meeting: auth.editableMeeting });
          }
          forbidden.push(path);
          return error('Blocked by isolated auth fixture', 'FORBIDDEN', 403, path);
        });
        await route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify(url.searchParams.get('batch') === '1' ? results : results[0]) });
        return;
      }
      if (url.origin === origin && url.pathname === '/google-drive/oauth/start' && request.method() === 'POST') {
        const form = new URLSearchParams(request.postData() || '');
        auth.oauthStartForms.push({ method: request.method(), origin: request.headers().origin, token: form.get('token') });
        await route.fulfill({ status: 200, contentType: 'text/plain', body: 'Mocked Google setup navigation' });
        return;
      }
      if (['xhr', 'fetch'].includes(request.resourceType()) || !['GET', 'HEAD'].includes(request.method())) {
        forbidden.push(`${request.method()} ${request.resourceType()}`);
        await route.abort('blockedbyclient');
      } else if (url.origin !== origin) await route.abort('blockedbyclient');
      else await route.continue();
    });
    await context.routeWebSocket('**/*', socket => {
      const url = new URL(socket.url());
      if (url.host === new URL(origin).host && url.pathname === '/') socket.connectToServer();
      else { forbidden.push('WebSocket'); socket.close(); }
    });
    await use(auth);
    expect(forbidden, 'No unapproved API/email/media requests may escape the auth fixture').toEqual([]);
  }, { auto: true }],
});

export type AuthMock = {
  user: { id: string; email: string; fullName: string };
  password: string; token: string; refreshToken?: string; calls: string[]; expired: boolean;
  allowSignup: boolean; privateTitle: string; unverified: boolean;
  notificationsEnabled: boolean; reminderEnabled: boolean; invitedEmails: string[];
  notificationCalls: Array<{ path: string; input: any }>;
  instantCreationEnabled: boolean; instantCreateError: boolean; instantCreateCalls: any[];
  editableMeeting: any; recordingSettingsCalls: any[]; rescheduleCalls: any[];
  driveAdmin: boolean; driveCanCreate: boolean; driveConnected: boolean; drivePending: boolean;
  driveState: '' | 'authorization_unavailable' | 'root_unverified' | 'status_unavailable';
  recordingFolders: Array<{ id: string; name: string }>; folderCreateCalls: string[];
  oauthStartForms: Array<{ method: string; origin: string | undefined; token: string | null }>;
};
export async function openLogin(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
}
export async function login(page: Page, auth: AuthMock) {
  await openLogin(page);
  await page.getByPlaceholder('name@company.com').fill(auth.user.email);
  await page.locator('input[autocomplete="current-password"]').fill(auth.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeHidden();
  await expect(page.getByRole('banner').getByRole('button', { name: auth.user.fullName })).toBeVisible();
  await expect.poll(() => auth.calls.includes('auth.me') && auth.calls.includes('meetings.list')).toBe(true);
}
export async function logout(page: Page, auth: AuthMock) {
  await page.getByRole('banner').getByRole('button', { name: auth.user.fullName }).click();
  await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
}
export async function expectNoSession(page: Page) {
  await expect.poll(() => page.evaluate(() => [localStorage.getItem('ylaam_meet_token'), localStorage.getItem('ylaam_meet_user'), localStorage.getItem('ylaam_meet_refresh_token')])).toEqual([null, null, null]);
}
export { expect };
