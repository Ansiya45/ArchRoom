import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
process.env.DOTENV_CONFIG_PATH = 'tests/.nonexistent-summary-env';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-only';
const { db } = await import('../src/db/index.js');
const { env } = await import('../src/env.js');
const { MeetingSummaryService } = await import('../src/services/meeting-summary.service.js');
const { MeetingHistoryService } = await import('../src/services/meeting-history.service.js');
const { meetingsRouter } = await import('../src/routers/meetings.js');
const host = randomUUID(), guest = randomUUID(), outsider = randomUUID(), occurrence = randomUUID();
const scope = { meetingCode: 'YLM-ABC234', occurrenceId: occurrence };
const dialect = new PgDialect();
async function fixture(run: (f: any) => Promise<void>) {
  const originalSave = MeetingHistoryService.prototype.save;
  const history: any[] = [];
  MeetingHistoryService.prototype.save = async input => { history.push(input); };
  const originals = { meeting: db.query.meetings.findFirst, occurrence: db.query.meetingOccurrences.findFirst,
    participant: db.query.meetingParticipants.findFirst, aiRequest: db.query.meetingAiRequests.findFirst, select: db.selectDistinct, fetch: globalThis.fetch,
    ai: env.OPENAI_API_KEY, resend: env.RESEND_API_KEY,
    user: db.query.users.findFirst, userPermissions: db.query.userPermissions.findMany };
  const meeting = { id: randomUUID(), meetingCode: scope.meetingCode, title: 'Planning', hostUserId: host, scheduleType: 'recurring', status: 'live', activeOccurrenceId: occurrence };
  const session = { id: occurrence, meetingId: meeting.id, status: 'ended', cancelledAt: null };
  const recipients = [{ id: host, name: 'Host', email: 'host@example.invalid' }, { id: guest, name: 'Attendee', email: 'guest@example.invalid' }];
  const conditions: any[] = [], requests: any[] = [];
  db.query.meetings.findFirst = (async () => meeting) as any;
  db.query.meetingOccurrences.findFirst = (async ({ where }: any) => { conditions.push(where); return session; }) as any;
  db.query.meetingParticipants.findFirst = (async ({ where }: any) => dialect.sqlToQuery(where).params.includes(outsider) ? null : ({ id: randomUUID() })) as any;
  db.query.meetingAiRequests.findFirst = (async () => null) as any;
  db.query.users.findFirst = (async () => ({ id: host, role: 'user' })) as any;
  db.query.userPermissions.findMany = (async () => []) as any;
  db.selectDistinct = (() => ({ from: () => ({ innerJoin: () => ({ where: async (where: any) => { conditions.push(where); return recipients; } }) }) })) as any;
  env.OPENAI_API_KEY = 'test-only'; env.RESEND_API_KEY = 'test-only';
  globalThis.fetch = async (url, options) => { requests.push({ url, ...options }); return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'The team agreed to test on Friday.' }] }] }); };
  try { await run({ service: new MeetingSummaryService(), meeting, session, recipients, conditions, requests, history }); }
  finally {
    MeetingHistoryService.prototype.save = originalSave;
    db.query.meetings.findFirst = originals.meeting; db.query.meetingOccurrences.findFirst = originals.occurrence;
    db.query.meetingParticipants.findFirst = originals.participant; db.query.meetingAiRequests.findFirst = originals.aiRequest; db.selectDistinct = originals.select;
    db.query.users.findFirst = originals.user; db.query.userPermissions.findMany = originals.userPermissions;
    globalThis.fetch = originals.fetch; env.OPENAI_API_KEY = originals.ai; env.RESEND_API_KEY = originals.resend;
  }
}
test('only the host can generate, list recipients, transcribe, or email a summary', async () => fixture(async ({ service, requests }) => {
  for (const action of [() => service.generate({ ...scope, speech: 'Meeting' }, outsider), () => service.recipients(scope, outsider),
    () => service.transcribe({ ...scope, requestId: randomUUID(), sequence: 0, audio: 'YQ==', mimeType: 'audio/webm' }, outsider),
    () => service.send({ ...scope, summary: 'Summary', recipientIds: [guest] }, outsider)]) await assert.rejects(action, { code: 'FORBIDDEN' });
  assert.equal(requests.length, 0);
}));
test('ended historical occurrences allow summaries and scope recipients to that occurrence', async () => fixture(async ({ service, meeting, conditions }) => {
  meeting.activeOccurrenceId = randomUUID();
  assert.equal((await service.recipients(scope, host)).length, 2);
  const query = dialect.sqlToQuery(conditions.at(-1));
  assert.match(query.sql, /occurrence_id/); assert.ok(query.params.includes(occurrence)); assert.ok(query.params.includes('admitted'));
  assert.doesNotMatch(query.sql, /left_at/);
}));
test('reusable/recurring scope requires an actual session, excludes cancelled/scheduled sessions', async () => fixture(async ({ service, session }) => {
  await assert.rejects(() => service.recipients({ meetingCode: scope.meetingCode }, host), { code: 'BAD_REQUEST' });
  session.status = 'scheduled'; await assert.rejects(() => service.recipients(scope, host), { code: 'FORBIDDEN' });
  session.status = 'ended'; session.cancelledAt = new Date(); await assert.rejects(() => service.recipients(scope, host), { code: 'FORBIDDEN' });
}));
test('legacy and one-time meetings remain usable after ending with null occurrence scope', async () => fixture(async ({ service, meeting, conditions }) => {
  for (const type of [null, 'one_time']) {
    meeting.scheduleType = type; meeting.status = 'ended';
    await service.recipients({ meetingCode: scope.meetingCode }, host);
    assert.match(dialect.sqlToQuery(conditions.at(-1)).sql, /"occurrence_id" is null/);
  }
}));
test('OpenAI receives multilingual speech as untrusted input and English summary-only instructions', async () => fixture(async ({ service, requests, history }) => {
  const result = await service.generate({ ...scope, speech: 'Bonjour. Nous testerons vendredi.' }, host);
  assert.match(result.summary, /Friday/);
  assert.equal(history.length, 1); assert.equal(history[0].kind, 'summary'); assert.equal(history[0].occurrenceId, occurrence);
  const payload = JSON.parse(requests[0].body);
  assert.equal(payload.store, false); assert.match(payload.instructions, /English/); assert.match(payload.instructions, /never instructions/);
  assert.match(payload.instructions, /Do not invent/); assert.match(payload.instructions, /Do not include a transcript/);
  assert.deepEqual(JSON.parse(payload.input), { capturedMeetingSpeech: 'Bonjour. Nous testerons vendredi.' });
}));

