import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/index.js';
import { meetingAiConsents, meetingAiRequests, meetingParticipants, meetings } from '../db/schema.js';
import { assertCurrentOccurrence, participantScope } from './meeting-occurrence.service.js';
import { canManageMeetingSession } from './meeting-host-access.js';
import { aiConsentState } from './ai-consent-state.js';
import { env } from '../env.js';

type Scope = { meetingCode: string; occurrenceId?: string };
type ParticipantIdentity = { userId?: string; participantId?: string };

export class MeetingAiPermissionService {
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
    const { meeting, participant } = await this.scope(input, { userId });
    if (!await canManageMeetingSession(meeting, userId, input.occurrenceId)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Only a host can request transcription.' });
    const requestId = randomUUID();
    await db.transaction(async tx => {
      await tx.insert(meetingAiRequests).values({ meetingId: meeting.id, occurrenceId: input.occurrenceId, requestId, requestedByUserId: userId })
        .onConflictDoUpdate({ target: meetingAiRequests.meetingId, set: {
          occurrenceId: input.occurrenceId ?? null, requestId, requestedByUserId: userId, requestedAt: new Date(), lastHeartbeatAt: null, stoppedAt: null,
        } });
      // Requesting transcription is an explicit agreement by the requesting host.
      await tx.insert(meetingAiConsents).values({ requestId, participantId: participant.id, agreed: true });
    });
    return { requestId };
  }

  async status(input: Scope, identity: ParticipantIdentity) {
    const { meeting, participant } = await this.scope(input, identity);
    const request = await db.query.meetingAiRequests.findFirst({ where: eq(meetingAiRequests.meetingId, meeting.id) });
    if (!request || request.stoppedAt || request.occurrenceId !== (input.occurrenceId ?? null)) return { state: 'off' as const };
    const participants = await db.query.meetingParticipants.findMany({ where: and(
      eq(meetingParticipants.meetingId, meeting.id), participantScope(meeting),
      eq(meetingParticipants.admission, 'admitted'), isNull(meetingParticipants.leftAt),
    ) });
    const ids = participants.map(row => row.id);
    const consents = ids.length ? await db.query.meetingAiConsents.findMany({ where: and(
      eq(meetingAiConsents.requestId, request.requestId), inArray(meetingAiConsents.participantId, ids),
    ) }) : [];
    const decisions = new Map(consents.map(row => [row.participantId, row.agreed]));
    const { pending, declined, active, agreedParticipantIds } = aiConsentState(ids, decisions);
    return {
      state: active ? 'active' as const : 'waiting' as const,
      requestId: request.requestId, requestedByUserId: request.requestedByUserId,
      capturing: active && Boolean(request.lastHeartbeatAt && Date.now() - request.lastHeartbeatAt.getTime() < 5000),
      pending, declined, needsResponse: !decisions.has(participant.id),
      ownDecision: decisions.get(participant.id) ?? null,
      agreedParticipantIds,
      participantIds: ids,
    };
  }

  async respond(input: Scope & { requestId: string; agree: boolean }, identity: ParticipantIdentity) {
    const { meeting, participant } = await this.scope(input, identity);
    const request = await db.query.meetingAiRequests.findFirst({ where: eq(meetingAiRequests.meetingId, meeting.id) });
    if (!request || request.stoppedAt || request.requestId !== input.requestId || request.occurrenceId !== (input.occurrenceId ?? null)) {
      throw new TRPCError({ code: 'CONFLICT', message: 'That transcription request is no longer active.' });
    }
    await db.insert(meetingAiConsents).values({ requestId: input.requestId, participantId: participant.id, agreed: input.agree })
      .onConflictDoUpdate({ target: [meetingAiConsents.requestId, meetingAiConsents.participantId], set: { agreed: input.agree, decidedAt: new Date() } });
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
    await this.assertCanTranscribe(input, userId);
    const { meeting } = await this.scope(input, { userId });
    await db.update(meetingAiRequests).set({ lastHeartbeatAt: new Date() }).where(and(
      eq(meetingAiRequests.meetingId, meeting.id), eq(meetingAiRequests.requestId, input.requestId), isNull(meetingAiRequests.stoppedAt),
    ));
    return { ok: true };
  }

  async assertCanTranscribe(input: Scope & { requestId: string }, userId: string) {
    const state = await this.status(input, { userId });
    const { meeting } = await this.scope(input, { userId });
    if (state.state !== 'active' || state.requestId !== input.requestId || state.requestedByUserId !== userId ||
      !await canManageMeetingSession(meeting, userId, input.occurrenceId)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Transcription requires agreement from every current participant.' });
    }
  }
}
