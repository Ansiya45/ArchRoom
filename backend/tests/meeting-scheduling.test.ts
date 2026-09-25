import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { resolveMeetingSchedule } from '../src/services/meeting-schedule.service.js';
import { localScheduleFields, formatMeetingTime, startMeetingOnce } from '../../frontend/src/lib/meetingSchedule.js';

// Isolated persistence doubles: no production env, database, email or media calls.
process.env.DOTENV_CONFIG_PATH = 'tests/.nonexistent-scheduling-env';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'scheduling-test-secret';
const { db } = await import('../src/db/index.js');
const { meetings } = await import('../src/db/schema.js');
const { MeetingService } = await import('../src/services/meeting.service.js');
const { meetingsRouter } = await import('../src/routers/meetings.js');
const hostId = '11111111-1111-4111-8111-111111111111';
const meetingId = '22222222-2222-4222-8222-222222222222';
const code = 'YLM-ABC234';
const schedule = { localDateTime: '2026-09-20T23:30', timeZone: 'Asia/Kolkata' };
const base = () => ({ id: meetingId, meetingCode: code, hostUserId: hostId, title: 'Product Discussion',
  scheduledAt: new Date('2026-09-20T18:00:00Z'), timeZone: schedule.timeZone,
  scheduleType: 'one_time', status: 'scheduled', createdAt: new Date(), updatedAt: new Date() });
async function withStore(initial: any, run: (store: any, service: InstanceType<typeof MeetingService>) => Promise<void>) {
  const original = { find: db.query.meetings.findFirst, transaction: db.transaction, update: db.update };
  const store = { meeting: initial, inserts: 0, participants: [] as any[], writes: 0, patch: null as any, condition: null as any, rejectUpdate: false };
  db.query.meetings.findFirst = (async () => store.meeting) as any;
  db.update = (() => ({ set: (patch: any) => ({ where: (condition: any) => ({ returning: async () => {
    store.condition = new PgDialect().sqlToQuery(condition); store.patch = patch;
    if (store.rejectUpdate) return [];
    store.writes++; store.meeting = { ...store.meeting, ...patch }; return [store.meeting];
  } }) }) })) as any;
  db.transaction = (async (callback: any) => callback({
    insert: (table: unknown) => ({ values: (values: any) => {
      if (table === meetings) {
        store.inserts++; store.meeting = { ...base(), ...values };
        return { returning: async () => [store.meeting] };
      }
      store.participants.push(values); return Promise.resolve();
    } }),
    update: (table: unknown) => ({ set: (patch: any) => ({ where: async () => {
      if (table === meetings) store.meeting = { ...store.meeting, ...patch };
    } }) }),
  })) as any;
  try { await run(store, new MeetingService()); }
  finally { db.query.meetings.findFirst = original.find; db.transaction = original.transaction; db.update = original.update; }
}

for (const [zone, local, utc] of [
  ['Asia/Kolkata', '2026-09-20T23:30', '2026-09-20T18:00:00.000Z'],
  ['America/New_York', '2026-07-20T23:30', '2026-07-21T03:30:00.000Z'],
  ['America/New_York', '2026-01-20T23:30', '2026-01-21T04:30:00.000Z'],
  ['Asia/Kathmandu', '2026-09-20T23:30', '2026-09-20T17:45:00.000Z'],
  ['Pacific/Auckland', '2026-09-20T00:00', '2026-09-19T12:00:00.000Z'],
]) test(`timezone conversion and UI round-trip: ${zone} ${local}`, () => {
  const result = resolveMeetingSchedule({ localDateTime: local, timeZone: zone });
  assert.equal(result.scheduledAt.toISOString(), utc); assert.equal(result.timeZone, zone);
  const fields = localScheduleFields(result.scheduledAt, zone);
  assert.equal(`${fields.date}T${fields.time}`, local);
});

test('invalid dates/zones and DST gaps/overlaps are explicitly rejected', () => {
  for (const input of [
    { ...schedule, localDateTime: '2026-02-30T23:30' }, { ...schedule, localDateTime: '2026-09-20T24:00' },
    { ...schedule, timeZone: 'Not/AZone' }, { ...schedule, timeZone: '+05:30' },
    { localDateTime: '2026-03-08T02:30', timeZone: 'America/New_York' },
    { localDateTime: '2026-11-01T01:30', timeZone: 'America/New_York' },
    { localDateTime: '2026-10-04T02:15', timeZone: 'Australia/Lord_Howe' },
  ]) assert.throws(() => resolveMeetingSchedule(input), { code: 'BAD_REQUEST' });
});

