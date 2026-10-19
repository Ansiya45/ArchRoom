import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test as base, expect, login, logout, type AuthMock } from './fixtures/auth-mock';
const code = 'YLM-W8Z3SE', path = `/meet/${code}`;
type Room = { admission: 'pending' | 'admitted' | 'denied'; status: string; cancelled: boolean; missing: boolean; host: boolean; rosterRole: 'host' | 'participant'; pollFails: boolean; stallPending: boolean; requests: Array<{ id: string; name: string }>; calls: Array<{ path: string; input: any }> };
const test = base.extend<{ room: Room }>({
  room: [async ({ context, authMock }, use) => {
    const room: Room = { admission: 'pending', status: 'live', cancelled: false, missing: false, host: false, rosterRole: 'participant', pollFails: false, stallPending: false, requests: [], calls: [] };
    const id = randomUUID();
    await context.routeWebSocket('**/api/whiteboard', socket => { socket.onMessage(() => {}); });
    await context.route('**/api/meetings.*', async route => {
      const url = new URL(route.request().url());
      const paths = decodeURIComponent(url.pathname.slice('/api/'.length)).split(',');
      if (paths.every(p => p === 'meetings.list')) { await route.fallback(); return; }
      if (paths.includes('meetings.pendingAdmissions') && room.stallPending) {
        room.stallPending = false;
        await new Promise(resolve => setTimeout(resolve, 10_000));
      }
      const batched = url.searchParams.get('batch') === '1';
      const input = route.request().method() === 'POST' ? route.request().postDataJSON() : JSON.parse(url.searchParams.get('input') || '{}');
      const results = paths.map((procedure, index) => {
        const value = batched ? input[index] : input;
        room.calls.push({ path: procedure, input: value });
        expect(value.meetingCode).toMatch(/^YLM-/);
        const ok = (data: unknown) => ({ result: { data } });
        const error = (message: string, errorCode = 'NOT_FOUND') => ({ error: { message, code: -32004, data: { code: errorCode, httpStatus: 404, path: procedure } } });
        const meeting = { id, meetingCode: value.meetingCode, title: 'Private shared meeting', hostUserId: room.host ? authMock.user.id : 'another-user', status: room.status, scheduleType: room.cancelled ? 'recurring' : null, recurrenceCancelledAt: room.cancelled ? new Date().toISOString() : null };
        if (procedure === 'meetings.getByCode') return room.missing ? error('Meeting not found') : ok({ ok: true, meeting });
        if (procedure === 'meetings.join' || procedure === 'meetings.rejoin') return ok({ ok: true, meeting, participant: { id, admission: room.host ? 'admitted' : room.admission } });
        if (procedure === 'meetings.admissionStatus') return ok({ admission: room.admission, meeting, leftAt: null, sessionEnded: false });
        if (procedure === 'meetings.participants') return ok({ participants: room.host ? [{ id, name: authMock.user.fullName, role: room.rosterRole, isSelf: true }] : [] });
        if (procedure === 'meetings.pendingAdmissions') return room.pollFails ? error('Temporarily unavailable', 'INTERNAL_SERVER_ERROR') : ok({ requests: room.requests });
        if (procedure === 'meetings.decideAdmission') { room.requests = room.requests.filter(request => request.id !== value.participantId); return ok({ ok: true }); }
        if (procedure === 'meetings.admitAll') { const participantIds = room.requests.map(request => request.id); room.requests = []; return ok({ ok: true, admittedCount: participantIds.length, participantIds }); }
        if (procedure === 'meetings.aiStatus') return ok({ state: 'off' });
        // Verify the admission transition without connecting to real media.
        if (procedure === 'meetings.livekitToken') return error('Media disabled in isolated test', 'PRECONDITION_FAILED');
        throw new Error(`Unexpected meeting API: ${procedure}`);
      });
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(batched ? results : results[0]) });
    });
    await use(room);
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
  await dialog.getByRole('button', { name: 'Admit' }).click();
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
  room.stallPending = true;
  room.requests = [{ id: randomUUID(), name: 'Waiting guest' }];
  await seedAccount(page, authMock);
  await page.goto(path);
  await page.getByRole('button', { name: 'Join Meeting Now' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Unable to check join requests' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('dialog', { name: 'Meeting join requests' })).toContainText('Waiting guest', { timeout: 20_000 });
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
