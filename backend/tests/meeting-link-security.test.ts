import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
process.env.DOTENV_CONFIG_PATH = 'tests/.unused';
process.env.DATABASE_URL = 'postgres://localhost/unused';
process.env.JWT_SECRET = 'meeting-link-test';
process.env.LIVEKIT_URL = 'wss://example.invalid';
process.env.LIVEKIT_API_KEY = 'test-only';
process.env.LIVEKIT_API_SECRET = 'test-only-secret';
const { meetingsRouter } = await import('../src/routers/meetings.js');
const { MeetingService } = await import('../src/services/meeting.service.js');
const { db } = await import('../src/db/index.js');

test('shared link never grants anonymous host controls', async () => {
  const caller = meetingsRouter.createCaller({ isAuthenticated: false, user: null } as never);
  const meetingCode = 'YLM-W8Z3SE';
  await assert.rejects(caller.decideAdmission({ meetingCode, participantId: randomUUID(), admit: true }), { code: 'UNAUTHORIZED' });
  await assert.rejects(caller.end({ meetingCode }), { code: 'UNAUTHORIZED' });
});

test('anonymous guest is created pending and can obtain media only by their admitted participant capability', async () => {
  const meeting = { id: randomUUID(), meetingCode: 'YLM-W8Z3SE', hostUserId: randomUUID(), status: 'live', scheduleType: null };
  const guestId = randomUUID(), joinRequestId = randomUUID();
  const original = { meeting: db.query.meetings.findFirst, participant: db.query.meetingParticipants.findFirst, insert: db.insert };
  db.query.meetings.findFirst = (async () => meeting) as any;
  db.query.meetingParticipants.findFirst = (async (query: any) => {
    const params = new PgDialect().sqlToQuery(query.where).params;
    return params.includes(guestId) ? { id: guestId, meetingId: meeting.id, userId: null, guestName: 'Guest Person', role: 'participant', admission: 'admitted', leftAt: null } : undefined;
  }) as any;
  db.insert = (() => ({ values: (value: any) => ({ onConflictDoNothing: () => ({ returning: async () => [{ id: guestId, ...value }] }) }) })) as any;
  try {
    const service = new MeetingService();
    const joined = await service.joinMeeting(meeting.meetingCode, { joinRequestId, guestName: 'Guest Person' });
    assert.equal(joined.participant.admission, 'pending');
    assert.equal(joined.participant.userId, null);
    await assert.rejects(service.createLiveKitToken(meeting.meetingCode, { participantId: randomUUID() }), { code: 'FORBIDDEN' });
    const token = await service.createLiveKitToken(meeting.meetingCode, { participantId: guestId });
    assert.equal(token.participantId, guestId);
  } finally {
    db.query.meetings.findFirst = original.meeting; db.query.meetingParticipants.findFirst = original.participant; db.insert = original.insert;
  }
});

test('authenticated new attendee is pending; a non-host cannot admit themselves', async () => {
  const host = randomUUID(), userId = randomUUID();
  const meeting = { id: randomUUID(), meetingCode: 'YLM-W8Z3SE', hostUserId: host, status: 'live', scheduleType: null };
  const original = { meeting: db.query.meetings.findFirst, participant: db.query.meetingParticipants.findFirst, insert: db.insert };
  db.query.meetings.findFirst = (async () => meeting) as any;
  db.query.meetingParticipants.findFirst = (async () => undefined) as any;
  db.insert = (() => ({ values: (value: any) => ({ onConflictDoNothing: () => ({ returning: async () => [{ id: randomUUID(), ...value }] }) }) })) as any;
  try {
    const service = new MeetingService();
    const result = await service.joinMeeting(meeting.meetingCode, { userId, joinRequestId: randomUUID() });
    assert.equal(result.participant.admission, 'pending');
    await assert.rejects(service.decideAdmission(meeting.meetingCode, result.participant.id, true, userId), { code: 'FORBIDDEN' });
  } finally {
    db.query.meetings.findFirst = original.meeting;
    db.query.meetingParticipants.findFirst = original.participant;
    db.insert = original.insert;
  }
});

test('media token query requires an admitted participant belonging to the signed-in user', async () => {
  const userId = randomUUID();
  const original = { meeting: db.query.meetings.findFirst, participant: db.query.meetingParticipants.findFirst };
  db.query.meetings.findFirst = (async () => ({ id: randomUUID(), status: 'live', scheduleType: null })) as any;
  db.query.meetingParticipants.findFirst = (async (query: any) => {
    const { params, sql } = new PgDialect().sqlToQuery(query.where);
    assert.ok(params.includes('admitted'));
    assert.ok(params.includes(userId));
    assert.match(sql, /left_at.*is null/);
    return undefined;
  }) as any;
  try {
    await assert.rejects(new MeetingService().createLiveKitToken('YLM-W8Z3SE', { userId }), { code: 'FORBIDDEN' });
  } finally {
    db.query.meetings.findFirst = original.meeting;
    db.query.meetingParticipants.findFirst = original.participant;
  }
});
