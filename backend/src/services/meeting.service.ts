import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull, isNotNull, ne, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { meetings, meetingParticipants, users } from '../db/schema.js';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { env } from '../env.js';
import { MeetingOccurrenceService, assertCurrentOccurrence, participantScope, mediaRoomName } from './meeting-occurrence.service.js';
import { resolveMeetingSchedule, type MeetingSchedule } from './meeting-schedule.service.js';

import { validateRecurrence, type RecurrenceRule } from './recurrence.service.js';

export type CreateMeetingInput = {
  title: string;
  meetingCode?: string;
  scheduledAt?: string | null;
  startNow?: boolean;
  schedule?: MeetingSchedule;
  reusable?: boolean;
  recurrence?: RecurrenceRule;
};

export type JoinMeetingIdentity = {
  userId: string;
  joinRequestId: string;
  occurrenceId?: string;
};

export class MeetingService {
  async createMeeting(input: CreateMeetingInput, hostUserId: string) {
    if (input.reusable && (input.schedule || input.scheduledAt || input.startNow)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Reusable rooms have no scheduled time. Create the room, then open it when needed.' });
    }
    if (input.schedule && (input.startNow || input.scheduledAt)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Provide one schedule for a Schedule Later meeting.' });
    }
    if (input.recurrence && (!input.schedule || input.reusable || input.startNow || input.scheduledAt)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Recurring meetings require a scheduled first occurrence.' });
    const recurrenceRule = input.recurrence ? validateRecurrence(input.schedule!, input.recurrence) : null;
    const schedule = input.schedule ? resolveMeetingSchedule(input.schedule) : null;
    const title = input.title.trim();
    if (!title) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Meeting title is required' });
    }

    const code = input.meetingCode
      ? await this.validateAvailableMeetingCode(input.meetingCode)
      : await this.generateUniqueMeetingCode();

    const meeting = await db.transaction(async (tx) => {
      const [createdMeeting] = await tx
        .insert(meetings)
        .values({
          title,
          hostUserId,
          meetingCode: code,
          scheduledAt: schedule?.scheduledAt ?? (input.scheduledAt ? new Date(input.scheduledAt) : null),
          scheduleType: input.recurrence ? 'recurring' : input.reusable ? 'reusable' : schedule ? 'one_time' : null,
          recurrenceRule,
          timeZone: schedule?.timeZone ?? null,
          status: input.startNow ? 'live' : 'scheduled',
        })
        .returning();

      if (!input.reusable && !input.recurrence) await tx.insert(meetingParticipants).values({
        meetingId: createdMeeting.id,
        userId: hostUserId,
        guestName: null,
        role: 'host',
        admission: 'admitted',
        joinedAt: new Date(),
        leftAt: null,
      });

      return createdMeeting;
    });

    return { ok: true, meeting };
  }

