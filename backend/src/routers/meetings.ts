import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { type Context } from '../trpc/context.js';
import { MeetingService } from '../services/meeting.service.js';
import { protectedProcedure } from '../trpc/protected.js';

const t = initTRPC.context<Context>().create();
const meetingService = new MeetingService();

export const meetingsRouter = t.router({
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1),
        scheduledAt: z.string().datetime().optional().or(z.literal('')).optional(),
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

  join: protectedProcedure
    .input(
      z.object({
        meetingCode: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return meetingService.joinMeeting(input.meetingCode, ctx.user!.id);
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
