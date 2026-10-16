import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/index.js';
import { meetingAiRequests, meetingParticipants, meetings } from '../db/schema.js';
import { assertCurrentOccurrence, participantScope } from './meeting-occurrence.service.js';
import { canManageMeetingSession } from './meeting-host-access.js';
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
    const { meeting } = await this.scope(input, { userId });
    if (!await canManageMeetingSession(meeting, userId, input.occurrenceId)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Only a host can request transcription.' });
    const requestId = randomUUID();
    await db.transaction(async tx => {
      await tx.insert(meetingAiRequests).values({ meetingId: meeting.id, occurrenceId: input.occurrenceId, requestId, requestedByUserId: userId })
        .onConflictDoUpdate({ target: meetingAiRequests.meetingId, set: {
          occurrenceId: input.occurrenceId ?? null, requestId, requestedByUserId: userId, requestedAt: new Date(), lastHeartbeatAt: null, stoppedAt: null,
        } });
    });
    return { requestId };
  }

  async status(input: Scope, identity: ParticipantIdentity) {
    const { meeting } = await this.scope(input, identity);
    const request = await db.query.meetingAiRequests.findFirst({ where: eq(meetingAiRequests.meetingId, meeting.id) });
    if (!request || request.stoppedAt || request.occurrenceId !== (input.occurrenceId ?? null)) return { state: 'off' as const };
    return {
      state: 'active' as const,
      requestId: request.requestId, requestedByUserId: request.requestedByUserId,
      capturing: Boolean(request.lastHeartbeatAt && Date.now() - request.lastHeartbeatAt.getTime() < 10000),
      pending: 0, declined: 0, needsResponse: false,
      ownDecision: true,
      agreedParticipantIds: [], participantIds: [],
    };
  }

  async respond(input: Scope & { requestId: string; agree: boolean }, identity: ParticipantIdentity) {
    const { meeting } = await this.scope(input, identity);
    const request = await db.query.meetingAiRequests.findFirst({ where: eq(meetingAiRequests.meetingId, meeting.id) });
    if (!request || request.stoppedAt || request.requestId !== input.requestId || request.occurrenceId !== (input.occurrenceId ?? null)) {
      throw new TRPCError({ code: 'CONFLICT', message: 'That transcription request is no longer active.' });
    }
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Transcription is controlled by the meeting host.' });
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
    const { meeting } = await this.scope(input, { userId });
    const request = await db.query.meetingAiRequests.findFirst({ where: eq(meetingAiRequests.meetingId, meeting.id) });
    if (!request || request.stoppedAt || request.requestId !== input.requestId || request.occurrenceId !== (input.occurrenceId ?? null) ||
      !request.lastHeartbeatAt || Date.now() - request.lastHeartbeatAt.getTime() >= 10000 ||
      !await canManageMeetingSession(meeting, userId, input.occurrenceId)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Transcription requires an active request from the meeting host.' });
    }
  }
}
