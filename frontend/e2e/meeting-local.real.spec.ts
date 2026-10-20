import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { parse } from 'dotenv';

const local = parse(readFileSync(new URL('../.env.auth-test.local', import.meta.url)));
const backendRequire = createRequire(new URL('../../backend/package.json', import.meta.url));
const postgres = backendRequire('postgres') as typeof import('../../backend/node_modules/postgres');
const bcrypt = backendRequire('bcryptjs') as typeof import('../../backend/node_modules/bcryptjs');

test('host admits a guest to an instant meeting without refreshing either browser', async ({ browser, baseURL }) => {
  const host = await browser.newContext();
  const guest = await browser.newContext();
  const blocked: string[] = [];
  const allowed = new Set(['auth.login', 'auth.me', 'auth.refresh', 'meetings.list', 'meetings.create', 'meetings.getByCode', 'meetings.start', 'meetings.join', 'meetings.rejoin', 'meetings.admissionStatus', 'meetings.pendingAdmissions', 'meetings.decideAdmission', 'meetings.participants', 'meetings.aiStatus', 'meetings.livekitToken', 'meetings.leave']);
  for (const context of [host, guest]) {
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== baseURL) return route.abort();
      if (url.pathname.startsWith('/api/')) {
        const paths = decodeURIComponent(url.pathname.slice(5)).split(',');
        if (paths.every(path => allowed.has(path))) return route.continue();
        blocked.push('Unexpected API request'); return route.abort();
      }
      if (!['GET', 'HEAD'].includes(req.method()) || ['fetch', 'xhr'].includes(req.resourceType())) return route.abort();
      return route.continue();
    });
    await context.routeWebSocket('**/*', socket => {
      const url = new URL(socket.url());
      if (url.host === new URL(baseURL!).host && url.pathname === '/') socket.connectToServer();
      else socket.close();
    });
  }
  const db = postgres({ host: '127.0.0.1', port: 5432, database: 'ylaam_auth_test', username: 'postgres', password: local.PG_TEST_PASSWORD, max: 1 });
  const title = `Local meeting test ${randomUUID()}`;
  const hostEmail = `ylaam-meeting-host-${randomUUID()}@example.invalid`;
  const hostPassword = `LocalHost${randomUUID().replaceAll('-', '')}Aa1`;
  try {
    const [database] = await db`select current_database() as name`;
    expect(database.name).toBe('ylaam_auth_test');
    const passwordHash = await bcrypt.hash(hostPassword, 10);
    await db`insert into users (email, password_hash, full_name, email_verified_at) values (${hostEmail}, ${passwordHash}, 'Local meeting host', now())`;
    const hostPage = await host.newPage();
    await hostPage.goto('/');
    await hostPage.getByRole('button', { name: 'Login', exact: true }).click();
    try {
      await hostPage.getByPlaceholder('name@company.com').fill(hostEmail);
      await hostPage.locator('input[autocomplete="current-password"]').fill(hostPassword);
    } catch { throw new Error('Could not enter dedicated test credentials; values withheld.'); }
    await hostPage.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(hostPage.getByRole('banner').getByRole('button', { name: 'Local meeting host' })).toBeVisible();
    await hostPage.getByRole('complementary').getByRole('button', { name: 'Create Meeting', exact: true }).click();
    const create = hostPage.getByRole('dialog', { name: 'Create or Schedule Meeting' });
    await create.getByLabel('Meeting Topic / Title').fill(title);
    await create.locator('button[type=submit]').click();
    await expect(hostPage).toHaveURL(/\/meet\/YLM-[A-Z2-9]{6}$/);
    const meetingURL = hostPage.url();
    await hostPage.getByRole('button', { name: 'Join Meeting Now', exact: true }).click();
    await expect(hostPage.getByRole('button', { name: 'Show meeting toolbar', exact: true })).toBeVisible();
    const guestPage = await guest.newPage();
    await guestPage.goto(meetingURL);
    await guestPage.getByPlaceholder('Enter your name').fill('Local test guest');
    await guestPage.getByRole('button', { name: 'Join Meeting Now', exact: true }).click();
    await expect(guestPage.getByRole('heading', { name: 'Waiting for the host' })).toBeVisible();
    const dialog = hostPage.getByRole('dialog', { name: 'Meeting join requests' });
    await expect(dialog).toContainText('Local test guest', { timeout: 20_000 });
    await dialog.getByRole('button', { name: 'Admit', exact: true }).click();
    await expect(guestPage.getByRole('button', { name: 'Show meeting toolbar', exact: true })).toBeVisible();
    const rows = await db`select id, schedule_type, status from meetings where title = ${title}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].schedule_type).toBe('reusable');
    const participants = await db`select role, admission from meeting_participants where meeting_id = ${rows[0].id}`;
    expect(participants.some(row => row.role === 'host' && row.admission === 'admitted')).toBe(true);
    expect(participants.some(row => row.role === 'participant' && row.admission === 'admitted')).toBe(true);
    expect(blocked).toEqual([]);
  } finally {
    await host.close(); await guest.close();
    await db`delete from users where email = ${hostEmail}`;
    await db.end({ timeout: 5 });
  }
});
