import { z } from 'zod';
import { t } from '../trpc/init.js';
import { MeetingService } from '../services/meeting.service.js';
import { protectedProcedure } from '../trpc/protected.js';

const meetingService = new MeetingService();

export const meetingsRouter = t.router({
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1),
        scheduledAt: z.string().datetime().optional().or(z.literal('')).optional(),
        startNow: z.boolean().default(false),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return meetingService.createMeeting(input, ctx.user!.id);
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    return meetingService.listMeetings(ctx.user!.id);
  }),

  getByCode: protectedProcedure
    .input(z.object({ meetingCode: z.string().min(1) }))
    .query(async ({ input }) => {
      return meetingService.getByCode(input.meetingCode);
    }),

  join: t.procedure
    .input(
      z.object({
        meetingCode: z.string().min(1),
        guestName: z.string().trim().min(1).max(120).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return meetingService.joinMeeting(input.meetingCode, {
        userId: ctx.user?.id,
        guestName: input.guestName,
      });
    }),

  start: protectedProcedure
    .input(
      z.object({
        meetingCode: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return meetingService.startMeeting(input.meetingCode, ctx.user!.id);
    }),

  updateGuestName: t.procedure
    .input(
      z.object({
        meetingCode: z.string().min(1),
        participantId: z.string().uuid(),
        guestName: z.string().trim().min(1).max(120),
      })
    )
    .mutation(async ({ input }) => {
      return meetingService.updateGuestName(input.meetingCode, input.participantId, input.guestName);
    }),

  leave: protectedProcedure
    .input(
      z.object({
        meetingCode: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return meetingService.leaveMeeting(input.meetingCode, ctx.user!.id);
    }),
});
