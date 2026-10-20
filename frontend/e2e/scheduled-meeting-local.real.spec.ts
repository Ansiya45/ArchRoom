import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';

const local = parse(readFileSync(new URL('../.env.auth-test.local', import.meta.url)));
const requireBackend = createRequire(new URL('../../backend/package.json', import.meta.url));
const postgres = requireBackend('postgres') as typeof import('../../backend/node_modules/postgres');
const bcrypt = requireBackend('bcryptjs') as typeof import('../../backend/node_modules/bcryptjs');

async function isolate(context: BrowserContext, baseURL: string) {
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== baseURL) return route.abort();
    if (url.pathname.startsWith('/api/')) return route.continue();
    if (!['GET', 'HEAD'].includes(request.method()) || ['fetch', 'xhr'].includes(request.resourceType())) return route.abort();
    return route.continue();
  });
  await context.routeWebSocket('**/*', socket => {
    const url = new URL(socket.url());
    if (url.host === new URL(baseURL).host && url.pathname === '/') socket.connectToServer();
    else socket.close();
  });
}

test('scheduled one-time meeting: host starts, guest requests and is admitted without refresh', async ({ browser, baseURL }) => {
  const host = await browser.newContext();
  const guest = await browser.newContext();
  const db = postgres({ host: '127.0.0.1', port: 5432, database: 'ylaam_auth_test', username: 'postgres', password: local.PG_TEST_PASSWORD, max: 1 });
  const hostEmail = `scheduled-host-${randomUUID()}@example.invalid`;
  const hostPassword = `ScheduledHost${randomUUID().replaceAll('-', '')}Aa1`;
  const title = `Scheduled local test ${randomUUID()}`;
  const checkpoints: string[] = [];
  const checkpoint = (name: string, details = '') => { const line = `[${new Date().toISOString()}] ${name}${details ? ` ${details}` : ''}`; checkpoints.push(line); console.log(line); };
  const diagnostics = (page: Page) => {
    page.on('console', message => { if (message.type() === 'error') console.log(`[browser-console] ${message.text()}`); });
    page.on('requestfailed', request => console.log(`[request-failed] ${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`));
    page.on('response', response => { if (response.status() >= 400) console.log(`[response-error] ${response.status()} ${response.url()}`); });
  };
  try {
    const [identity] = await db`select current_database() as name`;
    expect(identity.name).toBe('ylaam_auth_test');
    await db`insert into users (email, password_hash, full_name, email_verified_at) values (${hostEmail}, ${await bcrypt.hash(hostPassword, 10)}, 'Scheduled local host', now())`;
    await isolate(host, baseURL!); await isolate(guest, baseURL!);
    const hostPage = await host.newPage();
    diagnostics(hostPage);
    await hostPage.goto('/');
    await hostPage.getByRole('button', { name: 'Login', exact: true }).click();
    await hostPage.getByPlaceholder('name@company.com').fill(hostEmail);
    await hostPage.locator('input[autocomplete="current-password"]').fill(hostPassword);
    await hostPage.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(hostPage.getByRole('banner').getByRole('button', { name: 'Scheduled local host' })).toBeVisible();
    checkpoint('host login completed');
    await hostPage.getByRole('complementary').getByRole('button', { name: 'Create Meeting', exact: true }).click();
    const form = hostPage.getByRole('dialog', { name: 'Create or Schedule Meeting' });
    checkpoint('schedule dialog opened');
    await form.getByRole('button', { name: 'Schedule Meeting', exact: true }).first().click();
    await form.getByLabel('Meeting Topic / Title').fill(title);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const date = tomorrow.toISOString().slice(0, 10);
    await form.locator('input[type="date"]').fill(date);
    await form.locator('input[type="time"]').fill('12:00');
    checkpoint('schedule fields filled', `date=${await form.locator('input[type="date"]').inputValue()} valid=${await form.locator('input[type="date"]').evaluate((el: HTMLInputElement) => el.validity.valid)}`);
    const schedulingRequest = hostPage.waitForRequest(request => request.url().includes('/api/meetings.create'));
    const schedulingResponse = hostPage.waitForResponse(response => response.url().includes('/api/meetings.create'));
    await form.locator('form').getByRole('button', { name: 'Schedule Meeting', exact: true }).click();
    checkpoint('form submitted');
    await schedulingRequest; checkpoint('scheduling API request started');
    const scheduleResponse = await schedulingResponse; checkpoint('scheduling API response received', `status=${scheduleResponse.status()}`);
    await expect(form).toBeHidden();
    const [meeting] = await db`select id, meeting_code, schedule_type, scheduled_at, status, host_user_id from meetings where title = ${title}`;
    expect(meeting).toBeTruthy();
    expect(meeting.schedule_type).toBe('one_time');
    expect(meeting.status).toBe('scheduled');
    expect(meeting.scheduled_at).toBeTruthy();
    expect(meeting.meeting_code).toMatch(/^YLM-[A-Z2-9]{6}$/);
    checkpoint('meeting database record verified', `meetingId=${meeting.id} code=${meeting.meeting_code}`);
    await hostPage.getByRole('complementary').getByRole('button', { name: 'Scheduled Meetings', exact: true }).click();
    const card = hostPage.getByText(title, { exact: true }).locator('..');
    await expect(hostPage.getByRole('button', { name: 'Start Call', exact: true })).toBeVisible();
    checkpoint('scheduled meeting appeared on dashboard');
    const startRequest = hostPage.waitForRequest(request => request.url().includes('/api/meetings.start'));
    const startResponse = hostPage.waitForResponse(response => response.url().includes('/api/meetings.start'));
    await hostPage.getByRole('button', { name: 'Start Call', exact: true }).click();
    checkpoint('host clicked Start');
    await startRequest; checkpoint('start meeting API request started');
    const startedResponse = await startResponse; checkpoint('start meeting API response received', `status=${startedResponse.status()}`);
    await expect(hostPage).toHaveURL(new RegExp(`/meet/${meeting.meeting_code}$`));
    await hostPage.getByRole('button', { name: 'Join Meeting Now', exact: true }).click();
    await expect(hostPage.getByRole('button', { name: 'Show meeting toolbar', exact: true })).toBeVisible();
    checkpoint('host meeting room rendered');
    const [started] = await db`select id, active_occurrence_id, status from meetings where id = ${meeting.id}`;
    expect(started.status).toBe('live');
    expect(started.active_occurrence_id).toBeNull();
    const guestPage = await guest.newPage();
    diagnostics(guestPage);
    await guestPage.goto(`${baseURL}/meet/${meeting.meeting_code}`);
    checkpoint('guest opened invitation link');
    await guestPage.getByPlaceholder('Enter your name').fill('Scheduled guest');
    await guestPage.getByRole('button', { name: 'Join Meeting Now', exact: true }).click();
    await expect(guestPage.getByRole('heading', { name: 'Waiting for the host' })).toBeVisible();
    checkpoint('guest waiting room rendered');
    checkpoint('guest requested admission');
    const dialog = hostPage.getByRole('dialog', { name: 'Meeting join requests' });
    await expect(dialog).toContainText('Scheduled guest', { timeout: 20_000 });
    checkpoint('host received admission request');
    await dialog.getByRole('button', { name: 'Admit', exact: true }).click();
    checkpoint('host admitted guest');
    await expect(guestPage.getByRole('button', { name: 'Show meeting toolbar', exact: true })).toBeVisible();
    checkpoint('guest entered meeting');
    const participants = await db`select role, admission, meeting_id, occurrence_id from meeting_participants where meeting_id = ${meeting.id}`;
    expect(participants.some(row => row.role === 'host' && row.admission === 'admitted')).toBe(true);
    expect(participants.some(row => row.role === 'participant' && row.admission === 'admitted')).toBe(true);
    expect(participants.every(row => row.meeting_id === meeting.id)).toBe(true);
    checkpoint('PostgreSQL participant assertions passed');
  } finally {
    console.log(checkpoints.join('\n'));
    await host.close(); await guest.close();
    await db`delete from users where email = ${hostEmail}`;
    await db.end({ timeout: 5 });
  }
});
