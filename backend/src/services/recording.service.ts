import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { createClient } from '@supabase/supabase-js';
import { db } from '../db/index.js';
import { meetings, recordings, meetingOccurrences } from '../db/schema.js';
import { env } from '../env.js';

export type CreateRecordingInput = {
  meetingCode: string;
  occurrenceId?: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  durationSeconds: number;
};

export class RecordingService {
  private supabase: ReturnType<typeof createClient> | null;
  private bucketReady: Promise<void> | null = null;

  constructor() {
    this.supabase = env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
      ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;
  }

  private requireStorage() {
    if (!this.supabase) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Supabase Storage is not configured on the server' });
    }
    return this.supabase;
  }

  private async ensurePrivateBucket() {
    const supabase = this.requireStorage();
    if (!this.bucketReady) {
      this.bucketReady = (async () => {
        const existing = await supabase.storage.getBucket(env.SUPABASE_STORAGE_BUCKET);
        const result = existing.data
          ? await supabase.storage.updateBucket(env.SUPABASE_STORAGE_BUCKET, {
              public: false,
              allowedMimeTypes: ['video/webm'],
            })
          : await supabase.storage.createBucket(env.SUPABASE_STORAGE_BUCKET, {
              public: false,
              allowedMimeTypes: ['video/webm'],
            });
        if (result.error) throw result.error;
      })().catch((error) => {
        this.bucketReady = null;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Unable to prepare recording storage',
        });
      });
    }
    await this.bucketReady;
  }

  private async requireHostByCode(meetingCode: string, userId: string) {
    const meeting = await db.query.meetings.findFirst({
      where: eq(meetings.meetingCode, meetingCode.trim().toUpperCase()),
    });
    if (!meeting) throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found' });
    if (meeting.hostUserId !== userId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the meeting host can access recordings' });
    }
    return meeting;
  }

  private async requireOwnedRecording(recordingId: string, userId: string) {
    const [row] = await db.select({ recording: recordings, hostUserId: meetings.hostUserId })
      .from(recordings)
      .innerJoin(meetings, eq(recordings.meetingId, meetings.id))
      .where(eq(recordings.id, recordingId));
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Recording not found' });
    if (row.hostUserId !== userId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the meeting host can access recordings' });
    }
    return row.recording;
  }

  async authorizeExport(input: { meetingCode: string; occurrenceId?: string }, userId: string) {
    const meeting = await this.requireHostByCode(input.meetingCode, userId);
    if ((meeting.scheduleType === 'reusable' || meeting.scheduleType === 'recurring')) {
      const occurrence = input.occurrenceId && await db.query.meetingOccurrences.findFirst({
        where: and(eq(meetingOccurrences.id, input.occurrenceId), eq(meetingOccurrences.meetingId, meeting.id)),
      });
      if (!occurrence) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose the room session in which this recording was made.' });
    } else if (input.occurrenceId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'This meeting has no room sessions.' });
    return meeting;
  }

  async createUpload(input: CreateRecordingInput, userId: string) {
    const meeting = await this.authorizeExport(input, userId);
    const supabase = this.requireStorage();
    await this.ensurePrivateBucket();
    const safeName = input.fileName.trim().replace(/[^a-zA-Z0-9._-]/g, '-');
    const storagePath = `meetings/${meeting.id}/${input.occurrenceId ? `sessions/${input.occurrenceId}/` : ''}${crypto.randomUUID()}-${safeName}`;
    const { data, error } = await supabase.storage.from(env.SUPABASE_STORAGE_BUCKET).createSignedUploadUrl(storagePath);
    if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });

    const [recording] = await db.insert(recordings).values({
      meetingId: meeting.id,
      occurrenceId: input.occurrenceId ?? null,
      createdByUserId: userId,
      storagePath,
      fileName: safeName,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      durationSeconds: input.durationSeconds,
      status: 'created',
    }).returning();
    return { ok: true, recording, uploadUrl: data.signedUrl };
  }

  async completeRecording(recordingId: string, userId: string) {
    const recording = await this.requireOwnedRecording(recordingId, userId);
    if (recording.status === 'completed') return { ok: true, recording };
    const { data, error } = await this.requireStorage().storage.from(env.SUPABASE_STORAGE_BUCKET).info(recording.storagePath);
    if (error || !data || data.size !== recording.fileSize) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'The recording file is missing or incomplete. Retry the upload before saving.' });
    }
    const [completed] = await db.update(recordings).set({ status: 'completed', completedAt: new Date() })
      .where(and(eq(recordings.id, recordingId), eq(recordings.createdByUserId, userId))).returning();
    return { ok: true, recording: completed };
  }

  async retryUpload(recordingId: string, userId: string) {
    const recording = await this.requireOwnedRecording(recordingId, userId);
    const storage = this.requireStorage().storage.from(env.SUPABASE_STORAGE_BUCKET);
    const existing = await storage.info(recording.storagePath);
    if (existing.data) {
      if (existing.data.size !== recording.fileSize) throw new TRPCError({ code: 'CONFLICT', message: 'The stored recording has an unexpected size.' });
      return { transferred: true, uploadUrl: null };
    }
    if (existing.error && !['404', '400'].includes(String(existing.error.statusCode))) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unable to check the previous upload. Please retry.' });
    }
    const { data, error } = await storage.createSignedUploadUrl(recording.storagePath);
    if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
    return { transferred: false, uploadUrl: data.signedUrl };
  }

  async getForMeeting(meetingCode: string, userId: string) {
    const meeting = await this.requireHostByCode(meetingCode, userId);
    const found = await db.query.recordings.findMany({
      where: and(eq(recordings.meetingId, meeting.id), eq(recordings.status, 'completed')),
      orderBy: [desc(recordings.createdAt)],
    });
    return { ok: true, recordings: found };
  }

  async getDownloadUrl(recordingId: string, userId: string) {
    const supabase = this.requireStorage();
    const recording = await this.requireOwnedRecording(recordingId, userId);
    if (recording.status !== 'completed') {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Recording upload is not complete' });
    }
    const { data, error } = await supabase.storage.from(env.SUPABASE_STORAGE_BUCKET)
      .createSignedUrl(recording.storagePath, 60 * 10, { download: recording.fileName });
    if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
    return { ok: true, url: data.signedUrl };
  }
}
