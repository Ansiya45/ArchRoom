import assert from 'node:assert/strict';
import { test } from 'node:test';

// These tests use fake accounts and never connect to a database or send email.
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'auth-test-secret';
const { AuthService } = await import('../src/services/auth.service.js');
const { hashPassword } = await import('../src/utils/password.js');
const { authRouter } = await import('../src/routers/auth.js');
const { db } = await import('../src/db/index.js');
const { env } = await import('../src/env.js');

const user = {
  id: 'test-user', email: 'member@example.com', fullName: 'Test Member',
  passwordHash: await hashPassword('CorrectPassword1'),
  emailVerifiedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
};

function serviceFor(account: typeof user | undefined = user) {
  const service = new AuthService();
  const sent: Array<{ email: string; purpose: string }> = [];
  Object.assign(service, {
    findUser: async (email: string) => email === account?.email ? account : undefined,
    sendCode: async (recipient: typeof user, purpose: string) => { sent.push({ email: recipient.email, purpose }); },
  });
  return { service, sent };
}

test('login distinguishes wrong passwords from unregistered emails', async () => {
  const { service } = serviceFor();
  await assert.rejects(service.login({ email: user.email, password: 'bad' }), { code: 'UNAUTHORIZED', message: 'Wrong password. Please try again.' });
  await assert.rejects(service.login({ email: 'missing@example.com', password: 'bad' }), { code: 'NOT_FOUND', message: 'Email ID is not registered.' });
  const result = await service.login({ email: ' MEMBER@example.com ', password: 'CorrectPassword1' });
  assert.equal(result.user.email, user.email);
  assert.ok(result.token);
});

test('unverified login checks password before requiring verification and sends no email', async () => {
  const { service, sent } = serviceFor({ ...user, emailVerifiedAt: null } as unknown as typeof user);
  await assert.rejects(service.login({ email: user.email, password: 'bad' }), { code: 'UNAUTHORIZED' });
  await assert.rejects(service.login({ email: user.email, password: 'CorrectPassword1' }), {
    code: 'FORBIDDEN', message: 'Your registration is incomplete. Complete the email verification from sign up before logging in.',
  });
  assert.deepEqual(sent, []);
});

test('login router accepts short incorrect passwords so users get the password error', async () => {
  const original = db.query.users.findFirst;
  db.query.users.findFirst = (async () => user) as typeof original;
  try {
    const caller = authRouter.createCaller({ user: null } as never);
    await assert.rejects(caller.login({ email: user.email, password: 'bad' }), { message: 'Wrong password. Please try again.' });
  } finally { db.query.users.findFirst = original; }
});

test('password reset sends only to the registered normalized email', async () => {
  const { service, sent } = serviceFor();
  const result = await service.requestPasswordReset(' MEMBER@example.com ');
  assert.match(result.message, /^If an account exists/);
  assert.deepEqual(sent, [{ email: user.email, purpose: 'reset_password' }]);
  assert.deepEqual(await service.requestPasswordReset('missing@example.com'), result);
  assert.equal(sent.length, 1);
});

test('verification resend sends a verification code to an unverified account', async () => {
  const { service, sent } = serviceFor({ ...user, emailVerifiedAt: null } as unknown as typeof user);
  const result = await service.resendVerification(' MEMBER@example.com ');
  assert.equal(result.ok, true);
  assert.deepEqual(sent, [{ email: user.email, purpose: 'verify_email' }]);
});

test('verification resend rejects missing or already verified accounts without sending', async () => {
  const { service, sent } = serviceFor();
  await assert.rejects(service.resendVerification(user.email), { message: 'This email is already verified. Please sign in.' });
  await assert.rejects(service.resendVerification('missing@example.com'), { message: 'Email ID is not registered.' });
  assert.equal(sent.length, 0);
});

test('reset response hides provider failure while verification resend reports it', async () => {
  const { service } = serviceFor({ ...user, emailVerifiedAt: null } as unknown as typeof user);
  Object.assign(service, { sendCode: async () => { throw new Error('Email delivery failed'); } });
  assert.match((await service.requestPasswordReset(user.email)).message, /^If an account exists/);
  await assert.rejects(service.resendVerification(user.email), { message: 'Email delivery failed' });
});

test('resend replaces the code on success and preserves it when the email provider fails', async () => {
  const originalTransaction = db.transaction;
  const originalFetch = globalThis.fetch;
  const originalKey = env.RESEND_API_KEY;
  let codes: Array<{ codeHash: string; expiresAt: Date }> = [{ codeHash: 'previous-code', expiresAt: new Date(Date.now() + 600000) }];
  const tx = {
    execute: async (query: unknown) => {
      const { PgDialect } = await import('drizzle-orm/pg-core');
      return new PgDialect().sqlToQuery(query as any).sql.includes('for update') ? [{ email_verified_at: null }] : [];
    },
    delete: () => ({ where: async () => { codes = []; } }),
    insert: () => ({ values: async (value: typeof codes[number]) => { codes.push(value); } }),
  };
  db.transaction = (async (callback: (transaction: typeof tx) => Promise<void>) => {
    const previous = [...codes];
    try { return await callback(tx); } catch (error) { codes = previous; throw error; }
  }) as typeof originalTransaction;
  env.RESEND_API_KEY = 'fake-test-key';
  const service = new AuthService();
  Object.assign(service, { findUser: async () => ({ ...user, emailVerifiedAt: null }) });
  try {
    globalThis.fetch = async () => new Response('Test provider failure', { status: 500 });
    await assert.rejects(service.resendVerification(user.email), /Unable to send email/);
    assert.equal(codes[0].codeHash, 'previous-code');
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options!.body as string);
      assert.deepEqual(body.to, [user.email]);
      assert.match(body.subject, /Verify/);
      assert.match(body.html, />\d{6}</);
      return new Response(JSON.stringify({ id: 'fake-email-id' }), { status: 200 });
    };
    await service.resendVerification(user.email);
    assert.equal(codes.length, 1);
    assert.notEqual(codes[0].codeHash, 'previous-code');
    assert.ok(codes[0].expiresAt.getTime() > Date.now());
  } finally {
    db.transaction = originalTransaction;
    globalThis.fetch = originalFetch;
    env.RESEND_API_KEY = originalKey;
  }
});
