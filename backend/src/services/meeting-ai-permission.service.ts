import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/index.js';
import { meetingAiConsents, meetingAiRequests, meetingParticipants, meetings } from '../db/schema.js';
import { assertCurrentOccurrence, participantScope } from './meeting-occurrence.service.js';
import { canManageMeetingSession } from './meeting-host-access.js';
import { env } from '../env.js';

type Scope = { meetingCode: string; occurrenceId?: string };
type ParticipantIdentity = { userId?: string; participantId?: string };

export class MeetingAiPermissionService {
  private async consentState(meeting: any, requestId: string) {
    const participants = await db.query.meetingParticipants.findMany({ where: and(eq(meetingParticipants.meetingId, meeting.id), participantScope(meeting), eq(meetingParticipants.admission, 'admitted'), isNull(meetingParticipants.leftAt)) });
    const consents = await db.query.meetingAiConsents.findMany({ where: eq(meetingAiConsents.requestId, requestId) });
    const byId = new Map(consents.map(row => [row.participantId, row.agreed]));
    const pending = participants.filter(row => !byId.has(row.id)).length;
    const declined = participants.filter(row => byId.get(row.id) === false).length;
    return { participants, pending, declined, active: participants.length > 0 && pending === 0 && declined === 0, agreedParticipantIds: participants.filter(row => byId.get(row.id) === true).map(row => row.id) };
  }
  private async scope(input: Scope, identity: ParticipantIdentity) {
    const meeting = await db.query.meetings.findFirst({ where: eq(meetings.meetingCode, input.meetingCode.trim().toUpperCase()) });
    if (!meeting || meeting.status !== 'live') throw new TRPCError({ code: 'FORBIDDEN', message: 'The meeting is not active.' });
    assertCurrentOccurrence(meeting, input.occurrenceId);
    const participant = await db.query.meetingParticipants.findFirst({ where: and(
      eq(meetingParticipants.meetingId, meeting.id), participantScope(meeting),
      identity.userId ? eq(meetingParticipants.userId, identity.userId)
        : eq(meetingParticipants.id, identity.participantId || '00000000-0000-0000-0000-000000000000'),
      eq(meetingParticipants.admission, 'admitted'),
      isNull(meetingParticipants.leftAt),
    ) });
    if (!participant) throw new TRPCError({ code: 'FORBIDDEN', message: 'Join the meeting first.' });
    return { meeting, participant };
  }

