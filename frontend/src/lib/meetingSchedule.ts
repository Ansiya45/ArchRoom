import type { trpc } from './trpc';

export type MeetingRecord = Awaited<ReturnType<typeof trpc.meetings.create.mutate>>['meeting'];

export function localScheduleFields(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function formatMeetingTime(meeting: Pick<MeetingRecord, 'scheduledAt' | 'timeZone' | 'status' | 'scheduleType'> & Partial<Pick<MeetingRecord, 'recurrenceRule' | 'recurrenceCancelledAt'>>) {
  if (meeting.recurrenceCancelledAt) return 'Recurring series cancelled';
  if (meeting.scheduleType === 'reusable') return meeting.status === 'live' ? 'Reusable room - Live now' : 'Reusable room - Ready';
  if (meeting.scheduleType === 'recurring') {
    const rule = meeting.recurrenceRule;
    const days = rule?.weekdays?.map(day => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]).join(', ');
    const clock = meeting.scheduledAt && meeting.timeZone ? localScheduleFields(new Date(meeting.scheduledAt), meeting.timeZone).time : '';
    return `${rule ? `Every ${rule.interval} ${rule.frequency === 'daily' ? 'day(s)' : rule.frequency === 'weekly' ? 'week(s)' : 'month(s)'}` : 'Recurring'}${days ? ` on ${days}` : ''} ${clock} (${meeting.timeZone})`;
  }
  if (!meeting.scheduledAt) return meeting.status === 'live' ? 'Live now' : 'Not scheduled';
  return new Date(meeting.scheduledAt).toLocaleString(undefined, {
    ...(meeting.timeZone ? { timeZone: meeting.timeZone } : {}),
    timeZoneName: 'short',
  }) + (meeting.timeZone ? ` (${meeting.timeZone})` : '');
}

// Lock synchronously: two clicks in the same render must not issue two starts.
export async function startMeetingOnce(
  pending: Set<string>, code: string, start: () => Promise<unknown>, onStarted: () => void,
) {
  if (pending.has(code)) return;
  pending.add(code);
  try { await start(); onStarted(); }
  finally { pending.delete(code); }
}