  async rescheduleMeeting(meetingId: string, input: MeetingSchedule, hostUserId: string) {
    const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, meetingId) });
    if (!meeting) throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found' });
    if (meeting.hostUserId !== hostUserId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the meeting host can reschedule this meeting' });
    }
    if ((meeting.scheduleType === 'reusable' || meeting.scheduleType === 'recurring') || meeting.status !== 'scheduled' || (!meeting.scheduledAt && meeting.scheduleType !== 'one_time')) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Only a scheduled, not-yet-started meeting can be rescheduled.' });
    }
    const schedule = resolveMeetingSchedule(input);
    const [updated] = await db.update(meetings).set({
      ...schedule, scheduleType: 'one_time', updatedAt: new Date(),
    }).where(and(
      eq(meetings.id, meetingId), eq(meetings.hostUserId, hostUserId),
      eq(meetings.status, 'scheduled'),
      or(eq(meetings.scheduleType, 'one_time'), isNotNull(meetings.scheduledAt)),
    )).returning();
    if (!updated) throw new TRPCError({ code: 'CONFLICT', message: 'Only a scheduled, not-yet-started meeting can be rescheduled.' });
    return { ok: true, meeting: updated };
  }

  async listMeetings(userId: string) {
    const rows = await db
      .select()
      .from(meetings)
      .where(eq(meetings.hostUserId, userId));

    const participants = await db
      .select({ meetingId: meetingParticipants.meetingId })
      .from(meetingParticipants)
      .where(and(eq(meetingParticipants.userId, userId), isNull(meetingParticipants.leftAt)));

    const participantMeetingIds = participants.map((row) => row.meetingId);

    const joined = participantMeetingIds.length
      ? await db.select().from(meetings).where(inArray(meetings.id, participantMeetingIds))
      : [];

    const uniqueMeetings = new Map([...rows, ...joined].map((meeting) => [meeting.id, meeting]));

    return { ok: true, meetings: [...uniqueMeetings.values()] };
  }

  async getByCode(meetingCode: string) {
    const normalizedCode = meetingCode.trim().toUpperCase();
    const result = await db.query.meetings.findFirst({
      where: eq(meetings.meetingCode, normalizedCode),
    });

    if (!result) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found' });
    }

    return { ok: true, meeting: result };
  }

  async joinMeeting(meetingCode: string, identity: JoinMeetingIdentity) {
    const normalizedCode = meetingCode.trim().toUpperCase();
    const meeting = await db.query.meetings.findFirst({
      where: eq(meetings.meetingCode, normalizedCode),
    });

    if (!meeting) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found' });
    }
    if ((meeting.scheduleType === 'reusable' || meeting.scheduleType === 'recurring')) return new MeetingOccurrenceService().join(meeting.id, identity.userId, identity.joinRequestId, identity.occurrenceId);
    if (meeting.status === 'ended') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This meeting has ended' });
    }

    if (identity.userId) {
      const existing = await db.query.meetingParticipants.findFirst({
        where: and(
          eq(meetingParticipants.meetingId, meeting.id), participantScope(meeting),
          eq(meetingParticipants.userId, identity.userId),
          isNull(meetingParticipants.leftAt)
        ),
      });

      if (existing) {
        return { ok: true, meeting, participant: existing };
      }

      const previouslyAdmitted = await db.query.meetingParticipants.findFirst({
        where: and(
          eq(meetingParticipants.meetingId, meeting.id), participantScope(meeting),
          eq(meetingParticipants.userId, identity.userId),
          eq(meetingParticipants.admission, 'admitted')
        ),
      });
      if (previouslyAdmitted) {
        const [rejoined] = await db.update(meetingParticipants)
          .set({ leftAt: null, joinedAt: new Date() })
          .where(eq(meetingParticipants.id, previouslyAdmitted.id))
          .returning();
        return { ok: true, meeting, participant: rejoined };
      }

      const [participant] = await db
        .insert(meetingParticipants)
        .values({
          meetingId: meeting.id,
          userId: identity.userId,
          guestName: null,
          joinRequestId: identity.joinRequestId,
          role: 'participant',
          admission: meeting.hostUserId === identity.userId ? 'admitted' : 'pending',
          joinedAt: new Date(),
          leftAt: null,
        })
        .onConflictDoNothing()
        .returning();

      if (participant) return { ok: true, meeting, participant };
      const concurrent = await db.query.meetingParticipants.findFirst({
        where: and(eq(meetingParticipants.meetingId, meeting.id), participantScope(meeting), eq(meetingParticipants.userId, identity.userId), isNull(meetingParticipants.leftAt)),
      });
      if (!concurrent) throw new TRPCError({ code: 'CONFLICT', message: 'Unable to resolve the active join request' });
      return { ok: true, meeting, participant: concurrent };
    }

    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in or create an account before joining a meeting' });
  }

  async getAdmissionStatus(meetingCode: string, participantId: string) {
    const meeting = await this.requireMeeting(meetingCode);
    const participant = await db.query.meetingParticipants.findFirst({
      where: and(eq(meetingParticipants.id, participantId), eq(meetingParticipants.meetingId, meeting.id)),
    });

    if (!participant) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Join request not found' });
    }

    return { ok: true, admission: participant.admission, leftAt: participant.leftAt, meeting, sessionEnded: (meeting.scheduleType === 'reusable' || meeting.scheduleType === 'recurring') && (!meeting.activeOccurrenceId || participant.occurrenceId !== meeting.activeOccurrenceId) };
  }

  async listPendingAdmissions(meetingCode: string, hostUserId: string, occurrenceId?: string) {
    const meeting = await this.requireHost(meetingCode, hostUserId);
    assertCurrentOccurrence(meeting, occurrenceId);
    const requests = await db
      .select({
        id: meetingParticipants.id,
        guestName: meetingParticipants.guestName,
        userName: users.fullName,
        joinedAt: meetingParticipants.joinedAt,
      })
      .from(meetingParticipants)
      .leftJoin(users, eq(meetingParticipants.userId, users.id))
      .where(and(
        eq(meetingParticipants.meetingId, meeting.id), participantScope(meeting),
        eq(meetingParticipants.admission, 'pending'),
        isNull(meetingParticipants.leftAt)
      ));

    return {
      ok: true,
      requests: requests.map((request) => ({
        id: request.id,
        name: request.guestName || request.userName || 'Guest User',
        requestedAt: request.joinedAt,
      })),
    };
  }

  async listAdmittedParticipants(meetingCode: string, identity: { userId?: string; participantId?: string; occurrenceId?: string }) {
    const meeting = await this.requireMeeting(meetingCode);
    assertCurrentOccurrence(meeting, identity.occurrenceId);
    const requester = await db.query.meetingParticipants.findFirst({
      where: and(
        eq(meetingParticipants.meetingId, meeting.id), participantScope(meeting),
        (meeting.scheduleType === 'reusable' || meeting.scheduleType === 'recurring') ? eq(meetingParticipants.id, identity.participantId || '00000000-0000-0000-0000-000000000000') : undefined,
        identity.userId
          ? eq(meetingParticipants.userId, identity.userId)
          : eq(meetingParticipants.id, identity.participantId || '00000000-0000-0000-0000-000000000000'),
        eq(meetingParticipants.admission, 'admitted'),
        isNull(meetingParticipants.leftAt)
      ),
    });
    if (!requester) throw new TRPCError({ code: 'FORBIDDEN', message: 'You have not been admitted to this meeting' });

    const participants = await db
      .select({
        id: meetingParticipants.id,
        userId: meetingParticipants.userId,
        guestName: meetingParticipants.guestName,
        userName: users.fullName,
        role: meetingParticipants.role,
      })
      .from(meetingParticipants)
      .leftJoin(users, eq(meetingParticipants.userId, users.id))
      .where(and(
        eq(meetingParticipants.meetingId, meeting.id), participantScope(meeting),
        eq(meetingParticipants.admission, 'admitted'),
        isNull(meetingParticipants.leftAt)
      ));

    let visibleParticipants = participants;
    if (env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET) {
      try {
        const livekit = new RoomServiceClient(env.LIVEKIT_URL.replace(/^ws/, 'http'), env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
        const liveParticipants = await livekit.listParticipants(mediaRoomName(meeting));
        const liveIdentities = new Set(liveParticipants.map((entry) => entry.identity));
        visibleParticipants = participants.filter((entry) => entry.id === requester.id || liveIdentities.has(entry.id));
      } catch {
        // Preserve database presence if LiveKit's management API is temporarily unavailable.
      }
    }

    return {
      ok: true,
      participants: visibleParticipants.map((participant) => ({
        id: participant.id,
        name: participant.guestName || participant.userName || 'Guest User',
        role: participant.role,
        isSelf: participant.id === requester.id,
      })),
    };
  }

  async decideAdmission(meetingCode: string, participantId: string, admit: boolean, hostUserId: string, occurrenceId?: string) {
    const meeting = await this.requireHost(meetingCode, hostUserId);
    assertCurrentOccurrence(meeting, occurrenceId);
    const [participant] = await db
      .update(meetingParticipants)
      .set({ admission: admit ? 'admitted' : 'denied', leftAt: admit ? null : new Date() })
      .where(and(
        eq(meetingParticipants.id, participantId),
        eq(meetingParticipants.meetingId, meeting.id), participantScope(meeting),
        eq(meetingParticipants.admission, 'pending'),
        (meeting.scheduleType === 'reusable' || meeting.scheduleType === 'recurring') ? isNull(meetingParticipants.leftAt) : undefined
      ))
      .returning();

    if (!participant) {
      const existing = await db.query.meetingParticipants.findFirst({
        where: and(eq(meetingParticipants.id, participantId), eq(meetingParticipants.meetingId, meeting.id), participantScope(meeting)),
      });
      const desiredAdmission = admit ? 'admitted' : 'denied';
      if (existing?.admission === desiredAdmission) return { ok: true, participant: existing };
      if (existing) throw new TRPCError({ code: 'CONFLICT', message: `Join request was already ${existing.admission}` });
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Join request not found' });
    }

    return { ok: true, participant };
  }

  async startMeeting(meetingCode: string, userId: string, startRequestId?: string, expectedUpdatedAt?: string, occurrenceId?: string) {
    const normalizedCode = meetingCode.trim().toUpperCase();
    const meeting = await db.query.meetings.findFirst({
      where: eq(meetings.meetingCode, normalizedCode),
    });

    if (!meeting) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found' });
    }

    if (meeting.hostUserId !== userId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the meeting host can start this meeting' });
    }

    if ((meeting.scheduleType === 'reusable' || meeting.scheduleType === 'recurring')) return new MeetingOccurrenceService().start(meeting.id, userId, startRequestId, expectedUpdatedAt, occurrenceId);

    if (meeting.scheduleType === 'one_time' && meeting.status === 'ended') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This one-time meeting has ended' });
    }
    if (meeting.status === 'live') return { ok: true, meeting };

    const [startedMeeting] = await db
      .update(meetings)
      .set({
        status: 'live',
        updatedAt: new Date(),
      })
      .where(and(eq(meetings.id, meeting.id), or(isNull(meetings.scheduleType), ne(meetings.status, 'ended'))))
      .returning();

    if (!startedMeeting) throw new TRPCError({ code: 'FORBIDDEN', message: 'This one-time meeting has ended' });
    return { ok: true, meeting: startedMeeting };
  }

  async updateGuestName(meetingCode: string, participantId: string, guestName: string) {
    const normalizedCode = meetingCode.trim().toUpperCase();
    const meeting = await db.query.meetings.findFirst({
      where: eq(meetings.meetingCode, normalizedCode),
    });

    if (!meeting) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found' });
    }

    const [participant] = await db
      .update(meetingParticipants)
      .set({ guestName: guestName.trim() })
      .where(
        and(
          eq(meetingParticipants.id, participantId),
          eq(meetingParticipants.meetingId, meeting.id), participantScope(meeting),
          isNull(meetingParticipants.userId),
          isNull(meetingParticipants.leftAt)
        )
      )
      .returning();

    if (!participant) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Guest participant not found' });
    }

    return { ok: true, participant };
  }

  async leaveMeeting(meetingCode: string, identity: { userId?: string; participantId?: string; occurrenceId?: string }) {
    const meeting = await this.requireMeeting(meetingCode);
    assertCurrentOccurrence(meeting, identity.occurrenceId);
    const participant = await db.query.meetingParticipants.findFirst({
      where: and(
        eq(meetingParticipants.meetingId, meeting.id), participantScope(meeting),
        (meeting.scheduleType === 'reusable' || meeting.scheduleType === 'recurring') ? eq(meetingParticipants.id, identity.participantId || '00000000-0000-0000-0000-000000000000') : undefined,
        identity.userId
          ? eq(meetingParticipants.userId, identity.userId)
          : eq(meetingParticipants.id, identity.participantId || '00000000-0000-0000-0000-000000000000'),
        isNull(meetingParticipants.leftAt)
      ),
    });
    // Leaving can be reported more than once (for example by the Leave button
    // followed by the browser's pagehide event). Treat repeated reports as a
    // successful no-op so stale roster entries are never kept because of a race.
    if (!participant) return { ok: true, meetingEnded: false };

    await db.update(meetingParticipants).set({ leftAt: new Date() }).where(eq(meetingParticipants.id, participant.id));
    if (env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET) {
      const livekit = new RoomServiceClient(env.LIVEKIT_URL.replace(/^ws/, 'http'), env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
      await livekit.removeParticipant(mediaRoomName(meeting), participant.id, {
        revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)),
      }).catch(() => undefined);
    }
    return { ok: true, meetingEnded: false };
  }

  async rejoinMeeting(meetingCode: string, participantId: string, userId?: string, occurrenceId?: string) {
    const meeting = await this.requireMeeting(meetingCode);
    if ((meeting.scheduleType === 'reusable' || meeting.scheduleType === 'recurring')) return new MeetingOccurrenceService().join(meeting.id, userId!, crypto.randomUUID(), occurrenceId, participantId);
    if (meeting.status === 'ended') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This meeting has ended' });
    }
    const participant = await db.query.meetingParticipants.findFirst({
      where: and(
        eq(meetingParticipants.id, participantId),
        eq(meetingParticipants.meetingId, meeting.id), participantScope(meeting),
        eq(meetingParticipants.admission, 'admitted')
      ),
    });
    if (!participant || (participant.userId && participant.userId !== userId)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'A new admission is required' });
    }
    const [rejoined] = await db.update(meetingParticipants)
      .set({ leftAt: null, joinedAt: new Date() })
      .where(eq(meetingParticipants.id, participant.id))
      .returning();
    return { ok: true, meeting, participant: rejoined };
  }

  async endMeeting(meetingCode: string, hostUserId: string, occurrenceId?: string) {
    const meeting = await this.requireHost(meetingCode, hostUserId);
    if ((meeting.scheduleType === 'reusable' || meeting.scheduleType === 'recurring')) return new MeetingOccurrenceService().end(meeting.id, hostUserId, occurrenceId);
    const endedAt = new Date();
    await db.transaction(async (tx) => {
      await tx.update(meetings).set({ status: 'ended', updatedAt: endedAt }).where(eq(meetings.id, meeting.id));
      await tx.update(meetingParticipants).set({ leftAt: endedAt }).where(and(
        eq(meetingParticipants.meetingId, meeting.id), participantScope(meeting),
        isNull(meetingParticipants.leftAt)
      ));
    });
    return { ok: true };
  }

  async createLiveKitToken(meetingCode: string, identity: { userId?: string; participantId?: string; occurrenceId?: string }) {
    if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'LiveKit is not configured on the server' });
    }
    const meeting = await this.requireMeeting(meetingCode);
    assertCurrentOccurrence(meeting, identity.occurrenceId);
    if (meeting.status === 'ended') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This meeting has ended' });
    }
    const participant = await db.query.meetingParticipants.findFirst({
      where: and(
        eq(meetingParticipants.meetingId, meeting.id), participantScope(meeting),
        (meeting.scheduleType === 'reusable' || meeting.scheduleType === 'recurring') ? eq(meetingParticipants.id, identity.participantId || '00000000-0000-0000-0000-000000000000') : undefined,
        identity.userId
          ? eq(meetingParticipants.userId, identity.userId)
          : eq(meetingParticipants.id, identity.participantId || '00000000-0000-0000-0000-000000000000'),
        eq(meetingParticipants.admission, 'admitted'),
        isNull(meetingParticipants.leftAt)
      ),
    });
    if (!participant) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You must be admitted before joining media' });
    }
    const user = participant.userId
      ? await db.query.users.findFirst({ where: eq(users.id, participant.userId) })
      : null;
    const name = participant.guestName || user?.fullName || 'Participant';
    const roomName = mediaRoomName(meeting);
    const accessToken = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
      identity: participant.id,
      name,
      ttl: '6h',
      attributes: {
        meetingCode: meeting.meetingCode,
        role: participant.role,
        background: 'none',
        handRaised: 'false',
      },
    });
    accessToken.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: true,
    });
    return { ok: true, url: env.LIVEKIT_URL, token: await accessToken.toJwt(), participantId: participant.id };
  }

  async removeParticipant(meetingCode: string, participantId: string, hostUserId: string, occurrenceId?: string) {
    const meeting = await this.requireHost(meetingCode, hostUserId);
    assertCurrentOccurrence(meeting, occurrenceId);
    const [participant] = await db.update(meetingParticipants)
      .set({ leftAt: new Date(), admission: 'denied' })
      .where(and(
        eq(meetingParticipants.id, participantId),
        eq(meetingParticipants.meetingId, meeting.id), participantScope(meeting),
        eq(meetingParticipants.role, 'participant'),
        eq(meetingParticipants.admission, 'admitted'),
        isNull(meetingParticipants.leftAt)
      ))
      .returning();
    if (!participant) throw new TRPCError({ code: 'NOT_FOUND', message: 'Active participant not found' });

    if (env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET) {
      const livekit = new RoomServiceClient(
        env.LIVEKIT_URL.replace(/^ws/, 'http'),
        env.LIVEKIT_API_KEY,
        env.LIVEKIT_API_SECRET
      );
      await livekit.removeParticipant(mediaRoomName(meeting), participant.id, {
        revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)),
      })
        .catch((error) => console.warn('LiveKit participant removal failed; membership polling will disconnect them.', error));
    }
    return { ok: true };
  }

  async muteParticipant(meetingCode: string, participantId: string, hostUserId: string, occurrenceId?: string) {
    const meeting = await this.requireHost(meetingCode, hostUserId);
    assertCurrentOccurrence(meeting, occurrenceId);
    const participant = await db.query.meetingParticipants.findFirst({
      where: and(
        eq(meetingParticipants.id, participantId),
        eq(meetingParticipants.meetingId, meeting.id), participantScope(meeting),
        eq(meetingParticipants.admission, 'admitted'),
        isNull(meetingParticipants.leftAt)
      ),
    });
    if (!participant) throw new TRPCError({ code: 'NOT_FOUND', message: 'Active participant not found' });
    if (participant.role === 'host') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Use your own microphone control to mute yourself' });
    if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'LiveKit is not configured' });

    const livekit = new RoomServiceClient(env.LIVEKIT_URL.replace(/^ws/, 'http'), env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
    const liveParticipant = await livekit.getParticipant(mediaRoomName(meeting), participant.id)
      .catch(() => null);
    if (!liveParticipant) throw new TRPCError({ code: 'NOT_FOUND', message: 'Participant is no longer connected' });
    const microphone = liveParticipant.tracks.find((track) => track.source === TrackSource.MICROPHONE);
    if (!microphone || microphone.muted) return { ok: true, alreadyMuted: true };
    await livekit.mutePublishedTrack(mediaRoomName(meeting), participant.id, microphone.sid, true);
    return { ok: true, alreadyMuted: false };
  }

  async muteAllParticipants(meetingCode: string, hostUserId: string, occurrenceId?: string) {
    const meeting = await this.requireHost(meetingCode, hostUserId);
    assertCurrentOccurrence(meeting, occurrenceId);
    if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'LiveKit is not configured' });
    const attendees = await db.select({ id: meetingParticipants.id }).from(meetingParticipants).where(and(
      eq(meetingParticipants.meetingId, meeting.id), participantScope(meeting),
      eq(meetingParticipants.role, 'participant'),
      eq(meetingParticipants.admission, 'admitted'),
      isNull(meetingParticipants.leftAt)
    ));
    const attendeeIds = new Set(attendees.map((entry) => entry.id));
    const livekit = new RoomServiceClient(env.LIVEKIT_URL.replace(/^ws/, 'http'), env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
    const liveParticipants = await livekit.listParticipants(mediaRoomName(meeting));
    const microphoneTracks = liveParticipants.flatMap((participant) => attendeeIds.has(participant.identity)
      ? participant.tracks.filter((track) => track.source === TrackSource.MICROPHONE && !track.muted).map((track) => ({ identity: participant.identity, sid: track.sid }))
      : []);
    await Promise.all(microphoneTracks.map((track) => livekit.mutePublishedTrack(mediaRoomName(meeting), track.identity, track.sid, true)));
    return { ok: true, mutedCount: microphoneTracks.length };
  }

  private async requireMeeting(meetingCode: string) {
    const meeting = await db.query.meetings.findFirst({
      where: eq(meetings.meetingCode, meetingCode.trim().toUpperCase()),
    });

    if (!meeting) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found' });
    }

    return meeting;
  }

  private async requireHost(meetingCode: string, userId: string) {
    const meeting = await this.requireMeeting(meetingCode);
    if (meeting.hostUserId !== userId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the meeting host can manage join requests' });
    }
    return meeting;
  }

  private async generateUniqueMeetingCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    let attempt = 0;

    while (attempt < 10) {
      code = 'YLM-';
      for (let i = 0; i < 6; i += 1) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
      }

      const existing = await db.query.meetings.findFirst({
        where: eq(meetings.meetingCode, code),
      });

      if (!existing) {
        return code;
      }

      attempt += 1;
    }

    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unable to allocate a meeting code' });
  }

  private async validateAvailableMeetingCode(meetingCode: string) {
    const code = meetingCode.trim().toUpperCase();
    const existing = await db.query.meetings.findFirst({
      where: eq(meetings.meetingCode, code),
    });
    if (existing) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Meeting code is already in use. Please try again.' });
    }
    return code;
  }
}
