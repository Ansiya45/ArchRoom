import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { meetingParticipants, meetings, users } from '../db/schema.js';

type Meeting = typeof meetings.$inferSelect;

export async function canOpenAssignedMeeting(meeting: Meeting, userId: string) {
  if (meeting.hostUserId === userId) return true;
  if (meeting.assignedHostUserId !== userId) return false;
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  return Boolean(user && !user.disabledAt && user.emailVerifiedAt);
}

// A promoted host has control only over the session in which they were promoted.
// The creator retains ownership of scheduling and the full meeting history.
export async function canManageMeetingSession(meeting: Meeting, userId: string, occurrenceId?: string | null, active = true) {
  if (meeting.hostUserId === userId) return true;
  if (await canOpenAssignedMeeting(meeting, userId)) return true;
  const participant = await db.query.meetingParticipants.findFirst({ where: and(
    eq(meetingParticipants.meetingId, meeting.id),
    occurrenceId ? eq(meetingParticipants.occurrenceId, occurrenceId) : isNull(meetingParticipants.occurrenceId),
    eq(meetingParticipants.userId, userId), eq(meetingParticipants.role, 'host'),
    eq(meetingParticipants.admission, 'admitted'),
    active ? isNull(meetingParticipants.leftAt) : undefined,
  ) });
  return Boolean(participant);
}