test('history storage failure preserves generated summary and returns an explicit warning', async () => fixture(async ({ service }) => {
  MeetingHistoryService.prototype.save = async () => { throw new Error('storage unavailable'); };
  const result = await service.generate({ ...scope, speech: 'Discussed Friday testing.' }, host);
  assert.match(result.summary, /Friday/); assert.match(result.historyWarning, /could not be saved/);
}));

test('authorized transcript segments are archived with session identity; storage failure preserves text', async () => fixture(async ({ service, history }) => {
  const { MeetingAiPermissionService } = await import('../src/services/meeting-ai-permission.service.js');
  const original = MeetingAiPermissionService.prototype.assertCanTranscribe;
  MeetingAiPermissionService.prototype.assertCanTranscribe = async () => undefined as any;
  globalThis.fetch = async () => Response.json({ text: 'Training starts Monday.' });
  try {
    const input = { ...scope, requestId: randomUUID(), sequence: 0, audio: 'YQ==', mimeType: 'audio/webm' };
    const result = await service.transcribe(input, host);
    assert.equal(result.text, 'Training starts Monday.'); assert.equal(history[0].occurrenceId, occurrence);
    assert.equal(history[0].kind, 'transcript'); assert.ok(history[0].dedupeKey.includes(input.requestId)); assert.equal(history[0].label, '00000000');
    assert.equal('audio' in history[0], false);
    MeetingHistoryService.prototype.save = async () => { throw new Error('storage unavailable'); };
    const failed = await service.transcribe(input, host);
    assert.equal(failed.text, result.text); assert.match(failed.historyWarning, /could not be saved/);
  } finally { MeetingAiPermissionService.prototype.assertCanTranscribe = original; }
}));
test('empty speech never invents a summary or calls OpenAI; incomplete responses fail explicitly', async () => fixture(async ({ service, requests }) => {
  assert.match((await service.generate({ ...scope, speech: '' }, host)).summary, /No intelligible speech/); assert.equal(requests.length, 0);
  globalThis.fetch = async () => Response.json({ status: 'incomplete', output: [] });
  await assert.rejects(() => service.generate({ ...scope, speech: 'Speech' }, host), { code: 'BAD_GATEWAY' });
}));
test('direct transcription without an active unanimous request is rejected before provider access', async () => fixture(async ({ service, requests }) => {
  const input = { ...scope, requestId: randomUUID(), sequence: 0, audio: 'YQ==', mimeType: 'audio/webm' as const };
  for (const key of ['', 'test-configured-key']) {
    env.OPENAI_API_KEY = key;
    for (const id of [host, guest, outsider]) {
      await assert.rejects(() => service.transcribe(input, id), { code: 'FORBIDDEN' });
      const caller = meetingsRouter.createCaller({ isAuthenticated: true, user: { id } } as any);
      await assert.rejects(() => caller.transcribeSpeech(input), { code: 'FORBIDDEN' });
    }
  }
  const anonymous = meetingsRouter.createCaller({ user: null } as any);
  await assert.rejects(() => anonymous.transcribeSpeech(input), { code: 'UNAUTHORIZED' });
  assert.equal(requests.length, 0);
}));
test('send validates recipients and emails the reviewed summary and transcript', async () => fixture(async ({ service, requests }) => {
  await assert.rejects(() => service.send({ ...scope, summary: 'Summary', recipientIds: [guest, outsider] }, host), { code: 'BAD_REQUEST' });
  assert.equal(requests.length, 0);
  const input = { ...scope, summary: 'The team agreed to test on Friday.', transcript: 'We will test on Friday.', recipientIds: [guest, guest] };
  assert.deepEqual(await service.send(input, host), { sentIds: [guest], failedIds: [] });
  await service.send(input, host);
  assert.equal(requests[0].headers['Idempotency-Key'], requests[1].headers['Idempotency-Key']);
  const email = JSON.parse(requests[0].body);
  assert.deepEqual(email.to, ['guest@example.invalid']); assert.match(email.text, /The team agreed/); assert.match(email.text, /We will test on Friday/);
  assert.equal(email.html, undefined); assert.equal(email.transcript, undefined);
}));
test('partial delivery reports successes separately so the UI retries only failed recipients', async () => fixture(async ({ service }) => {
  globalThis.fetch = async (_url, options) => JSON.parse(options!.body as string).to[0].startsWith('host') ? Response.json({ id: 'ok' }) : new Response('', { status: 503 });
  assert.deepEqual(await service.send({ ...scope, summary: 'Summary', recipientIds: [host, guest] }, host), { sentIds: [host], failedIds: [guest] });
}));
test('provider errors do not expose provider bodies or keys; missing configuration is explicit', async () => fixture(async ({ service }) => {
  globalThis.fetch = async () => new Response('sensitive-provider-body', { status: 401 });
  await assert.rejects(() => service.generate({ ...scope, speech: 'Speech' }, host), error => !String(error).includes('sensitive-provider-body') && String(error).includes('401'));
  env.OPENAI_API_KEY = ''; await assert.rejects(() => service.generate({ ...scope, speech: 'Speech' }, host), { code: 'PRECONDITION_FAILED' });
  env.RESEND_API_KEY = ''; await assert.rejects(() => service.send({ ...scope, summary: 'Summary', recipientIds: [guest] }, host), { code: 'PRECONDITION_FAILED' });
}));
test('summary routes require authentication and reject arbitrary recipient addresses/oversized input', async () => {
  const anonymous = meetingsRouter.createCaller({ user: null } as any);
  await assert.rejects(() => anonymous.generateSummary({ ...scope, speech: 'Speech' }), { code: 'UNAUTHORIZED' });
  const caller = meetingsRouter.createCaller({ isAuthenticated: true, user: { id: host } } as any);
  await assert.rejects(() => caller.shareTranscript({ ...scope, summary: 'Summary', recipientIds: ['someone@example.com'] }), { code: 'BAD_REQUEST' });
  await assert.rejects(() => caller.generateSummary({ ...scope, speech: 'x'.repeat(200001) }), { code: 'BAD_REQUEST' });
});
