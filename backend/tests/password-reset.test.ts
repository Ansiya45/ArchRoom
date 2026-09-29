import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
process.env.DOTENV_CONFIG_PATH = 'tests/.unused-reset-env';
process.env.DATABASE_URL = 'postgres://localhost/unused';
process.env.JWT_SECRET = randomUUID();
const { AuthService } = await import('../src/services/auth.service.js');
const { authRouter } = await import('../src/routers/auth.js');
const { db } = await import('../src/db/index.js');
const { hashPassword, verifyPassword } = await import('../src/utils/password.js');
const { signJwt, verifyJwt } = await import('../src/utils/jwt.js');

async function fixture(run: (f: any) => Promise<void>, options: { expired?: boolean; wrongPurpose?: boolean; fail?: boolean } = {}) {
  const oldPassword = `Aa1-${randomUUID()}`, newPassword = `Bb2-${randomUUID()}`;
  const user = { id: randomUUID(), email: `${randomUUID()}@example.invalid`, fullName: 'Reset Test', passwordHash: await hashPassword(oldPassword), emailVerifiedAt: new Date(), updatedAt: new Date() };
  const code = String(randomInt(100000, 1000000));
  let record: any = { id: randomUUID(), codeHash: createHash('sha256').update(code).digest('hex'), expiresAt: new Date(Date.now() + (options.expired ? -1000 : 600000)) };
  let updates = 0, fail = !!options.fail, tail = Promise.resolve();
  const original = { find: db.query.users.findFirst, transaction: db.transaction, fetch: globalThis.fetch };
  const dialect = new PgDialect();
  db.query.users.findFirst = (async () => ({ ...user })) as any;
  globalThis.fetch = async () => { throw new Error('No network allowed'); };
  db.transaction = ((callback: any) => {
    const result = tail.then(async () => {
      const previous = record && { ...record }, oldUser = { ...user };
      try { return await callback({
        query: { authCodes: { findFirst: async (query: any) => {
          const q = dialect.sqlToQuery(query.where);
          assert.ok(q.params.includes(user.id)); assert.ok(q.params.includes('reset_password'));
          return options.wrongPurpose ? null : record && { ...record };
        } } },
        delete: () => ({ where: (query: any) => ({ returning: async () => {
          const q = dialect.sqlToQuery(query);
          assert.ok(q.params.includes(record?.id)); assert.ok(q.params.includes(record?.codeHash));
          const cutoff = q.params.find(p => typeof p === 'string' && p.includes('T'));
          assert.ok(cutoff);
          if (!record || record.expiresAt <= new Date(cutoff as string)) return [];
          const id = record.id; record = null; return [{ id }];
        } }) }),
        update: () => ({ set: (patch: any) => ({ where: (query: any) => ({ returning: async () => {
          assert.ok(dialect.sqlToQuery(query).params.includes(user.id));
          if (fail) throw new Error('Simulated password update failure');
          Object.assign(user, patch); updates++; return [{ id: user.id }];
        } }) }) }),
      }); } catch (error) { record = previous; Object.assign(user, oldUser); throw error; }
    });
    tail = result.then(() => {}, () => {}); return result;
  }) as any;
  try { await run({ service: new AuthService(), caller: authRouter.createCaller({ user: null } as never), user, code, oldPassword, newPassword,
    state: () => ({ record, updates }), allowUpdate: () => { fail = false; } }); }
  finally { db.query.users.findFirst = original.find; db.transaction = original.transaction; globalThis.fetch = original.fetch; }
}

test('reset stores bcrypt, consumes code, rejects old password and accepts new password', () => fixture(async f => {
  await f.caller.resetPassword({ email: f.user.email, code: f.code, password: f.newPassword });
  assert.match(f.user.passwordHash, /^\$2[aby]\$10\$/);
  assert.notEqual(f.user.passwordHash, f.newPassword);
  assert.ok(await verifyPassword(f.newPassword, f.user.passwordHash));
  assert.equal(f.state().record, null);
  await assert.rejects(f.service.login({ email: f.user.email, password: f.oldPassword }), { code: 'UNAUTHORIZED' });
  assert.ok((await f.service.login({ email: f.user.email, password: f.newPassword })).token);
}));
test('password update failure restores reset code for a successful retry', () => fixture(async f => {
  const previous = f.user.passwordHash;
  await assert.rejects(f.caller.resetPassword({ email: f.user.email, code: f.code, password: f.newPassword }), /Simulated password update failure/);
  assert.ok(f.state().record); assert.equal(f.user.passwordHash, previous);
  f.allowUpdate(); await f.service.resetPassword(f.user.email, f.code, f.newPassword);
  assert.equal(f.state().record, null);
}, { fail: true }));
test('incorrect reset code preserves password and code', () => fixture(async f => {
  await assert.rejects(f.service.resetPassword(f.user.email, '000000', f.newPassword), { code: 'BAD_REQUEST' });
  assert.equal(f.state().updates, 0); assert.ok(f.state().record);
}));
for (const mode of ['expired', 'wrongPurpose'] as const) test(`${mode} reset credential rejected`, () => fixture(async f => {
  await assert.rejects(f.service.resetPassword(f.user.email, f.code, f.newPassword), { code: 'BAD_REQUEST' });
  assert.equal(f.state().updates, 0); assert.ok(f.state().record);
}, { [mode]: true }));
test('reset code replay rejected', () => fixture(async f => {
  await f.service.resetPassword(f.user.email, f.code, f.newPassword);
  await assert.rejects(f.service.resetPassword(f.user.email, f.code, f.newPassword), { code: 'BAD_REQUEST' });
  assert.equal(f.state().updates, 1);
}));
test('concurrent reset requests allow only one password update', () => fixture(async f => {
  const results = await Promise.allSettled([f.service.resetPassword(f.user.email, f.code, f.newPassword), f.service.resetPassword(f.user.email, f.code, f.oldPassword)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.state().updates, 1);
}));
test('existing JWT remains valid after reset under current stateless session design', () => fixture(async f => {
  const token = signJwt({ sub: f.user.id, email: f.user.email });
  await f.service.resetPassword(f.user.email, f.code, f.newPassword);
  assert.equal(verifyJwt(token).sub, f.user.id);
}));
for (const [label, password] of [['length', 'Abcdef1'], ['uppercase', 'abcdefg1'], ['lowercase', 'ABCDEFG1'], ['digit', 'Abcdefgh'], ['line break', 'Abcdef1\ng'], ['empty', '']]) {
  test(`reset API enforces ${label} password rule before service execution`, async () => {
    const original = AuthService.prototype.resetPassword; let called = false;
    AuthService.prototype.resetPassword = async () => { called = true; throw new Error('Must not run'); };
    try { await assert.rejects(authRouter.createCaller({ user: null } as never).resetPassword({ email: 'reset@example.invalid', code: '123456', password }), { code: 'BAD_REQUEST' }); assert.equal(called, false); }
    finally { AuthService.prototype.resetPassword = original; }
  });
}
for (const code of ['', '12345', 'abcdef', undefined]) test(`malformed reset code ${code === undefined ? 'missing' : code.length + (code === 'abcdef' ? ' letters' : ' digits')} rejected`, async () => {
  const original = AuthService.prototype.resetPassword; let called = false;
  AuthService.prototype.resetPassword = async () => { called = true; throw new Error('Must not run'); };
  try { await assert.rejects(authRouter.createCaller({ user: null } as never).resetPassword({ email: 'reset@example.invalid', code: code as string, password: 'Abcdefg1' }), { code: 'BAD_REQUEST' }); assert.equal(called, false); }
  finally { AuthService.prototype.resetPassword = original; }
});
