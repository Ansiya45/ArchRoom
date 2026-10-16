import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
process.env.DOTENV_CONFIG_PATH = 'tests/.nonexistent-ai-env';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-only';
const { db } = await import('../src/db/index.js');
const { MeetingAiPermissionService } = await import('../src/services/meeting-ai-permission.service.js');

test('host enabled transcription needs no participant consent, but stale/stopped sessions and non-hosts cannot upload', async () => {
  const host = randomUUID(), guest = randomUUID(), meetingId = randomUUID(), requestId = randomUUID();
  const request: any = { requestId, meetingId, occurrenceId: null, requestedByUserId: host, stoppedAt: null, lastHeartbeatAt: new Date() };
  const original = { meeting: db.query.meetings.findFirst, participant: db.query.meetingParticipants.findFirst, request: db.query.meetingAiRequests.findFirst };
  db.query.meetings.findFirst = (async () => ({ id: meetingId, meetingCode: 'YLM-TEST', scheduleType: 'one_time', status: 'live', hostUserId: host })) as any;
  db.query.meetingParticipants.findFirst = (async ({ where }: any) => ({ id: randomUUID(), userId: guest })) as any;
  db.query.meetingAiRequests.findFirst = (async () => request) as any;
  const service = new MeetingAiPermissionService(), input = { meetingCode: 'YLM-TEST', requestId };
  try {
    await service.assertCanTranscribe(input, host);
    await assert.rejects(() => service.assertCanTranscribe(input, guest), { code: 'FORBIDDEN' });
    request.lastHeartbeatAt = new Date(Date.now() - 11000);
    await assert.rejects(() => service.assertCanTranscribe(input, host), { code: 'FORBIDDEN' });
    request.lastHeartbeatAt = new Date(); request.stoppedAt = new Date();
    await assert.rejects(() => service.assertCanTranscribe(input, host), { code: 'FORBIDDEN' });
  } finally {
    db.query.meetings.findFirst = original.meeting; db.query.meetingParticipants.findFirst = original.participant; db.query.meetingAiRequests.findFirst = original.request;
  }
});
