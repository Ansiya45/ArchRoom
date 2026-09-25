import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { meetings, meetingOccurrences, meetingParticipants } from '../db/schema.js';

import { occurrenceTimeZone } from './recurrence-series.service.js';
import { expandRecurrence } from './recurrence.service.js';
import { localDateTime } from './meeting-schedule.service.js';

type Meeting = typeof meetings.$inferSelect;
export function assertCurrentOccurrence(meeting: Meeting, occurrenceId?: string | null) {
  if (!meeting) throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found' });
  if ((meeting.scheduleType === 'reusable' || meeting.scheduleType === 'recurring') && (!occurrenceId || meeting.status !== 'live' || meeting.activeOccurrenceId !== occurrenceId)) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'This room session is not active. Wait for the host to open the room, then join again.' });
  }
}
export function participantScope(meeting: Meeting) {
  return (meeting.scheduleType === 'reusable' || meeting.scheduleType === 'recurring')
    ? eq(meetingParticipants.occurrenceId, meeting.activeOccurrenceId || '00000000-0000-0000-0000-000000000000') : undefined;
}
export function mediaRoomName(meeting: Meeting) {
  return (meeting.scheduleType === 'reusable' || meeting.scheduleType === 'recurring')
    ? `archroom-${meeting.id}-${meeting.activeOccurrenceId}` : `archroom-${meeting.id}`;
}
export function attachmentPrefix(meeting: Meeting) {
  return (meeting.scheduleType === 'reusable' || meeting.scheduleType === 'recurring')
    ? `meetings/${meeting.id}/sessions/${meeting.activeOccurrenceId}/` : `meetings/${meeting.id}/`;
}

