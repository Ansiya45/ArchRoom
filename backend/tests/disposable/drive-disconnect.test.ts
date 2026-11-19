// This test is deliberately restricted to the disposable cluster named below.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import postgres from 'postgres';

const url = 'postgres://ylaam_test_admin@127.0.0.1:55439/ylaam_disconnect_test_0016';
const expectedDataDirectory = 'D:/Development/ArchRoom/.codex-pg-disconnect-test-0016';
const migrationCopy = 'D:/Development/ArchRoom/.codex-pg-disconnect-migrations-0016';
const admin = '11111111-1111-4111-8111-111111111111';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

test('migration 0016 and Drive credential races on isolated PostgreSQL', async () => {
  if (process.env.DATABASE_URL !== url || process.env.NODE_ENV !== 'test' || process.env.DOTENV_CONFIG_PATH !== 'tests/.unused') throw new Error('Refusing unsafe test environment.');
  const target = new URL(url);
  assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, '55439'); assert.equal(target.pathname, '/ylaam_disconnect_test_0016');
  console.log(`Disposable PostgreSQL target: host=${target.hostname} port=${target.port} database=${target.pathname.slice(1)}`);
  const sql = postgres(url, { max: 1, connect_timeout: 5 });
  const observer = postgres(url, { max: 1, connect_timeout: 5 });
  try {
    const [identity] = await sql`select current_database() as name, current_setting('data_directory') as data_directory, inet_server_addr()::text as host, inet_server_port() as port`;
    assert.equal(identity.name, 'ylaam_disconnect_test_0016');
    assert.equal(identity.data_directory.replaceAll('\\', '/').toLowerCase(), expectedDataDirectory.toLowerCase());
    assert.equal(identity.host, '127.0.0.1/32'); assert.equal(identity.port, 55439);
    const [empty] = await sql`select to_regclass('public.users') as users`;
    assert.equal(empty.users, null, 'Refusing a database that is not new and empty.');
    const original = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8'));
    assert.equal(original.entries.length, 22); assert.equal(original.entries[16].tag, '0016_drive_credential_generation');
    assert.equal(original.entries[17].tag, '0017_company_recording_upload_jobs');
    assert.ok(original.entries.every((entry: { when: number }, index: number) => index === 0 || entry.when > original.entries[index - 1].when));
    await mkdir(migrationCopy);
    await mkdir(resolve(migrationCopy, 'meta'));
    for (const entry of original.entries.slice(0, 16)) await copyFile(`drizzle/${entry.tag}.sql`, `${migrationCopy}/${entry.tag}.sql`);
    await writeFile(`${migrationCopy}/meta/_journal.json`, JSON.stringify({ ...original, entries: original.entries.slice(0, 16) }));
    const { migrateDatabase } = await import('../../src/db/migrate.js');
    const { databaseIntegrationCredentialRepository, IntegrationCredentialService, encryptRefreshToken } = await import('../../src/services/drive-security.service.js');
    const { client } = await import('../../src/db/index.js');
    const { GoogleDriveOAuthService, OAuthFlowStore, driveScope } = await import('../../src/services/google-drive-oauth.service.js');
    const { BackendRecordingDriveClient } = await import('../../src/services/backend-recording-drive-client.js');
    const { recordingDriveRootId } = await import('../../src/config/recordingDrive.js');
    try {
      await migrateDatabase(url, migrationCopy);
      const key = randomBytes(32);
      const ciphertext = encryptRefreshToken('synthetic-existing-refresh', key);
      await sql`insert into users (id, email, password_hash, full_name) values (${admin}, 'test@example.invalid', 'not-a-password', 'Test Admin')`;
      await sql`insert into drive_integration_credentials (id, google_account_email, encrypted_refresh_token, connected_by_user_id) values (1, 'owner@example.invalid', ${ciphertext}, ${admin})`;
      const [before] = await sql`select * from drive_integration_credentials where id = 1`;
      await migrateDatabase(url);
      const [after] = await sql`select * from drive_integration_credentials where id = 1`;
      assert.deepEqual(after, before, 'Migration must leave existing ciphertext and metadata unchanged.');
      const [generation] = await sql`select generation from drive_integration_generation where id = 1`;
      assert.equal(generation.generation, '00000000-0000-4000-8000-000000000000');
      await migrateDatabase(url);
      const [journal] = await sql`select count(*)::integer as count from drizzle.__drizzle_migrations`;
      assert.equal(journal.count, 22, 'Repeated normal migration execution must not reapply any migration.');
      const first = new IntegrationCredentialService(databaseIntegrationCredentialRepository, admin, key);
      const second = new IntegrationCredentialService(databaseIntegrationCredentialRepository, admin, key);
      assert.equal((await first.loadForBackend())?.refreshToken, 'synthetic-existing-refresh');
      console.log('PASS migrations 0000-0021, existing ciphertext, initialization and repeat migration');
      const config = { clientId: 'mock', clientSecret: 'mock', callbackUrl: 'https://example.invalid/google-drive/oauth/callback', administratorId: admin };
      const root = recordingDriveRootId();
      const validRoot = () => ({ id: root, mimeType: 'application/vnd.google-apps.folder', trashed: false, isAppAuthorized: true, capabilities: { canListChildren: true, canAddChildren: true } });
      async function seed() { await first.replace(admin, 'owner@example.invalid', 'synthetic-refresh', await first.generation()); }
      for (const path of ['status', 'verify', 'picker', 'folder'] as const) {
        await seed(); const entered = deferred<void>(); const resume = deferred<void>();
        const transport = { exchangeCode: async () => ({ access_token: 'mock', refresh_token: 'mock', scope: driveScope }), refresh: async () => { entered.resolve(); await resume.promise; return { access_token: 'mock', refresh_token: 'rotated' }; }, accountEmail: async () => 'owner@example.invalid', rootMetadata: async () => validRoot() };
        const oauth = new GoogleDriveOAuthService(config, new OAuthFlowStore(), transport, first, async () => true);
        const other = new GoogleDriveOAuthService(config, new OAuthFlowStore(), transport, second, async () => true);
        const folder = new BackendRecordingDriveClient(config, transport, first, async () => { throw new Error('No Google request allowed.'); });
        const operation = path === 'status' ? oauth.status(admin) : path === 'verify' ? oauth.verifySelectedRoot(admin, root) : path === 'picker' ? oauth.pickerAccess(admin) : folder.listChildren(root);
        await entered.promise; await other.disconnect(admin); resume.resolve();
        if (path === 'status') assert.equal((await operation as { connected: boolean }).connected, false); else await assert.rejects(operation);
        assert.equal(await first.loadForBackend(), null);
      }
      console.log('PASS disconnect during status, root verification, Picker and folder refresh');
      const entered = deferred<void>(); const resume = deferred<void>(); let block = true;
      const transport = { exchangeCode: async () => { if (block) { entered.resolve(); await resume.promise; } return { access_token: 'mock', refresh_token: 'fresh', scope: driveScope }; }, refresh: async () => ({ access_token: 'mock' }), accountEmail: async () => 'owner@example.invalid', rootMetadata: async () => validRoot() };
      const oauth = new GoogleDriveOAuthService(config, new OAuthFlowStore(), transport, first, async () => true);
      const other = new GoogleDriveOAuthService(config, new OAuthFlowStore(), transport, second, async () => true);
      const started = await oauth.start(admin, 'session');
      const callback = oauth.complete({ state: new URL(started.authorizationUrl).searchParams.get('state')!, cookie: started.cookie, code: 'mock' });
      await entered.promise; const old = await first.generation(); await other.disconnect(admin); resume.resolve(); await assert.rejects(callback);
      assert.notEqual(await first.generation(), old); assert.equal(await first.loadForBackend(), null);
      block = false; const fresh = await oauth.start(admin, 'session');
      await oauth.complete({ state: new URL(fresh.authorizationUrl).searchParams.get('state')!, cookie: fresh.cookie, code: 'mock' });
      await oauth.verifySelectedRoot(admin, root); assert.equal((await first.loadForBackend())?.refreshToken, 'fresh');
      console.log('PASS pending callback invalidation and authorized reconnection');
      const recordA = (await first.loadForBackend())!; const recordB = (await second.loadForBackend())!;
      const outcomes = await Promise.allSettled([first.replace(admin, recordA.googleAccountEmail, 'a', recordA.generation, recordA.ciphertext), second.replace(admin, recordB.googleAccountEmail, 'b', recordB.generation, recordB.ciphertext)]);
      assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1); assert.equal(outcomes.filter(o => o.status === 'rejected').length, 1);
      const oldGeneration = await first.generation(); await second.disconnect(admin); const newGeneration = await first.generation();
      assert.notEqual(oldGeneration, newGeneration); await assert.rejects(first.replace(admin, 'owner@example.invalid', 'stale', oldGeneration));
      await second.disconnect(admin); assert.notEqual(await first.generation(), newGeneration); assert.equal(await first.loadForBackend(), null);
      await assert.rejects(second.disconnect('non-admin')); assert.equal(await first.loadForBackend(), null);
      const [seen] = await observer`select generation from drive_integration_generation where id = 1`;
      assert.equal(seen.generation, await first.generation());
      console.log('PASS concurrent rotation CAS, stale writes, repeated disconnect, authorization and separate connection visibility');
      await seed();
      const both = deferred<void>(); const rotate = deferred<void>(); let refreshes = 0;
      const concurrentTransport = { ...transport, refresh: async () => {
        const number = ++refreshes; if (number === 2) both.resolve(); await rotate.promise;
        return { access_token: 'mock', refresh_token: `concurrent-${number}` };
      } };
      const instanceA = new GoogleDriveOAuthService(config, new OAuthFlowStore(), concurrentTransport, first, async () => true);
      const instanceB = new GoogleDriveOAuthService(config, new OAuthFlowStore(), concurrentTransport, second, async () => true);
      const requests = [instanceA.pickerAccess(admin), instanceB.pickerAccess(admin)];
      await both.promise; rotate.resolve();
      const concurrent = await Promise.allSettled(requests);
      assert.equal(concurrent.filter(item => item.status === 'fulfilled').length, 1);
      assert.equal(concurrent.filter(item => item.status === 'rejected').length, 1);
      assert.ok(['concurrent-1', 'concurrent-2'].includes((await first.loadForBackend())!.refreshToken));
      console.log('PASS simultaneous token refreshes across service instances');
      const locked = deferred<void>(); const release = deferred<void>();
      const holding = sql.begin(async tx => { await tx`select generation from drive_integration_generation where id = 1 for update`; locked.resolve(); await release.promise; });
      await locked.promise; let finished = false; const disconnect = second.disconnect(admin).then(() => { finished = true; });
      await new Promise(resolve => setTimeout(resolve, 150)); assert.equal(finished, false, 'Disconnect must wait for row lock.');
      release.resolve(); await holding; await disconnect; assert.equal(finished, true);
      console.log('PASS PostgreSQL row lock serializes concurrent disconnect');
    } finally { await client.end({ timeout: 5 }); }
  } finally { await observer.end({ timeout: 5 }); await sql.end({ timeout: 5 }); }
});
