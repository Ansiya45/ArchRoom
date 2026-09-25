import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { localDateTime, resolveMeetingSchedule, resolveRecurringTime, type MeetingSchedule } from './meeting-schedule.service.js';

export const recurrenceInput = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  interval: z.number().int().min(1).max(365),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  ends: z.discriminatedUnion('type', [
    z.object({ type: z.literal('never') }).strict(),
    z.object({ type: z.literal('until'), date: z.string().date() }).strict(),
    z.object({ type: z.literal('count'), count: z.number().int().min(1).max(1000) }).strict(),
  ]),
}).strict().superRefine((rule, ctx) => {
  if ((rule.frequency === 'weekly') !== !!rule.weekdays) ctx.addIssue({ code: 'custom', message: 'Choose weekdays for weekly rules only.' });
  if (rule.weekdays && new Set(rule.weekdays).size !== rule.weekdays.length) ctx.addIssue({ code: 'custom', message: 'Weekdays must be unique.' });
});
export type RecurrenceRule = z.infer<typeof recurrenceInput>;
const DAY = 86400000;
const invalid = (message: string): never => { throw new TRPCError({ code: 'BAD_REQUEST', message }); };

export function validateRecurrence(schedule: MeetingSchedule, input: RecurrenceRule) {
  const parsed = recurrenceInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0].message);
  resolveMeetingSchedule(schedule);
  const rule = parsed.data;
  const date = schedule.localDateTime.slice(0, 10);
  if (rule.frequency === 'weekly' && !rule.weekdays!.includes(new Date(`${date}T00:00:00Z`).getUTCDay())) {
    return invalid('The first occurrence date must be one of the selected weekdays.');
  }
  if (rule.ends.type === 'until' && (rule.ends.date < date || rule.ends.date > '9999-12-31')) {
    return invalid('The ending date must be on or after the first occurrence.');
  }
  return { ...rule, ...(rule.weekdays ? { weekdays: [...rule.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) } : {}) };
}

// One canonical rule; DTSTART is the existing parent scheduled_at + time_zone.
// Expansion is paged, never an infinite database materialization.
export function expandRecurrence(anchor: Date, timeZone: string, rule: RecurrenceRule, fromDate: string, limit = 6) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 64 || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) return invalid('Invalid recurrence window.');
  const local = localDateTime(anchor, timeZone);
  const anchorDate = new Date(`${local.slice(0, 10)}T00:00:00Z`);
  const from = new Date(`${fromDate}T00:00:00Z`);
  if (!Number.isFinite(from.getTime()) || from.toISOString().slice(0, 10) !== fromDate) return invalid('Invalid recurrence window.');
  const time = local.slice(11);
  const anchorDay = anchorDate.getTime();
  const monday = anchorDay - ((anchorDate.getUTCDay() + 6) % 7) * DAY;
  const monthIndex = anchorDate.getUTCFullYear() * 12 + anchorDate.getUTCMonth();
  let period = 0;
  // Count-limited series count from DTSTART. Others jump straight to the requested window.
  if (rule.ends.type !== 'count') {
    if (rule.frequency === 'daily') period = Math.max(0, Math.floor((from.getTime() - anchorDay) / (DAY * rule.interval)));
    else if (rule.frequency === 'weekly') period = Math.max(0, Math.floor((from.getTime() - monday) / (7 * DAY * rule.interval)));
    else period = Math.max(0, Math.floor((from.getUTCFullYear() * 12 + from.getUTCMonth() - monthIndex) / rule.interval));
  }
  let count = 0;
  const dates: Date[] = [];
  // At most 1000 counted occurrences; sparse leap-day rules may skip periods.
  for (let attempts = 0; attempts < 16000; attempts++, period++) {
    let candidates: Date[];
    if (rule.frequency === 'daily') candidates = [new Date(anchorDay + period * rule.interval * DAY)];
    else if (rule.frequency === 'weekly') candidates = [...rule.weekdays!].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(day => new Date(monday + (period * rule.interval * 7 + (day + 6) % 7) * DAY));
    else {
      const month = monthIndex + period * rule.interval;
      const date = new Date(Date.UTC(Math.floor(month / 12), month % 12, anchorDate.getUTCDate()));
      candidates = date.getUTCMonth() === month % 12 ? [date] : [];
      if (Math.floor(month / 12) > 9999) return dates;
    }
    for (const date of candidates) {
      if (date.getUTCFullYear() > 9999) return dates;
      if (date.getTime() < anchorDay) continue;
      const day = date.toISOString().slice(0, 10);
      if (rule.ends.type === 'until' && day > rule.ends.date) return dates;
      if (rule.ends.type === 'count' && count >= rule.ends.count) return dates;
      // Before the window, no conversion is necessary unless COUNT needs DST-gap accounting.
      if (rule.ends.type !== 'count' && day < fromDate) continue;
      const occurrence = resolveRecurringTime({ localDateTime: `${day}T${time}`, timeZone });
      if (!occurrence) continue;
      count++;
      if (day >= fromDate) dates.push(occurrence.scheduledAt);
      if (dates.length === limit) return dates;
    }
  }
  return invalid('This recurrence window is too large to expand. Choose a closer starting date.');
}

