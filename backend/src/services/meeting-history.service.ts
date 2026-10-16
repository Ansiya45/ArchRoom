import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { meetings, meetingOccurrences, meetingHistoryItems, recordings } from '../db/schema.js';

export function driveRecordingUrl(value: string) {
  const match = /^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)\/view(?:\?[^#]*)?$/.exec(value);
  if (!match) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid Google Drive recording link.' });
  return `https://drive.google.com/file/d/${match[1]}/view`;
}

export class MeetingHistoryService {
  async list(userId: string, offset = 0) {
    return db.select().from(meetings).where(eq(meetings.hostUserId, userId))
      .orderBy(desc(meetings.createdAt), desc(meetings.id)).limit(30).offset(offset);
  }
  async detail(meetingId: string, userId: string) {
    const meeting = await db.query.meetings.findFirst({ where: and(eq(meetings.id, meetingId), eq(meetings.hostUserId, userId)) });
    if (!meeting) throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting history not found.' });
    const [sessions, items, savedRecordings] = await Promise.all([
      db.select().from(meetingOccurrences).where(eq(meetingOccurrences.meetingId, meetingId)).orderBy(desc(meetingOccurrences.scheduledAt), desc(meetingOccurrences.startedAt)),
      db.select().from(meetingHistoryItems).where(eq(meetingHistoryItems.meetingId, meetingId)).orderBy(asc(meetingHistoryItems.createdAt), asc(meetingHistoryItems.id)),
      db.select({ id: recordings.id, occurrenceId: recordings.occurrenceId, fileName: recordings.fileName, status: recordings.status, createdAt: recordings.createdAt, durationSeconds: recordings.durationSeconds, fileSize: recordings.fileSize })
        .from(recordings).where(eq(recordings.meetingId, meetingId)).orderBy(desc(recordings.createdAt)),
    ]);
    return { meeting, sessions, items, recordings: savedRecordings };
  }
  // Callers must authorize the meeting/session before writing.
  async save(input: typeof meetingHistoryItems.$inferInsert) {
    await db.insert(meetingHistoryItems).values(input).onConflictDoNothing();
  }
}
