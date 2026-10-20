import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

process.env.DOTENV_CONFIG_PATH = 'tests/.none';
const password = process.env.PG_TEST_PASSWORD;
if (!password) throw new Error('Set PG_TEST_PASSWORD to run the local Admit All integration test.');
const database = new URL('postgres://postgres@127.0.0.1:5432/ylaam_auth_test');
database.password = password;
process.env.DATABASE_URL = database.href;
process.env.JWT_SECRET = 'local-admit-all-test';
const sql = postgres({ host: '127.0.0.1', port: 5432, database: 'ylaam_auth_test', username: 'postgres', password, max: 2 });
const { db } = await import('../../src/db/index.js');
const { MeetingService } = await import('../../src/services/meeting.service.js');

test('real PostgreSQL Admit All is host-authorized, scoped, idempotent, and concurrent-safe', { timeout: 120000 }, async () => {
  const [identity] = await sql`select current_database() as name, inet_server_addr() as host, inet_server_port() as port`;
  assert.equal(identity.name, 'ylaam_auth_test'); assert.equal(identity.host, '127.0.0.1'); assert.equal(Number(identity.port), 5432);
  const host = randomUUID(), otherHost = randomUUID(), meetingId = randomUUID(), otherMeetingId = randomUUID();
  const occurrence = randomUUID(), otherOccurrence = randomUUID(), code = `YLM-${randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()}`, otherCode = `YLM-${randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()}`;
  const allGuests = Array.from({ length: 7 }, () => ({ id: randomUUID(), join: randomUUID() }));
  try {
    await sql`insert into users (id,email,password_hash,full_name,email_verified_at) values (${host},${`${host}@example.invalid`},'test','Admit host',now()),(${otherHost},${`${otherHost}@example.invalid`},'test','Other host',now())`;
    await sql`insert into meetings (id,meeting_code,title,host_user_id,schedule_type,status,active_occurrence_id,updated_at) values (${meetingId},${code},'Admit All integration',${host},'reusable','live',null,now()),(${otherMeetingId},${otherCode},'Other meeting',${otherHost},'reusable','live',null,now())`;
    await sql`insert into meeting_occurrences (id,meeting_id,status,started_at) values (${occurrence},${meetingId},'live',now()),(${otherOccurrence},${otherMeetingId},'live',now())`;
    await sql`update meetings set active_occurrence_id = ${occurrence} where id = ${meetingId}`;
    await sql`update meetings set active_occurrence_id = ${otherOccurrence} where id = ${otherMeetingId}`;
    for (const g of allGuests) await sql`insert into meeting_participants (id,meeting_id,occurrence_id,guest_name,join_request_id,role,admission,left_at) values (${g.id},${meetingId},${occurrence},'Guest',${g.join},'participant','pending',null)`;
    await sql`insert into meeting_participants (id,meeting_id,occurrence_id,user_id,join_request_id,role,admission,left_at) values (${randomUUID()},${meetingId},${occurrence},${host},${randomUUID()},'host','admitted',null)`;
    await sql`update meeting_participants set admission='admitted' where id=${allGuests[2].id}`;
    await sql`update meeting_participants set left_at=now() where id=${allGuests[3].id}`;
    await sql`insert into meeting_participants (id,meeting_id,occurrence_id,guest_name,join_request_id,role,admission,left_at) values (${randomUUID()},${otherMeetingId},${otherOccurrence},'Other meeting guest',${randomUUID()},'participant','pending',null)`;
    const service = new MeetingService();
    const first = await service.admitAll(code, host, occurrence);
    assert.equal(first.admittedCount, 5);
    const second = await service.admitAll(code, host, occurrence); assert.equal(second.admittedCount, 0);
    const concurrent = await Promise.all([service.admitAll(code, host, occurrence), service.admitAll(code, host, occurrence)]);
    assert.deepEqual(concurrent.map(x => x.admittedCount).sort(), [0, 0]);
    await assert.rejects(service.admitAll(code, otherHost, occurrence), { code: 'FORBIDDEN' });
    await sql`insert into meeting_participants (id,meeting_id,occurrence_id,guest_name,join_request_id,role,admission,left_at) values (${randomUUID()},${meetingId},${occurrence},'Late guest',${randomUUID()},'participant','pending',null)`;
    const late = await service.admitAll(code, host, occurrence); assert.equal(late.admittedCount, 1);
    const rows = await sql`select admission,left_at from meeting_participants where meeting_id=${meetingId} and occurrence_id=${occurrence} order by admission,left_at nulls first`;
    assert.equal(rows.filter(r => r.admission === 'admitted' && r.left_at === null).length, 8);
    assert.equal(rows.filter(r => r.admission === 'pending' && r.left_at !== null).length, 1);
    const other = await sql`select admission from meeting_participants where meeting_id=${otherMeetingId}`; assert.deepEqual(other.map(r => r.admission), ['pending']);
  } finally {
    await sql`delete from users where id in (${host},${otherHost})`;
    await sql.end({ timeout: 5 }); await db.$client.end({ timeout: 5 });
  }
});