test('date fields follow the selected timezone at midnight; stored timezone is displayed', () => {
  const now = new Date('2026-09-20T00:30:00Z');
  assert.equal(localScheduleFields(now, 'America/Los_Angeles').date, '2026-09-19');
  assert.equal(localScheduleFields(now, 'Asia/Kolkata').date, '2026-09-20');
  assert.ok(formatMeetingTime({ ...base(), scheduledAt: base().scheduledAt.toISOString() } as any).includes('Asia/Kolkata'));
});

test('tRPC creates one classified scheduled parent, correct instant/zone and existing host admission', async () => {
  await withStore(null, async (store) => {
    const caller = meetingsRouter.createCaller({ isAuthenticated: true, user: { id: hostId } } as never);
    const result = await caller.create({ title: 'Product Discussion', meetingCode: code, schedule });
    assert.equal(store.inserts, 1); assert.equal(result.meeting.id, meetingId);
    assert.equal(result.meeting.meetingCode, code); assert.equal(result.meeting.status, 'scheduled');
    assert.equal(result.meeting.scheduleType, 'one_time'); assert.equal(result.meeting.timeZone, 'Asia/Kolkata');
    assert.equal(result.meeting.scheduledAt?.toISOString(), '2026-09-20T18:00:00.000Z');
    assert.equal(store.participants[0].admission, 'admitted'); assert.equal(store.participants[0].role, 'host');
  });
});

test('host rescheduling keeps ID/code/title and creates no duplicate parent', async () => {
  await withStore(base(), async (store) => {
    const caller = meetingsRouter.createCaller({ isAuthenticated: true, user: { id: hostId } } as never);
    const result = await caller.reschedule({ meetingId, schedule: { localDateTime: '2026-09-21T14:00', timeZone: 'America/New_York' } });
    assert.equal(result.meeting.id, meetingId); assert.equal(result.meeting.meetingCode, code);
    assert.equal(result.meeting.title, 'Product Discussion'); assert.equal(store.inserts, 0);
    assert.equal(result.meeting.scheduledAt?.toISOString(), '2026-09-21T18:00:00.000Z');
    assert.equal(result.meeting.timeZone, 'America/New_York');
    assert.equal(store.patch.id, undefined); assert.equal(store.patch.meetingCode, undefined);
    assert.ok(store.condition.sql.includes('"status" =')); assert.ok(store.condition.params.includes('scheduled'));
  });
});

test('non-host and anonymous rescheduling denied; non-host start denied', async () => {
  await withStore(base(), async (store, service) => {
    const caller = meetingsRouter.createCaller({ isAuthenticated: true, user: { id: 'someone-else' } } as never);
    await assert.rejects(caller.reschedule({ meetingId, schedule }), { code: 'FORBIDDEN' });
    await assert.rejects(service.startMeeting(code, 'someone-else'), { code: 'FORBIDDEN' });
    const anonymous = meetingsRouter.createCaller({ user: null } as never);
    await assert.rejects(anonymous.reschedule({ meetingId, schedule }), { code: 'UNAUTHORIZED' });
    assert.equal(store.writes, 0);
  });
});

test('start is idempotent; explicit one-time end prevents start/join/rejoin', async () => {
  await withStore(base(), async (store, service) => {
    assert.equal((await service.startMeeting(code, hostId)).meeting.status, 'live');
    await service.startMeeting(code, hostId); assert.equal(store.writes, 1);
    await service.endMeeting(code, hostId);
    await assert.rejects(service.startMeeting(code, hostId), { code: 'FORBIDDEN' });
    await assert.rejects(service.joinMeeting(code, { userId: hostId, joinRequestId: meetingId }), { code: 'FORBIDDEN' });
    await assert.rejects(service.rejoinMeeting(code, meetingId, hostId), { code: 'FORBIDDEN' });
  });
});

test('atomic start guard refuses an end racing with start', async () => {
  await withStore(base(), async (store, service) => {
    store.rejectUpdate = true;
    await assert.rejects(service.startMeeting(code, hostId), { code: 'FORBIDDEN' });
    assert.ok(store.condition.sql.includes('"schedule_type" is null'));
    assert.ok(store.condition.sql.includes('"status" <>')); assert.ok(store.condition.params.includes('ended'));
  });
});

