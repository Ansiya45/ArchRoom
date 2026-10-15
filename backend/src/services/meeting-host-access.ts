import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { meetingParticipants, meetings } from '../db/schema.js';

type Meeting = typeof meetings.$inferSelect;

// A promoted host has control only over the session in which they were promoted.
// The creator retains ownership of scheduling and the full meeting history.
export async function canManageMeetingSession(meeting: Meeting, userId: string, occurrenceId?: string | null, active = true) {
  if (meeting.hostUserId === userId) return true;
  const participant = await db.query.meetingParticipants.findFirst({ where: and(
    eq(meetingParticipants.meetingId, meeting.id),
    occurrenceId ? eq(meetingParticipants.occurrenceId, occurrenceId) : isNull(meetingParticipants.occurrenceId),
    eq(meetingParticipants.userId, userId), eq(meetingParticipants.role, 'host'),
    eq(meetingParticipants.admission, 'admitted'),
    active ? isNull(meetingParticipants.leftAt) : undefined,
  ) });
  return Boolean(participant);
}
