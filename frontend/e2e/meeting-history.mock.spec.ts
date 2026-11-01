import { test, expect, login } from './fixtures/auth-mock';

const meetingId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const room = { id: meetingId, title: 'Reusable training room', meetingCode: 'YLM-ABC234', scheduleType: 'reusable', status: 'scheduled', scheduledAt: null, timeZone: null, recurrenceRule: null, createdAt: '2026-10-16T08:00:00.000Z', updatedAt: '2026-10-16T09:00:00.000Z' };

test('creator history opens saved session details without a Join action and supports mobile', async ({ page, authMock }) => {
  await login(page, authMock);
  await page.route('**/api/meetings.history*', route => {
    const details = new URL(route.request().url()).pathname.endsWith('historyDetail');
    return route.fulfill({ json: { result: { data: details ? {
      meeting: { ...room, hostUserId: authMock.user.id },
      sessions: [{ id: sessionId, status: 'ended', scheduledAt: null, startedAt: '2026-10-16T08:10:00.000Z', endedAt: '2026-10-16T09:10:00.000Z', cancelledAt: null }],
      items: [
        { id: 'text', occurrenceId: sessionId, kind: 'transcript', content: 'Discuss the training plan.' },
        { id: 'summary', occurrenceId: sessionId, kind: 'summary', content: 'Training starts Monday.' },
        { id: 'drive', occurrenceId: sessionId, kind: 'drive', label: 'Training.mp4', content: 'https://drive.google.com/file/d/example/view' },
      ], recordings: [],
    } : [{ ...room, hostUserId: authMock.user.id }] } } });
  });
  await page.getByRole('complementary').getByRole('button', { name: 'Meeting History' }).click();
  await page.getByRole('button', { name: 'View Details', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reusable training room' })).toBeVisible();
  await page.locator('summary').filter({ hasText: 'ended' }).click();
  await page.locator('summary').filter({ hasText: /^View transcript$/ }).click();
  await expect(page.getByText('Discuss the training plan.')).toBeVisible();
  await page.locator('summary').filter({ hasText: 'View summary' }).click();
  await expect(page.getByText('Training starts Monday.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open in Drive' })).toHaveAttribute('href', 'https://drive.google.com/file/d/example/view');
  await expect(page.locator('section').getByRole('button', { name: /join|start call/i })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Hide Details' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'View Details', exact: true })).toBeVisible();
});

test('scheduled meetings exclude reusable Create Meeting rooms', async ({ page, authMock }) => {
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    const paths = url.pathname.slice('/api/'.length).split(',');
    if (!paths.includes('meetings.list')) return route.fallback();
    authMock.calls.push(...paths);
    const results = paths.map(path => ({ result: { data: path === 'auth.me' ? { ok: true, user: authMock.user } : { ok: true, meetings: [
    { ...room, hostUserId: authMock.user.id },
    { ...room, id: '33333333-3333-4333-8333-333333333333', title: 'Scheduled training', scheduleType: 'one_time', scheduledAt: '2026-10-20T08:00:00.000Z', hostUserId: 'another-host' },
    ] } } }));
    return route.fulfill({ json: url.searchParams.get('batch') === '1' ? results : results[0] });
  });
  // This test supplies meetings.list itself; preserve the login fixture's readiness check.
  authMock.calls.push('meetings.list');
  await login(page, authMock);
  await page.getByRole('complementary').getByRole('button', { name: 'Scheduled Meetings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Scheduled training', exact: true })).toBeVisible();
  await expect(page.getByText('Reusable training room', { exact: true })).toHaveCount(0);
});

