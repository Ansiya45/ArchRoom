import { createHmac, timingSafeEqual } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.js';
import { meetings, meetingInvitations, meetingDeliveries, users } from '../db/schema.js';
import { env } from '../env.js';
import { calendarExport, meetingLink, nextCalendarStart } from './meeting-calendar.service.js';

import { MeetingOccurrenceService } from './meeting-occurrence.service.js';

export async function currentCalendar(meeting: typeof meetings.$inferSelect) {
  if (meeting.recurrenceCancelledAt || !meeting.scheduledAt || meeting.scheduleType === 'reusable' || !env.APP_PUBLIC_URL) return null;
  if (meeting.scheduleType === 'recurring' && meeting.recurrenceEditedAt) {
    let after: { at: string; id: string } | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await new MeetingOccurrenceService().upcoming(meeting.meetingCode, meeting.hostUserId, undefined, 12, after);
      const next = result.occurrences.find(o => !o.cancelledAt && o.status === 'scheduled' && o.scheduledAt && o.scheduledAt > new Date());
      if (next?.scheduledAt) return calendarExport(result.meeting, publicAppUrl(), new Date(), { id: next.id, scheduledAt: next.scheduledAt, timeZone: next.timeZone || result.meeting.timeZone });
      if (!result.nextCursor) return null;
      after = result.nextCursor;
    }
    return null;
  }
  return calendarExport(meeting, publicAppUrl());
}

export type ScheduledMeeting = typeof meetings.$inferSelect;
export function publicAppUrl() {
  if (!env.APP_PUBLIC_URL) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Scheduling links require APP_PUBLIC_URL on the backend.' });
  return env.APP_PUBLIC_URL;
}
export function assertEmailConfigured() {
  publicAppUrl();
  if (!env.RESEND_API_KEY) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Meeting email is not configured.' });
}
export function preferenceToken(id: string) {
  const signature = createHmac('sha256', env.JWT_SECRET).update(`meeting-email-preferences:${id}`).digest('base64url');
  return `${id}.${signature}`;
}
export function invitationIdFromToken(token: string) {
  const [id, signature, extra] = token.split('.');
  if (extra || !z.string().uuid().safeParse(id).success || !signature) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid preference link.' });
  const expected = Buffer.from(preferenceToken(id)); const actual = Buffer.from(token);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid preference link.' });
  return id;
}
export const escapeEmailHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function notificationPayload(meeting: ScheduledMeeting, invitation: typeof meetingInvitations.$inferSelect, kind: 'invitation' | 'reminder', scheduledAt: Date | null) {
  const link = meetingLink(meeting, publicAppUrl());
  const preferences = `${new URL(publicAppUrl()).origin}/meeting-notifications#${preferenceToken(invitation.id)}`;
  const displayedStart = kind === 'invitation' && meeting.recurrenceEditedAt ? null : kind === 'invitation' && meeting.scheduleType === 'recurring' ? nextCalendarStart(meeting, new Date()) : scheduledAt;
  const time = displayedStart ? displayedStart.toLocaleString('en-US', { timeZone: meeting.timeZone || 'UTC', dateStyle: 'full', timeStyle: 'short' }) + ` (${meeting.timeZone || 'UTC'})` : meeting.recurrenceEditedAt ? 'Schedule updated - view the current schedule using the link below' : meeting.scheduleType === 'recurring' ? 'No remaining calendar occurrences' : 'No fixed time';
  const title = escapeEmailHtml(meeting.title);
  return {
    from: env.MEETING_EMAIL_FROM || env.EMAIL_FROM,
    to: invitation.email,
    subject: kind === 'reminder' ? `YLAAM Meet starts soon: ${meeting.title}` : `YLAAM Meet invitation: ${meeting.title}`,
    html: `<div style="font-family:Arial,sans-serif"><h2>${title}</h2><p>${kind === 'reminder' ? 'Your scheduled meeting starts soon.' : 'You have been invited to a YLAAM Meet meeting.'}</p><p>${escapeEmailHtml(time)}${meeting.scheduleType === 'recurring' ? ' - recurring series' : ''}</p><p><a href="${escapeEmailHtml(link)}">Join YLAAM Meet</a></p><p>The host must open the meeting and admit participants. This invitation does not grant admission.</p><p><a href="${escapeEmailHtml(preferences)}">View schedule, add to calendar, or manage email reminders</a></p><p>Reminders are optional and disabled until you enable them. Calendar copies do not automatically synchronize.</p></div>`,
  };
}

