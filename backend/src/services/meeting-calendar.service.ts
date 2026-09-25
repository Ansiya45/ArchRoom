import { TRPCError } from '@trpc/server';
import type { meetings } from '../db/schema.js';
import { localDateTime, resolveRecurringTime } from './meeting-schedule.service.js';
import { expandRecurrence } from './recurrence.service.js';
type Meeting = typeof meetings.$inferSelect;
const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace('.000', '');
const text = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
export function meetingLink(meeting: Pick<Meeting, 'meetingCode'>, publicUrl: string) {
  const origin = new URL(publicUrl);
  if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password) throw new Error('Invalid public application URL');
  return new URL(`/meet/${encodeURIComponent(meeting.meetingCode)}`, origin.origin).href;
}
export function calendarRule(meeting: Meeting) {
  const rule = meeting.recurrenceRule;
  if (meeting.scheduleType !== 'recurring' || !rule || !meeting.timeZone || !meeting.scheduledAt) return undefined;
  const parts = [`FREQ=${rule.frequency.toUpperCase()}`, `INTERVAL=${rule.interval}`];
  if (rule.frequency === 'weekly') parts.push('WKST=MO', `BYDAY=${rule.weekdays!.map(day => ['SU','MO','TU','WE','TH','FR','SA'][day]).join(',')}`);
  if (rule.ends.type === 'count') parts.push(`COUNT=${rule.ends.count}`);
  if (rule.ends.type === 'until') {
    // Last valid instant in the inclusive local date. Midnight can itself be a DST gap.
    let end: Date | undefined;
    for (let minute = 1439; minute >= 0; minute--) {
      const resolved = resolveRecurringTime({ localDateTime: `${rule.ends.date}T${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`, timeZone: meeting.timeZone });
      if (resolved) { end = resolved.scheduledAt; break; }
    }
    if (!end) { // Whole skipped civil day: use the preceding valid day as the inclusive bound.
      const prior = new Date(new Date(`${rule.ends.date}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0,10);
      end = resolveRecurringTime({ localDateTime: `${prior}T23:59`, timeZone: meeting.timeZone })?.scheduledAt;
    }
    if (!end) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unable to export this ending date.' });
    parts.push(`UNTIL=${stamp(end)}`);
  }
  return `RRULE:${parts.join(';')}`;
}
export function nextCalendarStart(meeting: Meeting, now: Date) {
  if (meeting.recurrenceCancelledAt || !meeting.scheduledAt || meeting.scheduleType === 'reusable') return null;
  if (meeting.scheduleType !== 'recurring') return meeting.scheduledAt;
  if (!meeting.timeZone || !meeting.recurrenceRule) return null;
  return expandRecurrence(meeting.scheduledAt, meeting.timeZone, meeting.recurrenceRule, localDateTime(now, meeting.timeZone).slice(0,10), 2).find(date => date >= now) || null;
}
// Fold by UTF-8 bytes, without splitting multibyte characters (RFC 5545).
export function foldCalendarLine(line: string) {
  const lines: string[] = []; let part = '';
  for (const character of line) {
    if (Buffer.byteLength(part + character) > 75) { lines.push(part); part = ' '; }
    part += character;
  }
  lines.push(part); return lines.join('\r\n');
}
export function calendarExport(meeting: Meeting, publicUrl: string, now = new Date(), occurrence?: { id: string; scheduledAt: Date; timeZone: string | null }) {
  if (meeting.recurrenceCancelledAt) throw new TRPCError({ code: 'CONFLICT', message: 'This series is cancelled.' });
  if (!meeting.scheduledAt || meeting.scheduleType === 'reusable') throw new TRPCError({ code: 'BAD_REQUEST', message: 'This meeting has no scheduled calendar event.' });
  const link = meetingLink(meeting, publicUrl);
  const start = occurrence?.scheduledAt || nextCalendarStart(meeting, now);
  const rule = occurrence ? undefined : calendarRule(meeting);
  const zone = occurrence?.timeZone || meeting.timeZone;
  const anchor = occurrence?.scheduledAt || meeting.scheduledAt;
  // Google template is a draft for the user to review; no API conferenceData/Meet creation.
  const local = zone ? localDateTime(anchor, zone).replace(/[-:]/g, '') + '00' : stamp(anchor);
  const google = new URL('https://calendar.google.com/calendar/render');
  google.search = new URLSearchParams({ action: 'TEMPLATE', text: meeting.title, details: `Join YLAAM Meet: ${link}\nHost admission is required.`, location: link, dates: `${local}/${local}`, ...(zone ? { ctz: zone } : {}), ...(rule ? { recur: rule } : {}) }).toString();
  // Portable UTC export is explicitly one occurrence. This avoids floating-time
  // recurrences or incomplete VTIMEZONE definitions in third-party calendar clients.
  const lines = start ? ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//YLAAM Meet//Scheduling//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',
    `UID:${occurrence?.id || `${meeting.id}${rule ? `-${start.getTime()}` : ''}`}@ylaam-meet`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(start)}`, `SUMMARY:${text(meeting.title)}`,
    `DESCRIPTION:${text(`Join YLAAM Meet: ${link}\nHost admission is required.${rule ? '\nThis export contains one occurrence of a recurring meeting.' : ''}`)}`, `URL:${link}`, `LOCATION:${text(link)}`, 'END:VEVENT','END:VCALENDAR'] : [];
  return { googleUrl: google.href, ics: lines.length ? lines.map(foldCalendarLine).join('\r\n') + '\r\n' : null, occurrenceStart: start, recurring: !!rule, timeZone: zone, exceptions: !!meeting.recurrenceEditedAt };
}
