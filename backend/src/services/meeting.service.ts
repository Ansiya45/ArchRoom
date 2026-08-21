import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { meetings, meetingParticipants, users } from '../db/schema.js';

export type CreateMeetingInput = {
  title: string;
  meetingCode?: string;
  scheduledAt?: string | null;
  startNow?: boolean;
};

export type JoinMeetingIdentity = {
  userId?: string;
  guestName?: string;
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

      const [participant] = await db
        .insert(meetingParticipants)
        .values({
          meetingId: meeting.id,
          userId: identity.userId,
          guestName: null,
          role: 'participant',
          admission: meeting.hostUserId === identity.userId ? 'admitted' : 'pending',
          joinedAt: new Date(),
          leftAt: null,
        })
        .returning();

      return { ok: true, meeting, participant };
    }

    const guestName = identity.guestName?.trim() || 'Guest User';
    const [participant] = await db
      .insert(meetingParticipants)
      .values({
        meetingId: meeting.id,
        userId: null,
        guestName,
        role: 'participant',
        admission: 'pending',
        joinedAt: new Date(),
        leftAt: null,
      })
      .returning();

    return { ok: true, meeting, participant };
  }

  async getAdmissionStatus(meetingCode: string, participantId: string) {
    const meeting = await this.requireMeeting(meetingCode);
    const participant = await db.query.meetingParticipants.findFirst({
      where: and(eq(meetingParticipants.id, participantId), eq(meetingParticipants.meetingId, meeting.id)),
    });

    if (!participant) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Join request not found' });
    }

    return { ok: true, admission: participant.admission, meeting };
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

    return {
      ok: true,
      participants: participants.map((participant) => ({
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
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Pending join request not found' });
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

  async leaveMeeting(meetingCode: string, userId: string) {
    const normalizedCode = meetingCode.trim().toUpperCase();
    const meeting = await db.query.meetings.findFirst({
      where: eq(meetings.meetingCode, normalizedCode),
    });

    if (!meeting) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found' });
    }

    await db
      .update(meetingParticipants)
      .set({ leftAt: new Date() })
      .where(and(eq(meetingParticipants.meetingId, meeting.id), eq(meetingParticipants.userId, userId), isNull(meetingParticipants.leftAt)));

    return { ok: true };
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
