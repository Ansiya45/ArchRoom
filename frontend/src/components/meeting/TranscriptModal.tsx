import { useEffect, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';

// Kept for the existing LiveKit data-message types.
export type TranscriptSegment = { id: string; speaker: string; text: string; timestamp: string };
type Attendee = { id: string; name: string; email: string };
export function TranscriptModal({ meetingCode, occurrenceId, speech, warning, onClose, onOpenRecordings }: {
  meetingCode: string; occurrenceId?: string; speech: string; warning: string; onClose: () => void; onOpenRecordings?: () => void;
}) {
  const [summary, setSummary] = useState('');
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [sent, setSent] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const started = useRef(false), locked = useRef(false);
  const generate = async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      if (!summary) {
        const result = await trpc.meetings.generateSummary.mutate({ meetingCode, occurrenceId, speech }, { signal: AbortSignal.timeout(90000) });
        setSummary(result.summary);
      }
      setAttendees(await trpc.meetings.summaryRecipients.query({ meetingCode, occurrenceId }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to generate the summary.'); }
    finally { locked.current = false; setBusy(false); }
  };
  useEffect(() => {
    if (!started.current) { started.current = true; void generate(); }
  }, []);
  const send = async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await trpc.meetings.shareTranscript.mutate({ meetingCode, occurrenceId, summary: warning ? `Capture warning: ${warning}\n\n${summary}` : summary, recipientIds: selected.filter(id => !sent.includes(id)) });
      setSent(current => [...new Set([...current, ...result.sentIds])]);
      setSelected(result.failedIds);
      setNotice(`${result.sentIds.length} email(s) accepted for delivery.`);
      if (result.failedIds.length) setError(`${result.failedIds.length} email(s) were not accepted. Check the configured sender and retry.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to send the summary.'); }
    finally { locked.current = false; setBusy(false); }
  };
  const download = () => {
    const text = `English meeting summary\n\n${warning ? `Capture warning: ${warning}\n\n` : ''}${summary}`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `meeting-${meetingCode}-summary.txt`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="summary-title">
    <div className="bg-zinc-900 text-white border border-white/10 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-4">
      <h2 id="summary-title" className="text-xl font-semibold">English meeting summary</h2>
      <p className="text-sm text-zinc-400">Your call has closed. Review the summary before sharing. Keep this page open until you download or send it.</p>
      {warning && <p role="alert" className="text-amber-300 text-sm">{warning}</p>}
      {busy && <p role="status">{summary ? 'Processing...' : 'Translating and summarizing the discussion...'}</p>}
      {summary && <div className="whitespace-pre-wrap text-sm leading-relaxed bg-black/20 rounded-xl p-4">{summary}</div>}
      {error && <p role="alert" className="text-red-300 text-sm">{error}</p>}
      {notice && <p role="status" className="text-green-300 text-sm">{notice}</p>}
      {!busy && (!summary || !attendees.length) && <button className="underline" onClick={() => void generate()}>Retry summary / attendee loading</button>}
      {summary && <fieldset className="space-y-2"><legend className="font-medium mb-2">Send to selected attendees</legend>
        {attendees.map(attendee => <label key={attendee.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={busy || sent.includes(attendee.id)} checked={selected.includes(attendee.id)} onChange={event => setSelected(current => event.target.checked ? [...current, attendee.id] : current.filter(id => id !== attendee.id))} />
          {attendee.name} - {attendee.email}{sent.includes(attendee.id) ? ' (sent)' : ''}
        </label>)}
        {!attendees.length && !busy && <p className="text-sm text-zinc-400">No attendee email addresses are available.</p>}
      </fieldset>}
      <div className="flex gap-3 flex-wrap">
        {onOpenRecordings && <button className="px-4 py-2 rounded-lg bg-violet-600" onClick={onOpenRecordings}>Save recording</button>}
        <button className="px-4 py-2 rounded-lg bg-white/10 disabled:opacity-40" disabled={!summary} onClick={download}>Download</button>
        <button className="px-4 py-2 rounded-lg bg-blue-600 disabled:opacity-40" disabled={!summary || busy || !selected.some(id => !sent.includes(id))} onClick={() => void send()}>Send summary</button>
        <button className="px-4 py-2 rounded-lg bg-white/10" disabled={busy} onClick={onClose}>Done</button>
      </div>
    </div>
  </div>;
}
