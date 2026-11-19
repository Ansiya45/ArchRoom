import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { coordinateDisposableMigration } from '../../src/db/disposable-migration-coordinator.js';
import { migrateMeetingHostAssignment } from '../../src/db/meeting-host-migration.js';
import { MeetingService } from '../../src/services/meeting.service.js';
import { canOpenAssignedMeeting } from '../../src/services/meeting-host-access.js';
import { client } from '../../src/db/index.js';

test('persistent meeting host assignment on a verified disposable database', { timeout: 90000 }, async () => {
  const address = process.env.DATABASE_URL!;
  await coordinateDisposableMigration(address, process.cwd(), undefined, true);
  const sql = postgres(address, { max: 1 });
  const service = new MeetingService(async () => null);
  try {
    await migrateMeetingHostAssignment(address, process.cwd());
    await migrateMeetingHostAssignment(address, process.cwd());
    await coordinateDisposableMigration(address, process.cwd(), undefined, true);
    const owner = randomUUID(), host = randomUUID(), outsider = randomUUID();
    await sql`insert into users(id,email,password_hash,full_name,role,email_verified_at) values
      (${owner},${owner+'@example.invalid'},'unused','Owner','superadmin',now()),
      (${host},${host+'@example.invalid'},'unused','Assigned host','user',now()),
      (${outsider},${outsider+'@example.invalid'},'unused','Other user','user',now())`;
    await assert.rejects(service.createMeeting({ title: 'Unauthorized assignment', reusable: true, assignedHostUserId: host }, outsider));
    const { meeting } = await service.createMeeting({ title: 'Assigned reusable session', reusable: true, assignedHostUserId: host }, owner);
    assert.equal(meeting.hostUserId, owner);
    assert.equal(meeting.assignedHostUserId, host);
    assert.equal(await canOpenAssignedMeeting(meeting, outsider), false);
    assert.equal(await canOpenAssignedMeeting(meeting, host), true);
    assert.ok((await service.listMeetings(host)).meetings.some(row => row.id === meeting.id));
    await assert.rejects(service.startMeeting(meeting.meetingCode, outsider, randomUUID(), meeting.updatedAt.toISOString()));
    const started = await service.startMeeting(meeting.meetingCode, host, randomUUID(), meeting.updatedAt.toISOString());
    const joined = await service.joinMeeting(meeting.meetingCode, { userId: host, joinRequestId: randomUUID(), occurrenceId: started.meeting.activeOccurrenceId! });
    assert.equal(joined.participant.role, 'host');
    assert.equal(joined.participant.admission, 'admitted');
    await assert.rejects(service.assignHost(meeting.id, outsider, owner), /before its session starts/);
    await service.endMeeting(meeting.meetingCode, host, started.meeting.activeOccurrenceId!);
    const reassigned = await service.assignHost(meeting.id, null, owner);
    assert.equal(await canOpenAssignedMeeting(reassigned.meeting, host), false);
    await assert.rejects(service.startMeeting(meeting.meetingCode, host, randomUUID(), reassigned.meeting.updatedAt.toISOString()));
    const scheduled = await service.createMeeting({ title: 'Assigned scheduled session', schedule: { localDateTime: '2030-01-07T09:00', timeZone: 'UTC' }, assignedHostUserId: host }, owner);
    await service.startMeeting(scheduled.meeting.meetingCode, host);
    const scheduledJoin = await service.joinMeeting(scheduled.meeting.meetingCode, { userId: host, joinRequestId: randomUUID() });
    assert.equal(scheduledJoin.participant.role, 'host');
    assert.equal(scheduledJoin.participant.admission, 'admitted');
    const guest = await service.joinMeeting(scheduled.meeting.meetingCode, { guestName: 'Invited guest', joinRequestId: randomUUID() });
    await service.decideAdmission(scheduled.meeting.meetingCode, guest.participant.id, true, host);
    const leave = await service.leaveMeeting(scheduled.meeting.meetingCode, { userId: host });
    assert.equal(leave.meetingEnded, false);
    await sql`update users set disabled_at=now() where id=${host}`;
    await assert.rejects(service.assignHost(meeting.id, host, owner), /active, verified/);
    const original = await sql`select migration_hash from drizzle.meeting_host_assignment_runs`;
    await sql`update drizzle.meeting_host_assignment_runs set migration_hash='bad'`;
    await assert.rejects(coordinateDisposableMigration(address, process.cwd(), undefined, true), /evidence/);
    await sql`update drizzle.meeting_host_assignment_runs set migration_hash=${original[0].migration_hash}`;
    await sql`alter table meetings alter column assigned_host_user_id set default gen_random_uuid()`;
    await assert.rejects(coordinateDisposableMigration(address, process.cwd(), undefined, true), /not ready/);
    await sql`alter table meetings alter column assigned_host_user_id drop default`;
  } finally { await sql.end(); await client.end(); }
});
