import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test as base, expect, login, logout, type AuthMock } from './fixtures/auth-mock';
const code = 'YLM-W8Z3SE', path = `/meet/${code}`;
type Room = { admission: 'pending' | 'admitted' | 'denied'; status: string; cancelled: boolean; missing: boolean; host: boolean; recordingFolderId: string | null; historyItems: any[]; rosterRole: 'host' | 'participant'; pollFails: boolean; stallPending: boolean; requests: Array<{ id: string; name: string }>; calls: Array<{ path: string; input: any }>; aiStatus: any; aiRequestError: string };
const test = base.extend<{ room: Room }>({
  room: [async ({ context, authMock }, use) => {
    const room: Room = { admission: 'pending', status: 'live', cancelled: false, missing: false, host: false, recordingFolderId: null, historyItems: [], rosterRole: 'participant', pollFails: false, stallPending: false, requests: [], calls: [], aiStatus: { state: 'off' }, aiRequestError: '' };
    const id = randomUUID();
    await context.routeWebSocket('**/api/whiteboard', socket => { socket.onMessage(() => {}); });
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      const paths = decodeURIComponent(url.pathname.slice('/api/'.length)).split(',');
      if (!paths.some(p => p.startsWith('meetings.') && p !== 'meetings.list')) { await route.fallback(); return; }
      if (paths.includes('meetings.pendingAdmissions') && room.stallPending) {
        // Hold every polling attempt until the test observes the timeout warning.
        // Role discovery can cancel/restart the initial effect, so stalling only
        // its first request does not reliably exercise the timeout path.
        while (room.stallPending) await new Promise(resolve => setTimeout(resolve, 50));
      }
      const batched = url.searchParams.get('batch') === '1';
      const input = route.request().method() === 'POST' ? route.request().postDataJSON() : JSON.parse(url.searchParams.get('input') || '{}');
      const results = paths.map((procedure, index) => {
        const value = batched ? input[index] : input;
        const ok = (data: unknown) => ({ result: { data } });
        const error = (message: string, errorCode = 'NOT_FOUND') => ({ error: { message, code: -32004, data: { code: errorCode, httpStatus: 404, path: procedure } } });
        if (procedure === 'auth.me') {
          authMock.calls.push(procedure);
          if (authMock.expired || route.request().headers().authorization !== `Bearer ${authMock.token}`)
            return { error: { message: 'Authentication required', code: -32001, data: { code: 'UNAUTHORIZED', httpStatus: 401, path: procedure } } };
          return ok({ ok: true, user: authMock.user });
        }
        if (procedure === 'meetings.historyDetail') return ok({ items: room.historyItems, meeting: { id: value.meetingId }, sessions: [], recordings: [] });
        if (procedure === 'recordings.getForMeeting') return ok({ recordings: [] });
        if (procedure === 'meetings.list') {
          authMock.calls.push(procedure);
          if (authMock.expired || route.request().headers().authorization !== `Bearer ${authMock.token}`)
            return { error: { message: 'Authentication required', code: -32001, data: { code: 'UNAUTHORIZED', httpStatus: 401, path: procedure } } };
          return ok({ ok: true, meetings: authMock.editableMeeting ? [authMock.editableMeeting] : [{ id: authMock.user.id, title: authMock.privateTitle, meetingCode: `E2E-${authMock.user.id.slice(0, 6)}`, hostUserId: authMock.user.id, status: 'ended', scheduleType: 'one_time', scheduledAt: '2026-09-29T05:00:00.000Z', timeZone: null, createdAt: '2026-09-28T05:00:00.000Z', updatedAt: '2026-09-28T05:00:00.000Z' }] });
        }
        room.calls.push({ path: procedure, input: value });
        expect(value.meetingCode).toMatch(/^YLM-/);
        const meeting = { id, meetingCode: value.meetingCode, title: 'Private shared meeting', hostUserId: room.host ? authMock.user.id : 'another-user', status: room.status, scheduleType: room.cancelled ? 'recurring' : null, recurrenceCancelledAt: room.cancelled ? new Date().toISOString() : null, recordingFolderId: room.recordingFolderId, recordingAccessPolicy: 'private' };
        if (procedure === 'meetings.getByCode') return room.missing ? error('Meeting not found') : ok({ ok: true, meeting });
        if (procedure === 'meetings.join' || procedure === 'meetings.rejoin') return ok({ ok: true, meeting, participant: { id, admission: room.host ? 'admitted' : room.admission } });
        if (procedure === 'meetings.admissionStatus') return ok({ admission: room.admission, meeting, leftAt: null, sessionEnded: false });
        if (procedure === 'meetings.participants') return ok({ participants: room.host ? [{ id, name: authMock.user.fullName, role: room.rosterRole, isSelf: true }] : [] });
        if (procedure === 'meetings.pendingAdmissions') return room.pollFails ? error('Temporarily unavailable', 'INTERNAL_SERVER_ERROR') : ok({ requests: room.requests });
        if (procedure === 'meetings.decideAdmission') { room.requests = room.requests.filter(request => request.id !== value.participantId); return ok({ ok: true }); }
        if (procedure === 'meetings.admitAll') { const participantIds = room.requests.map(request => request.id); room.requests = []; return ok({ ok: true, admittedCount: participantIds.length, participantIds }); }
        if (procedure === 'meetings.end' || procedure === 'meetings.leave') return ok({ ok: true });
        if (procedure === 'meetings.aiStatus') return ok(room.aiStatus);
        if (procedure === 'meetings.requestAiTranscription') {
          if (room.aiRequestError) return error(room.aiRequestError, 'PRECONDITION_FAILED');
          room.aiStatus = { state: 'pending', requestId: 'fe3aa2ba-a378-4a7d-985b-a37725bd2dd7', requestedByUserId: authMock.user.id, capturing: false, pending: 1, declined: 0, needsResponse: false, ownDecision: true, agreedParticipantIds: [id], participantIds: [id] };
          return ok({ requestId: room.aiStatus.requestId });
        }
        if (procedure === 'meetings.respondAiTranscription') {
          room.aiStatus = value.agree
            ? { ...room.aiStatus, state: 'active', capturing: false, pending: 0, needsResponse: false, ownDecision: true }
            : { state: 'off', reason: 'declined' };
          return ok({ ok: true });
        }
        if (procedure === 'meetings.aiCaptureHeartbeat') return ok({ ok: true });
        // Verify the admission transition without connecting to real media.
        if (procedure === 'meetings.livekitToken') return error('Media disabled in isolated test', 'PRECONDITION_FAILED');
        throw new Error(`Unexpected meeting API: ${procedure}`);
      });
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(batched ? results : results[0]) });
    });
    try { await use(room); } finally { room.stallPending = false; }
  }, { auto: true }],
});
async function openJoin(page: Page) {
  await page.goto(path);
  await page.getByPlaceholder('Enter your name').fill('Guest Person');
  await page.getByRole('button', { name: 'Join Meeting Now', exact: true }).click();
}
async function seedAccount(page: Page, auth: AuthMock) {
  await page.goto('/');
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('ylaam_meet_token', token);
    localStorage.setItem('ylaam_meet_user', JSON.stringify(user));
  }, auth);
}
const waiting = (page: Page) => page.getByRole('heading', { name: 'Waiting for the host' });

