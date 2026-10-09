import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Never fall back to .env or a developer/production database.
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL must identify a disposable local archroom_auth_test database.');
const target = new URL(databaseUrl);
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.pathname !== '/archroom_auth_test') {
  throw new Error('Integration tests require a disposable local database named archroom_auth_test.');
}
process.env.DOTENV_CONFIG_PATH = 'tests/.unused';
process.env.DATABASE_URL = databaseUrl;
process.env.JWT_SECRET = 'integration-test-secret';
process.env.RESEND_API_KEY = 'test-email-provider';
const { migrateDatabase } = await import('../../src/db/migrate.js');
const { assertDatabaseReady, migrationsFolder } = await import('../../src/db/readiness.js');
const { client } = await import('../../src/db/index.js');
const { authRouter } = await import('../../src/routers/auth.js');

test('real database upgrade and authentication lifecycle', { timeout: 120000 }, async () => {
  const originalFetch = globalThis.fetch;
  const folder = await mkdtemp(join(tmpdir(), 'archroom-migrations-'));
  let code = '';
  globalThis.fetch = (async (_url, options) => {
    const payload = JSON.parse(String(options?.body));
    code = payload.html.match(/\b\d{6}\b/)?.[0] ?? '';
    assert.match(code, /^\d{6}$/);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    const [existing] = await client`select to_regclass('public.users') as users`;
    assert.equal(existing.users, null, 'Use a fresh disposable database for each run.');
    await assert.rejects(assertDatabaseReady());

    // Simulate the previous release, then upgrade with two concurrent replicas.
    const journal = JSON.parse(await readFile(join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
    journal.entries.pop();
    await mkdir(join(folder, 'meta'));
    await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries) await copyFile(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    await migrateDatabase(databaseUrl, folder);
    await assert.rejects(assertDatabaseReady(), /migrations/);
    await Promise.all([migrateDatabase(databaseUrl), migrateDatabase(databaseUrl)]);
    await assertDatabaseReady();
    await migrateDatabase(databaseUrl); // Repeated releases must be safe.

    // A failed release must leave both the schema and journal unchanged.
    const completeJournal = JSON.parse(await readFile(join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
    const last = completeJournal.entries.at(-1);
    await copyFile(join(migrationsFolder, `${last.tag}.sql`), join(folder, `${last.tag}.sql`));
    completeJournal.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1, tag: 'test_failure' });
    await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(completeJournal));
    await writeFile(join(folder, 'test_failure.sql'), 'CREATE TABLE migration_should_rollback (id integer);\n--> statement-breakpoint\nSELECT * FROM deliberately_missing_relation;');
    await assert.rejects(migrateDatabase(databaseUrl, folder));
    const [rolledBack] = await client`select to_regclass('migration_should_rollback') as artifact`;
    assert.equal(rolledBack.artifact, null);
    const [journalCount] = await client`select count(*)::integer as count from drizzle.__drizzle_migrations`;
    assert.equal(journalCount.count, completeJournal.entries.length - 1);
    await assertDatabaseReady();

    const caller = authRouter.createCaller({ user: null } as never);
    const email = 'auth-integration@example.invalid';
    const password = 'IntegrationPass123';
    await caller.signup({ fullName: 'Integration test', email, password });
    await assert.rejects(caller.login({ email, password }), { code: 'FORBIDDEN' });
    await assert.rejects(caller.signup({ fullName: 'Duplicate', email, password }), { code: 'CONFLICT' });
    const verificationCode = code;
    const session = await caller.verifyEmail({ email, code: verificationCode });
    assert.ok(session.refreshToken);
    await assert.rejects(caller.verifyEmail({ email, code: verificationCode }), { code: 'BAD_REQUEST' });
    await assert.rejects(caller.login({ email, password: 'Wrong123' }), { code: 'UNAUTHORIZED' });
    const login = await caller.login({ email, password });
    assert.ok((await caller.refresh({ refreshToken: login.refreshToken })).token);
    await caller.logout({ refreshToken: login.refreshToken });
    await assert.rejects(caller.refresh({ refreshToken: login.refreshToken }), { code: 'UNAUTHORIZED' });
    await caller.requestPasswordReset({ email });
    const resetCode = code;
    await caller.resetPassword({ email, code: resetCode, password: 'NewIntegration123' });
    await assert.rejects(caller.resetPassword({ email, code: resetCode, password }), { code: 'BAD_REQUEST' });
    await assert.rejects(caller.refresh({ refreshToken: session.refreshToken }), { code: 'UNAUTHORIZED' });
    assert.ok((await caller.login({ email, password: 'NewIntegration123' })).token);

    // Catch schema drift even when the migration journal says everything ran.
    await client`alter table auth_sessions rename to auth_sessions_missing`;
    try { await assert.rejects(assertDatabaseReady()); }
    finally { await client`alter table auth_sessions_missing rename to auth_sessions`; }
    await assertDatabaseReady();
  } finally {
    globalThis.fetch = originalFetch;
    await client.end({ timeout: 5 });
    await rm(folder, { recursive: true, force: true });
  }
});
