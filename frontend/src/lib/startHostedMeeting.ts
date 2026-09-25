import { trpc } from './trpc';
import type { MeetingRecord } from './meetingSchedule';
export async function startHostedMeeting(room: MeetingRecord, occurrenceId?: string) {
  if (room.recurrenceCancelledAt) throw new Error('This recurring series has been cancelled.');
  if (room.scheduleType === 'recurring' && !occurrenceId) {
    occurrenceId = room.activeOccurrenceId || undefined;
    let after: { at: string; id: string } | undefined;
    // Bounded pages handle completed occurrences earlier on the current date.
    for (let page = 0; !occurrenceId && page < 20; page++) {
      const result = await trpc.meetings.occurrences.mutate({ meetingCode: room.meetingCode, after });
      occurrenceId = result.occurrences.find(item => item.status === 'scheduled' && !item.cancelledAt)?.id;
      if (!result.nextCursor) break;
      after = result.nextCursor;
    }
    if (!occurrenceId) throw new Error('No further scheduled occurrences are available.');
  }
  return trpc.meetings.start.mutate({ meetingCode: room.meetingCode, startRequestId: crypto.randomUUID(), expectedUpdatedAt: room.updatedAt, occurrenceId });
}