test('A/B: direct anonymous link lets a named guest request admission without authentication', async ({ page, authMock, room }) => {
  expect((await page.goto(path))?.status()).toBe(200);
  await expect(page.getByText(`Meeting ID: ${code}`)).toBeVisible();
  await expect(page.getByText('Private shared meeting')).toBeVisible();
  await expect(page.getByText('Joining as guest')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign up' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Log in' })).toBeHidden();
  await openJoin(page);
  await expect(waiting(page)).toBeVisible();
  expect(room.calls.find(c => c.path === 'meetings.join')?.input).toMatchObject({ meetingCode: code, guestName: 'Guest Person' });
  expect(authMock.calls).toEqual([]);
  await expect(page).toHaveURL(new RegExp(`${path}$`));
});
test('C/M: host admission unlocks media for an anonymous guest', async ({ page, room }) => {
  await openJoin(page); await expect(waiting(page)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  expect(room.calls.filter(c => c.path === 'meetings.join')).toHaveLength(1);
  expect(room.calls.find(c => c.path === 'meetings.join')?.input.meetingCode).toBe(code);
  expect(room.calls.some(c => c.path === 'meetings.livekitToken')).toBe(false);
  await expect(page.getByRole('button', { name: 'Show meeting toolbar', exact: true })).toBeHidden();
  room.admission = 'admitted';
  await expect(page.getByRole('button', { name: 'Show meeting toolbar', exact: true })).toBeVisible();
  await expect.poll(() => room.calls.some(c => c.path === 'meetings.livekitToken')).toBe(true);
  expect(room.calls.some(c => c.path === 'meetings.decideAdmission')).toBe(false);
});
test('G: signed-in user joins without login or automatic admission', async ({ page, authMock, room }) => {
  await seedAccount(page, authMock); await page.goto(path);
  await expect(page.getByText(`Signed in as ${authMock.user.email}`, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeHidden();
  expect(room.calls.some(c => c.path === 'meetings.join')).toBe(false);
  await page.getByRole('button', { name: 'Join Meeting Now' }).click(); await expect(waiting(page)).toBeVisible();
});
test('H/I: reload and fresh tab preserve link; guest pending admission survives reload', async ({ page, context, room }) => {
  await page.goto(path); await page.reload();
  await expect(page.getByPlaceholder('Enter your name')).toBeVisible();
  const tab = await context.newPage(); await tab.goto(path);
  await expect(tab.getByPlaceholder('Enter your name')).toBeVisible(); await tab.close();
  await openJoin(page);
  await expect(waiting(page)).toBeVisible(); await page.reload(); await expect(waiting(page)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  expect(room.calls.filter(c => c.path === 'meetings.join')).toHaveLength(1);
});
for (const invalid of ['/meet/INVALID', '/meet/', '/meet/nonexistent-valid-format-code', '/meet/%3Cscript%3E']) {
  test(`J: malformed link ${invalid} is distinct from missing route`, async ({ page, room }) => {
    await page.goto(invalid); await expect(page.getByRole('heading', { name: 'Invalid meeting link' })).toBeVisible(); expect(room.calls).toEqual([]);
  });
}
test('J: unknown route has an explicit page-not-found view', async ({ page }) => {
  await page.goto('/not-a-route'); await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
test('K: valid-format nonexistent meeting is reported without authentication', async ({ page, room }) => {
  room.missing = true; await page.goto('/meet/YLM-ZZZZZZ');
  await expect(page.getByRole('alert')).toContainText('Meeting not found.');
  await expect(page.getByRole('button', { name: 'Join Meeting Now' })).toBeDisabled();
  expect(room.calls.some(c => c.path === 'meetings.join')).toBe(false);
});
for (const state of ['ended', 'cancelled']) {
  test(`existing ${state} meeting cannot be joined`, async ({ page, room }) => {
    room.status = state === 'ended' ? 'ended' : 'scheduled'; room.cancelled = state === 'cancelled';
    await page.goto(path);
    await expect(page.getByRole('alert')).toContainText(state);
    await expect(page.getByRole('button', { name: 'Join Meeting Now' })).toBeDisabled();
    expect(room.calls.some(c => c.path === 'meetings.join')).toBe(false);
  });
}
test('L: logout still permits joining the shared link as a guest', async ({ page, authMock }) => {
  await login(page, authMock); await logout(page, authMock); await openJoin(page);
  await expect(waiting(page)).toBeVisible();
});
test('M: host denial never unlocks guest media', async ({ page, room }) => {
  await openJoin(page); await expect(waiting(page)).toBeVisible(); room.admission = 'denied';
  await expect(page.getByRole('heading', { name: 'Request not accepted' })).toBeVisible();
  expect(room.calls.some(c => c.path === 'meetings.livekitToken')).toBe(false);
});
test('creator can see and admit requests even if the roster temporarily reports a participant role', async ({ page, authMock, room }) => {
  room.host = true;
  room.admission = 'admitted';
  await seedAccount(page, authMock);
  await page.goto(path);
  await page.getByRole('button', { name: 'Join Meeting Now' }).click();
  await expect.poll(() => room.calls.some(call => call.path === 'meetings.participants')).toBe(true);
  room.requests = [{ id: randomUUID(), name: 'Waiting guest' }];
  const dialog = page.getByRole('dialog', { name: 'Meeting join requests' });
  await expect(dialog).toContainText('Waiting guest');
  await dialog.getByRole('button', { name: 'Admit', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(room.calls.find(call => call.path === 'meetings.decideAdmission')?.input.admit).toBe(true);
});
test('host can admit all currently pending guests with one idempotent backend call', async ({ page, authMock, room }) => {
  room.host = true;
  room.admission = 'admitted';
  room.rosterRole = 'host';
  room.requests = [{ id: randomUUID(), name: 'Guest One' }, { id: randomUUID(), name: 'Guest Two' }];
  await seedAccount(page, authMock);
  await page.goto(path);
  await page.getByRole('button', { name: 'Join Meeting Now' }).click();
  const dialog = page.getByRole('dialog', { name: 'Meeting join requests' });
  await expect(dialog).toContainText('Guest One');
  await dialog.getByRole('button', { name: 'Admit All (2)' }).click();
  await expect(dialog).toBeHidden();
  expect(room.calls.filter(call => call.path === 'meetings.admitAll')).toHaveLength(1);
  expect(room.calls.some(call => call.path === 'meetings.decideAdmission')).toBe(false);
});
test('host sees a warning when checking requests fails and it clears on recovery', async ({ page, authMock, room }) => {
  room.host = true;
  room.admission = 'admitted';
  room.pollFails = true;
  await seedAccount(page, authMock);
  await page.goto(path);
  await page.getByRole('button', { name: 'Join Meeting Now' }).click();
  const warning = page.getByRole('alert').filter({ hasText: 'Unable to check join requests' });
  await expect(warning).toBeVisible();
  room.pollFails = false;
  await expect(warning).toBeHidden();
});
test('a stalled request check recovers and shows a waiting guest without a refresh', async ({ page, authMock, room }) => {
  room.host = true;
  room.admission = 'admitted';
  room.rosterRole = 'host';
  // Let initial role discovery and a successful poll finish before stalling.
  room.requests = [];
  await seedAccount(page, authMock);
  await page.goto(path);
  await page.getByRole('button', { name: 'Join Meeting Now' }).click();
  await expect(page.getByRole('button', { name: 'End meeting', exact: true })).toBeVisible();
  await expect.poll(() => room.calls.filter(call => call.path === 'meetings.pendingAdmissions').length).toBeGreaterThanOrEqual(2);
  room.stallPending = true;
  room.requests = [{ id: randomUUID(), name: 'Waiting guest' }];
  const warning = page.getByRole('alert').filter({ hasText: 'Unable to check join requests' });
  try {
    await expect(warning).toBeVisible({ timeout: 15_000 });
  } finally { room.stallPending = false; }
  await expect(page.getByRole('dialog', { name: 'Meeting join requests' })).toContainText('Waiting guest');
  await expect(warning).toBeHidden();
});
test('expired account session falls back to guest joining on the shared URL', async ({ page, authMock }) => {
  await seedAccount(page, authMock); authMock.expired = true; await page.goto(path);
  await expect(page.getByRole('button', { name: 'Join Meeting Now', exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${path}$`)); authMock.expired = false;
  await page.getByPlaceholder('Enter your name').fill('Guest Person');
  await page.getByRole('button', { name: 'Join Meeting Now', exact: true }).click(); await expect(waiting(page)).toBeVisible();
});
test('legacy query invitation and grouped code reach shared-link landing', async ({ page }) => {
  await page.goto('/?join=YLM-1234-ABC'); await expect(page).toHaveURL(/\/meet\/YLM-1234-ABC$/);
  await expect(page.getByPlaceholder('Enter your name')).toBeVisible();
});

test('AI transcription stays off by default', async ({ page, authMock, room }) => {
  room.host = true; room.admission = 'admitted'; room.rosterRole = 'host';
  await seedAccount(page, authMock); await page.goto(path);
  await expect(page.getByLabel('Enable AI transcription for this meeting')).not.toBeChecked();
  await page.getByRole('button', { name: 'Join Meeting Now' }).click();
  await expect.poll(() => room.calls.filter(call => call.path === 'meetings.aiStatus').length).toBeGreaterThanOrEqual(2);
  await expect(page.getByText(/AI transcription active|AI transcription preparing|Waiting for participant consent/)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Stop transcription' })).toBeHidden();
  expect(room.calls.some(call => ['meetings.requestAiTranscription', 'meetings.aiCaptureHeartbeat', 'meetings.transcribeSpeech'].includes(call.path))).toBe(false);
});

test('missing OpenAI configuration is displayed after the host opts in', async ({ page, authMock, room }) => {
  room.host = true; room.admission = 'admitted'; room.rosterRole = 'host'; room.aiRequestError = 'AI transcription is not configured.';
  await seedAccount(page, authMock); await page.goto(path);
  await page.getByLabel('Enable AI transcription for this meeting').check();
  await page.getByRole('button', { name: 'Join Meeting Now' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'AI transcription is not configured.' })).toBeVisible();
});

test('an admitted participant can agree without showing active before capture starts', async ({ page, room }) => {
  room.admission = 'admitted';
  room.aiStatus = { state: 'pending', requestId: 'fe3aa2ba-a378-4a7d-985b-a37725bd2dd7', requestedByUserId: randomUUID(), capturing: false, pending: 1, declined: 0, needsResponse: true, ownDecision: null, agreedParticipantIds: [], participantIds: [] };
  await openJoin(page);
  await expect(page.getByText(/Waiting for participant consent/)).toBeVisible();
  await page.getByRole('button', { name: 'Agree', exact: true }).click();
  await expect(page.getByText('AI transcription is enabled and preparing capture.')).toBeVisible();
  await expect(page.getByText(/AI transcription active/)).toBeHidden();
  expect(room.calls.find(call => call.path === 'meetings.respondAiTranscription')?.input.agree).toBe(true);
});

test('an admitted participant can decline and transcription remains off', async ({ page, room }) => {
  room.admission = 'admitted';
  room.aiStatus = { state: 'pending', requestId: 'fe3aa2ba-a378-4a7d-985b-a37725bd2dd7', requestedByUserId: randomUUID(), capturing: false, pending: 1, declined: 0, needsResponse: true, ownDecision: null, agreedParticipantIds: [], participantIds: [] };
  await openJoin(page);
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  await expect.poll(() => room.calls.find(call => call.path === 'meetings.respondAiTranscription')?.input.agree).toBe(false);
  await expect(page.getByRole('button', { name: 'Decline', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Agree', exact: true })).toBeHidden();
  await expect(page.getByText(/Waiting for participant consent|AI transcription active|AI transcription preparing|AI transcription is enabled and preparing capture/)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Stop transcription' })).toBeHidden();
  expect(room.calls.some(call => ['meetings.aiCaptureHeartbeat', 'meetings.transcribeSpeech'].includes(call.path))).toBe(false);
});

test('a fresh backend heartbeat is not labelled active until browser capture is running', async ({ page, room }) => {
  room.admission = 'admitted';
  room.aiStatus = { state: 'active', requestId: 'fe3aa2ba-a378-4a7d-985b-a37725bd2dd7', requestedByUserId: randomUUID(), capturing: true, pending: 0, declined: 0, needsResponse: false, ownDecision: true, agreedParticipantIds: [], participantIds: [] };
  await openJoin(page);
  await expect(page.getByText('AI transcription is enabled and preparing capture.')).toBeVisible();
  await expect(page.getByText(/AI transcription active/)).toBeHidden();
});

// Local synthetic capture exercises the real meeting exit paths without LiveKit or Drive.
for (const exit of ['end', 'leave-paused', 'remote-end', 'removed'] as const) {
  test(`recording survives ${exit} until explicit discard`, async ({ page, room, authMock }) => {
    room.host = true; room.rosterRole = 'host'; room.admission = 'admitted';
    await page.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: async () => {
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
        const context = canvas.getContext('2d')!;
        setInterval(() => { context.fillStyle = 'blue'; context.fillRect(0, 0, 320, 180); }, 50);
        return canvas.captureStream(15);
      }});
    });
    await page.route('**/api/recordings.*', route => decodeURIComponent(new URL(route.request().url()).pathname).includes(',') ? route.fallback() : route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ result: { data: { recordings: [] } } }]) }));
    await seedAccount(page, authMock); await page.goto(path);
    await page.getByRole('button', { name: 'Join Meeting Now', exact: true }).click();
    await page.getByRole('button', { name: 'Show meeting toolbar', exact: true }).click();
    await page.getByRole('button', { name: 'Start recording', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause recording', exact: true })).toBeVisible();
    await page.waitForTimeout(1100);
    if (exit === 'leave-paused') {
      await page.getByRole('button', { name: 'Pause recording', exact: true }).click();
      await page.getByRole('button', { name: 'Leave Meeting', exact: true }).click();
      await page.getByRole('button', { name: 'Leave Call', exact: true }).click();
    } else if (exit === 'end') {
      await page.getByRole('button', { name: 'End meeting', exact: true }).click();
    } else {
      page.once('dialog', dialog => dialog.accept());
      if (exit === 'remote-end') room.status = 'ended'; else room.admission = 'denied';
    }
    await expect(page.getByRole('heading', { name: 'Review your recording' })).toBeVisible();
    const dialog = page.getByRole('dialog', { name: 'Host recordings' });
    await expect(dialog.getByRole('button', { name: 'Download to computer' })).toBeVisible();
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download to computer' }).click();
    expect((await download).suggestedFilename()).toMatch(/meeting-recording-.*\.(mp4|webm)$/);
    await expect(dialog).toContainText('Download requested');
    page.once('dialog', prompt => prompt.dismiss());
    await dialog.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Download to computer' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close recordings' }).click();
    await page.getByRole('button', { name: 'Save / Download Recording' }).click();
    page.once('dialog', prompt => prompt.accept());
    await dialog.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Download to computer' })).toBeHidden();
    await dialog.getByRole('button', { name: 'Close recordings' }).click();
    await page.getByRole('button', { name: 'Return home', exact: true }).click();
    await expect(page).toHaveURL('/');
    if (exit === 'end') expect(room.calls.filter(call => call.path === 'meetings.end')).toHaveLength(1);
  });
}

test('verified company recording link can be copied before leaving without discarding the preview', async ({ page, room, authMock }) => {
  room.host = true; room.rosterRole = 'host'; room.admission = 'admitted';
  room.recordingFolderId = 'authorizedFolder123';
  const jobId = '44444444-4444-4444-8444-444444444444';
  const verifiedUrl = 'https://drive.google.com/file/d/verifiedTestFile123/view';
  const unrelatedUrl = 'https://drive.google.com/file/d/unrelatedTestFile123/view';
  let recordingId = '', occurrenceId: string | null = null, mimeType = 'video/webm', total = 0, staged = 0;
  let stagedVerified = false, processingRequested = false;
  await page.addInitScript(() => {
    (window as any).__copiedRecordingLink = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (value: string) => { (window as any).__copiedRecordingLink = value; },
    } });
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
      const context = canvas.getContext('2d')!;
      setInterval(() => { context.fillStyle = 'blue'; context.fillRect(0, 0, 320, 180); }, 50);
      return canvas.captureStream(15);
    } });
  });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/recording-staging/')) {
      if (url.pathname.endsWith('/chunks')) staged = route.request().postDataBuffer()?.length ?? 0;
      if (url.pathname.endsWith('/verify')) stagedVerified = true;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jobId, recordingId, mimeType,
        byteLength: total, ingestionOffset: staged, ingestionState: stagedVerified ? 'verified' : 'unverified' }) });
      return;
    }
    const paths = decodeURIComponent(url.pathname.slice('/api/'.length)).split(',');
    const supported = paths.every(name => name === 'auth.me' || name === 'recordingFolders.list' ||
      name.startsWith('recordings.'));
    if (!supported) { await route.fallback(); return; }
    const batched = url.searchParams.get('batch') === '1';
    const input = route.request().method() === 'POST' ? route.request().postDataJSON() : JSON.parse(url.searchParams.get('input') || '{}');
    const results = paths.map((name, index) => {
      const value = batched ? input[index] : input;
      const ok = (data: unknown) => ({ result: { data } });
      if (name === 'auth.me') return ok({ user: authMock.user });
      if (name === 'recordingFolders.list') return ok({ connected: true, folders: [] });
      if (name === 'recordings.getForMeeting') return ok({ recordings: [] });
      if (name === 'recordings.companyUploadCapability') return ok({ available: true });
      if (name === 'recordings.createCompanyJob') {
        recordingId = value.recordingId; occurrenceId = value.occurrenceId ?? null;
        mimeType = value.mimeType; total = value.byteLength;
        room.historyItems = [
          { kind: 'drive', dedupeKey: `company-drive:${recordingId}`, occurrenceId,
            independentlyVerified: true, content: verifiedUrl },
          { kind: 'drive', dedupeKey: 'company-drive:55555555-5555-4555-8555-555555555555', occurrenceId,
            independentlyVerified: true, content: unrelatedUrl },
        ];
        return ok({ id: jobId, recordingId });
      }
      if (name === 'recordings.companyJobProgress') return ok({ jobId, recordingId,
        stage: processingRequested ? 'completed' : 'preparing_drive_upload', stagedBytes: staged,
        expectedBytes: total, driveConfirmedBytes: processingRequested ? total : 0, errorCode: null });
      if (name === 'recordings.requestCompanyJobProcessing') { processingRequested = true; return ok({ accepted: true }); }
      throw new Error(`Unexpected mock API: ${name}`);
    });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(batched ? results : results[0]) });
  });
  await seedAccount(page, authMock); await page.goto(path);
  await page.getByRole('button', { name: 'Join Meeting Now', exact: true }).click();
  await page.getByRole('button', { name: 'Show meeting toolbar', exact: true }).click();
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await page.waitForTimeout(1100);
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect(page.getByLabel('Company recording uploads')).toContainText('Saved to company Drive and available in Meeting History');
  await page.getByRole('button', { name: 'Close recordings' }).click();
  await page.getByRole('button', { name: 'Leave Meeting', exact: true }).click();
  await page.getByRole('button', { name: 'Leave Call', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your recording' })).toBeVisible();
  await expect(page.getByText('Recording saved successfully.')).toBeVisible();
  await expect(page.getByRole('link', { name: verifiedUrl })).toBeVisible();
  await expect(page.getByText(unrelatedUrl)).toHaveCount(0);
  await page.getByRole('button', { name: 'Copy recording link', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__copiedRecordingLink)).toBe(verifiedUrl);
  await expect(page.getByRole('button', { name: 'Recording link copied', exact: true }).locator('svg')).toHaveClass(/text-green-400/);
  await page.getByRole('button', { name: 'Leave Meeting', exact: true }).click();
  await expect(page).toHaveURL('/');
});

test('host can opt into encrypted recovery before starting an existing manual recording', async ({ page, room, authMock }) => {
  room.host = true; room.rosterRole = 'host'; room.admission = 'admitted';
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
      const context = canvas.getContext('2d')!;
      setInterval(() => { context.fillStyle = 'blue'; context.fillRect(0, 0, 320, 180); }, 50);
      return canvas.captureStream(15);
    } });
  });
  await page.route('**/api/recordings.*', route => decodeURIComponent(new URL(route.request().url()).pathname).includes(',') ? route.fallback() : route.fulfill({ json: [{ result: { data: { recordings: [] } } }] }));
  await seedAccount(page, authMock); await page.goto(path);
  await page.getByRole('button', { name: 'Join Meeting Now', exact: true }).click();
  await page.getByRole('button', { name: 'Set up local recovery' }).click();
  const setup = page.getByRole('dialog', { name: 'Encrypted local recovery' });
  await setup.getByLabel('Recovery passphrase', { exact: true }).fill('meeting-passphrase');
  await setup.getByLabel('Confirm passphrase').fill('meeting-passphrase');
  await setup.getByRole('button', { name: 'Enable for next recording' }).click();
  await expect(page.getByRole('button', { name: 'Local recovery ready' })).toBeVisible();
  await page.getByRole('button', { name: 'Show meeting toolbar', exact: true }).click();
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByText('Encrypted local recovery is active.')).toBeVisible();
  await expect.poll(async () => page.evaluate(async owner => {
    const path = '/src/lib/localRecordingStore.ts'; const store = await import(/* @vite-ignore */ path);
    return (await store.listLocalRecordings(owner))[0]?.count ?? 0;
  }, authMock.user.id)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect(page.getByText('Encrypted recording saved on this device.')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Host recordings' }).getByRole('button', { name: 'Download to computer' })).toBeVisible();
  await page.evaluate(() => { const user = JSON.parse(localStorage.getItem('ylaam_meet_user')!); user.id = 'different-account'; localStorage.setItem('ylaam_meet_user', JSON.stringify(user)); });
  await expect(page.getByRole('dialog', { name: 'Host recordings' })).toBeHidden();
  await expect(page.getByText('Recording preview is hidden because the account session changed.')).toBeVisible();
  await expect(page.getByLabel('Recording video')).toHaveCount(0);
});

test('meeting mock preserves auth and recording results in mixed API batches', async ({ page, room, authMock }) => {
  room.admission = 'admitted';
  await seedAccount(page, authMock);
  const responses = await page.evaluate(async ({ token, meetingCode }) => {
    const batch = async (paths: string, input: object) => {
      const url = `/api/${paths}?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`;
      return (await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).json();
    };
    return {
      authFirst: await batch('auth.me,meetings.admissionStatus', { 0: {}, 1: { meetingCode } }),
      recordingFirst: await batch('recordings.getForMeeting,meetings.admissionStatus', { 0: { meetingCode }, 1: { meetingCode } }),
      meetingFirst: await batch('meetings.admissionStatus,recordings.getForMeeting', { 0: { meetingCode }, 1: { meetingCode } }),
    };
  }, { token: authMock.token, meetingCode: code });
  expect(responses.authFirst[0].result.data.user.id).toBe(authMock.user.id);
  expect(responses.authFirst[1].result.data.admission).toBe('admitted');
  expect(responses.recordingFirst[0].result.data.recordings).toEqual([]);
  expect(responses.recordingFirst[1].result.data.admission).toBe('admitted');
  expect(responses.meetingFirst[0].result.data.admission).toBe('admitted');
  expect(responses.meetingFirst[1].result.data.recordings).toEqual([]);
});
