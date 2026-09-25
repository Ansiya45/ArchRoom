import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import { calendarExport, calendarRule, foldCalendarLine, meetingLink } from '../src/services/meeting-calendar.service.js';
process.env.DOTENV_CONFIG_PATH = 'tests/.nonexistent-notifications-env';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'notification-test-only-secret';
process.env.APP_PUBLIC_URL = 'https://ylaam.example';
process.env.RESEND_API_KEY = 'test-only-not-a-real-key';
const { db } = await import('../src/db/index.js');
const { meetings, meetingOccurrences, meetingInvitations, meetingDeliveries, meetingParticipants, users } = await import('../src/db/schema.js');
const { MeetingNotificationService, preferenceToken, invitationIdFromToken, notificationPayload } = await import('../src/services/meeting-notification.service.js');
const { MeetingReminderService, sendMeetingEmail, reminderKey } = await import('../src/services/meeting-reminder.service.js');
const { meetingNotificationsRouter } = await import('../src/routers/meeting-notifications.js');
const host = randomUUID(), other = randomUUID();
const now = new Date('2026-09-21T03:20:00Z'); // 08:50 Kolkata
const start = new Date('2026-09-21T03:30:00Z');
function meeting(patch: any = {}) {
  return { id: randomUUID(), hostUserId: host, meetingCode: 'YLM-ABC234', title: 'Team <review>', scheduledAt: start, timeZone: 'Asia/Kolkata', scheduleType: 'one_time', status: 'scheduled', recurrenceRule: null, activeOccurrenceId: null, createdAt: now, updatedAt: now, ...patch };
}
const dialect = new PgDialect();
const key = (column: string) => column.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
function matches(row: any, condition: any) {
  if (!condition) return true;
  const query = dialect.sqlToQuery(condition);
  for (const match of query.sql.matchAll(/"[^" ]+"\."([^" ]+)" (=|<=) \$(\d+)/g)) {
    let a = row[key(match[1])], b = query.params[+match[3]-1];
    if (a instanceof Date) { a = a.getTime(); b = new Date(b as string).getTime(); }
    if (match[2] === '=' ? a !== b : a > b) return false;
  }
  return true;
}
async function fixture(run: (f: any) => Promise<void>, patch: any = {}) {
  const base = meeting(patch);
  const rows = new Map<any, any[]>([[meetings,[base]],[meetingOccurrences,[]],[meetingInvitations,[]],[meetingDeliveries,[]],[meetingParticipants,[]],[users,[{ id: host, email: 'host@example.com', emailVerifiedAt: now }]]]);
  const original: any = { transaction: db.transaction, select: db.select, selectDistinct: db.selectDistinct, insert: db.insert, update: db.update };
  const originals: any[] = [];
  const clone = (row: any) => row ? { ...row } : undefined;
  const find = (table: any, many: boolean) => async ({ where }: any) => many ? rows.get(table)!.filter(r => matches(r, where)).map(clone) : clone(rows.get(table)!.find(r => matches(r, where)));
  const query: any = {};
  for (const [name, table] of Object.entries({ meetings, meetingOccurrences, meetingInvitations, meetingDeliveries, users })) {
    query[name] = { findFirst: find(table,false), findMany: find(table,true) };
    const source = (db.query as any)[name]; originals.push([source, source.findFirst, source.findMany]); Object.assign(source, query[name]);
  }
  const select = (fields?: any) => ({ from: (table: any) => ({ where: (where: any) => {
    const get = () => rows.get(table)!.filter(r => matches(r,where)).map(r => fields ? Object.fromEntries(Object.entries(fields).map(([name,col]: any) => [name,r[key(col.name)]])) : clone(r));
    return { for: async () => get(), limit: async (n: number) => get().slice(0,n), orderBy: () => ({ limit: async (n: number) => get().slice(0,n) }), then: (resolve: any, reject: any) => Promise.resolve(get()).then(resolve,reject) };
  } }) });
  const update = (table: any) => ({ set: (patch: any) => ({ where: (where: any) => {
    const apply = () => rows.get(table)!.filter(r => matches(r,where)).map(r => { Object.assign(r,patch); return clone(r); });
    return { returning: async () => apply(), then: (resolve: any,reject: any) => Promise.resolve().then(apply).then(resolve,reject) };
  } }) });
  const insert = (table: any) => ({ values: (values: any) => {
    const apply = (conflict?: any) => {
      const existing = rows.get(table)!.find(r => table === meetingDeliveries ? r.deliveryKey === values.deliveryKey : table === meetingInvitations ? r.meetingId === values.meetingId && r.email === values.email : false);
      if (existing && conflict) { if (conflict.set && (!conflict.setWhere || matches(existing,conflict.setWhere))) Object.assign(existing,conflict.set); return []; }
      const row = { id: randomUUID(), createdAt: now, status: 'pending', attempts: 0, firstAttemptAt: null, sentAt: null, occurrenceId: null, payload: null, remindersEnabled: false, ...values };
      rows.get(table)!.push(row); return [clone(row)];
    };
    return { returning: async () => apply(), onConflictDoNothing: async () => apply({}), onConflictDoUpdate: async (config: any) => apply(config), then: (resolve: any,reject: any) => Promise.resolve().then(() => apply()).then(resolve,reject) };
  } });
  const tx = { query, select, insert, update };
  let tail = Promise.resolve();
  db.transaction = ((fn: any) => { const result = tail.then(() => fn(tx)); tail = result.then(() => {}, () => {}); return result; }) as any;
  db.select = select as any; db.selectDistinct = select as any; db.insert = insert as any; db.update = update as any;
  const sent: any[] = [];
  const sender = async (payload: any, id: string) => { sent.push({ payload: { ...payload }, id }); };
  const service = new MeetingNotificationService(), worker = new MeetingReminderService(sender);
  const subscribe = () => { const row = { id: randomUUID(), meetingId: base.id, email: 'guest@example.com', remindersEnabled: true, createdAt: now }; rows.get(meetingInvitations)!.push(row); return row; };
  try { await run({ rows, base, service, worker, sent, sender, subscribe }); }
  finally { Object.assign(db, original); for (const [source,first,many] of originals) { source.findFirst = first; source.findMany = many; } }
}

test('Google draft preserves wall time, RRULE, timezone and YLAAM link without conference creation', () => {
  const m = meeting({ scheduleType: 'recurring', recurrenceRule: { frequency: 'weekly', interval: 2, weekdays: [1,3], ends: { type: 'count', count: 10 } } });
  const result = calendarExport(m,'https://ylaam.example',now), url = new URL(result.googleUrl);
  assert.equal(url.searchParams.get('dates'), '20260921T090000/20260921T090000');
  assert.equal(url.searchParams.get('ctz'),'Asia/Kolkata');
  assert.equal(url.searchParams.get('recur'),'RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=MO;BYDAY=MO,WE;COUNT=10');
  assert.equal(url.searchParams.get('location'),'https://ylaam.example/meet/YLM-ABC234');
  assert.ok(!result.googleUrl.includes('conferenceData'));
  assert.ok(result.ics?.includes('DTSTART:20260921T033000Z')); assert.ok(!result.ics?.includes('RRULE'));
});
test('calendar until includes final local date across DST and no-time rooms cannot export', () => {
  const m = meeting({ scheduleType: 'recurring', timeZone: 'America/New_York', recurrenceRule: { frequency: 'daily', interval: 1, ends: { type: 'until', date: '2026-11-01' } } });
  assert.ok(calendarRule(m)?.endsWith('UNTIL=20261102T045900Z'));
  assert.throws(() => calendarExport(meeting({ scheduleType: 'reusable', scheduledAt: null }),'https://ylaam.example'));
});
test('ICS escapes injection, folds UTF-8 lines, retains one-time UID on reschedule', () => {
  const m = meeting({ title: 'Topic\r\nBEGIN:VEVENT,evil;\\' });
  const first = calendarExport(m,'https://ylaam.example',now).ics!;
  const second = calendarExport({ ...m, scheduledAt: new Date(start.getTime()+86400000) },'https://ylaam.example',now).ics!;
  assert.equal(first.match(/UID:.+/)![0],second.match(/UID:.+/)![0]);
  assert.equal(first.split('\r\nBEGIN:VEVENT').length,2);
  assert.ok(first.includes('\\nBEGIN:VEVENT\\,evil\\;\\\\'));
  for (const line of foldCalendarLine('SUMMARY:'+'?'.repeat(100)).split('\r\n')) assert.ok(Buffer.byteLength(line)<=75);
  assert.equal(meetingLink(m,'https://ylaam.example/some/path'),'https://ylaam.example/meet/YLM-ABC234');
});
test('preference capability is purpose scoped and rejects tampering', () => {
  const id = randomUUID(), token = preferenceToken(id);
  assert.equal(invitationIdFromToken(token),id);
  assert.throws(() => invitationIdFromToken(token+'x'));
  assert.throws(() => invitationIdFromToken(randomUUID()+'.'+token.split('.')[1]));
});
test('host invitation is deduplicated, private, opt-in and never participant admission', async () => {
  await fixture(async ({ service, base, rows }: any) => {
    await assert.rejects(service.invite(base.id,other,['guest@example.com']),{ code: 'FORBIDDEN' });
    await service.invite(base.id,host,['Guest@example.com','guest@example.com']);
    await service.invite(base.id,host,['guest@example.com']);
    assert.equal(rows.get(meetingInvitations).length,1); assert.equal(rows.get(meetingDeliveries).length,1);
    assert.equal(rows.get(meetingInvitations)[0].remindersEnabled,false); assert.equal(rows.get(meetingParticipants).length,0);
    await assert.rejects(service.info(base.id,other),{ code: 'FORBIDDEN' });
    const caller = meetingNotificationsRouter.createCaller({ user: null } as any);
    await assert.rejects(caller.invite({ meetingId: base.id, emails: ['guest@example.com'] }), { code: 'UNAUTHORIZED' });
  });
});
test('unverified host cannot send invitations', async () => {
  await fixture(async ({ service, base, rows }: any) => {
    rows.get(users)[0].emailVerifiedAt = null;
    await assert.rejects(service.invite(base.id,host,['guest@example.com']),{ code: 'PRECONDITION_FAILED' });
    assert.equal(rows.get(meetingDeliveries).length,0);
  });
});
test('recipient opts in/out using capability; reusable reminder opt-in is rejected', async () => {
  await fixture(async ({ service, subscribe, rows, base }: any) => {
    const invitation = subscribe(), token = preferenceToken(invitation.id);
    await service.setPreferences(token,false); assert.equal(invitation.remindersEnabled,false);
    await service.setPreferences(token,true); assert.equal(invitation.remindersEnabled,true);
    rows.get(meetings)[0].scheduleType = 'reusable'; rows.get(meetings)[0].scheduledAt = null;
    await assert.rejects(service.setPreferences(token,true), { code: 'BAD_REQUEST' });
    await service.setPreferences(token,false); assert.equal(invitation.remindersEnabled,false);
    assert.equal(rows.get(meetingParticipants).length,0);
  });
});
test('one-time reminder is scheduled once at ten minutes and is not sent twice', async () => {
  await fixture(async ({ worker, subscribe, rows, sent }: any) => {
    subscribe(); await worker.plan(new Date(now.getTime()-1)); assert.equal(rows.get(meetingDeliveries).length,0);
    await worker.plan(now); await worker.plan(now); assert.equal(rows.get(meetingDeliveries).length,1);
    const job = rows.get(meetingDeliveries)[0]; assert.equal(job.dueAt.getTime(),now.getTime());
    const [first,duplicate] = await Promise.all([worker.prepare(job.id,now),worker.prepare(job.id,now)]);
    assert.ok(first); assert.equal(duplicate,null);
    await worker.deliver(first,now); await worker.deliver(first,now);
    assert.equal(sent.length,1); assert.equal(job.status,'sent');
  });
});
test('recurring reminders materialize without dashboard and reference their own occurrence', async () => {
  await fixture(async ({ worker, subscribe, rows }: any) => {
    const invitation = subscribe(); await worker.plan(now); await worker.plan(now);
    assert.equal(rows.get(meetingDeliveries).length,1);
    const job = rows.get(meetingDeliveries)[0], occurrence = rows.get(meetingOccurrences).find((o: any) => o.id === job.occurrenceId);
    assert.ok(occurrence); assert.equal(occurrence.scheduledAt.getTime(),start.getTime()); assert.equal(occurrence.startedAt,null);
    await worker.plan(new Date(now.getTime()+86400000));
    const second = rows.get(meetingDeliveries)[1]; assert.notEqual(second.occurrenceId,job.occurrenceId);
    assert.notEqual(second.deliveryKey,job.deliveryKey); assert.equal(rows.get(meetings).length,1);
    assert.equal(job.deliveryKey,reminderKey(invitation.id,occurrence.id,start));
  }, { scheduleType: 'recurring', recurrenceRule: { frequency: 'daily', interval: 1, ends: { type: 'never' } } });
});
test('rescheduling suppresses old reminder and queues new time under same meeting', async () => {
  await fixture(async ({ worker, subscribe, rows, sent, base }: any) => {
    subscribe(); await worker.plan(now); const job = rows.get(meetingDeliveries)[0], prepared = await worker.prepare(job.id,now);
    base.scheduledAt = new Date(start.getTime()+86400000);
    await worker.deliver(prepared,now); assert.equal(sent.length,0); assert.equal(job.status,'skipped');
    await worker.plan(new Date(now.getTime()+86400000)); assert.equal(rows.get(meetingDeliveries).length,2);
    assert.equal(rows.get(meetings)[0].id,base.id);
  });
});
test('unsubscribe, early start, ended and expired reminders are suppressed', async () => {
  for (const scenario of ['unsubscribe','live','ended','expired']) await fixture(async ({ worker, subscribe, rows, sent, base }: any) => {
    const invitation = subscribe(); await worker.plan(now); const job = rows.get(meetingDeliveries)[0], prepared = await worker.prepare(job.id,now);
    if (scenario === 'unsubscribe') invitation.remindersEnabled = false;
    if (scenario === 'live' || scenario === 'ended') base.status = scenario;
    await worker.deliver(prepared,scenario === 'expired' ? start : now);
    assert.equal(sent.length,0); assert.equal(job.status,'skipped');
  });
});
test('reusable and instant rooms never generate scheduled reminders', async () => {
  for (const type of ['reusable',null]) await fixture(async ({ worker, subscribe, rows }: any) => {
    subscribe(); await worker.plan(now); assert.equal(rows.get(meetingDeliveries).length,0);
  }, { scheduleType: type, scheduledAt: null });
});
test('provider failure retries fixed payload/key after restart and suppresses attempts outside dedupe window', async () => {
  await fixture(async ({ worker, subscribe, rows, base, sent, sender }: any) => {
    subscribe(); await worker.plan(now); const job = rows.get(meetingDeliveries)[0];
    const captured: any[] = [];
    const failing = new MeetingReminderService(async (payload,key) => { captured.push({payload,key}); throw new Error('network uncertainty'); });
    const first = await failing.prepare(job.id,now); await failing.deliver(first,now); assert.equal(job.status,'pending');
    base.title = 'Changed after attempt';
    const restarted = new MeetingReminderService(sender), next = new Date(now.getTime()+60000);
    const retry = await restarted.prepare(job.id,next); await restarted.deliver(retry,next);
    assert.deepEqual(sent[0].payload,captured[0].payload); assert.equal(sent[0].id,captured[0].key);
    job.status = 'pending'; job.dueAt = now; job.expiresAt = new Date(now.getTime()+48*3600000); job.kind = 'invitation';
    assert.equal(await restarted.prepare(job.id,new Date(now.getTime()+24*3600000)),null); assert.equal(job.status,'failed');
  });
});
test('email payload escapes HTML and sends one recipient with stable provider idempotency header', async () => {
  const m = meeting(), invitation = { id: randomUUID(), email: 'guest@example.com', meetingId: m.id, remindersEnabled: false, createdAt: now };
  const payload = notificationPayload(m,invitation,'invitation',start);
  assert.ok(payload.html.includes('Team &lt;review&gt;')); assert.ok(payload.html.includes('/meeting-notifications#')); assert.ok(!payload.html.includes('<review>'));
  const original = globalThis.fetch; let captured: any;
  globalThis.fetch = (async (_url, options) => { captured = options; return new Response('{}',{status:200}); }) as typeof fetch;
  try { await sendMeetingEmail(payload,'test-fixed-id'); assert.equal(captured.headers['Idempotency-Key'],'test-fixed-id'); assert.deepEqual(JSON.parse(captured.body).to,['guest@example.com']); }
  finally { globalThis.fetch = original; }
});

test('turning reminders back on reactivates only an unsent current reminder', async () => {
  await fixture(async ({ worker, subscribe, rows, sent }: any) => {
    const invitation = subscribe(); await worker.plan(now);
    const job = rows.get(meetingDeliveries)[0], first = await worker.prepare(job.id,now);
    invitation.remindersEnabled = false; await worker.deliver(first,now); assert.equal(job.status,'skipped');
    invitation.remindersEnabled = true; const later = new Date(now.getTime()+60000); await worker.plan(later);
    assert.equal(job.status,'pending'); const prepared = await worker.prepare(job.id,later); await worker.deliver(prepared,later);
    assert.equal(sent.length,1); assert.equal(job.status,'sent');
    await worker.plan(later); assert.equal(job.status,'sent'); assert.equal(rows.get(meetingDeliveries).length,1);
  });
});


test('moved recurring occurrence invalidates old reminder and keeps occurrence identity for the new time', async () => {
  await fixture(async ({ worker, subscribe, rows, sent }: any) => {
    subscribe(); await worker.plan(now);
    const originalJob = rows.get(meetingDeliveries)[0], prepared = await worker.prepare(originalJob.id,now);
    const occurrence = rows.get(meetingOccurrences).find((o: any) => o.id === originalJob.occurrenceId);
    const original = occurrence.originalScheduledAt.getTime();
    occurrence.scheduledAt = new Date(start.getTime()+86400000); occurrence.timeZone = 'America/New_York';
    await worker.deliver(prepared,now); assert.equal(originalJob.status,'skipped'); assert.equal(sent.length,0);
    const later = new Date(now.getTime()+86400000); await worker.plan(later);
    const updatedJob = rows.get(meetingDeliveries).find((j: any) => j.occurrenceId === occurrence.id && j.id !== originalJob.id);
    assert.ok(updatedJob); assert.equal(occurrence.originalScheduledAt.getTime(),original);
    const updated = await worker.prepare(updatedJob.id,later); await worker.deliver(updated,later);
    assert.equal(sent.length,1); assert.ok(sent[0].payload.html.includes('America/New_York'));
  }, { scheduleType: 'recurring', recurrenceRule: { frequency: 'daily', interval: 1, ends: { type: 'never' } } });
});
test('cancelled occurrence, superseded occurrence and cancelled series suppress reminders', async () => {
  for (const scenario of ['occurrence','superseded','series']) await fixture(async ({ worker, subscribe, rows, sent, base }: any) => {
    subscribe(); await worker.plan(now);
    const job = rows.get(meetingDeliveries)[0], prepared = await worker.prepare(job.id,now);
    if (scenario === 'series') base.recurrenceCancelledAt = now;
    else { const occurrence = rows.get(meetingOccurrences).find((o: any) => o.id === job.occurrenceId); occurrence.cancelledAt = now; occurrence.cancellationReason = scenario; }
    await worker.deliver(prepared,now); assert.equal(sent.length,0); assert.equal(job.status,'skipped');
    await worker.plan(now); assert.equal(job.status,'skipped');
  }, { scheduleType: 'recurring', recurrenceRule: { frequency: 'daily', interval: 1, ends: { type: 'never' } } });
});
test('cancelled series hides calendar and prevents invitation delivery and reminder opt-in', async () => {
  await fixture(async ({ worker, subscribe, rows, sent, base, service }: any) => {
    const invitation = subscribe(); await worker.plan(now);
    const job = rows.get(meetingDeliveries)[0]; job.kind = 'invitation'; const prepared = await worker.prepare(job.id,now);
    base.recurrenceCancelledAt = now;
    await worker.deliver(prepared,now); assert.equal(sent.length,0); assert.equal(job.status,'skipped');
    const preferences = await service.preferences(preferenceToken(invitation.id));
    assert.equal(preferences.cancelled,true); assert.equal(preferences.calendar,null); assert.equal(preferences.canRemind,false);
    await assert.rejects(service.setPreferences(preferenceToken(invitation.id),true),{ code: 'BAD_REQUEST' });
    await assert.rejects(service.invite(base.id,host,['new@example.com']),{ code: 'CONFLICT' });
  }, { scheduleType: 'recurring', recurrenceRule: { frequency: 'daily', interval: 1, ends: { type: 'never' } } });
});
test('exception calendar uses actual occurrence/timezone and stable child UID without obsolete RRULE', () => {
  const parent = meeting({ scheduleType: 'recurring', recurrenceEditedAt: now, recurrenceRule: { frequency: 'daily', interval: 1, ends: { type: 'never' } } });
  const occurrence = { id: randomUUID(), scheduledAt: new Date('2030-01-01T20:00:00Z'), timeZone: 'America/New_York' };
  const first = calendarExport(parent,'https://ylaam.example',now,occurrence);
  const second = calendarExport(parent,'https://ylaam.example',now,{ ...occurrence, scheduledAt: new Date('2030-01-02T20:00:00Z') });
  const url = new URL(first.googleUrl);
  assert.equal(url.searchParams.get('dates'),'20300101T150000/20300101T150000'); assert.equal(url.searchParams.get('recur'),null);
  assert.equal(first.ics!.match(/UID:.+/)![0],second.ics!.match(/UID:.+/)![0]); assert.equal(first.exceptions,true);
});
