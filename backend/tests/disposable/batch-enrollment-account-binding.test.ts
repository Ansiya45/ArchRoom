import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import postgres from 'postgres';

const url = 'postgres://ylaam_test_admin@127.0.0.1:55459/ylaam_staging_disposable_binding_6c';
test('account binding on an isolated disposable PostgreSQL database', { timeout: 120000 }, async t => {
  if (process.env.DATABASE_URL !== url || process.env.NODE_ENV !== 'test' || process.env.DOTENV_CONFIG_PATH !== 'tests/.unused') throw new Error('Unsafe test environment');
  console.log('Disposable PostgreSQL target: host=127.0.0.1 port=55459 database=ylaam_staging_disposable_binding_6c');
  const sql = postgres(url, { max: 3 });
  try {
    const [target] = await sql`select current_database() as name,current_setting('data_directory') as directory,inet_server_addr()::text as host,inet_server_port() as port`;
    assert.equal(target.name, 'ylaam_staging_disposable_binding_6c'); assert.equal(target.host, '127.0.0.1/32'); assert.equal(target.port, 55459);
    assert.equal(target.directory.replaceAll('\\', '/').toLowerCase(), 'd:/development/archroom/.codex-pg-enrollment-binding');
    const [empty] = await sql`select to_regclass('public.users') as users`; assert.equal(empty.users, null);
    const { migrateDatabase } = await import('../../src/db/migrate.js');
    await migrateDatabase(url); await migrateDatabase(url);
    const { client } = await import('../../src/db/index.js');
    const { BatchRegistrationService } = await import('../../src/services/batch-registration.service.js');
    const { batchRegistrationRouter } = await import('../../src/routers/batch-registration.js');
    const admin = randomUUID(), student = randomUUID(), other = randomUUID(), unverified = randomUUID();
    const messages: {to:string; html:string}[] = [];
    const service = new BatchRegistrationService(admin, 'http://localhost:5174', 'test-only-rate-key', async mail => { messages.push(mail); });
    const realFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('External network forbidden'); };
    try {
      await sql`insert into users(id,email,password_hash,full_name,email_verified_at) values
        (${admin},'admin@example.invalid','test','Admin',now()),(${student},'student@example.invalid','test','Student',now()),
        (${other},'other@example.invalid','test','Other',now()),(${unverified},'unverified@example.invalid','test','Unverified',null)`;
      await sql`insert into recording_batch_folders(folder_id,name,created_by_user_id) values ('bindingBatchA1','A',${admin}),('bindingBatchB2','B',${admin})`;
      const a = new URL((await service.generate('bindingBatchA1', admin, 7)).registrationUrl).hash.slice(1);
      const b = new URL((await service.generate('bindingBatchB2', admin, 7)).registrationUrl).hash.slice(1);
      const issue = async (link: string, email: string, address: string) => {
        await service.register(link, 'Student', email, address);
        const html = messages.at(-1)!.html;
        return new URL(html.match(/href="([^"]+)"/)![1]).hash.slice(1);
      };
      await t.test('authenticated email token binds the correct account without approval and rejects replay', async () => {
        const token = await issue(a, 'student@example.invalid', 'issue1');
        await assert.rejects(service.verifyAndBind(token, other, 'other'));
        const [before] = await sql`select consumed_at from batch_registration_verifications where enrollment_id=(select id from batch_student_enrollments where folder_id='bindingBatchA1' and student_email='student@example.invalid')`;
        assert.equal(before.consumed_at, null);
        assert.deepEqual(await service.verifyAndBind(token, student, 'student'), { bound: true, approvalRequired: true });
        await assert.rejects(service.verifyAndBind(token, student, 'replay'));
        const [row] = await sql`select e.status,e.email_verified_at,b.user_id from batch_student_enrollments e join batch_enrollment_account_bindings b on b.enrollment_id=e.id where e.folder_id='bindingBatchA1'`;
        assert.equal(row.user_id, student); assert.equal(row.status, 'pending'); assert.ok(row.email_verified_at);
      });
      await t.test('same verified student binds a second batch using a separate proof', async () => {
        const token = await issue(b, 'student@example.invalid', 'issue2');
        await service.verifyAndBind(token, student, 'student2');
        const [count] = await sql`select count(*)::int as n from batch_enrollment_account_bindings where user_id=${student}`;
        assert.equal(count.n, 2);
      });
      await t.test('unverified account, expired proof and anonymous caller cannot bind', async () => {
        const token = await issue(a, 'unverified@example.invalid', 'issue3');
        await assert.rejects(service.verifyAndBind(token, unverified, 'unverified'));
        await sql`update batch_registration_verifications set expires_at=now()-interval '1 second' where enrollment_id=(select id from batch_student_enrollments where student_email='unverified@example.invalid')`;
        await sql`update users set email_verified_at=now() where id=${unverified}`;
        await assert.rejects(service.verifyAndBind(token, unverified, 'expired'));
        const caller = batchRegistrationRouter.createCaller({ req: {} as never, res: {} as never, isAuthenticated: false, user: null, jwtSecret: 'test' });
        await assert.rejects(caller.verifyAndBind({ token }), { code: 'UNAUTHORIZED' });
      });
      await t.test('concurrent attempts consume proof only once', async () => {
        const token = await issue(a, 'other@example.invalid', 'issue4');
        const results = await Promise.allSettled([service.verifyAndBind(token, other, 'race1'), service.verifyAndBind(token, other, 'race2')]);
        assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
      });
    } finally { globalThis.fetch = realFetch; await client.end({ timeout: 5 }); }
  } finally { await sql.end({ timeout: 5 }); }
});