export class MeetingOccurrenceService {
  async upcoming(meetingCode: string, hostUserId: string, fromDate?: string, limit = 6, after?: { at: string; id: string }) {
    return db.transaction(async (tx) => {
      const [meeting] = await tx.select().from(meetings).where(eq(meetings.meetingCode, meetingCode)).for('update');
      if (!meeting || meeting.hostUserId !== hostUserId) throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the host can view scheduled occurrences.' });
      if (meeting.scheduleType !== 'recurring' || !meeting.scheduledAt || !meeting.timeZone || !meeting.recurrenceRule) throw new TRPCError({ code: 'BAD_REQUEST', message: 'This is not a recurring meeting.' });
      if (!Number.isInteger(limit) || limit < 1 || limit > 12) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid page size.' });
      const from = after ? localDateTime(new Date(after.at), meeting.timeZone).slice(0,10) : fromDate || localDateTime(new Date(), meeting.timeZone).slice(0,10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !Number.isFinite(new Date(`${from}T00:00:00Z`).getTime()) || new Date(`${from}T00:00:00Z`).toISOString().slice(0,10) !== from) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid occurrence date.' });
      const segments = [...(meeting.recurrenceHistory || []), { revision: meeting.recurrenceRevision || 0, scheduledAt: meeting.scheduledAt.toISOString(), timeZone: meeting.timeZone, rule: meeting.recurrenceRule, untilExclusive: null }];
      const all = await tx.query.meetingOccurrences.findMany({ where: eq(meetingOccurrences.meetingId, meeting.id) });
      if (!meeting.recurrenceCancelledAt) for (const segment of segments) {
        // Include the adjacent civil day when revisions use different timezones.
        const segmentFrom = localDateTime(new Date(new Date(`${from}T00:00:00Z`).getTime() - 36 * 3600000), segment.timeZone).slice(0,10);
        if (segment.untilExclusive && new Date(segment.untilExclusive) < new Date(`${segmentFrom}T00:00:00Z`)) continue;
        const dates = expandRecurrence(new Date(segment.scheduledAt), segment.timeZone, segment.rule, segmentFrom, limit + 4);
        for (const scheduledAt of dates) {
          if (segment.untilExclusive && scheduledAt >= new Date(segment.untilExclusive)) continue;
          let occurrence = all.find(row => (row.recurrenceRevision || 0) === segment.revision && row.originalScheduledAt?.getTime() === scheduledAt.getTime());
          if (!occurrence) {
            [occurrence] = await tx.insert(meetingOccurrences).values({ meetingId: meeting.id, recurrenceRevision: segment.revision, timeZone: segment.timeZone, scheduledAt, originalScheduledAt: scheduledAt, status: 'scheduled', startedAt: null, startRequestId: null }).returning();
            all.push(occurrence);
          }
        }
      }
      const available = all.filter(row => row.scheduledAt && row.cancellationReason !== 'superseded' && localDateTime(row.scheduledAt, meeting.timeZone!).slice(0,10) >= from)
        .sort((a,b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime() || a.id.localeCompare(b.id))
        .filter(row => !after || row.scheduledAt!.getTime() > new Date(after.at).getTime() || (row.scheduledAt!.getTime() === new Date(after.at).getTime() && row.id > after.id));
      const occurrences = available.slice(0, limit).map(row => ({ ...row, timeZone: occurrenceTimeZone(meeting, row) })), last = occurrences.at(-1);
      const nextCursor = last && available.length > limit ? { at: last.scheduledAt!.toISOString(), id: last.id } : null;
      const nextFrom = nextCursor ? localDateTime(last!.scheduledAt!, meeting.timeZone).slice(0,10) : null;
      return { ok: true, meeting, occurrences, nextFrom, nextCursor };
    });
  }

  // Parent row locking serializes session start/end/join without changing legacy flows.
  async start(meetingId: string, hostUserId: string, startRequestId?: string, expectedUpdatedAt?: string, occurrenceId?: string) {
    if (!startRequestId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'A start request ID is required for a reusable room.' });
    return db.transaction(async (tx) => {
      const [meeting] = await tx.select().from(meetings).where(eq(meetings.id, meetingId)).for('update');
      if (!meeting || meeting.hostUserId !== hostUserId || (meeting.scheduleType !== 'reusable' && meeting.scheduleType !== 'recurring')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the host can open this room.' });
      }
      if (meeting.recurrenceCancelledAt) throw new TRPCError({ code: 'CONFLICT', message: 'This recurring series has been cancelled.' });
      const previous = await tx.query.meetingOccurrences.findFirst({ where: and(eq(meetingOccurrences.meetingId, meetingId), eq(meetingOccurrences.startRequestId, startRequestId)) });
      if (previous?.status === 'ended') throw new TRPCError({ code: 'CONFLICT', message: 'That room session has ended. Start a new session explicitly.' });
      if (meeting.activeOccurrenceId) {
        if (meeting.scheduleType === 'recurring' && occurrenceId !== meeting.activeOccurrenceId) throw new TRPCError({ code: 'CONFLICT', message: 'Another occurrence is already live.' });
        return { ok: true, meeting };
      }
      if (!expectedUpdatedAt || new Date(expectedUpdatedAt).getTime() !== meeting.updatedAt.getTime()) {
        throw new TRPCError({ code: 'CONFLICT', message: 'The room changed since this start request. Refresh and start again.' });
      }
      let occurrence;
      if (meeting.scheduleType === 'recurring') {
        if (!occurrenceId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Select a scheduled occurrence to start.' });
        const selected = await tx.query.meetingOccurrences.findFirst({ where: and(eq(meetingOccurrences.id, occurrenceId), eq(meetingOccurrences.meetingId, meetingId)) });
        if (!selected || selected.status !== 'scheduled' || selected.cancelledAt || !selected.scheduledAt) throw new TRPCError({ code: 'CONFLICT', message: 'This occurrence cannot be started.' });
        [occurrence] = await tx.update(meetingOccurrences).set({ status: 'live', startedAt: new Date(), startRequestId }).where(eq(meetingOccurrences.id, occurrenceId)).returning();
      } else {
        [occurrence] = await tx.insert(meetingOccurrences).values({ meetingId, startRequestId }).returning();
      }
      const [updated] = await tx.update(meetings).set({ activeOccurrenceId: occurrence.id, status: 'live', updatedAt: new Date(Math.max(Date.now(), meeting.updatedAt.getTime() + 1)) }).where(eq(meetings.id, meetingId)).returning();
      return { ok: true, meeting: updated };
    });
  }

  async join(meetingId: string, userId: string, joinRequestId: string, occurrenceId?: string, participantId?: string) {
    if (!userId) throw new TRPCError({ code: 'UNAUTHORIZED' });
    return db.transaction(async (tx) => {
      const [meeting] = await tx.select().from(meetings).where(eq(meetings.id, meetingId)).for('update');
      assertCurrentOccurrence(meeting, occurrenceId);
      const existing = await tx.query.meetingParticipants.findFirst({ where: and(
        eq(meetingParticipants.meetingId, meetingId), eq(meetingParticipants.occurrenceId, occurrenceId!),
        eq(meetingParticipants.userId, userId),
      ), orderBy: (table, { desc }) => [desc(table.joinedAt)] });
      if (participantId && (!existing || existing.id !== participantId || existing.admission !== 'admitted')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'A new admission is required' });
      }
      if (existing) {
        if (existing.leftAt && existing.admission === 'admitted') {
          const [rejoined] = await tx.update(meetingParticipants).set({ leftAt: null }).where(eq(meetingParticipants.id, existing.id)).returning();
          return { ok: true, meeting, participant: rejoined };
        }
        return { ok: true, meeting, participant: existing };
      }
      const [participant] = await tx.insert(meetingParticipants).values({
        meetingId, occurrenceId, userId, joinRequestId,
        role: meeting.hostUserId === userId ? 'host' : 'participant',
        admission: meeting.hostUserId === userId ? 'admitted' : 'pending',
      }).returning();
      return { ok: true, meeting, participant };
    });
  }

  async end(meetingId: string, hostUserId: string, occurrenceId?: string) {
    if (!occurrenceId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'A room session is required.' });
    return db.transaction(async (tx) => {
      const [meeting] = await tx.select().from(meetings).where(eq(meetings.id, meetingId)).for('update');
      if (!meeting || meeting.hostUserId !== hostUserId) throw new TRPCError({ code: 'FORBIDDEN' });
      const occurrence = await tx.query.meetingOccurrences.findFirst({ where: and(eq(meetingOccurrences.id, occurrenceId), eq(meetingOccurrences.meetingId, meetingId)) });
      if (occurrence?.status === 'ended') return { ok: true }; // Late retry cannot end a newer session.
      assertCurrentOccurrence(meeting, occurrenceId);
      const endedAt = new Date(Math.max(Date.now(), meeting.updatedAt.getTime() + 1));
      await tx.update(meetingOccurrences).set({ status: 'ended', endedAt }).where(eq(meetingOccurrences.id, occurrenceId));
      await tx.update(meetingParticipants).set({ leftAt: endedAt }).where(and(eq(meetingParticipants.occurrenceId, occurrenceId), isNull(meetingParticipants.leftAt)));
      await tx.update(meetings).set({ activeOccurrenceId: null, status: 'scheduled', updatedAt: endedAt }).where(eq(meetings.id, meetingId));
      return { ok: true };
    });
  }
}
