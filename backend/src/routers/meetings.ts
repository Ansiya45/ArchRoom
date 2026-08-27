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
        meetingCode: z.string().regex(/^YLM-[A-Z2-9]{6}$/).optional(),
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

  getByCode: t.procedure
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

  admissionStatus: t.procedure
    .input(z.object({ meetingCode: z.string().min(1), participantId: z.string().uuid() }))
    .query(async ({ input }) => {
      return meetingService.getAdmissionStatus(input.meetingCode, input.participantId);
    }),

  participants: t.procedure
    .input(z.object({ meetingCode: z.string().min(1), participantId: z.string().uuid().optional() }))
    .query(async ({ input, ctx }) => {
      return meetingService.listAdmittedParticipants(input.meetingCode, {
        userId: ctx.user?.id,
        participantId: input.participantId,
      });
    }),

  pendingAdmissions: protectedProcedure
    .input(z.object({ meetingCode: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      return meetingService.listPendingAdmissions(input.meetingCode, ctx.user!.id);
    }),

  decideAdmission: protectedProcedure
    .input(z.object({
      meetingCode: z.string().min(1),
      participantId: z.string().uuid(),
      admit: z.boolean(),
    }))
    .mutation(async ({ input, ctx }) => {
      return meetingService.decideAdmission(input.meetingCode, input.participantId, input.admit, ctx.user!.id);
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

  leave: t.procedure
    .input(
      z.object({
        meetingCode: z.string().min(1),
        participantId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return meetingService.leaveMeeting(input.meetingCode, {
        userId: ctx.user?.id,
        participantId: input.participantId,
      });
    }),

  rejoin: t.procedure
    .input(z.object({ meetingCode: z.string().min(1), participantId: z.string().uuid() }))
    .mutation(({ input, ctx }) => {
      return meetingService.rejoinMeeting(input.meetingCode, input.participantId, ctx.user?.id);
    }),

  end: protectedProcedure
    .input(z.object({ meetingCode: z.string().min(1) }))
    .mutation(({ input, ctx }) => meetingService.endMeeting(input.meetingCode, ctx.user.id)),

  removeParticipant: protectedProcedure
    .input(z.object({ meetingCode: z.string().min(1), participantId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return meetingService.removeParticipant(input.meetingCode, input.participantId, ctx.user!.id);
    }),
});
