import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
process.env.DOTENV_CONFIG_PATH = 'tests/.unused';
process.env.DATABASE_URL = 'postgres://localhost/unused';
process.env.JWT_SECRET = 'persistent-session-test-secret';
const { db } = await import('../src/db/index.js');
const { env } = await import('../src/env.js');
const { createPersistentSession, refreshSession, revokeSession, isSessionActive } = await import('../src/services/auth-session.service.js');
const { signJwt, verifyJwt } = await import('../src/utils/jwt.js');
const { createContext } = await import('../src/trpc/context.js');

async function fixture(run: (f: any) => Promise<void>) {
  const user = { id: randomUUID(), email: 'test@example.invalid', fullName: 'Test', passwordHash: 'password-hash', emailVerifiedAt: new Date() };
  const sessions = new Map<string, any>();
  const original = { insert: db.insert, delete: db.delete, session: db.query.authSessions.findFirst, user: db.query.users.findFirst };
  const dialect = new PgDialect();
  db.insert = (() => ({ values: (value: any) => ({ returning: async () => {
    const id = randomUUID(); sessions.set(id, { id, ...value }); return [{ id }];
  } }) })) as any;
  db.query.authSessions.findFirst = (async (query: any) => {
    const params = dialect.sqlToQuery(query.where).params;
    return [...sessions.values()].find(s => params.includes(s.id) || params.includes(s.tokenHash));
  }) as any;
  db.query.users.findFirst = (async () => user) as any;
  db.delete = (() => ({ where: async (where: any) => {
    const params = dialect.sqlToQuery(where).params;
    for (const [id, session] of sessions) if (params.includes(session.tokenHash)) sessions.delete(id);
  } })) as any;
  try { await run({ user, sessions }); }
  finally {
    db.insert = original.insert; db.delete = original.delete;
    db.query.authSessions.findFirst = original.session; db.query.users.findFirst = original.user;
  }
}

test('device credential is stored hashed and renews an expired access token', () => fixture(async ({ user, sessions }) => {
  const device = await createPersistentSession(user);
  assert.match(device.refreshToken, /^[a-f0-9]{64}$/);
  assert.equal(sessions.get(device.sessionId).tokenHash, createHash('sha256').update(device.refreshToken).digest('hex'));
  assert.ok(!JSON.stringify([...sessions.values()]).includes(device.refreshToken));
  const expiry = env.JWT_EXPIRES_IN;
  let expired: string;
  try { env.JWT_EXPIRES_IN = '-1s'; expired = signJwt({ sub: user.id, email: user.email, sid: device.sessionId }); }
  finally { env.JWT_EXPIRES_IN = expiry; }
  assert.throws(() => verifyJwt(expired), /expired/);
  const renewed = await refreshSession(device.refreshToken);
  assert.equal(verifyJwt(renewed.token).sid, device.sessionId);
  assert.equal(await isSessionActive(verifyJwt(renewed.token)), true);
}));

test('logout revokes both renewal and access for that device while preserving another device', () => fixture(async ({ user }) => {
  const first = await createPersistentSession(user), second = await createPersistentSession(user);
  const access = await refreshSession(first.refreshToken);
  await revokeSession(first.refreshToken);
  await revokeSession(first.refreshToken);
  await assert.rejects(refreshSession(first.refreshToken), { code: 'UNAUTHORIZED' });
  assert.equal(await isSessionActive(verifyJwt(access.token)), false);
  assert.ok((await refreshSession(second.refreshToken)).token);
}));

test('password changes revoke existing sessions and unknown credentials fail', () => fixture(async ({ user }) => {
  const device = await createPersistentSession(user);
  const access = await refreshSession(device.refreshToken);
  await assert.rejects(refreshSession('0'.repeat(64)), { code: 'UNAUTHORIZED' });
  user.passwordHash = 'changed-password-hash';
  await assert.rejects(refreshSession(device.refreshToken), { code: 'UNAUTHORIZED' });
  assert.equal(await isSessionActive(verifyJwt(access.token)), false);
}));

test('database outages are server errors rather than invalid authentication', () => fixture(async ({ user }) => {
  const device = await createPersistentSession(user);
  const access = await refreshSession(device.refreshToken);
  db.query.authSessions.findFirst = (async () => { throw new Error('Database unavailable'); }) as any;
  await assert.rejects(createContext({ req: { headers: { authorization: `Bearer ${access.token}` } }, res: {} } as any), /Database unavailable/);
}));
