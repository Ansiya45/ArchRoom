import { useState } from 'react';
import type { MeetingRecord } from '../lib/meetingSchedule';
export type Rule = NonNullable<MeetingRecord['recurrenceRule']>;
const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const field = 'w-full px-3 py-2 rounded-xl border border-slate-200 text-sm';
export function RecurrenceControls({ value, onChange, date }: { value: Rule | null; onChange: (rule: Rule | null) => void; date: string }) {
  const [preset, setPreset] = useState(value ? 'custom' : 'none');
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return <fieldset className="space-y-3"><legend className="text-sm font-semibold mb-2">Repeat</legend>
    <select aria-label="Repeat" className={field} value={preset} onChange={e => {
      const next = e.target.value; setPreset(next);
      onChange(next === 'none' ? null : { frequency: next === 'daily' || next === 'monthly' ? next : 'weekly', interval: 1,
        ...(['weekly', 'weekdays', 'custom'].includes(next) ? { weekdays: next === 'weekdays' ? [1,2,3,4,5] : [Number.isFinite(weekday) ? weekday : 1] } : {}), ends: { type: 'never' } });
    }}>
      <option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="weekdays">Weekdays (Monday-Friday)</option><option value="custom">Custom</option>
    </select>
    {value && <>
      {preset === 'custom' && <div className="flex gap-2 items-center"><span className="text-sm">Every</span>
        <input aria-label="Repeat interval" type="number" min="1" max="365" required className={field} value={value.interval} onChange={e => onChange({ ...value, interval: Number(e.target.value) })} />
        <select aria-label="Repeat unit" className={field} value={value.frequency} onChange={e => { const frequency = e.target.value as Rule['frequency']; onChange({ frequency, interval: value.interval, ends: value.ends, ...(frequency === 'weekly' ? { weekdays: [weekday] } : {}) }); }}>
          <option value="daily">days</option><option value="weekly">weeks</option><option value="monthly">months</option>
        </select></div>}
      {value.frequency === 'weekly' && <div className="flex flex-wrap gap-3">{names.map((name, day) => <label key={name} className="text-xs flex items-center gap-1"><input type="checkbox" checked={value.weekdays?.includes(day)} onChange={e => onChange({ ...value, weekdays: e.target.checked ? [...value.weekdays!, day] : value.weekdays!.filter(d => d !== day) })} />{name}</label>)}</div>}
      <label className="block text-sm">Ends<select aria-label="Recurrence ends" className={field} value={value.ends.type} onChange={e => onChange({ ...value, ends: e.target.value === 'count' ? { type: 'count', count: 10 } : e.target.value === 'until' ? { type: 'until', date } : { type: 'never' } })}><option value="never">Never</option><option value="until">On date</option><option value="count">After occurrences</option></select></label>
      {value.ends.type === 'until' && <input aria-label="Ending date" required type="date" min={date} className={field} value={value.ends.date} onChange={e => onChange({ ...value, ends: { type: 'until', date: e.target.value } })} />}
      {value.ends.type === 'count' && <input aria-label="Number of occurrences" required type="number" min="1" max="1000" className={field} value={value.ends.count} onChange={e => onChange({ ...value, ends: { type: 'count', count: Number(e.target.value) } })} />}
      <p className="text-xs text-slate-500">The date above is the first occurrence and must match the selected days. All occurrences share this link and timezone. Missing monthly dates and times skipped by daylight saving are skipped; a repeated clock time occurs once, at its first instance. The host starts each occurrence.</p>
    </>}
  </fieldset>;
}
