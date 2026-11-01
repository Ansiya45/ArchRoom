import { MeetingSummaryService } from '../services/meeting-summary.service.js';
import { MeetingHistoryService } from '../services/meeting-history.service.js';
import { MeetingAiPermissionService } from '../services/meeting-ai-permission.service.js';
import { z } from 'zod';
import { t } from '../trpc/init.js';
import { MeetingService } from '../services/meeting.service.js';
import { protectedProcedure } from '../trpc/protected.js';

import { recurrenceInput } from '../services/recurrence.service.js';
import { MeetingOccurrenceService } from '../services/meeting-occurrence.service.js';

import { RecurrenceSeriesService } from '../services/recurrence-series.service.js';

const meetingService = new MeetingService();
const recordingSettingsInput = z.object({
  recordingFolderId: z.string().min(1).max(128).nullable().optional(),
  recordingAccessPolicy: z.enum(['private', 'restricted', 'anyone_with_link']),
});
const scheduleInput = z.object({
  localDateTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  timeZone: z.string().min(1).max(100),
});

export const meetingsRouter = t.router({
  history: protectedProcedure.input(z.object({ offset: z.number().int().min(0).max(100000).default(0) }))
    .query(({ input, ctx }) => new MeetingHistoryService().list(ctx.user!.id, input.offset)),
  historyDetail: protectedProcedure.input(z.object({ meetingId: z.string().uuid() }))
    .query(({ input, ctx }) => new MeetingHistoryService().detail(input.meetingId, ctx.user!.id)),
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1),
        meetingCode: z.string().regex(/^YLM-[A-Z2-9]{6}$/).optional(),
        scheduledAt: z.string().datetime().optional().or(z.literal('')).optional(),
        startNow: z.boolean().default(false),
        schedule: scheduleInput.optional(),
        reusable: z.boolean().optional(),
        recurrence: recurrenceInput.optional(),
        recordingFolderId: z.string().min(1).max(128).nullable().optional(),
        recordingAccessPolicy: z.enum(['private', 'restricted', 'anyone_with_link']).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return meetingService.createMeeting(input, ctx.user!.id);
    }),

  occurrences: protectedProcedure
    .input(z.object({ meetingCode: z.string().min(1), fromDate: z.string().date().optional(), limit: z.number().int().min(1).max(12).default(6), after: z.object({ at: z.string().datetime(), id: z.string().uuid() }).optional() }))
    .mutation(({ input, ctx }) => new MeetingOccurrenceService().upcoming(input.meetingCode, ctx.user!.id, input.fromDate, input.limit, input.after)),

  changeRecurrence: protectedProcedure
    .input(z.object({
      meetingCode: z.string().min(1), expectedUpdatedAt: z.string().datetime(),
      action: z.enum(['edit_occurrence', 'edit_future', 'cancel_occurrence', 'cancel_series']),
      occurrenceId: z.string().uuid().optional(), schedule: scheduleInput.optional(), recurrence: recurrenceInput.optional(),
    }))
    .mutation(({ input, ctx }) => new RecurrenceSeriesService().change(input, ctx.user!.id)),

  reschedule: protectedProcedure
    .input(z.object({ meetingId: z.string().uuid(), schedule: scheduleInput }))
    .mutation(({ input, ctx }) => meetingService.rescheduleMeeting(input.meetingId, input.schedule, ctx.user!.id)),

  updateRecordingSettings: protectedProcedure
    .input(recordingSettingsInput.extend({ meetingId: z.string().uuid() }))
    .mutation(({ input, ctx }) => meetingService.updateRecordingSettings(input.meetingId, input, ctx.user!.id)),

  list: protectedProcedure.query(async ({ ctx }) => {
    return meetingService.listMeetings(ctx.user!.id);
  }),
  setPreference: protectedProcedure.input(z.object({ meetingId: z.string().uuid(), favorite: z.boolean().optional(), hidden: z.boolean().optional() })
    .refine(value => value.favorite !== undefined || value.hidden !== undefined, 'Choose a preference to update.'))
    .mutation(({ input, ctx }) => meetingService.setPreference(input.meetingId, ctx.user!.id, { favorite: input.favorite, hidden: input.hidden })),

  getByCode: t.procedure
    .input(z.object({ meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional() }))
    .query(async ({ input }) => {
      return meetingService.getByCode(input.meetingCode);
    }),

  join: t.procedure
    .input(
      z.object({
        meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional(),
        joinRequestId: z.string().uuid(),
        guestName: z.string().trim().min(1).max(120).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return meetingService.joinMeeting(input.meetingCode, {
        userId: ctx.user?.id,
        guestName: input.guestName,
        joinRequestId: input.joinRequestId,
        occurrenceId: input.occurrenceId,
      });
    }),

  admissionStatus: t.procedure
    .input(z.object({ meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional(), participantId: z.string().uuid() }))
    .query(async ({ input }) => {
      return meetingService.getAdmissionStatus(input.meetingCode, input.participantId);
    }),

  participants: t.procedure
    .input(z.object({ meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional(), participantId: z.string().uuid().optional() }))
    .query(async ({ input, ctx }) => {
      return meetingService.listAdmittedParticipants(input.meetingCode, {
        userId: ctx.user?.id,
        participantId: input.participantId,
        occurrenceId: input.occurrenceId,
      });
    }),

  pendingAdmissions: protectedProcedure
    .input(z.object({ meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional() }))
    .query(async ({ input, ctx }) => {
      return meetingService.listPendingAdmissions(input.meetingCode, ctx.user!.id, input.occurrenceId);
    }),

  decideAdmission: protectedProcedure
    .input(z.object({
      meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional(),
      participantId: z.string().uuid(),
      admit: z.boolean(),
    }))
    .mutation(async ({ input, ctx }) => {
      return meetingService.decideAdmission(input.meetingCode, input.participantId, input.admit, ctx.user!.id, input.occurrenceId);
    }),

  admitAll: protectedProcedure
    .input(z.object({ meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      return meetingService.admitAll(input.meetingCode, ctx.user!.id, input.occurrenceId);
    }),

  start: protectedProcedure
    .input(
      z.object({
        meetingCode: z.string().min(1), startRequestId: z.string().uuid().optional(), expectedUpdatedAt: z.string().datetime().optional(), occurrenceId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return meetingService.startMeeting(input.meetingCode, ctx.user!.id, input.startRequestId, input.expectedUpdatedAt, input.occurrenceId);
    }),

  updateGuestName: t.procedure
    .input(
      z.object({
        meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional(),
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
        meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional(),
        participantId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return meetingService.leaveMeeting(input.meetingCode, {
        userId: ctx.user?.id,
        participantId: input.participantId,
        occurrenceId: input.occurrenceId,
      });
    }),

  rejoin: t.procedure
    .input(z.object({ meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional(), participantId: z.string().uuid() }))
    .mutation(({ input, ctx }) => {
      return meetingService.rejoinMeeting(input.meetingCode, input.participantId, ctx.user?.id, input.occurrenceId);
    }),

  end: protectedProcedure
    .input(z.object({ meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional() }))
    .mutation(({ input, ctx }) => meetingService.endMeeting(input.meetingCode, ctx.user.id, input.occurrenceId)),

  livekitToken: t.procedure
    .input(z.object({ meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional(), participantId: z.string().uuid().optional() }))
    .mutation(({ input, ctx }) => meetingService.createLiveKitToken(input.meetingCode, {
      userId: ctx.user?.id,
      participantId: input.participantId,
        occurrenceId: input.occurrenceId,
    })),

  removeParticipant: protectedProcedure
    .input(z.object({ meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional(), participantId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return meetingService.removeParticipant(input.meetingCode, input.participantId, ctx.user!.id, input.occurrenceId);
    }),

  promoteCohost: protectedProcedure
    .input(z.object({ meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional(), participantId: z.string().uuid() }))
    .mutation(({ input, ctx }) => meetingService.promoteCohost(input.meetingCode, input.participantId, ctx.user!.id, input.occurrenceId)),

  muteParticipant: protectedProcedure
    .input(z.object({ meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional(), participantId: z.string().uuid() }))
    .mutation(({ input, ctx }) => meetingService.muteParticipant(input.meetingCode, input.participantId, ctx.user!.id, input.occurrenceId)),

  muteAll: protectedProcedure
    .input(z.object({ meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional() }))
    .mutation(({ input, ctx }) => meetingService.muteAllParticipants(input.meetingCode, ctx.user!.id, input.occurrenceId)),

  summaryRecipients: protectedProcedure
    .input(z.object({ meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional() }))
    .query(({ input, ctx }) => new MeetingSummaryService().recipients(input, ctx.user!.id)),
  aiStatus: t.procedure
    .input(z.object({ meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional(), participantId: z.string().uuid().optional() }))
    .query(({ input, ctx }) => new MeetingAiPermissionService().status(input, { userId: ctx.user?.id, participantId: input.participantId })),
  requestAiTranscription: protectedProcedure
    .input(z.object({ meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional() }))
    .mutation(({ input, ctx }) => new MeetingAiPermissionService().request(input, ctx.user!.id)),
  respondAiTranscription: t.procedure
    .input(z.object({ meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional(), participantId: z.string().uuid().optional(), requestId: z.string().uuid(), agree: z.boolean() }))
    .mutation(({ input, ctx }) => new MeetingAiPermissionService().respond(input, { userId: ctx.user?.id, participantId: input.participantId })),
  stopAiTranscription: protectedProcedure
    .input(z.object({ meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional(), requestId: z.string().uuid() }))
    .mutation(({ input, ctx }) => new MeetingAiPermissionService().stop(input, ctx.user!.id)),
  aiCaptureHeartbeat: protectedProcedure
    .input(z.object({ meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional(), requestId: z.string().uuid() }))
    .mutation(({ input, ctx }) => new MeetingAiPermissionService().heartbeat(input, ctx.user!.id)),
  transcribeSpeech: protectedProcedure
    .input(z.object({ meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional(), requestId: z.string().uuid(), sequence: z.number().int().min(0).max(20000), audio: z.string().min(1).max(2800000).regex(/^[A-Za-z0-9+/]+={0,2}$/), mimeType: z.enum(['audio/webm', 'audio/webm;codecs=opus', 'audio/mp4']) }))
    .mutation(({ input, ctx }) => new MeetingSummaryService().transcribe(input, ctx.user!.id)),
  generateSummary: protectedProcedure
    .input(z.object({ meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional(), speech: z.string().max(200000) }))
    .mutation(({ input, ctx }) => new MeetingSummaryService().generate(input, ctx.user!.id)),
  shareTranscript: protectedProcedure
    .input(z.object({ meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional(), summary: z.string().max(12000).optional(), transcript: z.string().max(200000).default(''), recipientIds: z.array(z.string().uuid()).min(1).max(100) }))
    .mutation(({ input, ctx }) => new MeetingSummaryService().send(input, ctx.user!.id)),
});