  async request(input: Scope, userId: string) {
    if (!env.OPENAI_API_KEY) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'AI transcription is not configured.' });
    const { meeting } = await this.scope(input, { userId });
    if (!await canManageMeetingSession(meeting, userId, input.occurrenceId)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Only a host can request transcription.' });
    const requestId = randomUUID();
    await db.transaction(async tx => {
      await tx.insert(meetingAiRequests).values({ meetingId: meeting.id, occurrenceId: input.occurrenceId, requestId, requestedByUserId: userId })
        .onConflictDoUpdate({ target: meetingAiRequests.meetingId, set: {
          occurrenceId: input.occurrenceId ?? null, requestId, requestedByUserId: userId, requestedAt: new Date(), lastHeartbeatAt: null, stoppedAt: null,
        } });
      const hostParticipant = await tx.query.meetingParticipants.findFirst({ where: and(eq(meetingParticipants.meetingId, meeting.id), participantScope(meeting), eq(meetingParticipants.userId, userId), eq(meetingParticipants.admission, 'admitted'), isNull(meetingParticipants.leftAt)) });
      if (hostParticipant) await tx.insert(meetingAiConsents).values({ requestId, participantId: hostParticipant.id, agreed: true }).onConflictDoNothing();
    });
    return { requestId };
  }

  async status(input: Scope, identity: ParticipantIdentity) {
    const { meeting } = await this.scope(input, identity);
    const request = await db.query.meetingAiRequests.findFirst({ where: eq(meetingAiRequests.meetingId, meeting.id) });
    if (!request || request.occurrenceId !== (input.occurrenceId ?? null)) return { state: 'off' as const };
    if (request.stoppedAt) {
      const consents = await db.query.meetingAiConsents.findMany({ where: eq(meetingAiConsents.requestId, request.requestId) });
      return { state: 'off' as const, reason: consents.some(row => row.agreed === false) ? 'declined' as const : 'stopped' as const };
    }
    const state = await this.consentState(meeting, request.requestId);
    const own = await db.query.meetingParticipants.findFirst({ where: and(eq(meetingParticipants.meetingId, meeting.id), participantScope(meeting), identity.userId ? eq(meetingParticipants.userId, identity.userId) : eq(meetingParticipants.id, identity.participantId || ''), eq(meetingParticipants.admission, 'admitted'), isNull(meetingParticipants.leftAt)) });
    const ownConsent = own ? await db.query.meetingAiConsents.findFirst({ where: and(eq(meetingAiConsents.requestId, request.requestId), eq(meetingAiConsents.participantId, own.id)) }) : undefined;
    return { state: state.active ? 'active' as const : 'pending' as const, requestId: request.requestId, requestedByUserId: request.requestedByUserId,
      capturing: state.active && Boolean(request.lastHeartbeatAt && Date.now() - request.lastHeartbeatAt.getTime() < 10000), pending: state.pending, declined: state.declined,
      needsResponse: !ownConsent, ownDecision: ownConsent?.agreed ?? null, agreedParticipantIds: state.agreedParticipantIds, participantIds: state.participants.map(row => row.id) };
  }

  async respond(input: Scope & { requestId: string; agree: boolean }, identity: ParticipantIdentity) {
    const { meeting } = await this.scope(input, identity);
    const request = await db.query.meetingAiRequests.findFirst({ where: eq(meetingAiRequests.meetingId, meeting.id) });
    if (!request || request.stoppedAt || request.requestId !== input.requestId || request.occurrenceId !== (input.occurrenceId ?? null)) {
      throw new TRPCError({ code: 'CONFLICT', message: 'That transcription request is no longer active.' });
    }
    const participant = await db.query.meetingParticipants.findFirst({ where: and(eq(meetingParticipants.meetingId, meeting.id), participantScope(meeting), identity.participantId ? eq(meetingParticipants.id, identity.participantId) : identity.userId ? eq(meetingParticipants.userId, identity.userId) : eq(meetingParticipants.id, ''), eq(meetingParticipants.admission, 'admitted'), isNull(meetingParticipants.leftAt)) });
    if (!participant) throw new TRPCError({ code: 'FORBIDDEN', message: 'Join the meeting first.' });
    await db.insert(meetingAiConsents).values({ requestId: input.requestId, participantId: participant.id, agreed: input.agree }).onConflictDoUpdate({ target: [meetingAiConsents.requestId, meetingAiConsents.participantId], set: { agreed: input.agree, decidedAt: new Date() } });
    if (!input.agree) await db.update(meetingAiRequests).set({ stoppedAt: new Date(), lastHeartbeatAt: null }).where(and(eq(meetingAiRequests.meetingId, meeting.id), eq(meetingAiRequests.requestId, input.requestId), isNull(meetingAiRequests.stoppedAt)));
    return { ok: true };
  }

  async stop(input: Scope & { requestId: string }, userId: string) {
    const { meeting } = await this.scope(input, { userId });
    if (!await canManageMeetingSession(meeting, userId, input.occurrenceId)) throw new TRPCError({ code: 'FORBIDDEN' });
    const [stopped] = await db.update(meetingAiRequests).set({ stoppedAt: new Date() }).where(and(
      eq(meetingAiRequests.meetingId, meeting.id), eq(meetingAiRequests.requestId, input.requestId), isNull(meetingAiRequests.stoppedAt),
    )).returning();
    if (!stopped) throw new TRPCError({ code: 'CONFLICT', message: 'Transcription is already off.' });
    return { ok: true };
  }

  async heartbeat(input: Scope & { requestId: string }, userId: string) {
    const { meeting } = await this.scope(input, { userId });
    const request = await db.query.meetingAiRequests.findFirst({ where: eq(meetingAiRequests.meetingId, meeting.id) });
    const consent = request && !request.stoppedAt ? await this.consentState(meeting, request.requestId) : null;
    if (!request || request.stoppedAt || !consent?.active || request.requestId !== input.requestId ||
      request.occurrenceId !== (input.occurrenceId ?? null) || !await canManageMeetingSession(meeting, userId, input.occurrenceId)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Transcription requires unanimous consent and an active request from the meeting host.' });
    }
    await db.update(meetingAiRequests).set({ lastHeartbeatAt: new Date() }).where(and(
      eq(meetingAiRequests.meetingId, meeting.id), eq(meetingAiRequests.requestId, input.requestId), isNull(meetingAiRequests.stoppedAt),
    ));
    return { ok: true };
  }

  async assertCanTranscribe(input: Scope & { requestId: string }, userId: string) {
    const { meeting } = await this.scope(input, { userId });
    const request = await db.query.meetingAiRequests.findFirst({ where: eq(meetingAiRequests.meetingId, meeting.id) });
    const consent = request && !request.stoppedAt ? await this.consentState(meeting, request.requestId) : null;
    if (!request || request.stoppedAt || !consent?.active || request.requestId !== input.requestId || request.occurrenceId !== (input.occurrenceId ?? null) ||
      !request.lastHeartbeatAt || Date.now() - request.lastHeartbeatAt.getTime() >= 10000 ||
      !await canManageMeetingSession(meeting, userId, input.occurrenceId)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Transcription requires an active request from the meeting host.' });
    }
  }
}
