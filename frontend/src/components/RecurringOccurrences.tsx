import { useRef, useState } from 'react';
import { trpc } from '../lib/trpc';
import { localScheduleFields, type MeetingRecord } from '../lib/meetingSchedule';
import { RecurrenceControls, type Rule } from './RecurrenceControls';
type Page = Awaited<ReturnType<typeof trpc.meetings.occurrences.mutate>>;
type Occurrence = Page['occurrences'][number];
type Action = 'edit_occurrence' | 'edit_future' | 'cancel_occurrence' | 'cancel_series';
export function RecurringOccurrences({ meeting, busy, onStart, onChanged }: { meeting: MeetingRecord; busy: boolean; onStart: (id: string) => void; onChanged: (meeting: MeetingRecord) => void }) {
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [editing, setEditing] = useState<{ action: Action; occurrence?: Occurrence; expectedUpdatedAt: string } | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [zone, setZone] = useState(meeting.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [rule, setRule] = useState<Rule | null>(meeting.recurrenceRule);
  const pending = useRef(false);
  const current = page?.meeting || meeting;
  const load = async (after?: Page['nextCursor']) => {
    if (pending.current) return; pending.current = true; setLoading(true); setError(''); setEditing(null);
    try {
      const result = await trpc.meetings.occurrences.mutate({ meetingCode: meeting.meetingCode, fromDate: fromDate || undefined, after: after || undefined });
      setPage(result); onChanged(result.meeting);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load occurrences.'); }
    finally { pending.current = false; setLoading(false); }
  };
  const begin = (action: Action, occurrence?: Occurrence) => {
    setNotice(''); setError('');
    const selectedZone = action === 'edit_future' ? current.timeZone! : occurrence?.timeZone || current.timeZone!;
    const fields = localScheduleFields(new Date(occurrence?.scheduledAt || current.scheduledAt!), selectedZone);
    setDate(fields.date); setTime(fields.time); setZone(selectedZone); setRule(current.recurrenceRule);
    setEditing({ action, occurrence, expectedUpdatedAt: current.updatedAt });
  };
  const save = async () => {
    if (!editing || pending.current) return;
    const isEdit = editing.action.startsWith('edit');
    if (editing.action === 'edit_future' && !rule) { setError('Choose a recurrence rule for the future series.'); return; }
    pending.current = true; setLoading(true); setError('');
    try {
      const result = await trpc.meetings.changeRecurrence.mutate({ meetingCode: meeting.meetingCode, expectedUpdatedAt: editing.expectedUpdatedAt, action: editing.action, occurrenceId: editing.occurrence?.id,
        ...(isEdit ? { schedule: { localDateTime: `${date}T${time}`, timeZone: zone } } : {}), ...(editing.action === 'edit_future' && rule ? { recurrence: rule } : {}) });
      onChanged(result.meeting); setEditing(null);
      setPage(await trpc.meetings.occurrences.mutate({ meetingCode: meeting.meetingCode, fromDate: fromDate || undefined }));
      setNotice('Saved. The meeting link is unchanged. Existing calendar copies and already-sent emails are not updated automatically.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to change recurrence.'); }
    finally { pending.current = false; setLoading(false); }
  };
  const disabled = busy || loading;
  const zones = Array.from(new Set([zone, ...(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [])]));
  return <div className="space-y-3 text-xs">
    <div className="flex flex-wrap gap-2 items-center"><button type="button" disabled={disabled} className="text-blue-600 font-semibold" onClick={() => void load()}>Occurrences & series settings</button>
      <input aria-label="Show occurrences from date" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="rounded-lg border border-slate-200 p-1" disabled={disabled} /></div>
    {loading && <p>Saving/loading...</p>}{error && <p role="alert" className="text-red-600">{error}</p>}{notice && <p role="status" className="text-slate-600">{notice}</p>}
    {current.recurrenceCancelledAt && <p className="font-semibold text-red-600">Recurring series cancelled. History and meeting link are preserved.</p>}
    {page && !page.occurrences.length && <p>No occurrences in this range.</p>}
    {!loading && page?.occurrences.map(item => {
      const canChange = !current.recurrenceCancelledAt && !item.cancelledAt && item.status === 'scheduled' && new Date(item.scheduledAt!) > new Date();
      return <div key={item.id} className="space-y-2 border-b border-slate-100 pb-2">
        <div className="flex items-center justify-between gap-2"><span>{new Date(item.scheduledAt!).toLocaleString(undefined, { timeZone: item.timeZone || current.timeZone!, dateStyle: 'medium', timeStyle: 'short' })} ({item.timeZone || current.timeZone})</span>
          <button type="button" className="text-blue-600 disabled:text-slate-400" disabled={disabled || !!current.recurrenceCancelledAt || !!item.cancelledAt || item.status === 'ended'} onClick={() => onStart(item.id)}>{item.cancelledAt ? 'Cancelled' : item.status === 'ended' ? 'Ended' : item.status === 'live' ? 'Join' : 'Start'}</button></div>
        {item.scheduledAt !== item.originalScheduledAt && <p className="text-slate-500">Moved from {new Date(item.originalScheduledAt!).toLocaleString()}</p>}
        {canChange && <div className="flex flex-wrap gap-3">
          <button type="button" disabled={disabled} className="text-blue-600" onClick={() => begin('edit_occurrence',item)}>Edit this occurrence</button>
          {item.recurrenceRevision === current.recurrenceRevision && <button type="button" disabled={disabled || !!current.activeOccurrenceId} className="text-blue-600 disabled:opacity-50" onClick={() => begin('edit_future',item)}>Edit this and future</button>}
          <button type="button" disabled={disabled} className="text-red-600" onClick={() => begin('cancel_occurrence',item)}>Cancel this occurrence</button>
        </div>}
      </div>;
    })}
    {page?.nextCursor && <button type="button" disabled={disabled} className="text-blue-600" onClick={() => void load(page.nextCursor)}>Later occurrences</button>}
    {page && !current.recurrenceCancelledAt && <button type="button" disabled={disabled || !!current.activeOccurrenceId} className="block text-red-600 disabled:opacity-50" onClick={() => begin('cancel_series')}>Cancel recurring series</button>}
    {current.activeOccurrenceId && <p className="text-slate-500">End the live occurrence before changing or cancelling the series.</p>}
    {editing && <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
      <p className="font-semibold">{editing.action === 'cancel_series' ? 'Cancel the entire recurring series?' : editing.action === 'cancel_occurrence' ? 'Cancel only this occurrence?' : editing.action === 'edit_future' ? 'Edit this and future occurrences' : 'Edit this occurrence'}</p>
      {editing.action === 'edit_future' && <p>This replaces the selected original occurrence and later dates in the latest revision, including later edits/cancellations. Earlier occurrences and history stay intact. A count limit starts again at the new first occurrence.</p>}
      {editing.action.startsWith('edit') && <>
        <label className="block">Date<input type="date" required value={date} onChange={e => setDate(e.target.value)} className="block w-full rounded-lg border p-2" /></label>
        <label className="block">Time<input type="time" required value={time} onChange={e => setTime(e.target.value)} className="block w-full rounded-lg border p-2" /></label>
        <label className="block">Timezone<select value={zone} onChange={e => setZone(e.target.value)} className="block w-full rounded-lg border p-2">{zones.map(value => <option key={value}>{value}</option>)}</select></label>
        {editing.action === 'edit_future' && <RecurrenceControls value={rule} onChange={setRule} date={date} />}
      </>}
      {editing.action.startsWith('cancel') && <p>{editing.action === 'cancel_series' ? 'No further occurrence can start. Completed history is retained. This cannot be undone.' : 'The selected occurrence cannot start. Other occurrences keep the same meeting link. This cannot be undone.'}</p>}
      <p>Notify invitees of this change. Calendar copies and already-sent emails will not update automatically.</p>
      <div className="flex gap-3"><button type="button" disabled={disabled} className="rounded-lg bg-blue-600 text-white px-3 py-2 disabled:opacity-50" onClick={() => void save()}>Confirm {editing.action.startsWith('cancel') ? 'cancellation' : 'changes'}</button><button type="button" disabled={disabled} onClick={() => setEditing(null)}>Keep current schedule</button></div>
    </div>}
  </div>;
}
