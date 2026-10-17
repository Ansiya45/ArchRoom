import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { randomUUID } from 'node:crypto';
process.env.DOTENV_CONFIG_PATH = 'tests/.unused';
process.env.DATABASE_URL = 'postgres://localhost/unused';
process.env.JWT_SECRET = 'isolated-cooldown-test';
const { AuthService } = await import('../src/services/auth.service.js');
const { db } = await import('../src/db/index.js');
const { env } = await import('../src/env.js');

async function fixture(run: (f: any) => Promise<void>, expectedPurpose = 'verify_email') {
  const originals = { transaction: db.transaction, fetch: globalThis.fetch, key: env.RESEND_API_KEY };
  let now = 1000000, sends = 0, committed = false, failDelivery = false;
  let deliveryGate: Promise<void> | undefined;
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
        select: () => ({ from: () => ({ where: async () => records.filter(r => r.userId === account && r.purpose === purpose).map(r => ({ ...r })) }) }),
        delete: () => ({ where: (query: any) => {
          assert.ok(locked);
          const q = dialect.sqlToQuery(query);
          const remove = () => {
            const matches = records.filter(r => q.params.includes(r.userId) && q.params.includes(r.purpose) && (!q.sql.includes('"id"') || q.params.includes(r.id)));
            records = records.filter(r => !matches.includes(r));
            return matches.map(r => ({ id: r.id }));
          };
          return { then: (resolve: any, reject: any) => Promise.resolve(remove()).then(resolve, reject), returning: async () => remove() };
        } }),
        insert: () => ({ values: (value: any) => {
          const insert = () => {
            const items = Array.isArray(value) ? value : [value];
            const inserted = items.map(item => ({ ...item, id: item.id || randomUUID(), createdAt: typeof item.createdAt === 'number' ? item.createdAt : now }));
            records.push(...inserted);
            return inserted.map(item => ({ id: item.id }));
          };
          return { then: (resolve: any, reject: any) => Promise.resolve(insert()).then(resolve, reject), returning: async () => insert() };
        } }),
      });
    } finally { if (locked && records.some(r => r.userId === account)) committed = true; unlock(); }
  }) as any;
  env.RESEND_API_KEY = 'fake';
  globalThis.fetch = async () => { assert.equal(committed, true, 'Email must be sent after the transaction closes'); sends++; const gate = deliveryGate; if (gate) await gate; return new Response('{}', { status: failDelivery ? 500 : 200 }); };
  const service = new AuthService();
  Object.assign(service, { findUser: async (email: string) => ({ id: email, email, fullName: 'Test', emailVerifiedAt: null }) });
  try { await run({ resend: (email = 'a@example.invalid') => expectedPurpose === 'verify_email' ? service.resendVerification(email) : service.requestPasswordReset(email),
    advance: (ms: number) => { now += ms; }, sends: () => sends,
    seed: (userId: string, purpose: string) => records.push({ id: randomUUID(), userId, purpose, createdAt: now }),
    records: () => records.map(r => ({ ...r })), fail: (value: boolean) => { failDelivery = value; },
    hold: (gate: Promise<void> | undefined) => { deliveryGate = gate; } });
  } finally { db.transaction = originals.transaction; globalThis.fetch = originals.fetch; env.RESEND_API_KEY = originals.key; }
}
test('first resend without a code is allowed', () => fixture(async f => { await f.resend(); assert.equal(f.sends(), 1); }));
test('delivery failure restores the previous code and permits a retry', () => fixture(async f => {
  await f.resend();
  const previous = f.records();
  f.advance(60000); f.fail(true);
  await assert.rejects(f.resend(), { code: 'INTERNAL_SERVER_ERROR' });
  assert.deepEqual(f.records(), previous);
  f.fail(false);
  await f.resend();
  assert.equal(f.sends(), 3);
  assert.notEqual(f.records()[0].id, previous[0].id);
}));
test('delivery failure without a prior code allows an immediate retry', () => fixture(async f => {
  f.fail(true); await assert.rejects(f.resend(), { code: 'INTERNAL_SERVER_ERROR' });
  assert.deepEqual(f.records(), []);
  f.fail(false); await f.resend(); assert.equal(f.sends(), 2);
}));
test('resend before 60 seconds is rejected', () => fixture(async f => { await f.resend(); f.advance(59999); await assert.rejects(f.resend(), { code: 'TOO_MANY_REQUESTS' }); assert.equal(f.sends(), 1); }));
test('resend at 60 seconds is allowed', () => fixture(async f => { await f.resend(); f.advance(60000); await f.resend(); assert.equal(f.sends(), 2); }));
test('concurrent resends allow only one send', () => fixture(async f => { const results = await Promise.allSettled([f.resend(), f.resend(), f.resend()]); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.sends(), 1); for (const r of results) if (r.status === 'rejected') assert.equal(r.reason.code, 'TOO_MANY_REQUESTS'); }));
test('a pending email does not prevent another account from requesting a code', () => fixture(async f => {
  let release!: () => void;
  f.hold(new Promise<void>(resolve => { release = resolve; }));
  const pending = f.resend();
  try {
    while (!f.sends()) await new Promise(resolve => setImmediate(resolve));
    f.hold(undefined);
    await f.resend('b@example.invalid');
    assert.equal(f.sends(), 2);
  } finally { release(); await pending; }
}));
test('a late delivery failure cannot remove a newer code', () => fixture(async f => {
  let release!: () => void;
  f.hold(new Promise<void>(resolve => { release = resolve; }));
  const pending = f.resend();
  try {
    while (!f.sends()) await new Promise(resolve => setImmediate(resolve));
    f.advance(60000); f.hold(undefined);
    await f.resend();
    const newer = f.records();
    f.fail(true); release();
    await assert.rejects(pending, { code: 'INTERNAL_SERVER_ERROR' });
    assert.deepEqual(f.records(), newer);
  } finally { release(); await pending.catch(() => {}); }
}));
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
