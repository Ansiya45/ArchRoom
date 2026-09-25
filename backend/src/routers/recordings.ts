import { z } from 'zod';
import { t } from '../trpc/init.js';
import { RecordingService } from '../services/recording.service.js';
import { protectedProcedure } from '../trpc/protected.js';

const recordingService = new RecordingService();

export const recordingsRouter = t.router({
  createUpload: protectedProcedure.input(z.object({
    meetingCode: z.string().min(1),
    occurrenceId: z.string().uuid().optional(),
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(120),
    fileSize: z.number().int().positive(),
    durationSeconds: z.number().int().nonnegative(),
  })).mutation(({ input, ctx }) => recordingService.createUpload(input, ctx.user.id)),

  complete: protectedProcedure.input(z.object({ recordingId: z.string().uuid() }))
    .mutation(({ input, ctx }) => recordingService.completeRecording(input.recordingId, ctx.user.id)),

  getForMeeting: protectedProcedure.input(z.object({ meetingCode: z.string().min(1) }))
    .query(({ input, ctx }) => recordingService.getForMeeting(input.meetingCode, ctx.user.id)),

  downloadUrl: protectedProcedure.input(z.object({ recordingId: z.string().uuid() }))
    .mutation(({ input, ctx }) => recordingService.getDownloadUrl(input.recordingId, ctx.user.id)),
});
