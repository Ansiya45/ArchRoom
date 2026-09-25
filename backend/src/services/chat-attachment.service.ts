import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';
import { createClient } from '@supabase/supabase-js';
import { db } from '../db/index.js';
import { meetingParticipants, meetings } from '../db/schema.js';
import { assertCurrentOccurrence, participantScope, attachmentPrefix } from './meeting-occurrence.service.js';
import { env } from '../env.js';

export class ChatAttachmentService {
  private supabase = env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
  private bucketReady: Promise<void> | null = null;

  private requireStorage() {
    if (!this.supabase) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Supabase Storage is not configured' });
    }
    return this.supabase;
  }

  private async ensureBucket() {
    const supabase = this.requireStorage();
    if (!this.bucketReady) {
      this.bucketReady = (async () => {
        const existing = await supabase.storage.getBucket(env.SUPABASE_CHAT_FILES_BUCKET);
        const result = existing.data
          ? await supabase.storage.updateBucket(env.SUPABASE_CHAT_FILES_BUCKET, { public: false, fileSizeLimit: 25 * 1024 * 1024 })
          : await supabase.storage.createBucket(env.SUPABASE_CHAT_FILES_BUCKET, { public: false, fileSizeLimit: 25 * 1024 * 1024 });
        if (result.error) throw result.error;
      })().catch((error) => {
        this.bucketReady = null;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error instanceof Error ? error.message : 'Unable to prepare chat storage' });
      });
    }
    await this.bucketReady;
  }

  private async requireParticipant(meetingCode: string, identity: { userId?: string; participantId?: string; occurrenceId?: string }) {
    const meeting = await db.query.meetings.findFirst({
      where: eq(meetings.meetingCode, meetingCode.trim().toUpperCase()),
    });
    if (!meeting || meeting.status === 'ended') throw new TRPCError({ code: 'NOT_FOUND', message: 'Active meeting not found' });
    assertCurrentOccurrence(meeting, identity.occurrenceId);
    const participant = await db.query.meetingParticipants.findFirst({
      where: and(
        eq(meetingParticipants.meetingId, meeting.id), participantScope(meeting),
        (meeting.scheduleType === 'reusable' || meeting.scheduleType === 'recurring') ? eq(meetingParticipants.id, identity.participantId || '00000000-0000-0000-0000-000000000000') : undefined,
        identity.userId
          ? eq(meetingParticipants.userId, identity.userId)
          : eq(meetingParticipants.id, identity.participantId || '00000000-0000-0000-0000-000000000000'),
        eq(meetingParticipants.admission, 'admitted'),
        isNull(meetingParticipants.leftAt)
      ),
    });
    if (!participant) throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admitted participants can access chat files' });
    return meeting;
  }

  async createUpload(meetingCode: string, fileName: string, identity: { userId?: string; participantId?: string; occurrenceId?: string }) {
    await this.ensureBucket();
    const meeting = await this.requireParticipant(meetingCode, identity);
    const safeName = fileName.trim().replace(/[^a-zA-Z0-9._-]/g, '-').slice(-180) || 'attachment';
    const storagePath = `${attachmentPrefix(meeting)}${crypto.randomUUID()}-${safeName}`;
    const { data, error } = await this.requireStorage().storage.from(env.SUPABASE_CHAT_FILES_BUCKET).createSignedUploadUrl(storagePath);
    if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
    return { ok: true, storagePath, uploadUrl: data.signedUrl };
  }

  async downloadUrl(meetingCode: string, storagePath: string, fileName: string, identity: { userId?: string; participantId?: string; occurrenceId?: string }) {
    const meeting = await this.requireParticipant(meetingCode, identity);
    if (!storagePath.startsWith(attachmentPrefix(meeting))) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This file does not belong to the meeting' });
    }
    const { data, error } = await this.requireStorage().storage.from(env.SUPABASE_CHAT_FILES_BUCKET)
      .createSignedUrl(storagePath, 60 * 10, { download: fileName });
    if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
    return { ok: true, url: data.signedUrl };
  }
}
