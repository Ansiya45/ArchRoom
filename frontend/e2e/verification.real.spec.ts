import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { inspectSignup, signupSettings, securePassword } from './fixtures/signup-data';

// Explicitly select exactly one action. Never resend automatically before verify.
const action = process.env.E2E_VERIFICATION_ACTION;
const settings = signupSettings();
const local = parse(readFileSync(new URL('../.env.e2e.local', import.meta.url)));
const code = process.env.E2E_VERIFICATION_CODE || local.E2E_VERIFICATION_CODE || '';

test('controlled dedicated-account email verification', async ({ page, request, baseURL }) => {
  expect(['resend', 'verify', 'recover'].includes(action || ''), 'Set E2E_VERIFICATION_ACTION to resend, verify or recover').toBe(true);
  expect(Boolean(settings.email), 'E2E_SIGNUP_EMAIL is required').toBe(true);
  const before = await inspectSignup(settings.email);
  expect(Boolean(before?.user.full_name?.startsWith('YLAAM E2E signup ')), 'Only an existing dedicated signup account is allowed').toBe(true);
  expect(before?.user.email_verified_at === null, 'Account must still be unverified; do not retry a completed verification').toBe(true);
  const call = async (procedure: 'resendVerification' | 'verifyEmail', input: object) => {
    try {
      const response = await request.post(`${baseURL}/api/auth.${procedure}`, { data: input });
      return await response.json();
    } catch { throw new Error('Verification request failed; sensitive details withheld. No automatic retry.'); }
  };
  if (action === 'resend') {
    const result = await call('resendVerification', { email: settings.email });
    expect(Boolean(result.result?.data?.ok), 'Resend was not accepted; check cooldown/provider configuration. No automatic retry.').toBe(true);
    console.log('One resend accepted by the backend. Check the dedicated mailbox; no verification attempted.');
    return;
  }
  expect(/^\d{6}$/.test(code), 'Configure the received E2E_VERIFICATION_CODE locally').toBe(true);
  if (action === 'recover') {
    // Recovery for the dedicated account whose generated signup password was lost.
    // Exercise the real browser -> proxy -> backend API, not the password-gated
    // verification form. Do not claim this as completed UI/login coverage.
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== baseURL) return route.abort();
      if (url.pathname.startsWith('/api/')) {
        if (req.method() === 'POST' && ['/api/auth.verifyEmail', '/api/auth.requestPasswordReset'].includes(url.pathname)) {
          const body = req.postDataJSON();
          const input = url.searchParams.get('batch') === '1' ? body?.[0] : body;
          if (input?.email === settings.email) return route.continue();
        }
        return route.abort();
      }
      return req.method() === 'GET' ? route.continue() : route.abort();
    });
    await page.routeWebSocket('**/*', socket => {
      const url = new URL(socket.url());
      if (url.host === new URL(baseURL!).host && url.pathname === '/') socket.connectToServer(); else socket.close();
    });
    await page.goto('/');
    const outcome = await page.evaluate(async input => {
      const verify = async () => {
        const response = await fetch('/api/auth.verifyEmail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
        return response.json();
      };
      const first = await verify();
      if (!first.result?.data?.token) return { accepted: false, replayRejected: false };
      const replay = await verify();
      return { accepted: true, replayRejected: replay.error?.data?.code === 'BAD_REQUEST' && !replay.result?.data?.token };
    }, { email: settings.email, code }).catch(() => { throw new Error('Recovery verification request failed; secrets withheld. Inspect account state before retrying.'); });
    expect(outcome.accepted, 'Real received verification code must be accepted').toBe(true);
    expect(outcome.replayRejected, 'Consumed code must not issue another session').toBe(true);
    const verified = await inspectSignup(settings.email);
    expect(Boolean(verified?.user.email_verified_at)).toBe(true);
    expect(verified?.codes.filter(c => c.purpose === 'verify_email').length).toBe(0);
    expect(verified?.user.password_hash === before?.user.password_hash).toBe(true);
    // Request exactly one normal password-recovery email through the real UI.
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await page.getByRole('button', { name: 'Forgot password?', exact: true }).click();
    try { await page.getByPlaceholder('name@company.com').fill(settings.email); }
    catch { throw new Error('Unable to fill dedicated recipient; value withheld'); }
    await page.getByRole('button', { name: 'Send reset code', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    const pending = await inspectSignup(settings.email);
    expect(pending?.codes.filter(c => c.purpose === 'reset_password').length).toBe(1);
    expect(pending?.user.password_hash === before?.user.password_hash).toBe(true);
    console.log('Received verification code accepted; activation and replay rejection confirmed. One reset email accepted. Password unchanged; STOP for mailbox input.');
    return;
  }
  expect(Boolean(settings.password), 'E2E_SIGNUP_PASSWORD must be the existing signup account password, not the separate login account password').toBe(true);
  expect(await securePassword(before!.user.password_hash, settings.password!), 'Signup password does not match; stop before consuming the code').toBe(true);
  const forbidden: string[] = [];
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== baseURL) return route.abort();
    if (url.pathname.startsWith('/api/')) {
      if (['/api/auth.login', '/api/auth.verifyEmail'].includes(url.pathname) && req.method() === 'POST') {
        const body = req.postDataJSON();
        const input = url.searchParams.get('batch') === '1' ? body?.[0] : body;
        if (input?.email === settings.email) return route.continue();
      }
      // Keep auth.me real; isolate the homepage's unrelated meeting-list query.
      const paths = decodeURIComponent(url.pathname.slice(5)).split(',');
      if (req.method() === 'GET' && paths.every(path => ['auth.me', 'meetings.list'].includes(path))) {
        let account: any;
        if (paths.includes('auth.me')) {
          const response = await route.fetch({ url: `${baseURL}/api/auth.me` });
          account = await response.json();
          expect(account.result?.data?.user?.email === settings.email, 'Real auth.me must identify the verified account').toBe(true);
        }
        const results = paths.map(path => path === 'auth.me' ? account : { result: { data: { ok: true, meetings: [] } } });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(url.searchParams.get('batch') === '1' ? results : results[0]) });
      }
      forbidden.push('unexpected mutation'); return route.abort();
    }
    if (['GET', 'HEAD'].includes(req.method()) && !['fetch', 'xhr'].includes(req.resourceType())) return route.continue();
    forbidden.push('unexpected request'); return route.abort();
  });
  await page.routeWebSocket('**/*', socket => {
    const url = new URL(socket.url());
    if (url.host === new URL(baseURL!).host && url.pathname === '/') socket.connectToServer(); else socket.close();
  });
  const signIn = async () => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    try {
      await page.getByPlaceholder('name@company.com').fill(settings.email);
      await page.locator('input[autocomplete="current-password"]').fill(settings.password!);
    } catch { throw new Error('Unable to fill login credentials; values withheld'); }
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  };
  await signIn();
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
  try { await page.getByPlaceholder('123456').fill(code); }
  catch { throw new Error('Unable to fill received code; value withheld'); }
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeHidden();
  const hasSession = () => page.evaluate(() => Boolean(localStorage.getItem('ylaam_meet_token') && localStorage.getItem('ylaam_meet_user')));
  await expect.poll(hasSession).toBe(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeHidden();
  await expect.poll(hasSession).toBe(true);
  const after = await inspectSignup(settings.email);
  expect(Boolean(after?.user.email_verified_at), 'Account activation must persist').toBe(true);
  expect(after?.codes.filter(c => c.purpose === 'verify_email').length).toBe(0);
  expect(after?.user.password_hash === before?.user.password_hash).toBe(true);
  const replay = await call('verifyEmail', { email: settings.email, code });
  expect(replay.error?.data?.code === 'BAD_REQUEST' && !replay.result?.data?.token, 'Consumed code must not issue another session').toBe(true);
  const arbitrary = await call('verifyEmail', { email: settings.email, code: '000000' });
  expect(arbitrary.error?.data?.code === 'BAD_REQUEST' && !arbitrary.result?.data?.token).toBe(true);
  await page.getByRole('banner').locator('div.hidden.md\\:flex button').click();
  await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await expect.poll(hasSession).toBe(false);
  await signIn();
  await expect.poll(hasSession).toBe(true);
  await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeHidden();
  expect(forbidden).toEqual([]);
});