test('atomic reschedule guard reports concurrent start/end as a conflict', async () => {
  await withStore(base(), async (store, service) => {
    store.rejectUpdate = true;
    await assert.rejects(service.rescheduleMeeting(meetingId, schedule, hostId), { code: 'CONFLICT' });
    assert.equal(store.writes, 0);
  });
});

test('legacy ended meetings still start without changing old timestamps or classification', async () => {
  await withStore({ ...base(), scheduleType: null, timeZone: null, status: 'ended' }, async (store, service) => {
    const before = store.meeting.scheduledAt;
    const result = await service.startMeeting(code, hostId);
    assert.equal(result.meeting.status, 'live'); assert.equal(result.meeting.scheduleType, null);
    assert.equal(result.meeting.timeZone, null); assert.equal(result.meeting.scheduledAt, before);
  });
});

test('instant creation and old scheduledAt clients preserve legacy behavior', async () => {
  for (const input of [{ startNow: true }, { scheduledAt: '2026-09-20T18:00:00Z' }]) {
    await withStore(null, async (store, service) => {
      const result = await service.createMeeting({ title: 'Quick meeting', meetingCode: code, ...input }, hostId);
      assert.equal(result.meeting.scheduleType, null); assert.equal(result.meeting.timeZone, null);
      assert.equal(result.meeting.status, 'startNow' in input ? 'live' : 'scheduled'); assert.equal(store.inserts, 1);
    });
  }
});

test('conflicting schedule and instant/legacy timestamp inputs fail before insertion', async () => {
  await withStore(null, async (store, service) => {
    await assert.rejects(service.createMeeting({ title: 'Bad', schedule, startNow: true }, hostId), { code: 'BAD_REQUEST' });
    await assert.rejects(service.createMeeting({ title: 'Bad', schedule, scheduledAt: '2026-09-20T00:00:00Z' }, hostId), { code: 'BAD_REQUEST' });
    assert.equal(store.inserts, 0);
  });
});

test('frontend waits for success before live/navigation and suppresses simultaneous Start clicks', async () => {
  const pending = new Set<string>(); const events: string[] = [];
  let resolve!: () => void;
  const response = new Promise<void>((done) => { resolve = done; });
  const start = async () => { events.push('request'); await response; };
  const onStarted = () => { events.push('live'); events.push('navigate'); };
  const first = startMeetingOnce(pending, code, start, onStarted);
  await startMeetingOnce(pending, code, start, onStarted);
  assert.deepEqual(events, ['request']); resolve(); await first;
  assert.deepEqual(events, ['request', 'live', 'navigate']); assert.equal(pending.size, 0);
});

test('failed frontend start never navigates and permits retry', async () => {
  const pending = new Set<string>(); let navigations = 0;
  await assert.rejects(startMeetingOnce(pending, code, async () => { throw new Error('Forbidden'); }, () => { navigations++; }));
  assert.equal(navigations, 0);
  await startMeetingOnce(pending, code, async () => {}, () => { navigations++; });
  assert.equal(navigations, 1);
});


test('live, ended, and legacy unscheduled rooms cannot be rescheduled', async () => {
  for (const initial of [{ ...base(), status: 'live' }, { ...base(), status: 'ended' },
    { ...base(), scheduleType: null, scheduledAt: null }]) {
    await withStore(initial, async (store, service) => {
      await assert.rejects(service.rescheduleMeeting(meetingId, schedule, hostId), { code: 'CONFLICT' });
      assert.equal(store.writes, 0); assert.equal(store.patch, null);
    });
  }
});

test('explicit rescheduling of a legacy scheduled meeting opts into one-time handling', async () => {
  await withStore({ ...base(), scheduleType: null, timeZone: null }, async (store, service) => {
    const result = await service.rescheduleMeeting(meetingId, schedule, hostId);
    assert.equal(result.meeting.id, meetingId); assert.equal(result.meeting.meetingCode, code);
    assert.equal(result.meeting.scheduleType, 'one_time'); assert.equal(result.meeting.timeZone, schedule.timeZone);
    assert.equal(store.inserts, 0);
  });
});
