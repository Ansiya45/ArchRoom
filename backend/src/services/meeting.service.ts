import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { meetings, meetingParticipants, users } from '../db/schema.js';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { env } from '../env.js';

export type CreateMeetingInput = {
  title: string;
  meetingCode?: string;
  scheduledAt?: string | null;
  startNow?: boolean;
};

export type JoinMeetingIdentity = {
  userId?: string;
  guestName?: string;
  joinRequestId: string;
};

export class MeetingService {
  async createMeeting(input: CreateMeetingInput, hostUserId: string) {
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
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
          status: input.startNow ? 'live' : 'scheduled',
        })
        .returning();

      await tx.insert(meetingParticipants).values({
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
    if (meeting.status === 'ended') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This meeting has ended' });
    }

    if (identity.userId) {
      const existing = await db.query.meetingParticipants.findFirst({
        where: and(
          eq(meetingParticipants.meetingId, meeting.id),
          eq(meetingParticipants.userId, identity.userId),
          isNull(meetingParticipants.leftAt)
        ),
      });

      if (existing) {
        return { ok: true, meeting, participant: existing };
      }

      const previouslyAdmitted = await db.query.meetingParticipants.findFirst({
        where: and(
          eq(meetingParticipants.meetingId, meeting.id),
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
        where: and(eq(meetingParticipants.meetingId, meeting.id), eq(meetingParticipants.userId, identity.userId), isNull(meetingParticipants.leftAt)),
      });
      if (!concurrent) throw new TRPCError({ code: 'CONFLICT', message: 'Unable to resolve the active join request' });
      return { ok: true, meeting, participant: concurrent };
    }

    const guestName = identity.guestName?.trim() || 'Guest User';
    const existingRequest = await db.query.meetingParticipants.findFirst({
      where: and(eq(meetingParticipants.meetingId, meeting.id), eq(meetingParticipants.joinRequestId, identity.joinRequestId)),
    });
    if (existingRequest) return { ok: true, meeting, participant: existingRequest };
    const [participant] = await db
      .insert(meetingParticipants)
      .values({
        meetingId: meeting.id,
        userId: null,
        guestName,
        joinRequestId: identity.joinRequestId,
        role: 'participant',
        admission: 'pending',
        joinedAt: new Date(),
        leftAt: null,
      })
      .onConflictDoNothing()
      .returning();

    if (participant) return { ok: true, meeting, participant };
    const concurrent = await db.query.meetingParticipants.findFirst({
      where: and(eq(meetingParticipants.meetingId, meeting.id), eq(meetingParticipants.joinRequestId, identity.joinRequestId)),
    });
    if (!concurrent) throw new TRPCError({ code: 'CONFLICT', message: 'Unable to resolve the active join request' });
    return { ok: true, meeting, participant: concurrent };
  }

  async getAdmissionStatus(meetingCode: string, participantId: string) {
    const meeting = await this.requireMeeting(meetingCode);
    const participant = await db.query.meetingParticipants.findFirst({
      where: and(eq(meetingParticipants.id, participantId), eq(meetingParticipants.meetingId, meeting.id)),
    });

    if (!participant) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Join request not found' });
    }

    return { ok: true, admission: participant.admission, leftAt: participant.leftAt, meeting };
  }

  async listPendingAdmissions(meetingCode: string, hostUserId: string) {
    const meeting = await this.requireHost(meetingCode, hostUserId);
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
        eq(meetingParticipants.meetingId, meeting.id),
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

  async listAdmittedParticipants(meetingCode: string, identity: { userId?: string; participantId?: string }) {
    const meeting = await this.requireMeeting(meetingCode);
    const requester = await db.query.meetingParticipants.findFirst({
      where: and(
        eq(meetingParticipants.meetingId, meeting.id),
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
        eq(meetingParticipants.meetingId, meeting.id),
        eq(meetingParticipants.admission, 'admitted'),
        isNull(meetingParticipants.leftAt)
      ));

    let visibleParticipants = participants;
    if (env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET) {
      try {
        const livekit = new RoomServiceClient(env.LIVEKIT_URL.replace(/^ws/, 'http'), env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
        const liveParticipants = await livekit.listParticipants(`archroom-${meeting.id}`);
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

  async decideAdmission(meetingCode: string, participantId: string, admit: boolean, hostUserId: string) {
    const meeting = await this.requireHost(meetingCode, hostUserId);
    const [participant] = await db
      .update(meetingParticipants)
      .set({ admission: admit ? 'admitted' : 'denied', leftAt: admit ? null : new Date() })
      .where(and(
        eq(meetingParticipants.id, participantId),
        eq(meetingParticipants.meetingId, meeting.id),
        eq(meetingParticipants.admission, 'pending')
      ))
      .returning();

    if (!participant) {
      const existing = await db.query.meetingParticipants.findFirst({
        where: and(eq(meetingParticipants.id, participantId), eq(meetingParticipants.meetingId, meeting.id)),
      });
      const desiredAdmission = admit ? 'admitted' : 'denied';
      if (existing?.admission === desiredAdmission) return { ok: true, participant: existing };
      if (existing) throw new TRPCError({ code: 'CONFLICT', message: `Join request was already ${existing.admission}` });
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Join request not found' });
    }

    return { ok: true, participant };
  }

  async startMeeting(meetingCode: string, userId: string) {
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

    const [startedMeeting] = await db
      .update(meetings)
      .set({
        status: 'live',
        updatedAt: new Date(),
      })
      .where(eq(meetings.id, meeting.id))
      .returning();

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
          eq(meetingParticipants.meetingId, meeting.id),
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

  async leaveMeeting(meetingCode: string, identity: { userId?: string; participantId?: string }) {
    const meeting = await this.requireMeeting(meetingCode);
    const participant = await db.query.meetingParticipants.findFirst({
      where: and(
        eq(meetingParticipants.meetingId, meeting.id),
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
      await livekit.removeParticipant(`archroom-${meeting.id}`, participant.id, {
        revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)),
      }).catch(() => undefined);
    }
    return { ok: true, meetingEnded: false };
  }

  async rejoinMeeting(meetingCode: string, participantId: string, userId?: string) {
    const meeting = await this.requireMeeting(meetingCode);
    if (meeting.status === 'ended') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This meeting has ended' });
    }
    const participant = await db.query.meetingParticipants.findFirst({
      where: and(
        eq(meetingParticipants.id, participantId),
        eq(meetingParticipants.meetingId, meeting.id),
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

  async endMeeting(meetingCode: string, hostUserId: string) {
    const meeting = await this.requireHost(meetingCode, hostUserId);
    const endedAt = new Date();
    await db.transaction(async (tx) => {
      await tx.update(meetings).set({ status: 'ended', updatedAt: endedAt }).where(eq(meetings.id, meeting.id));
      await tx.update(meetingParticipants).set({ leftAt: endedAt }).where(and(
        eq(meetingParticipants.meetingId, meeting.id),
        isNull(meetingParticipants.leftAt)
      ));
    });
    return { ok: true };
  }

  async createLiveKitToken(meetingCode: string, identity: { userId?: string; participantId?: string }) {
    if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'LiveKit is not configured on the server' });
    }
    const meeting = await this.requireMeeting(meetingCode);
    if (meeting.status === 'ended') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This meeting has ended' });
    }
    const participant = await db.query.meetingParticipants.findFirst({
      where: and(
        eq(meetingParticipants.meetingId, meeting.id),
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
    const roomName = `archroom-${meeting.id}`;
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

  async removeParticipant(meetingCode: string, participantId: string, hostUserId: string) {
    const meeting = await this.requireHost(meetingCode, hostUserId);
    const [participant] = await db.update(meetingParticipants)
      .set({ leftAt: new Date(), admission: 'denied' })
      .where(and(
        eq(meetingParticipants.id, participantId),
        eq(meetingParticipants.meetingId, meeting.id),
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
      await livekit.removeParticipant(`archroom-${meeting.id}`, participant.id, {
        revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)),
      })
        .catch((error) => console.warn('LiveKit participant removal failed; membership polling will disconnect them.', error));
    }
    return { ok: true };
  }

  async muteParticipant(meetingCode: string, participantId: string, hostUserId: string) {
    const meeting = await this.requireHost(meetingCode, hostUserId);
    const participant = await db.query.meetingParticipants.findFirst({
      where: and(
        eq(meetingParticipants.id, participantId),
        eq(meetingParticipants.meetingId, meeting.id),
        eq(meetingParticipants.admission, 'admitted'),
        isNull(meetingParticipants.leftAt)
      ),
    });
    if (!participant) throw new TRPCError({ code: 'NOT_FOUND', message: 'Active participant not found' });
    if (participant.role === 'host') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Use your own microphone control to mute yourself' });
    if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'LiveKit is not configured' });

    const livekit = new RoomServiceClient(env.LIVEKIT_URL.replace(/^ws/, 'http'), env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
    const liveParticipant = await livekit.getParticipant(`archroom-${meeting.id}`, participant.id)
      .catch(() => null);
    if (!liveParticipant) throw new TRPCError({ code: 'NOT_FOUND', message: 'Participant is no longer connected' });
    const microphone = liveParticipant.tracks.find((track) => track.source === TrackSource.MICROPHONE);
    if (!microphone || microphone.muted) return { ok: true, alreadyMuted: true };
    await livekit.mutePublishedTrack(`archroom-${meeting.id}`, participant.id, microphone.sid, true);
    return { ok: true, alreadyMuted: false };
  }

  async muteAllParticipants(meetingCode: string, hostUserId: string) {
    const meeting = await this.requireHost(meetingCode, hostUserId);
    if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'LiveKit is not configured' });
    const attendees = await db.select({ id: meetingParticipants.id }).from(meetingParticipants).where(and(
      eq(meetingParticipants.meetingId, meeting.id),
      eq(meetingParticipants.role, 'participant'),
      eq(meetingParticipants.admission, 'admitted'),
      isNull(meetingParticipants.leftAt)
    ));
    const attendeeIds = new Set(attendees.map((entry) => entry.id));
    const livekit = new RoomServiceClient(env.LIVEKIT_URL.replace(/^ws/, 'http'), env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
    const liveParticipants = await livekit.listParticipants(`archroom-${meeting.id}`);
    const microphoneTracks = liveParticipants.flatMap((participant) => attendeeIds.has(participant.identity)
      ? participant.tracks.filter((track) => track.source === TrackSource.MICROPHONE && !track.muted).map((track) => ({ identity: participant.identity, sid: track.sid }))
      : []);
    await Promise.all(microphoneTracks.map((track) => livekit.mutePublishedTrack(`archroom-${meeting.id}`, track.identity, track.sid, true)));
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
