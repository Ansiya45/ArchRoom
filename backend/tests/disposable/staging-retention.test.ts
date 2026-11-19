import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { test } from 'node:test';
import postgres from 'postgres';
import { migrateDatabase } from '../../src/db/migrate.js';

const url = 'postgres://ylaam_test_admin@127.0.0.1:55448/ylaam_staging_disposable_0018';
test('0018 retention, quotas, deletion semantics and transactional isolation', { timeout: 120000 }, async () => {
  assert.equal(process.env.DATABASE_URL, url);
  assert.equal(process.env.NODE_ENV, 'test');
  console.log('Disposable target: host=127.0.0.1 port=55448 database=ylaam_staging_disposable_0018');
  const sql = postgres(url, { max: 1 });
  const other = postgres(url, { max: 1 });
  try {
    const [identity] = await sql`select current_database() as name, current_setting('data_directory') as directory, inet_server_addr()::text as host, inet_server_port() as port`;
    assert.equal(identity.name, 'ylaam_staging_disposable_0018');
    assert.equal(identity.directory.replaceAll('\\', '/').toLowerCase(), 'd:/development/archroom/.codex-pg-staging-0018');
    assert.equal(identity.host, '127.0.0.1/32'); assert.equal(identity.port, 55448);
    assert.equal((await sql`select to_regclass('public.users') as value`)[0].value, null);
    await migrateDatabase(url);
    await migrateDatabase(url);
    assert.equal((await sql`select count(*)::int as n from drizzle.__drizzle_migrations`)[0].n, 22);
    const fixture = async (length = 3) => {
      const user = randomUUID(), meeting = randomUUID(), session = randomUUID(), job = randomUUID();
      await sql`insert into users(id,email,password_hash,full_name) values(${user},${user + '@example.invalid'},'test','Test')`;
      await sql`insert into meetings(id,meeting_code,title,host_user_id) values(${meeting},${meeting},'Test',${user})`;
      await sql`insert into meeting_occurrences(id,meeting_id,status) values(${session},${meeting},'ended')`;
      await sql`insert into company_recording_upload_jobs(id,recording_id,owner_user_id,meeting_id,occurrence_id,destination_folder_id,access_policy,mime_type,byte_length,sha256)
        values(${job},${randomUUID()},${user},${meeting},${session},'testFolder123','private','video/webm',${length},${'a'.repeat(64)})`;
      return { user, meeting, session, job };
    };
    const stage = async (job: string) => (await sql`insert into local_recording_staging.recordings(source_job_id) values(${job}) returning id`)[0].id as string;
    const put = (db: typeof sql, id: string, bytes = Buffer.from('abc'), offset = 0) => db`insert into local_recording_staging.chunks(staging_id,byte_offset,contents) values(${id},${offset},${bytes})`;
    const used = async () => Number((await sql`select used_bytes from local_recording_staging.capacity`)[0].used_bytes);
    const first = await fixture();
    await assert.rejects(stage(first.job), /LOCAL_STAGING_DISABLED/);
    await sql`set ylaam.local_staging_test = 'enabled'`;
    await other`set ylaam.local_staging_test = 'enabled'`;
    await assert.rejects(stage(randomUUID()));
    const firstStage = await stage(first.job);
    for (const kind of ['job', 'meeting', 'session', 'user'] as const) {
      const f = kind === 'job' ? first : await fixture();
      const id = kind === 'job' ? firstStage : await stage(f.job);
      await put(sql, id);
      if (kind === 'job') await sql`delete from company_recording_upload_jobs where id=${f.job}`;
      if (kind === 'meeting') await sql`delete from meetings where id=${f.meeting}`;
      if (kind === 'session') await sql`delete from meeting_occurrences where id=${f.session}`;
      if (kind === 'user') await sql`delete from users where id=${f.user}`;
      assert.equal((await sql`select count(*)::int as n from company_recording_upload_jobs where id=${f.job}`)[0].n, 0);
      const [chunk] = await sql`select contents,sha256 from local_recording_staging.chunks where staging_id=${id}`;
      assert.equal(chunk.contents.toString(), 'abc');
      assert.equal(chunk.sha256, createHash('sha256').update('abc').digest('hex'));
      assert.equal((await sql`select source_job_id from local_recording_staging.recordings where id=${id}`)[0].source_job_id, f.job);
    }
    assert.equal(await used(), 12);
    await assert.rejects(sql`delete from local_recording_staging.recordings where id=${firstStage}`);
    await assert.rejects(sql`truncate local_recording_staging.chunks`);
    await assert.rejects(sql`update local_recording_staging.chunks set contents=${Buffer.from('bad')}`);
    await assert.rejects(put(sql, randomUUID()));
    await assert.rejects(stage((await fixture(134217729)).job));
    const large = await stage((await fixture(16777216)).job);
    await assert.rejects(put(sql, large, Buffer.alloc(8388609)));
    await assert.rejects(put(sql, large, Buffer.from('abc')));
    await assert.rejects(put(sql, large, Buffer.alloc(262144), 262144));
    assert.equal(await used(), 12);
    await assert.rejects(sql.begin(async tx => { await tx`insert into local_recording_staging.chunks(staging_id,byte_offset,contents) values(${large},0,${Buffer.alloc(262144)})`; throw new Error('rollback'); }));
    assert.equal(await used(), 12);
    const races = await Promise.allSettled([put(sql, large, Buffer.alloc(262144)), put(other, large, Buffer.alloc(262144))]);
    assert.equal(races.filter(r => r.status === 'fulfilled').length, 1);
    const before = await used();
    await sql`insert into local_recording_staging.chunks(staging_id,byte_offset,contents) values(${large},0,${Buffer.alloc(262144)}) on conflict do nothing`;
    assert.equal(await used(), before);
    // Privileged disposable-test fixture simulates existing quota usage; no giant allocation.
    const a = await stage((await fixture()).job), b = await stage((await fixture()).job);
    await sql`update local_recording_staging.capacity set used_bytes=536870909`;
    const capRace = await Promise.allSettled([put(sql,a),put(other,b)]);
    assert.equal(capRace.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(await used(), 536870912);
    assert.match(String((capRace.find(r => r.status === 'rejected') as PromiseRejectedResult).reason), /STAGING_CAPACITY_EXHAUSTED/);
    assert.equal((await sql`select count(*)::int as n from local_recording_staging.chunks where staging_id in (${a},${b})`)[0].n,1);
    await sql`update local_recording_staging.capacity set used_bytes=(select sum(byte_length) from local_recording_staging.chunks)`;
    assert.equal(await used(), before + 3);
    console.log('PASS deletion of job/meeting/session/user; immutable retained bytes; orphan quota; rollback; concurrent chunk and capacity reservation; limits; migration replay');
  } finally { await sql.end(); await other.end(); }
});
