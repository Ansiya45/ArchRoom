import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expandRecurrence, validateRecurrence, type RecurrenceRule } from '../src/services/recurrence.service.js';
import { resolveMeetingSchedule, localDateTime } from '../src/services/meeting-schedule.service.js';
function dates(start: string, rule: RecurrenceRule, zone = 'Asia/Kolkata', from = start.slice(0,10), limit = 6) {
  const schedule = { localDateTime: start, timeZone: zone };
  return expandRecurrence(resolveMeetingSchedule(schedule).scheduledAt, zone, validateRecurrence(schedule, rule), from, limit).map(d => localDateTime(d, zone));
}
const never = { type: 'never' } as const;
test('weekly Thursday keeps 23:30 and same timezone', () => {
  assert.deepEqual(dates('2026-09-17T23:30', { frequency: 'weekly', interval: 1, weekdays: [4], ends: never }).slice(0,4), ['2026-09-17T23:30','2026-09-24T23:30','2026-10-01T23:30','2026-10-08T23:30']);
});
test('weekdays, selected weekdays and alternate weeks', () => {
  assert.deepEqual(dates('2026-09-18T09:00', { frequency: 'weekly', interval: 1, weekdays: [1,2,3,4,5], ends: never }).slice(0,2), ['2026-09-18T09:00','2026-09-21T09:00']);
  assert.deepEqual(dates('2026-09-21T14:00', { frequency: 'weekly', interval: 1, weekdays: [3,1], ends: never }).slice(0,3), ['2026-09-21T14:00','2026-09-23T14:00','2026-09-28T14:00']);
  assert.equal(dates('2026-09-18T14:00', { frequency: 'weekly', interval: 2, weekdays: [5], ends: never })[1], '2026-10-02T14:00');
});
test('monthly skips invalid dates; count excludes skipped dates', () => {
  assert.deepEqual(dates('2026-01-31T09:00', { frequency: 'monthly', interval: 1, ends: { type: 'count', count: 3 } }), ['2026-01-31T09:00','2026-03-31T09:00','2026-05-31T09:00']);
});
test('daily interval, inclusive until, finite exhaustion and fast-forward', () => {
  const rule: RecurrenceRule = { frequency: 'daily', interval: 2, ends: { type: 'until', date: '2026-09-24' } };
  assert.deepEqual(dates('2026-09-20T09:00',rule), ['2026-09-20T09:00','2026-09-22T09:00','2026-09-24T09:00']);
  assert.deepEqual(dates('2026-09-20T09:00',rule,undefined,'2027-01-01'), []);
  assert.equal(dates('2026-09-20T09:00',{ frequency: 'daily', interval: 1, ends: never },undefined,'2090-01-01')[0], '2090-01-01T09:00');
});
test('DST preserves wall-clock time, skips gaps and chooses first overlap', () => {
  assert.deepEqual(dates('2026-03-07T02:30', { frequency: 'daily', interval: 1, ends: { type: 'count', count: 3 } },'America/New_York'), ['2026-03-07T02:30','2026-03-09T02:30','2026-03-10T02:30']);
  const schedule = { localDateTime: '2026-10-31T01:30', timeZone: 'America/New_York' };
  const expanded = expandRecurrence(resolveMeetingSchedule(schedule).scheduledAt, schedule.timeZone, { frequency: 'daily', interval: 1, ends: never }, '2026-11-01', 2);
  assert.equal(expanded[0].toISOString(), '2026-11-01T05:30:00.000Z');
  assert.equal(expanded[1].toISOString(), '2026-11-02T06:30:00.000Z');
});
test('invalid weekday anchor, empty days, interval and ending date rejected', () => {
  const schedule = { localDateTime: '2026-09-17T09:00', timeZone: 'Asia/Kolkata' };
  for (const rule of [ { frequency: 'weekly', interval: 1, weekdays: [1], ends: never }, { frequency: 'weekly', interval: 1, weekdays: [], ends: never }, { frequency: 'daily', interval: 0, ends: never }, { frequency: 'daily', interval: 1, ends: { type: 'until', date: '2026-09-16' } } ]) assert.throws(() => validateRecurrence(schedule, rule as RecurrenceRule));
});
