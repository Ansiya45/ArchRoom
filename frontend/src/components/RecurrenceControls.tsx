import type { MeetingRecord } from '../lib/meetingSchedule';
export type Rule = NonNullable<MeetingRecord['recurrenceRule']>;
const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const field = 'w-full px-3 py-2 rounded-xl border border-slate-200 text-sm';
export function RecurrenceControls({ value, onChange, date }: { value: Rule | null; onChange: (rule: Rule | null) => void; date: string }) {
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  const weekly = (weekdays: number[]): Rule => ({ frequency: 'weekly', interval: 1, weekdays, ends: { type: 'never' } });
  return <fieldset className="space-y-3"><legend className="text-sm font-semibold mb-2">Repeat</legend>
    <select aria-label="Repeat" className={`schedule-dark-options ${field}`} value={value ? 'repeat' : 'none'} onChange={e => {
      onChange(e.target.value === 'none' ? null : weekly([Number.isFinite(weekday) ? weekday : 1]));
    }}>
      <option value="none">Does not repeat</option><option value="repeat">Repeat</option>
    </select>
    {value && <>
      {value.frequency !== 'weekly' || value.interval !== 1 || value.ends.type !== 'never' ? <p className="text-xs text-slate-500">This meeting has an older repeat rule. Selecting days replaces it with a weekly schedule without an end date.</p> : null}
      <div className="flex flex-wrap gap-3">{names.map((name, day) => <label key={name} className="text-xs flex items-center gap-1">
        <input type="checkbox" checked={value.weekdays?.includes(day) ?? false} onChange={e => onChange(weekly(e.target.checked ? [...(value.weekdays || []), day] : (value.weekdays || []).filter(d => d !== day)))} />{name}
      </label>)}</div>
      {value.frequency === 'weekly' && !value.weekdays?.length && <p role="alert" className="text-sm text-red-600">Select at least one day.</p>}
      <p className="text-xs text-slate-500">Repeats every week on the selected days with the same link and host, without an end date. Choose a first date that matches a selected day. The host opens each session. Change the time and repeat days from Scheduled Meetings.</p>
    </>}
  </fieldset>;
}
