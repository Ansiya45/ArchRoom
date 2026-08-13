import { TRPCError } from '@trpc/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { meetings, meetingParticipants, users } from '../db/schema.js';

export type CreateMeetingInput = {
  title: string;
  scheduledAt?: string | null;
};

export class MeetingService {
  async createMeeting(input: CreateMeetingInput, hostUserId: string) {
    const title = input.title.trim();
    if (!title) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Meeting title is required' });
    }

    const code = await this.generateUniqueMeetingCode();

    const [meeting] = await db
      .insert(meetings)
      .values({
        title,
        hostUserId,
        meetingCode: code,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        status: 'scheduled',
      })
      .returning();

    await db.insert(meetingParticipants).values({
      meetingId: meeting.id,
      userId: hostUserId,
      role: 'host',
      joinedAt: new Date(),
      leftAt: null,
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
      ? await db.select().from(meetings).where(sql`${meetings.id} IN ${participantMeetingIds}`)
      : [];

    return { ok: true, meetings: [...rows, ...joined] };
  }

  async getByCode(meetingCode: string) {
    const result = await db.query.meetings.findFirst({
      where: eq(meetings.meetingCode, meetingCode),
    });

    if (!result) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found' });
    }

    return { ok: true, meeting: result };
  }

  async joinMeeting(meetingCode: string, userId: string) {
    const meeting = await db.query.meetings.findFirst({
      where: eq(meetings.meetingCode, meetingCode),
    });

    if (!meeting) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found' });
    }

    const existing = await db.query.meetingParticipants.findFirst({
      where: and(eq(meetingParticipants.meetingId, meeting.id), eq(meetingParticipants.userId, userId), isNull(meetingParticipants.leftAt)),
    });

    if (!existing) {
      await db.insert(meetingParticipants).values({
        meetingId: meeting.id,
        userId,
        role: 'participant',
        joinedAt: new Date(),
        leftAt: null,
      });
    }

    return { ok: true, meeting };
  }

  async leaveMeeting(meetingCode: string, userId: string) {
    const meeting = await db.query.meetings.findFirst({
      where: eq(meetings.meetingCode, meetingCode),
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

  private async generateUniqueMeetingCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    let attempt = 0;

    while (attempt < 10) {
      code = '';
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
}
