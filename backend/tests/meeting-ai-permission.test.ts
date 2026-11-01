import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
process.env.DOTENV_CONFIG_PATH = 'tests/.nonexistent-ai-env';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-only';
const { db } = await import('../src/db/index.js');
const { MeetingAiPermissionService } = await import('../src/services/meeting-ai-permission.service.js');

test('transcription requires unanimous consent, and stale/stopped sessions and non-hosts cannot upload', async () => {
  const host = randomUUID(), guest = randomUUID(), meetingId = randomUUID(), requestId = randomUUID(), hostParticipantId = randomUUID();
  const request: any = { requestId, meetingId, occurrenceId: null, requestedByUserId: host, stoppedAt: null, lastHeartbeatAt: null };
  const original = { meeting: db.query.meetings.findFirst, participant: db.query.meetingParticipants.findFirst, participants: db.query.meetingParticipants.findMany, consents: db.query.meetingAiConsents.findMany, request: db.query.meetingAiRequests.findFirst, update: db.update };
  db.query.meetings.findFirst = (async () => ({ id: meetingId, meetingCode: 'YLM-TEST', scheduleType: 'one_time', status: 'live', hostUserId: host })) as any;
  const dialect = new PgDialect();
  db.query.meetingParticipants.findFirst = (async ({ where }: any) => {
    const query = dialect.sqlToQuery(where);
    // Scope lookup requires an admitted participant; host access separately
    // requires the host role. The guest must not match that second query.
    if (query.params.includes('host')) return undefined;
    const userId = query.params.includes(host) ? host : query.params.includes(guest) ? guest : undefined;
    return userId ? { id: randomUUID(), userId, role: userId === host ? 'host' : 'participant' } : undefined;
  }) as any;
  db.query.meetingParticipants.findMany = (async () => [{ id: hostParticipantId, userId: host, role: 'host', admission: 'admitted', leftAt: null }]) as any;
  let consents: any[] = [{ participantId: hostParticipantId, agreed: true }];
  db.query.meetingAiConsents.findMany = (async () => consents) as any;
  db.query.meetingAiRequests.findFirst = (async () => request) as any;
  let heartbeatWritten = false;
  db.update = (() => ({ set: () => ({ where: async () => { heartbeatWritten = true; return []; } }) })) as any;
  const service = new MeetingAiPermissionService(), input = { meetingCode: 'YLM-TEST', requestId };
  try {
    await service.heartbeat(input, host);
    assert.equal(heartbeatWritten, true, 'the first unanimous heartbeat must bootstrap capture');
    await assert.rejects(() => service.heartbeat(input, guest), { code: 'FORBIDDEN' });
    consents = []; request.lastHeartbeatAt = new Date();
    await assert.rejects(() => service.assertCanTranscribe(input, host), { code: 'FORBIDDEN' });
    await assert.rejects(() => service.assertCanTranscribe(input, guest), { code: 'FORBIDDEN' });
    request.lastHeartbeatAt = new Date(Date.now() - 11000);
    await assert.rejects(() => service.assertCanTranscribe(input, host), { code: 'FORBIDDEN' });
    request.lastHeartbeatAt = new Date(); request.stoppedAt = new Date(); consents = [{ participantId: hostParticipantId, agreed: false }];
    await assert.rejects(() => service.assertCanTranscribe(input, host), { code: 'FORBIDDEN' });
    assert.deepEqual(await service.status({ meetingCode: 'YLM-TEST' }, { userId: host }), { state: 'off', reason: 'declined' });
  } finally {
    db.query.meetings.findFirst = original.meeting; db.query.meetingParticipants.findFirst = original.participant; db.query.meetingParticipants.findMany = original.participants; db.query.meetingAiConsents.findMany = original.consents; db.query.meetingAiRequests.findFirst = original.request; db.update = original.update;
  }
});
