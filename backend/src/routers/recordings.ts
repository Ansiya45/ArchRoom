import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { type Context } from '../trpc/context.js';
import { RecordingService } from '../services/recording.service.js';
import { protectedProcedure } from '../trpc/protected.js';

const t = initTRPC.context<Context>().create();
const recordingService = new RecordingService();

export const recordingsRouter = t.router({
  create: protectedProcedure
    .input(
      z.object({
        meetingId: z.string().min(1),
        fileName: z.string().min(1),
        mimeType: z.string().min(1).optional(),
        fileSize: z.number().int().nonnegative().optional(),
        durationSeconds: z.number().int().nonnegative().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return recordingService.createRecording(input, ctx.user!.id);
    }),

  complete: protectedProcedure
    .input(
      z.object({
        recordingId: z.string().min(1),
        storagePath: z.string().min(1),
        fileName: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ input }) => {
      return recordingService.completeRecording(input.recordingId, {
        storagePath: input.storagePath,
        fileName: input.fileName,
      });
    }),

  getForMeeting: protectedProcedure
    .input(
      z.object({
        meetingId: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
      return recordingService.getForMeeting(input.meetingId);
    }),
});
