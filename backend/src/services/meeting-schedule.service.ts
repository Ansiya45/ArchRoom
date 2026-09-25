import { TRPCError } from '@trpc/server';

export type MeetingSchedule = { localDateTime: string; timeZone: string };

// Interpret wall-clock input in its named zone, never in the server's timezone.
// One-time input rejects gaps/overlaps; recurring expansion skips gaps and uses the first overlap.
function resolveWallTime(input: MeetingSchedule, recurring: boolean) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(input.localDateTime);
  const invalid = (message: string): never => { throw new TRPCError({ code: 'BAD_REQUEST', message }); };
  if (!match) return invalid('Enter a valid meeting date and time.');
  const [, year, month, day, hour, minute] = match.map(Number);
  if (year < 1900 || year > 9999) return invalid('Enter a meeting year between 1900 and 9999.');
  const wallTime = Date.UTC(year, month - 1, day, hour, minute);
  if (new Date(wallTime).toISOString().slice(0, 16) !== input.localDateTime) {
    return invalid('Enter a valid meeting date and time.');
  }
  let formatter: Intl.DateTimeFormat;
  try {
    if (!input.timeZone || /^[+-]/.test(input.timeZone)) throw new Error('Named timezone required');
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: input.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
  } catch { return invalid('Choose a valid IANA timezone.'); }
  const asWallTime = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  };
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const instant = wallTime + hours * 3600000;
    offsets.add(asWallTime(instant) - instant);
  }
  const candidates = [...offsets].map((offset) => wallTime - offset).filter((instant) => asWallTime(instant) === wallTime);
  if (!candidates.length && recurring) return null;
  if (!candidates.length) return invalid('This local time does not exist because the clocks change. Choose another time.');
  if (candidates.length > 1 && !recurring) return invalid('This local time occurs twice because the clocks change. Choose an unambiguous time.');
  return { scheduledAt: new Date(Math.min(...candidates)), timeZone: input.timeZone };
}

// One-time scheduling retains its explicit DST ambiguity validation.
export function resolveMeetingSchedule(input: MeetingSchedule) {
  return resolveWallTime(input, false)!;
}

// RFC 5545: skip nonexistent recurrence times; choose the first duplicated time.
export function resolveRecurringTime(input: MeetingSchedule) {
  return resolveWallTime(input, true);
}

export function localDateTime(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
