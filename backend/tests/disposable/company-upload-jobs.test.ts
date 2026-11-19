// Only the explicitly named, freshly initialized disposable cluster is accepted.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import postgres from 'postgres';

const url = 'postgres://ylaam_test_admin@127.0.0.1:55440/ylaam_upload_jobs_test_0017';
const directory = 'D:/Development/ArchRoom/.codex-pg-jobs-0017';
test('company upload jobs and migration on disposable PostgreSQL', { timeout: 120000 }, async () => {
  if (process.env.DATABASE_URL !== url || process.env.NODE_ENV !== 'test' || process.env.DOTENV_CONFIG_PATH !== 'tests/.unused') throw new Error('Unsafe test environment');
  console.log('Disposable PostgreSQL target: host=127.0.0.1 port=55440 database=ylaam_upload_jobs_test_0017');
  const sql = postgres(url, { max: 2, connect_timeout: 5 });
  try {
    const [identity] = await sql`select current_database() as name, current_setting('data_directory') as directory, inet_server_addr()::text as host, inet_server_port() as port`;
    assert.equal(identity.name, 'ylaam_upload_jobs_test_0017'); assert.equal(identity.directory.replaceAll('\\', '/').toLowerCase(), directory.toLowerCase());
    assert.equal(identity.host, '127.0.0.1/32'); assert.equal(identity.port, 55440);
    const [empty] = await sql`select to_regclass('public.users') as users`; assert.equal(empty.users, null);
    const { migrateDatabase } = await import('../../src/db/migrate.js');
    await migrateDatabase(url); await migrateDatabase(url);
    const [count] = await sql`select count(*)::int as value from drizzle.__drizzle_migrations`; assert.equal(count.value, 22);
    const { env } = await import('../../src/env.js'); assert.equal(env.COMPANY_DRIVE_UPLOAD_JOBS_ENABLED, false);
    const { client } = await import('../../src/db/index.js');
    const { CompanyRecordingJobsService } = await import('../../src/services/company-recording-jobs.service.js');
    const { recordingDriveRootId } = await import('../../src/config/recordingDrive.js');
    const originalFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('Network must not be used'); };
    try {
      const host = randomUUID(), other = randomUUID(), meeting = randomUUID(), scheduled = randomUUID(), session = randomUUID();
      await sql`insert into users (id,email,password_hash,full_name) values (${host},'host@example.invalid','test','Host'),(${other},'other@example.invalid','test','Other')`;
      await sql`insert into meetings (id,meeting_code,title,host_user_id,schedule_type) values (${meeting},'YLM-JOB001','Instant',${host},null),(${scheduled},'YLM-JOB002','Scheduled',${host},'reusable')`;
      await sql`insert into meeting_occurrences (id,meeting_id,status) values (${session},${scheduled},'ended')`;
      let privacyResult: any = { status: 'SAFE', destinationId: recordingDriveRootId(), checkedAt: 'test' }; let privacyCalls = 0;
      const privacy = async () => { privacyCalls++; return privacyResult; };
      const disabled = new CompanyRecordingJobsService(false, privacy);
      const service = new CompanyRecordingJobsService(true, privacy); // Dependency injection only; no environment flag is enabled.
      const input = { recordingId: randomUUID(), meetingCode: 'YLM-JOB001', mimeType: 'video/webm' as const, byteLength: 123, sha256: 'a'.repeat(64) };
      await assert.rejects(disabled.create(input, host)); await assert.rejects(disabled.status(randomUUID(), host)); await assert.rejects(disabled.retry(randomUUID(), host));
      assert.equal(privacyCalls, 0);
      await assert.rejects(service.create(input, other));
      await assert.rejects(service.create({ ...input, byteLength: 0 }, host));
      await assert.rejects(service.create({ ...input, byteLength: 21474836481 }, host));
      await assert.rejects(service.create({ ...input, sha256: 'bad' }, host));
      const [a, b] = await Promise.all([service.create(input, host), service.create(input, host)]);
      assert.equal(a.id, b.id); assert.equal(a.state, 'pending'); assert.equal(privacyCalls, 0);
      assert.ok(!('encryptedSession' in a)); assert.ok(!('driveFileId' in a));
      await assert.rejects(service.create({ ...input, byteLength: 124 }, host));
      await assert.rejects(service.status(a.id, other)); await assert.rejects(service.retry(a.id, other));
      await assert.rejects(service.retry(a.id, host));
      const stored = await sql`select destination_folder_id, access_policy, drive_file_id, encrypted_session from company_recording_upload_jobs where id=${a.id}`;
      assert.equal(stored[0].destination_folder_id, recordingDriveRootId()); assert.equal(stored[0].access_policy, 'private');
      assert.equal(stored[0].drive_file_id, null); assert.equal(stored[0].encrypted_session, null);
      assert.equal((await service.validateImmediatelyBeforeFileCreation(a.id, host)).status, 'SAFE');
      privacyResult = { status: 'BLOCKED', reason: 'test' }; assert.equal((await service.validateImmediatelyBeforeFileCreation(a.id, host)).status, 'BLOCKED');
      privacyResult = { status: 'UNVERIFIABLE', reason: 'test' }; assert.equal((await service.validateImmediatelyBeforeFileCreation(a.id, host)).status, 'UNVERIFIABLE');
      privacyResult = { status: 'SAFE', destinationId: 'wrongFolder123', checkedAt: 'test' }; assert.equal((await service.validateImmediatelyBeforeFileCreation(a.id, host)).status, 'BLOCKED');
      await sql`update meetings set recording_access_policy='restricted' where id=${meeting}`;
      assert.equal((await service.validateImmediatelyBeforeFileCreation(a.id, host)).status, 'BLOCKED');
      await sql`update company_recording_upload_jobs set state='retryable', error_code='NETWORK' where id=${a.id}`;
      const retries = await Promise.allSettled([service.retry(a.id, host), service.retry(a.id, host)]);
      assert.equal(retries.filter(item => item.status === 'fulfilled').length, 1); assert.equal(retries.filter(item => item.status === 'rejected').length, 1);
      assert.equal((await service.status(a.id, host)).retryCount, 1);
      await assert.rejects(sql`update company_recording_upload_jobs set state='completed', verified_drive_file_id='test', confirmed_offset=byte_length, completed_at=now() where id=${a.id}`);
      await assert.rejects(sql`update company_recording_upload_jobs set state='unknown' where id=${a.id}`);
      const scheduledInput = { ...input, recordingId: randomUUID(), meetingCode: 'YLM-JOB002', occurrenceId: session, mimeType: 'video/mp4' as const };
      const scheduledJob = await service.create(scheduledInput, host); assert.equal(scheduledJob.occurrenceId, session);
      await assert.rejects(service.create({ ...scheduledInput, recordingId: randomUUID(), occurrenceId: randomUUID() }, host));
      await assert.rejects(service.create({ ...input, recordingId: randomUUID(), occurrenceId: session }, host));
      const [total] = await sql`select count(*)::int as value from company_recording_upload_jobs`; assert.equal(total.value, 2);
      await sql`delete from meetings where id=${scheduled}`;
      const [remaining] = await sql`select count(*)::int as value from company_recording_upload_jobs`; assert.equal(remaining.value, 1);
      await sql`delete from users where id=${host}`;
      const [afterDeletion] = await sql`select count(*)::int as value from company_recording_upload_jobs`; assert.equal(afterDeletion.value, 0);
      console.log('PASS migration 0017, flag, host authorization, idempotency, job states, privacy gating and concurrency');
    } finally { globalThis.fetch = originalFetch; await client.end({ timeout: 5 }); }
  } finally { await sql.end({ timeout: 5 }); }
});