test('history failure offers retry, and logged-out users cannot open private history', async ({ page, authMock }) => {
  await page.goto('/');
  await page.getByRole('complementary').getByRole('button', { name: 'Meeting History' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.goto('/');
  await login(page, authMock);
  let failed = true;
  await page.route('**/api/meetings.history*', route => failed ? route.fulfill({ status: 500, body: 'Unavailable' }) : route.fulfill({ json: { result: { data: [] } } }));
  await page.getByRole('complementary').getByRole('button', { name: 'Meeting History' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
  failed = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('No meetings on this page.')).toBeVisible();
});

test('inline history copies saved content and retains participant sharing', async ({ page, authMock }) => {
  await login(page, authMock);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as any).copiedHistoryText = text; } } }));
  await page.route('**/api/meetings.history*', route => route.fulfill({ json: { result: { data: new URL(route.request().url()).pathname.endsWith('historyDetail') ? {
    meeting: room, sessions: [], recordings: [], items: [
      { id: 't', occurrenceId: null, kind: 'transcript', label: 'reviewed-complete', content: 'Actual saved transcript.' },
      { id: 's', occurrenceId: null, kind: 'summary', content: 'Actual saved summary.' },
      { id: 'd', occurrenceId: null, kind: 'drive', content: 'https://drive.google.com/file/d/saved123/view?usp=sharing' },
    ],
  } : [room, { ...room, id: sessionId, title: 'Other meeting', status: 'ended' }] } } }));
  await page.route('**/api/meetings.summaryRecipients*', route => route.fulfill({ json: { result: { data: [{ id: sessionId, name: 'Attendee', email: 'attendee@example.invalid' }] } } }));
  let sent: any;
  await page.route('**/api/meetings.shareTranscript*', route => { sent = route.request().postDataJSON(); return route.fulfill({ json: { result: { data: { sentIds: [sessionId], failedIds: [] } } } }); });
  await page.getByRole('complementary').getByRole('button', { name: 'Meeting History' }).click();
  const card = page.getByRole('listitem').filter({ hasText: room.title });
  await card.getByRole('button', { name: 'View Details' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Other meeting' })).toBeVisible();
  const link = page.getByRole('textbox', { name: 'Meeting link' });
  await expect(link).toHaveValue(new URL('/meet/' + room.meetingCode, page.url()).href);
  await card.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).copiedHistoryText)).toBe(await link.inputValue());
  await expect(card.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  for (const kind of ['transcript', 'summary']) {
    await card.locator('summary').filter({ hasText: 'View ' + kind }).click();
    await expect(card.getByText('Actual saved ' + kind + '.', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Copy ' + kind, exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).copiedHistoryText)).toBe('Actual saved ' + kind + '.');
  }
  await expect(card.getByRole('link', { name: 'Open in Drive' })).toHaveAttribute('href', 'https://drive.google.com/file/d/saved123/view?usp=sharing');
  await card.getByRole('button', { name: 'Email transcript to participants' }).click();
  await card.getByRole('checkbox', { name: 'Attendee' }).check();
  await card.getByRole('button', { name: 'Send transcript', exact: true }).click();
  await expect(card.getByRole('status')).toContainText('1 participant email(s) accepted');
  expect(sent[0] ?? sent).toMatchObject({ meetingCode: room.meetingCode, transcript: 'Actual saved transcript.', summary: 'Actual saved summary.', recipientIds: [sessionId] });
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Denied'); } } }));
  await card.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(card.getByRole('status')).toContainText('Select the text and copy it manually');
  await page.screenshot({ path: 'test-results/history-desktop.png', fullPage: true });
  await card.getByRole('button', { name: 'Hide Details' }).click();
  await expect(link).toHaveCount(0);
});

test('history empty materials, real timestamps, and non-Drive recording states', async ({ page, authMock }) => {
  await login(page, authMock);
  const scheduled = { ...room, scheduleType: 'one_time', scheduledAt: '2026-11-02T18:30:00.000Z', status: 'ended' };
  let items: any[] = [], recordings: any[] = [];
  await page.route('**/api/meetings.history*', route => route.fulfill({ json: { result: { data: new URL(route.request().url()).pathname.endsWith('historyDetail') ? { meeting: scheduled, sessions: [], items, recordings } : [scheduled] } } }));
  await page.getByRole('complementary').getByRole('button', { name: 'Meeting History' }).click();
  const expectedDate = await page.evaluate(value => new Date(value).toLocaleString(), scheduled.scheduledAt);
  await expect(page.getByText('Scheduled: ' + expectedDate, { exact: true })).toBeVisible();
  await expect(page.getByText('ended', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View Details' }).click();
  await expect(page.getByText('No saved transcript or summary is available.')).toBeVisible();
  await expect(page.getByText('No separate session times are stored for this meeting.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recording', exact: true })).toHaveCount(0);
  await expect(page.locator('summary')).toHaveCount(0);
  await page.getByRole('button', { name: 'Hide Details' }).click();
  items = [{ id: 'bad', kind: 'drive', occurrenceId: null, content: 'https://example.invalid/not-drive' }];
  recordings = [{ id: sessionId, occurrenceId: null, fileName: 'saved.webm', status: 'completed' }];
  await page.route('**/api/recordings.downloadUrl*', route => route.fulfill({ json: { result: { data: { url: 'https://example.invalid/saved-recording' } } } }));
  await page.getByRole('button', { name: 'View Details' }).click();
  await expect(page.getByText('No usable Google Drive link is available.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open in Drive' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Get temporary recording link' }).click();
  await expect(page.getByRole('link', { name: 'Open saved recording' })).toHaveAttribute('href', 'https://example.invalid/saved-recording');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
