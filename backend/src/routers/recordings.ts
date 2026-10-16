import { z } from 'zod';
import { t } from '../trpc/init.js';
import { RecordingService } from '../services/recording.service.js';
import { protectedProcedure } from '../trpc/protected.js';
import { MeetingHistoryService, driveRecordingUrl } from '../services/meeting-history.service.js';

const recordingService = new RecordingService();

export const recordingsRouter = t.router({
  saveDriveReference: protectedProcedure.input(z.object({
    meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional(),
    url: z.string().max(1000), fileName: z.string().min(1).max(255),
  })).mutation(async ({ input, ctx }) => {
    const url = driveRecordingUrl(input.url);
    const meeting = await recordingService.authorizeExport(input, ctx.user.id);
    await new MeetingHistoryService().save({ meetingId: meeting.id, occurrenceId: input.occurrenceId,
      kind: 'drive', dedupeKey: `drive:${input.occurrenceId || 'meeting'}:${url.split('/')[5]}`, content: url, label: input.fileName });
    return { ok: true };
  }),
  authorizeExport: protectedProcedure.input(z.object({
    meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional(),
  })).mutation(async ({ input, ctx }) => {
    await recordingService.authorizeExport(input, ctx.user.id);
    return { ok: true };
  }),

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

  retryUpload: protectedProcedure.input(z.object({ recordingId: z.string().uuid() }))
    .mutation(({ input, ctx }) => recordingService.retryUpload(input.recordingId, ctx.user.id)),

  getForMeeting: protectedProcedure.input(z.object({ meetingCode: z.string().min(1) }))
    .query(({ input, ctx }) => recordingService.getForMeeting(input.meetingCode, ctx.user.id)),

  downloadUrl: protectedProcedure.input(z.object({ recordingId: z.string().uuid() }))
    .mutation(({ input, ctx }) => recordingService.getDownloadUrl(input.recordingId, ctx.user.id)),
});
