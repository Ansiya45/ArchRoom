import { randomUUID } from 'node:crypto';
import { test as base, expect } from '@playwright/test';
import { realCredentials } from './fixtures/real-credentials';
import { inspectSignup, securePassword, signupSettings } from './fixtures/signup-data';
const existing = realCredentials();
const signup = signupSettings();
const test = base.extend<{ signupOnly: void }>({
  signupOnly: [async ({ context, baseURL }, use) => {
    const origin = new URL(baseURL!).origin;
    const blocked: string[] = [];
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === origin && url.pathname === '/api/auth.signup' && request.method() === 'POST') {
        const body = request.postDataJSON();
        const input = url.searchParams.get('batch') === '1' ? body?.[0] : body;
        if ([existing.email, signup.email].filter(Boolean).includes(input?.email) && input?.fullName?.startsWith('YLAAM E2E signup ')) return route.continue();
      }
      if (url.pathname.startsWith('/api') || ['xhr', 'fetch'].includes(request.resourceType()) || !['GET', 'HEAD'].includes(request.method())) {
        blocked.push('unexpected signup-phase request'); return route.abort('blockedbyclient');
      }
      if (url.origin !== origin) return route.abort('blockedbyclient');
      return route.continue();
    });
    await context.routeWebSocket('**/*', socket => {
      const url = new URL(socket.url());
      if (url.host === new URL(origin).host && url.pathname === '/') socket.connectToServer();
      else { blocked.push('WebSocket'); socket.close(); }
    });
    await use();
    expect(blocked).toEqual([]);
  }, { auto: true }],
});
async function register(page: import('@playwright/test').Page, email: string, password: string, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
  try {
    await page.getByPlaceholder('Jordan Miller').fill(name);
    await page.getByPlaceholder('name@company.com').fill(email);
    for (const input of await page.locator('input[autocomplete="new-password"]').all()) await input.fill(password);
  } catch { throw new Error('Unable to fill signup form; values withheld.'); }
  const pending = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth.signup');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  const body = await (await pending).json();
  return Array.isArray(body) ? body[0] : body;
}

test('duplicate signup is rejected without altering the existing E2E account', async ({ page }) => {
  const before = await inspectSignup(existing.email);
  expect(Boolean(before), 'Dedicated existing account must exist before testing duplicate signup').toBe(true);
  const result = await register(page, existing.email, `Aa1-${randomUUID()}`, `YLAAM E2E signup duplicate ${randomUUID()}`);
  expect(result.error?.data?.code).toBe('CONFLICT');
  await expect(page.getByRole('alert')).toHaveText('Email already registered');
  const after = await inspectSignup(existing.email);
  expect(JSON.stringify(before) === JSON.stringify(after), 'Existing user and verification records must remain unchanged').toBe(true);
});

test('valid signup creates one bcrypt-protected unverified E2E account and triggers the normal email', async ({ page }) => {
  test.skip(!signup.email, 'Configure E2E_SIGNUP_EMAIL with a fresh dedicated address you control.');
  expect(signup.email !== existing.email && signup.email !== existing.nonexistent, 'Use a separate signup-only address').toBe(true);
  expect(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signup.email), 'Configure a valid signup recipient').toBe(true);
  expect(await inspectSignup(signup.email) === null, 'Signup address already exists; configure a fresh E2E alias. No account is deleted automatically.').toBe(true);
  const password = signup.password || `Aa1-${randomUUID()}`;
  expect(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password), 'Configured signup password must meet the existing policy').toBe(true);
  const name = `YLAAM E2E signup ${randomUUID()}`;
  const result = await register(page, signup.email, password, name);
  // Inspect even on provider failure: signup inserts the user before sending mail.
  const stored = await inspectSignup(signup.email);
  console.log(`Signup audit: dedicated user created=${Boolean(stored)}; verification response accepted=${Boolean(result.result?.data?.verificationRequired)}; no verification attempted.`);
  expect(Boolean(stored), 'Signup must create the dedicated account').toBe(true);
  expect(stored?.user.full_name === name).toBe(true);
  expect(await securePassword(stored!.user.password_hash, password), 'Stored password must be bcrypt cost 10, match, and differ from plaintext').toBe(true);
  expect(stored!.user.email_verified_at === null, 'New user must remain unverified').toBe(true);
  if (result.error) throw new Error(`Signup rejected after submission (${result.error.data?.code || 'unknown'}); inspect email configuration. User may already exist; no automatic retry or cleanup.`);
  expect(result.result?.data?.verificationRequired === true).toBe(true);
  expect(stored!.codes.filter(code => code.purpose === 'verify_email').length).toBe(1);
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
  expect(await page.evaluate(() => !localStorage.getItem('ylaam_meet_token') && !localStorage.getItem('ylaam_meet_user'))).toBe(true);
  // STOP: no code entry, resend, email inbox access, or verification endpoint.
});