export class MeetingNotificationService {
  async hostMeeting(meetingId: string, userId: string) {
    const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, meetingId) });
    if (!meeting || meeting.hostUserId !== userId) throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the host can manage meeting invitations.' });
    return meeting;
  }
  async info(meetingId: string, userId: string) {
    const meeting = await this.hostMeeting(meetingId, userId);
    const invitations = await db.query.meetingInvitations.findMany({ where: eq(meetingInvitations.meetingId, meetingId) });
    const deliveries = await db.select({ invitationId: meetingDeliveries.invitationId, status: meetingDeliveries.status, kind: meetingDeliveries.kind, scheduledAt: meetingDeliveries.scheduledAt }).from(meetingDeliveries).where(eq(meetingDeliveries.meetingId, meetingId)).limit(200);
    return { invitations, deliveries, calendar: await currentCalendar(meeting), emailConfigured: !!env.RESEND_API_KEY && !!env.APP_PUBLIC_URL };
  }
  async invite(meetingId: string, userId: string, inputEmails: string[]) {
    assertEmailConfigured();
    const emails = [...new Set(inputEmails.map(email => z.string().email().max(255).parse(email.trim().toLowerCase())))];
    if (!emails.length || emails.length > 20) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invite between 1 and 20 email addresses at a time.' });
    return db.transaction(async tx => {
      const [meeting] = await tx.select().from(meetings).where(eq(meetings.id, meetingId)).for('update');
      if (!meeting || meeting.hostUserId !== userId) throw new TRPCError({ code: 'FORBIDDEN' });
      const host = await tx.query.users.findFirst({ where: eq(users.id, userId) });
      if (!host?.emailVerifiedAt) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Verify your email before sending invitations.' });
      if (meeting.status === 'ended' || meeting.recurrenceCancelledAt) throw new TRPCError({ code: 'CONFLICT', message: 'This meeting has ended.' });
      const existing = await tx.query.meetingInvitations.findMany({ where: eq(meetingInvitations.meetingId, meetingId) });
      if (new Set([...existing.map(row => row.email), ...emails]).size > 100) throw new TRPCError({ code: 'BAD_REQUEST', message: 'This meeting supports up to 100 email invitees.' });
      const now = new Date();
      for (const email of emails) {
        let invitation = existing.find(row => row.email === email);
        if (!invitation) [invitation] = await tx.insert(meetingInvitations).values({ meetingId, email }).returning();
        await tx.insert(meetingDeliveries).values({ invitationId: invitation.id, meetingId, kind: 'invitation', deliveryKey: `invite:${invitation.id}`, scheduledAt: meeting.scheduledAt, dueAt: now, expiresAt: new Date(now.getTime() + 23 * 3600000) }).onConflictDoNothing();
      }
      return { ok: true, message: 'Invitation request processed. New addresses receive one invitation; previously invited addresses are not sent another.' };
    });
  }
  async myReminder(meetingId: string, userId: string, enabled: boolean) {
    if (enabled) assertEmailConfigured();
    const meeting = await this.hostMeeting(meetingId, userId);
    if (enabled && (!meeting.scheduledAt || meeting.scheduleType === 'reusable' || meeting.status === 'ended' || meeting.recurrenceCancelledAt)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Reminders require an upcoming scheduled meeting.' });
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user?.emailVerifiedAt) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Verify your email to enable reminders.' });
    await db.insert(meetingInvitations).values({ meetingId, email: user.email.toLowerCase(), remindersEnabled: enabled }).onConflictDoUpdate({ target: [meetingInvitations.meetingId, meetingInvitations.email], set: { remindersEnabled: enabled } });
    return { ok: true };
  }
  async preferences(token: string) {
    const invitation = await db.query.meetingInvitations.findFirst({ where: eq(meetingInvitations.id, invitationIdFromToken(token)) });
    if (!invitation) throw new TRPCError({ code: 'NOT_FOUND', message: 'This invitation no longer exists.' });
    const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, invitation.meetingId) });
    if (!meeting) throw new TRPCError({ code: 'NOT_FOUND' });
    return { title: meeting.title, meetingCode: meeting.meetingCode, remindersEnabled: invitation.remindersEnabled, canRemind: !!meeting.scheduledAt && meeting.scheduleType !== 'reusable' && meeting.status !== 'ended' && !meeting.recurrenceCancelledAt, cancelled: !!meeting.recurrenceCancelledAt, calendar: await currentCalendar(meeting) };
  }
  async setPreferences(token: string, enabled: boolean) {
    const current = await this.preferences(token);
    if (enabled && !current.canRemind) throw new TRPCError({ code: 'BAD_REQUEST', message: 'This meeting has no upcoming scheduled reminders.' });
    await db.update(meetingInvitations).set({ remindersEnabled: enabled }).where(eq(meetingInvitations.id, invitationIdFromToken(token)));
    return { ok: true };
  }
}
