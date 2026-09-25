import { z } from 'zod';
import { t } from '../trpc/init.js';
import { protectedProcedure } from '../trpc/protected.js';
import { MeetingNotificationService } from '../services/meeting-notification.service.js';
const service = new MeetingNotificationService();
const meetingInput = z.object({ meetingId: z.string().uuid() });
const tokenInput = z.object({ token: z.string().min(1).max(150) });
export const meetingNotificationsRouter = t.router({
  info: protectedProcedure.input(meetingInput).query(({ input, ctx }) => service.info(input.meetingId, ctx.user!.id)),
  invite: protectedProcedure.input(meetingInput.extend({ emails: z.array(z.string().trim().email().max(255)).min(1).max(20) })).mutation(({ input, ctx }) => service.invite(input.meetingId, ctx.user!.id, input.emails)),
  myReminder: protectedProcedure.input(meetingInput.extend({ enabled: z.boolean() })).mutation(({ input, ctx }) => service.myReminder(input.meetingId, ctx.user!.id, input.enabled)),
  preferences: t.procedure.input(tokenInput).mutation(({ input }) => service.preferences(input.token)),
  setPreferences: t.procedure.input(tokenInput.extend({ enabled: z.boolean() })).mutation(({ input }) => service.setPreferences(input.token, input.enabled)),
});
