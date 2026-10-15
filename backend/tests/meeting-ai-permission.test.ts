import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
process.env.DOTENV_CONFIG_PATH = 'tests/.nonexistent-ai-env';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-only';
const { db } = await import('../src/db/index.js');
const { MeetingAiPermissionService } = await import('../src/services/meeting-ai-permission.service.js');

test('server accepts audio only for the requesting host after every present participant agrees', async () => {
  const host = randomUUID(), guest = randomUUID(), late = randomUUID(), meetingId = randomUUID(), requestId = randomUUID();
  const participants = [
    { id: randomUUID(), userId: host, role: 'host', admission: 'admitted', leftAt: null },
    { id: randomUUID(), userId: guest, role: 'participant', admission: 'admitted', leftAt: null },
  ];
  const decisions = new Map([[participants[0].id, true]]);
  const original = {
    meeting: db.query.meetings.findFirst, participant: db.query.meetingParticipants.findFirst,
    participants: db.query.meetingParticipants.findMany, request: db.query.meetingAiRequests.findFirst,
    consents: db.query.meetingAiConsents.findMany,
  };
  db.query.meetings.findFirst = (async () => ({ id: meetingId, meetingCode: 'YLM-TEST', scheduleType: 'one_time', status: 'live', hostUserId: host })) as any;
  db.query.meetingParticipants.findFirst = (async () => currentParticipant) as any;
  db.query.meetingParticipants.findMany = (async () => participants) as any;
  db.query.meetingAiRequests.findFirst = (async () => ({ requestId, meetingId, occurrenceId: null, requestedByUserId: host, stoppedAt: null, lastHeartbeatAt: null })) as any;
  db.query.meetingAiConsents.findMany = (async () => [...decisions].map(([participantId, agreed]) => ({ participantId, agreed }))) as any;
  let currentParticipant: any = participants[0];
  const service = new MeetingAiPermissionService();
  try {
    const input = { meetingCode: 'YLM-TEST', requestId };
    await assert.rejects(() => service.assertCanTranscribe(input, host), { code: 'FORBIDDEN' });
    decisions.set(participants[1].id, true);
    await service.assertCanTranscribe(input, host);
    currentParticipant = participants[1];
    await assert.rejects(() => service.assertCanTranscribe(input, guest), { code: 'FORBIDDEN' });
    currentParticipant = participants[0];
    const anonymous = { id: randomUUID(), userId: null, role: 'participant', admission: 'admitted', leftAt: null };
    participants.push(anonymous);
    currentParticipant = anonymous;
    const guestStatus = await service.status(input, { participantId: anonymous.id });
    assert.equal(guestStatus.needsResponse, true);
    decisions.set(anonymous.id, true);
    assert.equal((await service.status(input, { participantId: anonymous.id })).state, 'active');
    participants.pop(); decisions.delete(anonymous.id); currentParticipant = participants[0];
    participants.push({ id: randomUUID(), userId: late, role: 'participant', admission: 'admitted', leftAt: null });
    await assert.rejects(() => service.assertCanTranscribe(input, host), { code: 'FORBIDDEN' });
    participants.pop();
    decisions.set(participants[1].id, false);
    await assert.rejects(() => service.assertCanTranscribe(input, host), { code: 'FORBIDDEN' });
  } finally {
    db.query.meetings.findFirst = original.meeting; db.query.meetingParticipants.findFirst = original.participant;
    db.query.meetingParticipants.findMany = original.participants; db.query.meetingAiRequests.findFirst = original.request;
    db.query.meetingAiConsents.findMany = original.consents;
  }
});
