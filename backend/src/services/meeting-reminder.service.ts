import { and, eq, lte } from 'drizzle-orm';
import { db } from '../db/index.js';
import { meetings, meetingOccurrences, meetingInvitations, meetingDeliveries } from '../db/schema.js';
import { env } from '../env.js';
import { MeetingOccurrenceService } from './meeting-occurrence.service.js';
import { localDateTime } from './meeting-schedule.service.js';
import { assertEmailConfigured, notificationPayload, type ScheduledMeeting } from './meeting-notification.service.js';

import { occurrenceTimeZone } from './recurrence-series.service.js';

type Delivery = typeof meetingDeliveries.$inferSelect;
type Invitation = typeof meetingInvitations.$inferSelect;
type Occurrence = typeof meetingOccurrences.$inferSelect;
const MINUTE = 60000;
export function reminderKey(invitationId: string, occurrenceId: string | null, scheduledAt: Date) {
  return `reminder:${invitationId}:${occurrenceId || 'one-time'}:${scheduledAt.toISOString()}`;
}
export function reminderIsCurrent(meeting: ScheduledMeeting, job: Delivery, invitation: Invitation, occurrence: Occurrence | undefined, now: Date) {
  if (!invitation.remindersEnabled || !job.scheduledAt || job.scheduledAt <= now || job.expiresAt <= now) return false;
  if (meeting.recurrenceCancelledAt || meeting.scheduleType === 'reusable' || !meeting.scheduledAt) return false;
  if (meeting.scheduleType === 'recurring') return !!occurrence && occurrence.meetingId === meeting.id && occurrence.status === 'scheduled' && !occurrence.cancelledAt && occurrence.scheduledAt?.getTime() === job.scheduledAt.getTime();
  return !job.occurrenceId && meeting.status === 'scheduled' && meeting.scheduledAt.getTime() === job.scheduledAt.getTime();
}
export async function sendMeetingEmail(payload: NonNullable<Delivery['payload']>, idempotencyKey: string) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ ...payload, to: [payload.to] }),
  });
  // Never log provider response bodies, recipients, credentials or capability links.
  if (!response.ok) throw new Error(`Meeting email provider returned HTTP ${response.status}`);
}
export class MeetingReminderService {
  constructor(private readonly sender = sendMeetingEmail) {}
  async plan(now = new Date()) {
    const subscribed = await db.selectDistinct({ meetingId: meetingInvitations.meetingId }).from(meetingInvitations).where(eq(meetingInvitations.remindersEnabled, true));
    for (const { meetingId } of subscribed) {
      const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, meetingId) });
      if (!meeting?.scheduledAt || meeting.scheduleType === 'reusable' || meeting.status === 'ended' || meeting.recurrenceCancelledAt) continue;
      // Materialize only a small upcoming window; no open dashboard is required.
      if (meeting.scheduleType === 'recurring' && meeting.timeZone) await new MeetingOccurrenceService().upcoming(meeting.meetingCode, meeting.hostUserId, localDateTime(now, meeting.timeZone).slice(0,10), 12);
      const candidates = meeting.scheduleType === 'recurring'
        ? (await db.query.meetingOccurrences.findMany({ where: eq(meetingOccurrences.meetingId, meeting.id) })).filter(o => !o.cancelledAt).map(o => ({ occurrenceId: o.id, scheduledAt: o.scheduledAt!, status: o.status }))
        : [{ occurrenceId: null, scheduledAt: meeting.scheduledAt, status: meeting.status }];
      const recipients = await db.query.meetingInvitations.findMany({ where: and(eq(meetingInvitations.meetingId, meetingId), eq(meetingInvitations.remindersEnabled, true)) });
      for (const candidate of candidates) {
        if (!candidate.scheduledAt || candidate.status !== 'scheduled' || candidate.scheduledAt <= now || candidate.scheduledAt.getTime() - now.getTime() > 10 * MINUTE) continue;
        for (const invitation of recipients) await db.insert(meetingDeliveries).values({
          invitationId: invitation.id, meetingId, occurrenceId: candidate.occurrenceId,
          kind: 'reminder', deliveryKey: reminderKey(invitation.id, candidate.occurrenceId, candidate.scheduledAt), scheduledAt: candidate.scheduledAt,
          dueAt: new Date(candidate.scheduledAt.getTime() - 10 * MINUTE), expiresAt: candidate.scheduledAt,
        }).onConflictDoUpdate({ target: meetingDeliveries.deliveryKey, set: { status: 'pending' }, setWhere: eq(meetingDeliveries.status, 'skipped') });
      }
    }
  }
  async prepare(id: string, now = new Date()) {
    // Commit the exact payload before any network call. A crashed sender can retry
    // using the same provider idempotency key and bytes, within its 24-hour window.
    return db.transaction(async tx => {
      const [job] = await tx.select().from(meetingDeliveries).where(eq(meetingDeliveries.id, id)).for('update');
      if (!job || job.status !== 'pending' || job.dueAt > now) return null;
      if (job.expiresAt <= now || job.attempts >= 10 || (job.firstAttemptAt && now.getTime() - job.firstAttemptAt.getTime() >= 23 * 3600000)) {
        await tx.update(meetingDeliveries).set({ status: job.kind === 'reminder' && job.expiresAt <= now ? 'skipped' : 'failed' }).where(eq(meetingDeliveries.id, id)); return null;
      }
      const invitation = await tx.query.meetingInvitations.findFirst({ where: eq(meetingInvitations.id, job.invitationId) });
      const meeting = await tx.query.meetings.findFirst({ where: eq(meetings.id, job.meetingId) });
      if (!invitation || !meeting) return null;
      const occurrence = job.occurrenceId ? await tx.query.meetingOccurrences.findFirst({ where: eq(meetingOccurrences.id, job.occurrenceId) }) : undefined;
      const payload = job.payload || notificationPayload({ ...meeting, timeZone: occurrence ? occurrenceTimeZone(meeting, occurrence) : meeting.timeZone }, invitation, job.kind, job.kind === 'invitation' ? meeting.scheduledAt : job.scheduledAt);
      const [prepared] = await tx.update(meetingDeliveries).set({ payload, firstAttemptAt: job.firstAttemptAt || now, attempts: job.attempts + 1, dueAt: new Date(now.getTime() + MINUTE) }).where(eq(meetingDeliveries.id, id)).returning();
      return prepared;
    });
  }
  async deliver(prepared: Delivery, now?: Date) {
    return db.transaction(async tx => {
      // Lock the parent during the final eligibility check and bounded send, so a
      // committed reschedule/end cannot race a stale reminder into the provider.
      const [meeting] = await tx.select().from(meetings).where(eq(meetings.id, prepared.meetingId)).for('update');
      const [invitation] = await tx.select().from(meetingInvitations).where(eq(meetingInvitations.id, prepared.invitationId)).for('update');
      const [job] = await tx.select().from(meetingDeliveries).where(eq(meetingDeliveries.id, prepared.id)).for('update');
      if (!meeting || !invitation || !job || job.status !== 'pending' || job.attempts !== prepared.attempts) return;
      const occurrence = job.occurrenceId ? await tx.query.meetingOccurrences.findFirst({ where: eq(meetingOccurrences.id, job.occurrenceId) }) : undefined;
      const checkedAt = now || new Date();
      if (job.expiresAt <= checkedAt || (job.kind === 'reminder' ? !reminderIsCurrent(meeting, job, invitation, occurrence, checkedAt) : meeting.status === 'ended' || !!meeting.recurrenceCancelledAt)) {
        await tx.update(meetingDeliveries).set({ status: 'skipped' }).where(eq(meetingDeliveries.id, job.id)); return;
      }
      try {
        await this.sender(job.payload!, `ylaam-meeting-${job.id}`);
        await tx.update(meetingDeliveries).set({ status: 'sent', sentAt: new Date() }).where(eq(meetingDeliveries.id, job.id));
      } catch {
        // Keep pending for the next poll. Payload + key are fixed; failure never
        // changes meeting status or participant admission.
        return;
      }
    });
  }
  async runOnce(now = new Date()) {
    assertEmailConfigured();
    await this.plan(now);
    const pending = await db.select({ id: meetingDeliveries.id }).from(meetingDeliveries).where(and(eq(meetingDeliveries.status, 'pending'), lte(meetingDeliveries.dueAt, now))).orderBy(meetingDeliveries.dueAt).limit(100);
    for (const { id } of pending) { const prepared = await this.prepare(id); if (prepared) await this.deliver(prepared); }
    return { processed: pending.length };
  }
}
