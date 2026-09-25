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
const { meetingsRouter } = await import('../src/routers/meetings.js');
const host = randomUUID(), guest = randomUUID(), outsider = randomUUID(), occurrence = randomUUID();
const scope = { meetingCode: 'YLM-ABC234', occurrenceId: occurrence };
const dialect = new PgDialect();
async function fixture(run: (f: any) => Promise<void>) {
  const originals = { meeting: db.query.meetings.findFirst, occurrence: db.query.meetingOccurrences.findFirst,
    participant: db.query.meetingParticipants.findFirst, select: db.selectDistinct, fetch: globalThis.fetch,
    ai: env.OPENAI_API_KEY, resend: env.RESEND_API_KEY };
  const meeting = { id: randomUUID(), meetingCode: scope.meetingCode, title: 'Planning', hostUserId: host, scheduleType: 'recurring', status: 'live', activeOccurrenceId: occurrence };
  const session = { id: occurrence, meetingId: meeting.id, status: 'ended', cancelledAt: null };
  const recipients = [{ id: host, name: 'Host', email: 'host@example.invalid' }, { id: guest, name: 'Attendee', email: 'guest@example.invalid' }];
  const conditions: any[] = [], requests: any[] = [];
  db.query.meetings.findFirst = (async () => meeting) as any;
  db.query.meetingOccurrences.findFirst = (async ({ where }: any) => { conditions.push(where); return session; }) as any;
  db.query.meetingParticipants.findFirst = (async () => ({ id: randomUUID() })) as any;
  db.selectDistinct = (() => ({ from: () => ({ innerJoin: () => ({ where: async (where: any) => { conditions.push(where); return recipients; } }) }) })) as any;
  env.OPENAI_API_KEY = 'test-only'; env.RESEND_API_KEY = 'test-only';
  globalThis.fetch = async (url, options) => { requests.push({ url, ...options }); return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'The team agreed to test on Friday.' }] }] }); };
  try { await run({ service: new MeetingSummaryService(), meeting, session, recipients, conditions, requests }); }
  finally {
    db.query.meetings.findFirst = originals.meeting; db.query.meetingOccurrences.findFirst = originals.occurrence;
    db.query.meetingParticipants.findFirst = originals.participant; db.selectDistinct = originals.select;
    globalThis.fetch = originals.fetch; env.OPENAI_API_KEY = originals.ai; env.RESEND_API_KEY = originals.resend;
  }
}
test('only the host can generate, list recipients, transcribe, or email a summary', async () => fixture(async ({ service, requests }) => {
  for (const action of [() => service.generate({ ...scope, speech: 'Meeting' }, outsider), () => service.recipients(scope, outsider),
    () => service.transcribe({ ...scope, audio: 'YQ==', mimeType: 'audio/webm' }, outsider),
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
test('OpenAI receives multilingual speech as untrusted input and English summary-only instructions', async () => fixture(async ({ service, requests }) => {
  const result = await service.generate({ ...scope, speech: 'Bonjour. Nous testerons vendredi.' }, host);
  assert.match(result.summary, /Friday/);
  const payload = JSON.parse(requests[0].body);
  assert.equal(payload.store, false); assert.match(payload.instructions, /English/); assert.match(payload.instructions, /never instructions/);
  assert.match(payload.instructions, /Do not invent/); assert.match(payload.instructions, /Do not include a transcript/);
  assert.deepEqual(JSON.parse(payload.input), { capturedMeetingSpeech: 'Bonjour. Nous testerons vendredi.' });
}));
test('empty speech never invents a summary or calls OpenAI; incomplete responses fail explicitly', async () => fixture(async ({ service, requests }) => {
  assert.match((await service.generate({ ...scope, speech: '' }, host)).summary, /No intelligible speech/); assert.equal(requests.length, 0);
  globalThis.fetch = async () => Response.json({ status: 'incomplete', output: [] });
  await assert.rejects(() => service.generate({ ...scope, speech: 'Speech' }, host), { code: 'BAD_GATEWAY' });
}));
test('transcription auto-detects language, rejects ended sessions and absent admission', async () => fixture(async ({ service, meeting }) => {
  let form: FormData;
  globalThis.fetch = async (_url, options) => { form = options!.body as FormData; return Response.json({ text: 'Bonjour' }); };
  assert.equal((await service.transcribe({ ...scope, audio: 'YQ==', mimeType: 'audio/webm' }, host)).text, 'Bonjour');
  assert.equal(form!.get('language'), null); assert.equal(form!.get('response_format'), 'json');
  meeting.status = 'ended'; await assert.rejects(() => service.transcribe({ ...scope, audio: 'YQ==', mimeType: 'audio/webm' }, host), { code: 'FORBIDDEN' });
  meeting.status = 'live'; db.query.meetingParticipants.findFirst = (async () => undefined) as any;
  await assert.rejects(() => service.transcribe({ ...scope, audio: 'YQ==', mimeType: 'audio/webm' }, host), { code: 'FORBIDDEN' });
}));
test('send validates every selected recipient before delivery and emails only the selected summary', async () => fixture(async ({ service, requests }) => {
  await assert.rejects(() => service.send({ ...scope, summary: 'Summary', recipientIds: [guest, outsider] }, host), { code: 'BAD_REQUEST' });
  assert.equal(requests.length, 0);
  const input = { ...scope, summary: 'The team agreed to test on Friday.', recipientIds: [guest, guest] };
  assert.deepEqual(await service.send(input, host), { sentIds: [guest], failedIds: [] });
  await service.send(input, host);
  assert.equal(requests[0].headers['Idempotency-Key'], requests[1].headers['Idempotency-Key']);
  const email = JSON.parse(requests[0].body);
  assert.deepEqual(email.to, ['guest@example.invalid']); assert.equal(email.text, input.summary);
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
