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
  await page.getByRole('button', { name: /Reusable training room/ }).click();
  await expect(page.getByRole('heading', { name: 'Reusable training room' })).toBeVisible();
  await page.locator('summary').filter({ hasText: 'ended' }).click();
  await page.locator('summary').filter({ hasText: /^Transcript$/ }).click();
  await expect(page.getByText('Discuss the training plan.')).toBeVisible();
  await page.locator('summary').filter({ hasText: 'Generated summaries' }).click();
  await expect(page.getByText('Training starts Monday.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Google Drive: Training.mp4' })).toHaveAttribute('href', 'https://drive.google.com/file/d/example/view');
  await expect(page.locator('section').getByRole('button', { name: /join|start call/i })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Back to meeting history' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Reusable training room/ })).toBeVisible();
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
