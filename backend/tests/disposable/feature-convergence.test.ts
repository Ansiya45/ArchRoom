import { historicalFixture } from './historical-fixture.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import postgres from 'postgres';
import { migrateDatabase } from '../../src/db/migrate.js';
import { convergeFeatureForDisposableTest, featureSchemaFingerprint } from '../../src/db/feature-convergence.js';
import { CompanyRecordingConfirmationService } from '../../src/services/company-recording-confirmation.service.js';

const address = process.env.DISPOSABLE_DATABASE_URL ?? '';
const identityFile = 'src/db/feature-ledger-identities.json', migrationFile = 'drizzle/convergence/feature-to-combined-v1.sql';
test('feature-only database converges transactionally in an isolated cluster', { timeout: 90000 }, async t => {
  const parsed = new URL(address);
  if (process.env.NODE_ENV !== 'test' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55470' || parsed.username !== 'ylaam_disposable_admin' ||
    parsed.password || parsed.search || !/^\/ylaam_converge_disposable_[a-f0-9]{8}$/.test(parsed.pathname)) throw new Error('Unsafe disposable test target');
  const sql = postgres(address, { max:1, connect_timeout:3 });
  const run = (hook?: () => Promise<void>) => convergeFeatureForDisposableTest(address, identityFile, migrationFile, hook);
  try {
    const [identity] = await sql`select current_database() as name,current_user as role,inet_server_addr()::text as host,inet_server_port() as port,current_setting('data_directory') as directory`;
    assert.deepEqual(identity, { name:parsed.pathname.slice(1), role:'ylaam_disposable_admin', host:'127.0.0.1/32', port:55470,
      directory:'D:/Development/ArchRoom/backend/.phase-b-confirmation-disposable-pg' });
    const [initial] = await sql`select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','drizzle') and c.relkind in ('r','p')`;
    assert.equal(initial.n,0,'Refusing a nonempty database');
    await migrateDatabase(address,await historicalFixture('feature'));
    const before = await featureSchemaFingerprint(sql);
    const owner=randomUUID(), meeting=randomUUID(), recording=randomUUID(), job=randomUUID(), generation=randomUUID();
    const file='fileTest123456789', folder='folderTest1234567', hash='a'.repeat(64), url=`https://drive.google.com/file/d/${file}/view`;
    await sql`insert into users(id,email,password_hash,full_name) values (${owner},'host@example.invalid','test','Host')`;
    await sql`insert into meetings(id,meeting_code,title,host_user_id,recording_folder_id) values (${meeting},'YLM-FA1234','Preserve me',${owner},${folder})`;
    const occurrence=randomUUID(), enrollment=randomUUID(), request=randomUUID();
    await sql`insert into meeting_occurrences(id,meeting_id,start_request_id) values (${occurrence},${meeting},${randomUUID()})`;
    await sql`insert into meeting_ai_requests(meeting_id,occurrence_id,request_id,requested_by_user_id) values (${meeting},${occurrence},${request},${owner})`;
    await sql`insert into recording_batch_folders(folder_id,name,created_by_user_id) values (${folder},'Batch',${owner})`;
    await sql`insert into batch_student_enrollments(id,folder_id,student_name,student_email) values (${enrollment},${folder},'Student','student@example.invalid')`;
    await sql`insert into company_recording_upload_jobs(id,recording_id,owner_user_id,meeting_id,destination_folder_id,access_policy,mime_type,byte_length,sha256,drive_file_id,verified_drive_file_id,state,confirmed_offset,completed_at)
      values (${job},${recording},${owner},${meeting},${folder},'private','video/webm',123,${hash},${file},${file},'completed',123,now())`;
    await sql`insert into company_recording_transfer_intents(job_id,recording_id,owner_user_id,drive_file_id,company_account_email,credential_generation,destination_folder_id,drive_confirmed_offset)
      values (${job},${recording},${owner},${file},'company@example.invalid',${generation},${folder},123)`;
    await sql`insert into company_recording_drive_verifications(job_id,recording_id,drive_file_id,destination_folder_id,expected_byte_length,observed_byte_length,expected_mime_type,observed_mime_type,expected_sha256,observed_sha256,company_account_email,credential_generation,outcome)
      values (${job},${recording},${file},${folder},123,123,'video/webm','video/webm',${hash},${hash},'company@example.invalid',${generation},'verified')`;
    await sql`insert into meeting_history_items(meeting_id,kind,dedupe_key,content) values (${meeting},'drive',${`company-drive:${recording}`},${url})`;
    await t.test('rejects unknown ledger and schema drift', async () => {
      await assert.rejects(convergeFeatureForDisposableTest(address, migrationFile, migrationFile), /inputs/);
      await assert.rejects(convergeFeatureForDisposableTest(address, identityFile, identityFile), /inputs/);
      await sql`insert into drizzle.__drizzle_migrations(hash,created_at) values (${'f'.repeat(64)},1999999999999)`;
      await assert.rejects(run(), /ledger/);
      await sql`delete from drizzle.__drizzle_migrations where created_at=1999999999999`;
      await sql`alter table meetings alter column title set default 'unexpected drift'`;
      await assert.rejects(run(), /baseline/);
      await sql`alter table meetings alter column title drop default`;
      assert.equal(await featureSchemaFingerprint(sql),before);
    });
    await t.test('rejects existing data that violates a historical foreign key', async () => {
      const orphan = randomUUID();
      try {
        await sql`set session_replication_role='replica'`;
        await sql`insert into meetings(id,meeting_code,title,host_user_id) values (${orphan},'YLM-ORPHAN','Bad',${randomUUID()})`;
      } finally { await sql`set session_replication_role='origin'`; }
      await assert.rejects(run(), /foreign key/);
      await sql`delete from meetings where id=${orphan}`;
    });
    await t.test('failed transaction rolls back all DDL and can be retried', async () => {
      await assert.rejects(run(async () => { throw new Error('simulated interruption'); }), /simulated interruption/);
      assert.equal(await featureSchemaFingerprint(sql),before);
      const [record] = await sql`select to_regclass('drizzle.feature_convergence_runs') as marker`;
      assert.equal(record.marker,null);
    });
    await t.test('applies additions, preserves data and reruns idempotently', async () => {
      assert.equal(await run(),'converged'); assert.equal(await run(),'already-converged');
      const [check] = await sql`select u.role::text as role,m.title,m.recording_folder_id,m.transcript_access,
        to_regclass('public.user_permissions')::text as permissions,to_regclass('public.user_invitations')::text as invitations,
        (select count(*)::int from drizzle.__drizzle_migrations) as ledger_count from users u join meetings m on m.host_user_id=u.id where u.id=${owner}`;
      assert.deepEqual(check,{ role:'user',title:'Preserve me',recording_folder_id:folder,transcript_access:'all',permissions:'user_permissions',invitations:'user_invitations',ledger_count:32 });
      const [preserved] = await sql`select (select count(*)::int from meeting_occurrences where id=${occurrence}) as occurrences,
        (select count(*)::int from meeting_ai_requests where request_id=${request}) as ai_requests,
        (select count(*)::int from batch_student_enrollments where id=${enrollment}) as enrollments,
        to_regclass('public.meeting_recording_consent_requests')::text as consent_requests,
        to_regclass('public.meeting_recording_consent_responses')::text as consent_responses`;
      assert.deepEqual(preserved,{ occurrences:1,ai_requests:1,enrollments:1,consent_requests:'meeting_recording_consent_requests',consent_responses:'meeting_recording_consent_responses' });
      const security = await sql`select relname,relrowsecurity from pg_class where oid in ('public.meeting_recording_consent_requests'::regclass,'public.meeting_recording_consent_responses'::regclass) order by relname`;
      assert.deepEqual(security.map(row => [row.relname,row.relrowsecurity]), [['meeting_recording_consent_requests',true],['meeting_recording_consent_responses',true]]);
      const service = new CompanyRecordingConfirmationService(sql, async (id,user) => {
        assert.equal(id,job); assert.equal(user,owner); return {recordingId:recording,meetingId:meeting,occurrenceId:null};
      });
      const confirmation = await service.confirm(recording,owner);
      assert.equal(confirmation?.historyUrl,url); assert.equal(confirmation?.destinationFolderId,folder);
      await sql`alter table users alter column full_name set default 'drift'`;
      await assert.rejects(run(), /does not match/);
      await sql`alter table users alter column full_name drop default`;
      assert.equal(await run(),'already-converged');
    });
  } finally { await sql.end({timeout:3}); }
});
