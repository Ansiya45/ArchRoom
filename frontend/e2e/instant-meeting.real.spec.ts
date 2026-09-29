import { randomUUID } from 'node:crypto';
import { test as base, expect } from '@playwright/test';
import { realCredentials } from './fixtures/real-credentials';
import { inspectInstantMeeting, removeInstantMeeting } from './fixtures/instant-meeting-data';

const credentials = realCredentials();

const test = base.extend<{ protectReal: void }>({
  protectReal: [async ({ context, baseURL }, use) => {
    const origin = new URL(baseURL!).origin;
    const blocked: string[] = [];
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === origin && url.pathname.startsWith('/api/')) {
        const paths = decodeURIComponent(url.pathname.slice(5)).split(',');
        const allowed = paths.every(path => request.method() === 'POST'
          ? ['auth.login', 'meetings.create'].includes(path)
          : request.method() === 'GET' && ['auth.me', 'meetings.list'].includes(path));
        if (allowed) return route.continue();
        blocked.push('unapproved API'); return route.abort('blockedbyclient');
      }
      if (['xhr', 'fetch'].includes(request.resourceType()) || !['GET', 'HEAD'].includes(request.method())) {
        blocked.push('unapproved data request'); return route.abort('blockedbyclient');
      }
      if (url.origin !== origin) return route.abort('blockedbyclient');
      return route.continue();
    });
    await use();
    expect(blocked, 'Only authentication reads and instant creation are authorized').toEqual([]);
  }, { auto: true }],
});

test('real instant meeting is persisted as live for the dedicated E2E host', async ({ page }) => {
  const title = `E2E Instant Creation ${randomUUID()}`;
  let meetingCode = '';
  await page.addInitScript(() => {
    const pushState = history.pushState.bind(history);
    history.pushState = (data: unknown, unused: string, url?: string | URL | null) => {
      const destination = String(url ?? '');
      if (destination.startsWith('/meet/')) {
        sessionStorage.setItem('e2e_instant_navigation', destination); return;
      }
      pushState(data, unused, url);
    };
  });

  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    try {
      await page.getByPlaceholder('name@company.com').fill(credentials.email);
      await page.locator('input[autocomplete="current-password"]').fill(credentials.password);
    } catch { throw new Error('Unable to fill login form; credential values withheld.'); }
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeHidden();

    await page.getByRole('complementary').getByRole('button', { name: 'Create Meeting', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create or Schedule Meeting' });
    meetingCode = (await dialog.getByLabel('Meeting Link').inputValue()).split('/').pop()!;
    await dialog.getByLabel('Meeting Topic / Title').fill(title);
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/meetings.create');
    await dialog.getByRole('button', { name: 'Start Meeting' }).click();
    const body = await (await response).json();
    if (body.error) throw new Error(`Real instant creation failed (${body.error.data?.code || 'unknown'}).`);

    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('e2e_instant_navigation')))
      .toBe(`/meet/${meetingCode}`);
    const record = await inspectInstantMeeting(meetingCode, credentials.email);
    expect(record).toMatchObject({ title, meeting_code: meetingCode, status: 'live', role: 'host', admission: 'admitted' });
    expect(record.schedule_type).toBeNull();
    expect(record.scheduled_at).toBeNull();
    expect(record.time_zone).toBeNull();
    expect(record.recurrence_rule).toBeNull();
  } finally {
    if (meetingCode) expect(await removeInstantMeeting(meetingCode, credentials.email, title)).toBeLessThanOrEqual(1);
  }
});
