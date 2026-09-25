import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { meetings, meetingOccurrences } from '../db/schema.js';
import { localDateTime, resolveMeetingSchedule, type MeetingSchedule } from './meeting-schedule.service.js';
import { validateRecurrence, type RecurrenceRule } from './recurrence.service.js';
export type RecurrenceSegment = { revision: number; scheduledAt: string; timeZone: string; rule: RecurrenceRule; untilExclusive: string };
export type RecurrenceChange = {
  meetingCode: string; expectedUpdatedAt: string; occurrenceId?: string;
  action: 'edit_occurrence' | 'edit_future' | 'cancel_occurrence' | 'cancel_series';
  schedule?: MeetingSchedule; recurrence?: RecurrenceRule;
};
export function occurrenceTimeZone(meeting: typeof meetings.$inferSelect, occurrence: typeof meetingOccurrences.$inferSelect) {
  return occurrence.timeZone || meeting.recurrenceHistory?.find(segment => segment.revision === (occurrence.recurrenceRevision || 0))?.timeZone || meeting.timeZone;
}
const conflict = (message: string): never => { throw new TRPCError({ code: 'CONFLICT', message }); };
export class RecurrenceSeriesService {
  async change(input: RecurrenceChange, hostUserId: string, now = new Date()) {
    return db.transaction(async tx => {
      const [meeting] = await tx.select().from(meetings).where(eq(meetings.meetingCode, input.meetingCode.trim().toUpperCase())).for('update');
      if (!meeting || meeting.hostUserId !== hostUserId) throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the host can change this series.' });
      if (meeting.scheduleType !== 'recurring' || !meeting.scheduledAt || !meeting.timeZone || !meeting.recurrenceRule) throw new TRPCError({ code: 'BAD_REQUEST', message: 'A recurring meeting is required.' });
      if (meeting.recurrenceCancelledAt) {
        if (input.action === 'cancel_series') return { ok: true, meeting };
        return conflict('This recurring series has been cancelled.');
      }
      if (meeting.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime()) return conflict('The series changed. Reload its occurrences before saving.');
      const changedAt = new Date(Math.max(now.getTime(), meeting.updatedAt.getTime() + 1));
      let parentPatch: Partial<typeof meetings.$inferInsert> = { recurrenceEditedAt: changedAt, updatedAt: changedAt };
      const all = await tx.query.meetingOccurrences.findMany({ where: eq(meetingOccurrences.meetingId, meeting.id) });
      if (input.action === 'cancel_series') {
        if (meeting.activeOccurrenceId) return conflict('End the live occurrence before cancelling the series.');
        parentPatch.recurrenceCancelledAt = changedAt;
        for (const row of all) if (row.status === 'scheduled' && !row.cancelledAt) await tx.update(meetingOccurrences).set({ cancelledAt: changedAt, cancellationReason: 'series_cancelled' }).where(eq(meetingOccurrences.id, row.id));
      } else {
        const selected = all.find(row => row.id === input.occurrenceId);
        if (!selected || !selected.scheduledAt || !selected.originalScheduledAt) throw new TRPCError({ code: 'NOT_FOUND', message: 'Occurrence not found in this series.' });
        if (selected.status !== 'scheduled' || selected.startedAt || selected.cancelledAt) return conflict('Only a scheduled, unstarted occurrence can be changed.');
        if (selected.scheduledAt <= now) return conflict('Past occurrences are retained as history and cannot be edited or cancelled individually.');
        if (input.action === 'cancel_occurrence') {
          await tx.update(meetingOccurrences).set({ cancelledAt: changedAt, cancellationReason: 'host_cancelled' }).where(eq(meetingOccurrences.id, selected.id));
        } else {
          if (!input.schedule) throw new TRPCError({ code: 'BAD_REQUEST', message: 'A new date, time and timezone are required.' });
          const schedule = resolveMeetingSchedule(input.schedule);
          if (schedule.scheduledAt <= now) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose a future date and time.' });
          if (input.action === 'edit_occurrence') {
            await tx.update(meetingOccurrences).set(schedule).where(eq(meetingOccurrences.id, selected.id));
          } else {
            if (meeting.activeOccurrenceId) return conflict('End the live occurrence before editing the future series.');
            if ((selected.recurrenceRevision || 0) !== (meeting.recurrenceRevision || 0)) return conflict('Future editing must start from the latest schedule revision. Earlier retained occurrences can be edited individually.');
            if (!input.recurrence) throw new TRPCError({ code: 'BAD_REQUEST', message: 'A recurrence rule is required.' });
            const rule = validateRecurrence(input.schedule, input.recurrence);
            // Allow an earlier clock time on the selected civil day, but not a
            // new schedule which reaches back into retained earlier days.
            if (localDateTime(schedule.scheduledAt, meeting.timeZone).slice(0,10) < localDateTime(selected.originalScheduledAt, meeting.timeZone).slice(0,10)) return conflict('The new series must start on or after the selected original day in the current series timezone.');
            const affected = all.filter(row => (row.recurrenceRevision || 0) === (meeting.recurrenceRevision || 0) && row.originalScheduledAt && row.originalScheduledAt >= selected.originalScheduledAt!);
            if (affected.some(row => row.status !== 'scheduled' || row.startedAt)) return conflict('This range contains a started or completed occurrence. Choose a later occurrence.');
            const history = meeting.recurrenceHistory || [];
            if (history.length >= 100) return conflict('This series has reached its revision limit. Create a new series.');
            const segment: RecurrenceSegment = { revision: meeting.recurrenceRevision || 0, scheduledAt: meeting.scheduledAt.toISOString(), timeZone: meeting.timeZone, rule: meeting.recurrenceRule, untilExclusive: selected.originalScheduledAt.toISOString() };
            parentPatch = { ...parentPatch, ...schedule, recurrenceRule: rule, recurrenceRevision: (meeting.recurrenceRevision || 0) + 1, recurrenceHistory: [...history, segment] };
            for (const row of affected) await tx.update(meetingOccurrences).set({ cancelledAt: changedAt, cancellationReason: 'superseded' }).where(eq(meetingOccurrences.id, row.id));
          }
        }
      }
      const [updated] = await tx.update(meetings).set(parentPatch).where(eq(meetings.id, meeting.id)).returning();
      return { ok: true, meeting: updated };
    });
  }
}
