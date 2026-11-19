import { historicalFixture } from './historical-fixture.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import postgres from 'postgres';
import { migrateDatabase } from '../../src/db/migrate.js';
import { CompanyRecordingConfirmationService } from '../../src/services/company-recording-confirmation.service.js';
import { convergeFeatureForDisposableTest } from '../../src/db/feature-convergence.js';

const address = process.env.DISPOSABLE_DATABASE_URL ?? '';
const directory = 'D:/Development/ArchRoom/backend/.phase-b-confirmation-disposable-pg';
test('confirmation uses persisted PostgreSQL evidence in an explicitly isolated cluster', { timeout: 60000 }, async t => {
  const parsed = new URL(address);
  const combined = process.env.PHASE_B_COMBINED_CONFIRMATION === '1';
  if (process.env.NODE_ENV !== 'test' || parsed.protocol !== 'postgres:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55470' ||
    parsed.username !== 'ylaam_disposable_admin' || parsed.password || parsed.search ||
    !(combined ? /^\/ylaam_(?:converge|fresh)_disposable_[a-f0-9]{8}$/ : /^\/ylaam_confirmation_disposable_[a-f0-9]{8}$/).test(parsed.pathname)) throw new Error('Unsafe disposable test configuration');
  const sql = postgres(address, { max: 1, connect_timeout: 3 });
  try {
    const [identity] = await sql`select current_database() as database, current_user as role, inet_server_addr()::text as host,
      inet_server_port() as port, current_setting('data_directory') as directory`;
    assert.deepEqual(identity, { database:parsed.pathname.slice(1), role:'ylaam_disposable_admin', host:'127.0.0.1/32', port:55470, directory });
    if (combined) {
      assert.equal(await convergeFeatureForDisposableTest(address,'src/db/feature-ledger-identities.json','drizzle/convergence/feature-to-combined-v1.sql'),'already-converged');
    } else {
      const [initial] = await sql`select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','drizzle') and c.relkind in ('r','p')`;
      assert.equal(initial.n, 0, 'Refusing to migrate a nonempty database');
      await migrateDatabase(address, await historicalFixture('feature'));
      await migrateDatabase(address, await historicalFixture('feature'));
    }
    const [migrations] = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    assert.equal(migrations.n, 32);
    const owner=randomUUID(), other=randomUUID(), meeting=randomUUID(), recording=randomUUID(), jobId=randomUUID(), generation=randomUUID();
    const file='driveFile1234567890', folder='folder1234567890', hash='a'.repeat(64), url=`https://drive.google.com/file/d/${file}/view`;
    await sql`insert into users(id,email,password_hash,full_name) values (${owner},'owner@example.invalid','test','Owner'),(${other},'other@example.invalid','test','Other')`;
    await sql`insert into meetings(id,meeting_code,title,host_user_id) values (${meeting},'YLM-B84D7C','Test',${owner})`;
    await sql`insert into company_recording_upload_jobs(id,recording_id,owner_user_id,meeting_id,destination_folder_id,access_policy,mime_type,byte_length,sha256,drive_file_id,verified_drive_file_id,state,confirmed_offset,completed_at)
      values (${jobId},${recording},${owner},${meeting},${folder},'private','video/webm',123,${hash},${file},${file},'completed',123,now())`;
    await sql`insert into company_recording_transfer_intents(job_id,recording_id,owner_user_id,drive_file_id,company_account_email,credential_generation,destination_folder_id,drive_confirmed_offset)
      values (${jobId},${recording},${owner},${file},'company@example.invalid',${generation},${folder},123)`;
    await sql`insert into company_recording_drive_verifications(job_id,recording_id,drive_file_id,destination_folder_id,expected_byte_length,observed_byte_length,expected_mime_type,observed_mime_type,expected_sha256,observed_sha256,company_account_email,credential_generation,outcome)
      values (${jobId},${recording},${file},${folder},123,123,'video/webm','video/webm',${hash},${hash},'company@example.invalid',${generation},'verified')`;
    await sql`insert into meeting_history_items(meeting_id,kind,dedupe_key,content) values (${meeting},'drive',${`company-drive:${recording}`},${url})`;
    const service = new CompanyRecordingConfirmationService(sql, async (id, user) => {
      if (id !== jobId || user !== owner) throw new Error('unauthorized');
      return { recordingId:recording, meetingId:meeting, occurrenceId:null };
    });
    await t.test('matching evidence confirms exact persisted identities', async () => {
      const result = await service.confirm(recording,owner);
      assert.equal(result?.jobId,jobId); assert.equal(result?.meetingId,meeting); assert.equal(result?.driveFileId,file);
      assert.equal(result?.destinationFolderId,folder); assert.equal(result?.historyUrl,url); assert.equal(result?.sha256,hash);
      assert.equal(await service.confirm(recording,other),null);
    });
    await t.test('mismatched history, destination, bytes and missing evidence fail closed', async () => {
      await sql`update meeting_history_items set content='https://example.invalid/' where meeting_id=${meeting}`;
      assert.equal(await service.confirm(recording,owner),null);
      await sql`update meeting_history_items set content=${url} where meeting_id=${meeting}`;
      await sql`update company_recording_drive_verifications set destination_folder_id='wrongFolder12345' where job_id=${jobId}`;
      assert.equal(await service.confirm(recording,owner),null);
      await sql`update company_recording_drive_verifications set destination_folder_id=${folder}, observed_byte_length=122 where job_id=${jobId}`;
      assert.equal(await service.confirm(recording,owner),null);
      await sql`update company_recording_drive_verifications set observed_byte_length=123, observed_sha256=${'b'.repeat(64)} where job_id=${jobId}`;
      assert.equal(await service.confirm(recording,owner),null);
      await sql`update company_recording_drive_verifications set observed_sha256=${hash}, observed_mime_type='video/mp4' where job_id=${jobId}`;
      assert.equal(await service.confirm(recording,owner),null);
      await sql`update company_recording_drive_verifications set observed_mime_type='video/webm', drive_file_id='wrongFile12345678' where job_id=${jobId}`;
      assert.equal(await service.confirm(recording,owner),null);
      await sql`delete from company_recording_drive_verifications where job_id=${jobId}`;
      assert.equal(await service.confirm(recording,owner),null);
    });
  } finally { await sql.end({ timeout: 3 }); }
});
