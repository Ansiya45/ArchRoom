import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';

process.env.DOTENV_CONFIG_PATH = 'tests/.nonexistent-auth-verification-env';
process.env.DATABASE_URL = 'postgres://localhost:5432/unused';
process.env.JWT_SECRET = randomUUID();
const { AuthService } = await import('../src/services/auth.service.js');
const { authRouter } = await import('../src/routers/auth.js');
const { db } = await import('../src/db/index.js');
const { verifyJwt } = await import('../src/utils/jwt.js');

async function fixture(run: (f: any) => Promise<void>, options: { verified?: boolean; expired?: boolean; updateFails?: boolean; expiresDuringConsume?: boolean } = {}) {
  const code = String(randomInt(100000, 1000000));
  const account = { id: randomUUID(), email: `${randomUUID()}@example.invalid`, fullName: 'Verification test', passwordHash: 'test-password-hash', emailVerifiedAt: options.verified ? new Date() : null };
  let record: any = { id: randomUUID(), userId: account.id, purpose: 'verify_email', codeHash: createHash('sha256').update(code).digest('hex'),
    expiresAt: new Date(Date.now() + (options.expired ? -60000 : 60000)), createdAt: new Date() };
  let updates = 0, consumed = 0;
  const originals = { find: db.query.users.findFirst, insert: db.insert, transaction: db.transaction, fetch: globalThis.fetch };
  let issuedSessions = 0;
  db.insert = (() => ({ values: () => ({ returning: async () => {
    issuedSessions++;
    return [{ id: randomUUID() }];
  } }) })) as any;
  const dialect = new PgDialect();
  db.query.users.findFirst = (async () => ({ ...account })) as any;
  globalThis.fetch = async () => { throw new Error('Network is forbidden in verification tests'); };
  const tx = {
    query: { authCodes: { findFirst: async (query: any) => {
      const sql = dialect.sqlToQuery(query.where);
      assert.ok(sql.params.includes(account.id));
      assert.ok(sql.params.includes('verify_email'));
      return record && { ...record };
    } } },
    delete: () => ({ where: (condition: any) => ({ returning: async () => {
      if (!record) return [];
      const sql = dialect.sqlToQuery(condition);
      assert.ok(sql.params.includes(record.id));
      assert.ok(sql.params.includes(record.codeHash));
      // Exercise the expiry guard in the consuming DELETE, including races.
      const cutoff = sql.params.find(value => typeof value === 'string' && value.includes('T'));
      assert.ok(cutoff, 'DELETE must include an expiry cutoff');
      if (options.expiresDuringConsume || record.expiresAt <= new Date(cutoff as string)) return [];
      const id = record.id; record = null; consumed++;
      return [{ id }];
    } }) }),
    update: () => ({ set: (patch: any) => ({ where: async () => {
      if (options.updateFails) throw new Error('Simulated update failure');
      account.emailVerifiedAt = patch.emailVerifiedAt; updates++;
    } }) }),
  };
  let tail = Promise.resolve();
  db.transaction = ((callback: any) => {
    const result = tail.then(async () => {
      const before = record && { ...record };
      try { return await callback(tx); } catch (error) { record = before; throw error; }
    });
    tail = result.then(() => {}, () => {});
    return result;
  }) as any;
  try {
    await run({ service: new AuthService(), caller: authRouter.createCaller({ user: null } as never), account, code,
      wrongCode: String(Number(code) === 999999 ? 100000 : Number(code) + 1),
      state: () => ({ record, updates, consumed, issuedSessions }) });
  } finally {
    db.query.users.findFirst = originals.find;
    db.transaction = originals.transaction;
    db.insert = originals.insert;
    globalThis.fetch = originals.fetch;
  }
}

test('valid verification code activates the account and returns its signed session', () => fixture(async f => {
  const result = await f.caller.verifyEmail({ email: f.account.email, code: f.code });
  assert.equal(verifyJwt(result.token).sub, f.account.id);
  assert.ok(verifyJwt(result.token).sid);
  assert.match(result.refreshToken, /^[a-f0-9]{64}$/);
  assert.equal(f.state().issuedSessions, 1);
  assert.ok(f.account.emailVerifiedAt);
  assert.equal(f.state().record, null);
  assert.equal(f.state().updates, 1);
}));

test('invalid verification code cannot activate an account or consume its code', () => fixture(async f => {
  await assert.rejects(f.service.verifyEmail(f.account.email, f.wrongCode), { code: 'BAD_REQUEST' });
  assert.equal(f.state().updates, 0);
  assert.ok(f.state().record);
}));

test('expired verification code cannot create a session', () => fixture(async f => {
  await assert.rejects(f.service.verifyEmail(f.account.email, f.code), { code: 'BAD_REQUEST' });
  assert.equal(f.state().updates, 0);
}, { expired: true }));

test('already-verified account cannot obtain a session with an invalid code', () => fixture(async f => {
  await assert.rejects(f.caller.verifyEmail({ email: f.account.email, code: f.wrongCode }), { code: 'BAD_REQUEST' });
  assert.equal(f.state().updates, 0);
}, { verified: true }));

test('already-verified account must sign in even if a leftover code matches', () => fixture(async f => {
  await assert.rejects(f.service.verifyEmail(f.account.email, f.code), { code: 'BAD_REQUEST' });
}, { verified: true }));

test('missing and empty codes fail both router and service for verified accounts', () => fixture(async f => {
  for (const code of [undefined, '']) {
    await assert.rejects(f.caller.verifyEmail({ email: f.account.email, code }), { code: 'BAD_REQUEST' });
    await assert.rejects(f.service.verifyEmail(f.account.email, code), { code: 'BAD_REQUEST' });
  }
  assert.equal(f.state().updates, 0);
}, { verified: true }));

test('a consumed verification code cannot be replayed', () => fixture(async f => {
  await f.service.verifyEmail(f.account.email, f.code);
  await assert.rejects(f.service.verifyEmail(f.account.email, f.code), { code: 'BAD_REQUEST' });
  assert.equal(f.state().consumed, 1);
  assert.equal(f.state().issuedSessions, 1);
}));

test('two simultaneous verifications issue only one session', () => fixture(async f => {
  const results = await Promise.allSettled([f.service.verifyEmail(f.account.email, f.code), f.service.verifyEmail(f.account.email, f.code)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal(f.state().consumed, 1);
  assert.equal(f.state().issuedSessions, 1);
}));

test('a code expiring between lookup and consumption is rejected', () => fixture(async f => {
  await assert.rejects(f.service.verifyEmail(f.account.email, f.code), { code: 'BAD_REQUEST' });
  assert.equal(f.state().updates, 0);
}, { expiresDuringConsume: true }));

test('failed account activation rolls back code consumption and issues no session', () => fixture(async f => {
  await assert.rejects(f.service.verifyEmail(f.account.email, f.code), /Simulated update failure/);
  assert.ok(f.state().record);
  assert.equal(f.state().issuedSessions, 0);
}, { updateFails: true }));
