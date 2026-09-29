import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
process.env.DOTENV_CONFIG_PATH = 'tests/.unused';
process.env.DATABASE_URL = 'postgres://localhost/unused';
process.env.JWT_SECRET = 'isolated-cooldown-test';
const { AuthService } = await import('../src/services/auth.service.js');
const { db } = await import('../src/db/index.js');
const { env } = await import('../src/env.js');

async function fixture(run: (f: any) => Promise<void>, expectedPurpose = 'verify_email') {
  const originals = { transaction: db.transaction, fetch: globalThis.fetch, key: env.RESEND_API_KEY };
  let now = 1000000, sends = 0;
  let records: any[] = [];
  let tail = Promise.resolve();
  const dialect = new PgDialect();
  db.transaction = (async (callback: any) => {
    let unlock!: () => void;
    const previous = tail;
    tail = new Promise<void>(resolve => { unlock = resolve; });
    let locked = false, account = '', purpose = '';
    try {
      return await callback({
        execute: async (query: any) => {
          const q = dialect.sqlToQuery(query);
          if (q.sql.includes('for update')) {
            await previous; locked = true; account = String(q.params[0]);
            return [{ email_verified_at: null }];
          }
          assert.ok(locked, 'Cooldown query must run after the user row lock');
          assert.match(q.sql, /clock_timestamp\(\).*60 seconds/);
          assert.equal(q.params[0], account);
          purpose = String(q.params[1]);
          assert.equal(purpose, expectedPurpose);
          return records.filter(r => r.userId === account && r.purpose === purpose && r.createdAt > now - 60000);
        },
        delete: () => ({ where: async (query: any) => {
          assert.ok(locked);
          const q = dialect.sqlToQuery(query);
          assert.ok(q.params.includes(account) && q.params.includes(purpose));
          records = records.filter(r => r.userId !== account || r.purpose !== purpose);
        } }),
        insert: () => ({ values: async (value: any) => {
          assert.match(dialect.sqlToQuery(value.createdAt).sql, /clock_timestamp/);
          records.push({ ...value, createdAt: now });
        } }),
      });
    } finally { unlock(); }
  }) as any;
  env.RESEND_API_KEY = 'fake';
  globalThis.fetch = async () => { sends++; return new Response('{}'); };
  const service = new AuthService();
  Object.assign(service, { findUser: async (email: string) => ({ id: email, email, fullName: 'Test', emailVerifiedAt: null }) });
  try { await run({ resend: (email = 'a@example.invalid') => expectedPurpose === 'verify_email' ? service.resendVerification(email) : service.requestPasswordReset(email),
    advance: (ms: number) => { now += ms; }, sends: () => sends,
    seed: (userId: string, purpose: string) => records.push({ userId, purpose, createdAt: now }) });
  } finally { db.transaction = originals.transaction; globalThis.fetch = originals.fetch; env.RESEND_API_KEY = originals.key; }
}
test('first resend without a code is allowed', () => fixture(async f => { await f.resend(); assert.equal(f.sends(), 1); }));
test('resend before 60 seconds is rejected', () => fixture(async f => { await f.resend(); f.advance(59999); await assert.rejects(f.resend(), { code: 'TOO_MANY_REQUESTS' }); assert.equal(f.sends(), 1); }));
test('resend at 60 seconds is allowed', () => fixture(async f => { await f.resend(); f.advance(60000); await f.resend(); assert.equal(f.sends(), 2); }));
test('concurrent resends allow only one send', () => fixture(async f => { const results = await Promise.allSettled([f.resend(), f.resend(), f.resend()]); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.sends(), 1); for (const r of results) if (r.status === 'rejected') assert.equal(r.reason.code, 'TOO_MANY_REQUESTS'); }));
test('cooldown isolates account and purpose', () => fixture(async f => { f.seed('b@example.invalid', 'verify_email'); f.seed('a@example.invalid', 'reset_password'); await f.resend(); assert.equal(f.sends(), 1); }));

test('reset first request sends; cooldown returns identical response without another send', () => fixture(async f => {
  const first = await f.resend(); f.advance(59999);
  assert.deepEqual(await f.resend(), first); assert.equal(f.sends(), 1);
  f.advance(1); assert.deepEqual(await f.resend(), first); assert.equal(f.sends(), 2);
}, 'reset_password'));
test('concurrent reset requests send once and have indistinguishable responses', () => fixture(async f => {
  const replies = await Promise.all([f.resend(), f.resend(), f.resend()]);
  assert.deepEqual(replies[0], replies[1]); assert.deepEqual(replies[1], replies[2]); assert.equal(f.sends(), 1);
}, 'reset_password'));
test('reset cooldown isolates account and purpose', () => fixture(async f => {
  f.seed('b@example.invalid', 'reset_password'); f.seed('a@example.invalid', 'verify_email');
  await f.resend(); assert.equal(f.sends(), 1);
}, 'reset_password'));
