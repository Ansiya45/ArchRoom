import assert from 'node:assert/strict';
import { test } from 'node:test';
import postgres from 'postgres';

const address = process.env.DISPOSABLE_DATABASE_URL || '';
const parsed = new URL(address);
if (process.env.NODE_ENV !== 'test' || process.env.DATABASE_URL !== address || parsed.protocol !== 'postgres:' || parsed.hostname !== '127.0.0.1' ||
    !/^ylaam_staging_disposable_[a-f0-9]{12}$/.test(parsed.pathname.slice(1)) || !/^ylaam_test_runner_[a-f0-9]{12}$/.test(parsed.username)) throw new Error('Unsafe disposable database target.');
const sql = postgres(address, {max:2});
const host='11111111-1111-4111-8111-111111111111', meeting='22222222-2222-4222-8222-222222222222', job='33333333-3333-4333-8333-333333333333', recording='44444444-4444-4444-8444-444444444444';
async function check() {
  const [identity]=await sql`select current_database() as name,current_user as role,inet_server_addr()::text as host`;
  assert.equal(identity.name,parsed.pathname.slice(1)); assert.equal(identity.role,parsed.username); assert.equal(identity.host,'127.0.0.1/32');
}
if (process.argv[2] === 'seed') {
  try {
    await check();
    await sql`insert into users(id,email,password_hash,full_name) values (${host},'metadata-host@example.invalid','test','Host')`;
    await sql`insert into meetings(id,meeting_code,title,host_user_id) values (${meeting},'YLM-META','Metadata meeting',${host})`;
    await sql`insert into company_recording_upload_jobs(id,recording_id,owner_user_id,meeting_id,destination_folder_id,access_policy,mime_type,byte_length,sha256) values (${job},${recording},${host},${meeting},'configured_folder_123','private','video/webm',4,${'a'.repeat(64)})`;
  } finally { await sql.end({timeout:5}); }
} else {
  test('0031 retains legacy jobs and persists filename metadata',async()=>{
    try {
      await check();
      const [legacy]=await sql`select recording_started_at,recording_title,recording_time_zone,recording_filename from company_recording_upload_jobs where id=${job}`;
      assert.deepEqual([legacy.recording_started_at,legacy.recording_title,legacy.recording_time_zone,legacy.recording_filename],[null,null,null,null]);
      const id='55555555-5555-4555-8555-555555555555', newRecording='66666666-6666-4666-8666-666666666666';
      const filename=`Metadata meeting - 2026-01-02 - 08-34 - ${newRecording}.webm`;
      await sql`insert into company_recording_upload_jobs(id,recording_id,owner_user_id,meeting_id,destination_folder_id,access_policy,mime_type,byte_length,sha256,recording_started_at,recording_title,recording_time_zone,recording_filename) values (${id},${newRecording},${host},${meeting},'configured_folder_123','private','video/webm',4,${'b'.repeat(64)},'2026-01-02T03:04:00Z','Metadata meeting','Asia/Kolkata',${filename})`;
      const [saved]=await sql`select recording_started_at,recording_title,recording_time_zone,recording_filename from company_recording_upload_jobs where id=${id}`;
      assert.equal(saved.recording_started_at.toISOString(),'2026-01-02T03:04:00.000Z');
      assert.equal(saved.recording_title,'Metadata meeting'); assert.equal(saved.recording_time_zone,'Asia/Kolkata'); assert.equal(saved.recording_filename,filename);
      await assert.rejects(sql`insert into company_recording_upload_jobs(recording_id,owner_user_id,meeting_id,destination_folder_id,access_policy,mime_type,byte_length,sha256) values (${newRecording},${host},${meeting},'configured_folder_123','private','video/webm',4,${'b'.repeat(64)})`);
    } finally { await sql.end({timeout:5}); }
  });
}
