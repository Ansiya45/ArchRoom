import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { createClient } from '@supabase/supabase-js';
import { db } from '../db/index.js';
import { recordings } from '../db/schema.js';
import { env } from '../env.js';

export type CreateRecordingInput = {
  meetingId: string;
  fileName: string;
  mimeType?: string | null;
  fileSize?: number | null;
  durationSeconds?: number | null;
};

export class RecordingService {
  private supabase: ReturnType<typeof createClient> | null;

  constructor() {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      this.supabase = null;
      return;
    }

    this.supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  async createRecording(input: CreateRecordingInput, userId: string) {
    const fileName = input.fileName.trim();

    if (!fileName) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'file_name is required' });
    }

    const [recording] = await db
      .insert(recordings)
      .values({
        meetingId: input.meetingId,
        createdByUserId: userId,
        storagePath: `meeting/${input.meetingId}/${fileName}`,
        fileName,
        mimeType: input.mimeType || 'application/octet-stream',
        fileSize: input.fileSize ?? 0,
        durationSeconds: input.durationSeconds ?? 0,
        status: 'created',
      })
      .returning();

    return {
      ok: true,
      recording,
    };
  }

  async completeRecording(recordingId: string, input: { storagePath: string; fileName?: string }) {
    const [completed] = await db
      .update(recordings)
      .set({
        storagePath: input.storagePath,
        fileName: input.fileName ?? recordings.fileName,
        status: 'completed',
        completedAt: new Date(),
      })
      .where(eq(recordings.id, recordingId))
      .returning();

    return { ok: true, recording: completed };
  }

  async getForMeeting(meetingId: string) {
    const found = await db.query.recordings.findMany({
      where: eq(recordings.meetingId, meetingId),
    });

    return { ok: true, recordings: found };
  }

  async getBucketStatus() {
    return {
      configured: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
      bucket: env.SUPABASE_STORAGE_BUCKET,
    };
  }
}
