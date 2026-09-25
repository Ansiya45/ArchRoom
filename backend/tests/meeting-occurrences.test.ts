import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
process.env.DOTENV_CONFIG_PATH = 'tests/.nonexistent-occurrence-env';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-only';
process.env.LIVEKIT_URL = 'wss://example.invalid';
process.env.LIVEKIT_API_KEY = 'test-key';
process.env.LIVEKIT_API_SECRET = 'test-secret-for-local-token-tests';
const { db } = await import('../src/db/index.js');
const { meetings, meetingOccurrences, meetingParticipants, recordings } = await import('../src/db/schema.js');
const { MeetingService } = await import('../src/services/meeting.service.js');
const { MeetingOccurrenceService, assertCurrentOccurrence, mediaRoomName, attachmentPrefix } = await import('../src/services/meeting-occurrence.service.js');
const { RecordingService } = await import('../src/services/recording.service.js');
const { ChatAttachmentService } = await import('../src/services/chat-attachment.service.js');
const { meetingsRouter } = await import('../src/routers/meetings.js');
const host = randomUUID(), attendee = randomUUID();
const dialect = new PgDialect();
const key = (column: string) => column.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
function matches(row: any, condition: any) {
  if (!condition) return true;
  const query = dialect.sqlToQuery(condition);
  for (const match of query.sql.matchAll(/"[^" ]+"\."([^" ]+)" = \$(\d+)/g)) {
    const actual = row[key(match[1])], expected = query.params[+match[2] - 1];
    if (actual instanceof Date ? actual.toISOString() !== new Date(expected as string).toISOString() : actual !== expected) return false;
  }
  for (const match of query.sql.matchAll(/"[^" ]+"\."([^" ]+)" is null/g)) {
    if (row[key(match[1])] != null) return false;
  }
  return true;
}
// Serializing transaction double models the parent FOR UPDATE lock. It evaluates
// the real SQL predicates rather than returning an unconditional matching row.
async function fixture(run: (f: any) => Promise<void>) {
  const original = { transaction: db.transaction, update: db.update, insert: db.insert, occurrence: db.query.meetingOccurrences.findFirst,
    meeting: db.query.meetings.findFirst, participant: db.query.meetingParticipants.findFirst,
    user: db.query.users.findFirst };
  const rows = new Map<any, any[]>([[meetings, []], [meetingOccurrences, []], [meetingParticipants, []], [recordings, []]]);
  const find = (table: any) => async ({ where }: any) => rows.get(table)!.find(row => matches(row, where));
  const update = (table: any) => ({ set: (patch: any) => ({ where: (where: any) => {
    const apply = () => rows.get(table)!.filter(row => matches(row, where)).map(row => { Object.assign(row, patch); return { ...row }; });
    return { returning: async () => apply(), then: (resolve: any, reject: any) => Promise.resolve().then(apply).then(resolve, reject) };
  } }) });
  const tx = {
    query: { meetingOccurrences: { findFirst: find(meetingOccurrences), findMany: async ({ where }: any) => rows.get(meetingOccurrences)!.filter(row => matches(row, where)).map(row => ({ ...row })) }, meetingParticipants: { findFirst: find(meetingParticipants) } },
    select: () => ({ from: (table: any) => ({ where: (where: any) => ({ for: async () => rows.get(table)!.filter(row => matches(row, where)).map(row => ({ ...row })) }) }) }),
    insert: (table: any) => ({ values: (values: any) => {
      const row = { id: randomUUID(), status: table === meetingOccurrences ? 'live' : 'scheduled',
        activeOccurrenceId: null, occurrenceId: null, leftAt: null, endedAt: null,
        createdAt: new Date(), updatedAt: new Date(), joinedAt: new Date(), startedAt: new Date(), ...values };
      rows.get(table)!.push(row);
      return { returning: async () => [{ ...row }] };
    } }), update,
  };
  let tail = Promise.resolve();
  db.transaction = ((callback: any) => {
    const next = tail.then(() => callback(tx)); tail = next.then(() => {}, () => {}); return next;
  }) as any;
  db.update = update as any;
  db.insert = tx.insert as any;
  db.query.meetingOccurrences.findFirst = find(meetingOccurrences) as any;
  db.query.meetings.findFirst = find(meetings) as any;
  db.query.meetingParticipants.findFirst = find(meetingParticipants) as any;
  db.query.users.findFirst = (async () => ({ fullName: 'Test member' })) as any;
  const service = new MeetingService();
  try {
    const { meeting } = await service.createMeeting({ title: 'Team Room', reusable: true, meetingCode: 'YLM-ABC234' }, host);
    const open = async () => service.startMeeting(meeting.meetingCode, host, randomUUID(), rows.get(meetings)![0].updatedAt.toISOString());
    await run({ rows, meeting, service, open, sessions: new MeetingOccurrenceService() });
  } finally {
    db.transaction = original.transaction; db.update = original.update; db.insert = original.insert; db.query.meetingOccurrences.findFirst = original.occurrence;
    db.query.meetings.findFirst = original.meeting; db.query.meetingParticipants.findFirst = original.participant; db.query.users.findFirst = original.user;
  }
}

test('reusable creation uses one parent, no time, no premature participant/session rows', async () => {
  await fixture(async ({ rows, meeting, service }: any) => {
    assert.equal(meeting.scheduleType, 'reusable'); assert.equal(meeting.scheduledAt, null);
    assert.equal(meeting.timeZone, null); assert.equal(meeting.activeOccurrenceId, null);
    assert.equal(rows.get(meetings).length, 1); assert.equal(rows.get(meetingParticipants).length, 0);
    assert.equal(rows.get(meetingOccurrences).length, 0);
    await assert.rejects(service.createMeeting({ title: 'Bad', reusable: true, startNow: true }, host), { code: 'BAD_REQUEST' });
    await assert.rejects(service.rescheduleMeeting(meeting.id, { localDateTime: '2026-09-20T12:00', timeZone: 'Asia/Kolkata' }, host), { code: 'CONFLICT' });
  });
});

test('only host opens a session; simultaneous starts resolve to one occurrence', async () => {
  await fixture(async ({ rows, meeting, service, open }: any) => {
    await assert.rejects(service.startMeeting(meeting.meetingCode, attendee, randomUUID(), meeting.updatedAt.toISOString()), { code: 'FORBIDDEN' });
    await assert.rejects(service.startMeeting(meeting.meetingCode, host), { code: 'BAD_REQUEST' });
    const [a, b] = await Promise.all([open(), open()]);
    assert.equal(a.meeting.activeOccurrenceId, b.meeting.activeOccurrenceId);
    assert.equal(rows.get(meetingOccurrences).length, 1); assert.equal(rows.get(meetings).length, 1);
  });
});

test('closed room rejects joins; each use requires fresh admission and preserves old attendance', async () => {
  await fixture(async ({ rows, meeting, service, open }: any) => {
    const request = randomUUID();
    await assert.rejects(service.joinMeeting(meeting.meetingCode, { userId: attendee, joinRequestId: request }), { code: 'PRECONDITION_FAILED' });
    const first = (await open()).meeting;
    const identity = { userId: attendee, joinRequestId: request, occurrenceId: first.activeOccurrenceId };
    const joined = await service.joinMeeting(meeting.meetingCode, identity);
    assert.equal(joined.participant.admission, 'pending');
    const duplicate = await service.joinMeeting(meeting.meetingCode, identity);
    assert.equal(duplicate.participant.id, joined.participant.id);
    await service.decideAdmission(meeting.meetingCode, joined.participant.id, true, host, first.activeOccurrenceId);
    await service.endMeeting(meeting.meetingCode, host, first.activeOccurrenceId);
    const old = { ...rows.get(meetingParticipants)[0] };
    assert.ok(old.leftAt);
    const second = (await open()).meeting;
    assert.equal(second.id, first.id); assert.equal(second.meetingCode, first.meetingCode);
    assert.notEqual(second.activeOccurrenceId, first.activeOccurrenceId);
    const again = await service.joinMeeting(meeting.meetingCode, { ...identity, occurrenceId: second.activeOccurrenceId });
    assert.equal(again.participant.admission, 'pending'); assert.notEqual(again.participant.id, old.id);
    assert.deepEqual(rows.get(meetingParticipants)[0], old);
    assert.equal(rows.get(meetingOccurrences).length, 2);
    assert.equal(rows.get(meetings).length, 1);
    assert.equal((await service.getAdmissionStatus(meeting.meetingCode, old.id)).sessionEnded, true);
    await assert.rejects(service.rejoinMeeting(meeting.meetingCode, old.id, attendee, first.activeOccurrenceId), { code: 'PRECONDITION_FAILED' });
    await assert.rejects(service.rejoinMeeting(meeting.meetingCode, old.id, attendee, second.activeOccurrenceId), { code: 'FORBIDDEN' });
  });
});

test('a stale end, leave, moderation or start retry cannot affect the next use', async () => {
  await fixture(async ({ rows, meeting, service, open }: any) => {
    const startRequestId = randomUUID(), expected = meeting.updatedAt.toISOString();
    const first = (await service.startMeeting(meeting.meetingCode, host, startRequestId, expected)).meeting;
    await service.endMeeting(meeting.meetingCode, host, first.activeOccurrenceId);
    await assert.rejects(service.startMeeting(meeting.meetingCode, host, startRequestId, expected), { code: 'CONFLICT' });
    await assert.rejects(service.startMeeting(meeting.meetingCode, host, randomUUID(), expected), { code: 'CONFLICT' });
    const second = (await open()).meeting;
    await service.endMeeting(meeting.meetingCode, host, first.activeOccurrenceId);
    assert.equal(rows.get(meetings)[0].activeOccurrenceId, second.activeOccurrenceId);
    await assert.rejects(service.leaveMeeting(meeting.meetingCode, { userId: attendee, occurrenceId: first.activeOccurrenceId }), { code: 'PRECONDITION_FAILED' });
    await assert.rejects(service.decideAdmission(meeting.meetingCode, randomUUID(), true, host, first.activeOccurrenceId), { code: 'PRECONDITION_FAILED' });
    await assert.rejects(service.muteAllParticipants(meeting.meetingCode, host, first.activeOccurrenceId), { code: 'PRECONDITION_FAILED' });
  });
});

test('host joins directly; reconnect within a session retains admission without rewriting joinedAt', async () => {
  await fixture(async ({ rows, meeting, service, open }: any) => {
    const active = (await open()).meeting;
    const { participant } = await service.joinMeeting(meeting.meetingCode, { userId: host, joinRequestId: randomUUID(), occurrenceId: active.activeOccurrenceId });
    assert.equal(participant.role, 'host'); assert.equal(participant.admission, 'admitted');
    rows.get(meetingParticipants)[0].leftAt = new Date();
    const rejoined = await service.rejoinMeeting(meeting.meetingCode, participant.id, host, active.activeOccurrenceId);
    assert.equal(rejoined.participant.id, participant.id); assert.equal(rejoined.participant.leftAt, null);
    assert.equal(rejoined.participant.joinedAt, participant.joinedAt);
  });
});

test('tokens require current admitted identity and room names isolate later sessions', async () => {
  await fixture(async ({ meeting, service, open }: any) => {
    const first = (await open()).meeting;
    const { participant } = await service.joinMeeting(meeting.meetingCode, { userId: attendee, joinRequestId: randomUUID(), occurrenceId: first.activeOccurrenceId });
    const identity = { userId: attendee, participantId: participant.id, occurrenceId: first.activeOccurrenceId };
    await assert.rejects(service.createLiveKitToken(meeting.meetingCode, identity), { code: 'FORBIDDEN' });
    await service.decideAdmission(meeting.meetingCode, participant.id, true, host, first.activeOccurrenceId);
    const credentials = await service.createLiveKitToken(meeting.meetingCode, identity);
    const payload = JSON.parse(Buffer.from(credentials.token.split('.')[1], 'base64url').toString());
    assert.equal(payload.video.room, mediaRoomName(first));
    await service.endMeeting(meeting.meetingCode, host, first.activeOccurrenceId);
    const second = (await open()).meeting;
    assert.notEqual(mediaRoomName(first), mediaRoomName(second));
    assert.notEqual(attachmentPrefix(first), attachmentPrefix(second));
    await assert.rejects(service.createLiveKitToken(meeting.meetingCode, identity), { code: 'PRECONDITION_FAILED' });
    await assert.rejects(service.createLiveKitToken(meeting.meetingCode, { ...identity, occurrenceId: second.activeOccurrenceId }), { code: 'FORBIDDEN' });
  });
});

test('tRPC carries occurrence context and rejects omitted scope on reusable end', async () => {
  await fixture(async ({ meeting, open }: any) => {
    const caller = meetingsRouter.createCaller({ isAuthenticated: true, user: { id: host } } as never);
    const active = (await open()).meeting;
    await assert.rejects(caller.end({ meetingCode: meeting.meetingCode }), { code: 'BAD_REQUEST' });
    const { participant } = await caller.join({ meetingCode: meeting.meetingCode, joinRequestId: randomUUID(), occurrenceId: active.activeOccurrenceId });
    assert.equal(participant.occurrenceId, active.activeOccurrenceId);
    await caller.end({ meetingCode: meeting.meetingCode, occurrenceId: active.activeOccurrenceId });
    assert.equal((await caller.getByCode({ meetingCode: meeting.meetingCode })).meeting.status, 'scheduled');
  });
});


test('recording uploaded after session end keeps original occurrence; wrong parent/missing occurrence rejected', async () => {
  await fixture(async ({ rows, meeting, service, open }: any) => {
    const first = (await open()).meeting;
    await service.endMeeting(meeting.meetingCode, host, first.activeOccurrenceId);
    await open();
    const recordingService = new RecordingService();
    Object.assign(recordingService, {
      ensurePrivateBucket: async () => {},
      requireStorage: () => ({ storage: { from: () => ({ createSignedUploadUrl: async () => ({ data: { signedUrl: 'https://example.invalid/upload' }, error: null }) }) } }),
    });
    const input = { meetingCode: meeting.meetingCode, occurrenceId: first.activeOccurrenceId, fileName: 'call.webm', mimeType: 'video/webm', fileSize: 100, durationSeconds: 60 };
    const saved = await recordingService.createUpload(input, host);
    assert.equal(saved.recording.meetingId, meeting.id);
    assert.equal(saved.recording.occurrenceId, first.activeOccurrenceId);
    assert.ok(saved.recording.storagePath.includes(`/sessions/${first.activeOccurrenceId}/`));
    await assert.rejects(recordingService.createUpload({ ...input, occurrenceId: undefined }, host), { code: 'BAD_REQUEST' });
    await assert.rejects(recordingService.createUpload({ ...input, occurrenceId: randomUUID() }, host), { code: 'BAD_REQUEST' });
    await assert.rejects(recordingService.createUpload(input, attendee), { code: 'FORBIDDEN' });
    assert.equal(rows.get(recordings).length, 1);
  });
});

test('chat attachments are accessible only with current admission and current session path', async () => {
  await fixture(async ({ meeting, service, open }: any) => {
    const first = (await open()).meeting;
    await service.endMeeting(meeting.meetingCode, host, first.activeOccurrenceId);
    const second = (await open()).meeting;
    const { participant } = await service.joinMeeting(meeting.meetingCode, { userId: attendee, joinRequestId: randomUUID(), occurrenceId: second.activeOccurrenceId });
    const attachmentService = new ChatAttachmentService();
    let downloads = 0;
    Object.assign(attachmentService, { requireStorage: () => ({ storage: { from: () => ({ createSignedUrl: async () => { downloads++; return { data: { signedUrl: 'https://example.invalid/download' }, error: null }; } }) } }) });
    const identity = { userId: attendee, participantId: participant.id, occurrenceId: second.activeOccurrenceId };
    await assert.rejects(attachmentService.downloadUrl(meeting.meetingCode, attachmentPrefix(second) + 'file', 'file', identity), { code: 'FORBIDDEN' });
    await service.decideAdmission(meeting.meetingCode, participant.id, true, host, second.activeOccurrenceId);
    await assert.rejects(attachmentService.downloadUrl(meeting.meetingCode, attachmentPrefix(first) + 'file', 'file', identity), { code: 'FORBIDDEN' });
    await assert.rejects(attachmentService.downloadUrl(meeting.meetingCode, attachmentPrefix(second) + 'file', 'file', { ...identity, occurrenceId: first.activeOccurrenceId }), { code: 'PRECONDITION_FAILED' });
    await attachmentService.downloadUrl(meeting.meetingCode, attachmentPrefix(second) + 'file', 'file', identity);
    assert.equal(downloads, 1);
  });
});


test('summary recipients belong only to the selected room session', async () => {
  const { env } = await import('../src/env.js');
  const originalSelect = db.selectDistinct, originalFetch = globalThis.fetch, originalKey = env.RESEND_API_KEY;
  try {
    await fixture(async ({ rows, meeting, service, open }: any) => {
      const first = (await open()).meeting;
      const old = await service.joinMeeting(meeting.meetingCode, { userId: attendee, joinRequestId: randomUUID(), occurrenceId: first.activeOccurrenceId });
      await service.decideAdmission(meeting.meetingCode, old.participant.id, true, host, first.activeOccurrenceId);
      await service.endMeeting(meeting.meetingCode, host, first.activeOccurrenceId);
      const second = (await open()).meeting;
      const currentUser = randomUUID();
      const current = await service.joinMeeting(meeting.meetingCode, { userId: currentUser, joinRequestId: randomUUID(), occurrenceId: second.activeOccurrenceId });
      await service.decideAdmission(meeting.meetingCode, current.participant.id, true, host, second.activeOccurrenceId);
      db.selectDistinct = (() => ({ from: () => ({ innerJoin: () => ({ where: async (condition: any) => rows.get(meetingParticipants).filter((row: any) => matches(row, condition)).map((row: any) => ({ id: row.userId, name: 'Attendee', email: row.userId + '@example.invalid' })) }) }) })) as any;
      const recipients: string[] = [];
      env.RESEND_API_KEY = 'fake-test-key';
      globalThis.fetch = async (_url, options) => { recipients.push(...JSON.parse(options!.body as string).to); return new Response('{}'); };
      const { MeetingSummaryService } = await import('../src/services/meeting-summary.service.js');
      await new MeetingSummaryService().send({ meetingCode: meeting.meetingCode, occurrenceId: second.activeOccurrenceId, summary: 'Summary', recipientIds: [currentUser] }, host);
      assert.deepEqual(recipients, [currentUser + '@example.invalid']);
    });
  } finally { db.selectDistinct = originalSelect; globalThis.fetch = originalFetch; env.RESEND_API_KEY = originalKey; }
});


test('recurring occurrences materialize once, retain parent link, and isolate consecutive admissions', async () => {
  await fixture(async ({ rows, service, sessions }: any) => {
    const { meeting } = await service.createMeeting({ title: 'Weekly', meetingCode: 'YLM-DEF234', schedule: { localDateTime: '2026-09-17T23:30', timeZone: 'Asia/Kolkata' }, recurrence: { frequency: 'weekly', interval: 1, weekdays: [4], ends: { type: 'count', count: 2 } } }, host);
    assert.equal(meeting.scheduleType, 'recurring');
    await assert.rejects(sessions.upcoming(meeting.meetingCode, attendee, '2026-09-17'), { code: 'FORBIDDEN' });
    const a = await sessions.upcoming(meeting.meetingCode, host, '2026-09-17');
    const b = await sessions.upcoming(meeting.meetingCode, host, '2026-09-17');
    assert.deepEqual(a.occurrences.map((o: any) => o.id), b.occurrences.map((o: any) => o.id));
    assert.equal(a.occurrences.length, 2); assert.equal(a.occurrences[0].startedAt, null);
    assert.equal(a.occurrences[0].scheduledAt.toISOString(), '2026-09-17T18:00:00.000Z');
    assert.equal(rows.get(meetingParticipants).length, 0);
    const open = (id?: string) => service.startMeeting(meeting.meetingCode, host, randomUUID(), rows.get(meetings).find((m: any) => m.id === meeting.id).updatedAt.toISOString(), id);
    await assert.rejects(open(), { code: 'BAD_REQUEST' });
    await assert.rejects(open(randomUUID()), { code: 'CONFLICT' });
    const [first, duplicate] = await Promise.all([open(a.occurrences[0].id), open(a.occurrences[0].id)]);
    assert.equal(first.meeting.activeOccurrenceId, duplicate.meeting.activeOccurrenceId);
    await assert.rejects(open(a.occurrences[1].id), { code: 'CONFLICT' });
    const joined = await service.joinMeeting(meeting.meetingCode, { userId: attendee, joinRequestId: randomUUID(), occurrenceId: a.occurrences[0].id });
    await service.decideAdmission(meeting.meetingCode, joined.participant.id, true, host, a.occurrences[0].id);
    await service.endMeeting(meeting.meetingCode, host, a.occurrences[0].id);
    await assert.rejects(open(a.occurrences[0].id), { code: 'CONFLICT' });
    const second = await open(a.occurrences[1].id);
    assert.equal(first.meeting.id, second.meeting.id); assert.equal(first.meeting.meetingCode, second.meeting.meetingCode);
    assert.notEqual(mediaRoomName(first.meeting), mediaRoomName(second.meeting));
    const fresh = await service.joinMeeting(meeting.meetingCode, { userId: attendee, joinRequestId: randomUUID(), occurrenceId: a.occurrences[1].id });
    assert.equal(fresh.participant.admission, 'pending'); assert.notEqual(fresh.participant.id, joined.participant.id);
    await assert.rejects(service.createLiveKitToken(meeting.meetingCode, { userId: attendee, participantId: joined.participant.id, occurrenceId: a.occurrences[0].id }), { code: 'PRECONDITION_FAILED' });
    await assert.rejects(service.rescheduleMeeting(meeting.id, { localDateTime: '2026-09-20T12:00', timeZone: 'Asia/Kolkata' }, host), { code: 'CONFLICT' });
    assert.equal((await sessions.upcoming(meeting.meetingCode, host, '2026-10-01')).occurrences.length, 0);
    assert.equal(rows.get(meetings).filter((m: any) => m.id === meeting.id).length, 1);
  });
});


const { RecurrenceSeriesService } = await import('../src/services/recurrence-series.service.js');
async function seriesFixture(run: (f: any) => Promise<void>) {
  await fixture(async (f: any) => {
    const { meeting } = await f.service.createMeeting({ title: 'Daily series', meetingCode: 'YLM-XYZ234', schedule: { localDateTime: '2030-01-07T09:00', timeZone: 'America/New_York' }, recurrence: { frequency: 'daily', interval: 1, ends: { type: 'count', count: 10 } } }, host);
    const page = await f.sessions.upcoming(meeting.meetingCode,host,'2030-01-07',6);
    const parent = () => f.rows.get(meetings).find((row: any) => row.id === meeting.id);
    const edits = new RecurrenceSeriesService();
    const change = (patch: any, user = host) => edits.change({ meetingCode: meeting.meetingCode, expectedUpdatedAt: parent().updatedAt.toISOString(), ...patch },user,new Date('2029-12-01T12:00:00Z'));
    const row = (id: string) => f.rows.get(meetingOccurrences).find((item: any) => item.id === id);
    const start = (id: string) => f.service.startMeeting(meeting.meetingCode,host,randomUUID(),parent().updatedAt.toISOString(),id);
    await run({ ...f, series: meeting, page, parent, change, row, start });
  });
}
test('single occurrence edit preserves identity/original date and appears at its moved date', async () => {
  await seriesFixture(async ({ series, page, change, row, sessions, parent }: any) => {
    const original = page.occurrences[0], untouched = { ...row(page.occurrences[1].id) };
    await change({ action: 'edit_occurrence', occurrenceId: original.id, schedule: { localDateTime: '2030-02-01T11:00', timeZone: 'Asia/Kolkata' } });
    const moved = row(original.id);
    assert.equal(moved.id,original.id); assert.equal(moved.originalScheduledAt.getTime(),original.originalScheduledAt.getTime());
    assert.equal(moved.scheduledAt.toISOString(),'2030-02-01T05:30:00.000Z'); assert.equal(moved.timeZone,'Asia/Kolkata');
    assert.deepEqual(row(untouched.id),untouched);
    const later = await sessions.upcoming(series.meetingCode,host,'2030-02-01');
    assert.equal(later.occurrences[0].id,original.id);
    assert.equal(parent().id,series.id); assert.equal(parent().meetingCode,series.meetingCode);
  });
});
test('cancel one occurrence never regenerates or starts it and leaves another occurrence usable', async () => {
  await seriesFixture(async ({ series, page, change, row, sessions, start, parent }: any) => {
    const selected = page.occurrences[0];
    await change({ action: 'cancel_occurrence', occurrenceId: selected.id });
    assert.equal(row(selected.id).cancellationReason,'host_cancelled');
    const again = await sessions.upcoming(series.meetingCode,host,'2030-01-07');
    assert.equal(again.occurrences[0].id,selected.id); assert.ok(again.occurrences[0].cancelledAt);
    await assert.rejects(start(selected.id),{ code: 'CONFLICT' });
    await start(page.occurrences[1].id); assert.equal(parent().activeOccurrenceId,page.occurrences[1].id);
  });
});
test('future revision retains prior completed history and earlier unstarted dates under same parent', async () => {
  await seriesFixture(async ({ series, page, change, row, sessions, start, service, parent, rows }: any) => {
    await start(page.occurrences[0].id); await service.endMeeting(series.meetingCode,host,page.occurrences[0].id);
    const historical = { ...row(page.occurrences[0].id) }, prior = { ...row(page.occurrences[1].id) };
    await change({ action: 'edit_future', occurrenceId: page.occurrences[2].id, schedule: { localDateTime: '2030-01-09T08:00', timeZone: 'America/New_York' }, recurrence: { frequency: 'weekly', interval: 1, weekdays: [3], ends: { type: 'count', count: 2 } } });
    assert.deepEqual(row(historical.id),historical); assert.deepEqual(row(prior.id),prior);
    assert.equal(row(page.occurrences[2].id).cancellationReason,'superseded');
    assert.equal(parent().recurrenceRevision,1); assert.equal(parent().recurrenceHistory.length,1);
    const next = await sessions.upcoming(series.meetingCode,host,'2030-01-07');
    const fresh = next.occurrences.filter((o: any) => o.recurrenceRevision === 1);
    assert.deepEqual(fresh.map((o: any) => o.scheduledAt.toISOString()),['2030-01-09T13:00:00.000Z','2030-01-16T13:00:00.000Z']);
    assert.equal(rows.get(meetings).filter((m: any) => m.id === series.id).length,1);
    await assert.rejects(start(page.occurrences[2].id),{ code: 'CONFLICT' });
    await start(fresh[0].id); assert.equal(parent().meetingCode,series.meetingCode);
  });
});
test('same instant in a revised series gets a distinct child without colliding with old history', async () => {
  await seriesFixture(async ({ series, page, change, sessions, row }: any) => {
    const original = page.occurrences[0];
    await change({ action: 'edit_future', occurrenceId: original.id, schedule: { localDateTime: '2030-01-07T09:00', timeZone: 'America/New_York' }, recurrence: { frequency: 'daily', interval: 2, ends: { type: 'count', count: 2 } } });
    const fresh = (await sessions.upcoming(series.meetingCode,host,'2030-01-07')).occurrences[0];
    assert.notEqual(fresh.id,original.id); assert.equal(fresh.originalScheduledAt.getTime(),original.originalScheduledAt.getTime());
    assert.equal(fresh.recurrenceRevision,1); assert.equal(row(original.id).cancellationReason,'superseded');
  });
});
test('series cancellation is terminal, retry safe, and preserves ended children', async () => {
  await seriesFixture(async ({ series, page, change, start, service, row, parent, sessions, rows }: any) => {
    await start(page.occurrences[0].id); await service.endMeeting(series.meetingCode,host,page.occurrences[0].id);
    const old = { ...row(page.occurrences[0].id) };
    await change({ action: 'cancel_series' }); const count = rows.get(meetingOccurrences).length;
    assert.ok(parent().recurrenceCancelledAt); assert.deepEqual(row(old.id),old);
    await change({ action: 'cancel_series' });
    await assert.rejects(start(page.occurrences[1].id),{ code: 'CONFLICT' });
    await sessions.upcoming(series.meetingCode,host,'2031-01-01'); assert.equal(rows.get(meetingOccurrences).length,count);
    await assert.rejects(change({ action: 'edit_occurrence', occurrenceId: page.occurrences[1].id, schedule: { localDateTime: '2030-01-08T10:00', timeZone: 'UTC' } }),{ code: 'CONFLICT' });
  });
});
test('non-host, foreign occurrence and stale edits are rejected without changing schedules', async () => {
  await seriesFixture(async ({ page, change, row, parent }: any) => {
    const original = { ...row(page.occurrences[0].id) }, version = parent().updatedAt.toISOString();
    await assert.rejects(change({ action: 'cancel_series' },attendee),{ code: 'FORBIDDEN' });
    await assert.rejects(change({ action: 'cancel_occurrence', occurrenceId: randomUUID() }),{ code: 'NOT_FOUND' });
    await change({ action: 'cancel_occurrence', occurrenceId: page.occurrences[1].id });
    await assert.rejects(change({ action: 'cancel_occurrence', occurrenceId: original.id, expectedUpdatedAt: version }),{ code: 'CONFLICT' });
    assert.deepEqual(row(original.id),original);
  });
});
test('live/completed ranges and past occurrences cannot be edited destructively', async () => {
  await seriesFixture(async ({ series, page, change, start, service, row }: any) => {
    await start(page.occurrences[3].id);
    await assert.rejects(change({ action: 'cancel_series' }),{ code: 'CONFLICT' });
    await assert.rejects(change({ action: 'cancel_occurrence', occurrenceId: page.occurrences[3].id }),{ code: 'CONFLICT' });
    await service.endMeeting(series.meetingCode,host,page.occurrences[3].id);
    await assert.rejects(change({ action: 'edit_future', occurrenceId: page.occurrences[1].id, schedule: { localDateTime: '2030-01-08T10:00', timeZone: 'UTC' }, recurrence: { frequency: 'daily', interval: 1, ends: { type: 'never' } } }),{ code: 'CONFLICT' });
    row(page.occurrences[0].id).scheduledAt = new Date('2020-01-01T00:00:00Z');
    await assert.rejects(change({ action: 'cancel_occurrence', occurrenceId: page.occurrences[0].id }),{ code: 'CONFLICT' });
  });
});
test('same-day moved occurrences paginate without omissions or duplicates', async () => {
  await seriesFixture(async ({ series, page, change, sessions }: any) => {
    for (const item of page.occurrences.slice(0,3)) await change({ action: 'edit_occurrence', occurrenceId: item.id, schedule: { localDateTime: '2030-02-01T10:00', timeZone: 'UTC' } });
    const ids: string[] = []; let after;
    for (let i=0;i<4;i++) {
      const result = await sessions.upcoming(series.meetingCode,host,'2030-02-01',1,after);
      ids.push(...result.occurrences.map((o: any) => o.id)); if (!result.nextCursor) break; after = result.nextCursor;
    }
    assert.equal(ids.length,3); assert.equal(new Set(ids).size,3);
    assert.deepEqual([...ids].sort(),page.occurrences.slice(0,3).map((o: any) => o.id).sort());
  });
});


test('unmaterialized earlier dates retain their archived rule and timezone after a future split', async () => {
  await seriesFixture(async ({ series, parent, sessions, change, row, page }: any) => {
    parent().recurrenceRule = { frequency: 'daily', interval: 1, ends: { type: 'never' } };
    row(page.occurrences[1].id).timeZone = null; // Child created before Phase 5.
    const march = await sessions.upcoming(series.meetingCode,host,'2030-03-20',2);
    await change({ action: 'edit_future', occurrenceId: march.occurrences[0].id, schedule: { localDateTime: '2030-03-20T20:00', timeZone: 'Asia/Kolkata' }, recurrence: { frequency: 'weekly', interval: 1, weekdays: [3], ends: { type: 'never' } } });
    const february = await sessions.upcoming(series.meetingCode,host,'2030-02-01',2);
    assert.equal(february.occurrences[0].scheduledAt.toISOString(),'2030-02-01T14:00:00.000Z');
    assert.equal(february.occurrences[0].timeZone,'America/New_York');
    const january = await sessions.upcoming(series.meetingCode,host,'2030-01-08',1);
    assert.equal(january.occurrences[0].timeZone,'America/New_York');
    assert.equal(parent().timeZone,'Asia/Kolkata');
  });
});
test('parallel edits with the same revision allow only one committed change', async () => {
  await seriesFixture(async ({ page, change, parent, row }: any) => {
    const expectedUpdatedAt = parent().updatedAt.toISOString();
    const results = await Promise.allSettled(page.occurrences.slice(0,2).map((item: any) => change({ action: 'cancel_occurrence', occurrenceId: item.id, expectedUpdatedAt })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length,1);
    assert.equal(results.filter(result => result.status === 'rejected').length,1);
    assert.equal(page.occurrences.slice(0,2).filter((item: any) => row(item.id).cancelledAt).length,1);
  });
});
test('recurrence edit router requires authentication and a valid expected revision timestamp', async () => {
  const anonymous = meetingsRouter.createCaller({ user: null } as any);
  await assert.rejects(anonymous.changeRecurrence({ meetingCode: 'YLM-XYZ234', action: 'cancel_series', expectedUpdatedAt: new Date().toISOString() }), { code: 'UNAUTHORIZED' });
  const caller = meetingsRouter.createCaller({ isAuthenticated: true, user: { id: host } } as any);
  await assert.rejects(caller.changeRecurrence({ meetingCode: 'YLM-XYZ234', action: 'cancel_series', expectedUpdatedAt: 'invalid' }), { code: 'BAD_REQUEST' });
});
