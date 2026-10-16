import { useEffect, useState } from 'react';
import { trpc } from '../lib/trpc';
import { formatMeetingTime } from '../lib/meetingSchedule';

type Detail = Awaited<ReturnType<typeof trpc.meetings.historyDetail.query>>;
type Row = Awaited<ReturnType<typeof trpc.meetings.history.query>>[number];
const date = (value: string | null) => value ? new Date(value).toLocaleString() : 'Not recorded';

export default function MeetingHistoryView() {
  const [rows, setRows] = useState<Row[]>([]), [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null), [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [notice, setNotice] = useState('');
  const [recordingLinks, setRecordingLinks] = useState<Record<string, string>>({});
  const [emailScope, setEmailScope] = useState<string | null>(null), [recipients, setRecipients] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]), [emailBusy, setEmailBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(''); setDetail(null); setNotice(''); setRecordingLinks({}); setEmailScope(null); setRecipients([]); setSelectedRecipients([]);
    const load = async () => {
      try {
        if (selected) {
          const result = await trpc.meetings.historyDetail.query({ meetingId: selected });
          if (!cancelled) setDetail(result);
        } else {
          const result = await trpc.meetings.history.query({ offset });
          if (!cancelled) setRows(result);
        }
      } catch { if (!cancelled) setError('Meeting history could not be loaded. Please retry.'); }
      finally { if (!cancelled) setLoading(false); }
    };
    void load(); return () => { cancelled = true; };
  }, [selected, offset, retry]);
  const materials = (occurrenceId: string | null) => {
    if (!detail) return null;
    const items = detail.items.filter(item => item.occurrenceId === occurrenceId);
    const recordings = detail.recordings.filter(item => item.occurrenceId === occurrenceId);
    return <div className="space-y-3">
      {!items.length && !recordings.length && <p className="text-sm text-slate-500">No saved transcript, summary, or recording reference for this session. Older unsaved content is not recoverable here.</p>}
      {(['transcript', 'summary'] as const).map(kind => {
        const texts = items.filter(item => item.kind === kind);
        const displayTexts = (kind === 'transcript' && texts.some(item => item.label === 'reviewed-complete') ? texts.filter(item => item.label === 'reviewed-complete') : texts)
          .sort((a, b) => (a.label || '').localeCompare(b.label || '') || a.createdAt.localeCompare(b.createdAt));
        return displayTexts.length > 0 && <details key={kind} className="rounded-xl border p-3"><summary className="cursor-pointer font-semibold">{kind === 'transcript' ? 'Transcript' : 'Generated summaries'}</summary>
          <p className="my-2 text-xs text-slate-500">Automatically generated; may be incomplete or inaccurate. Review before use.</p>
          <div className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-sm">{displayTexts.map(item => item.content).join('\n\n')}</div>
        </details>;
      })}
      {items.filter(item => item.kind === 'drive').map(item => <a className="block break-all text-blue-600 underline" key={item.id} href={item.content} target="_blank" rel="noopener noreferrer">Google Drive: {item.label || 'Recording'}</a>)}
      {items.some(item => item.kind === 'drive') && <p className="text-xs text-slate-500">Drive permissions still apply. A saved link does not guarantee that the file is available.</p>}
      {items.some(item => item.kind === 'transcript') && <div className="space-y-3 rounded-xl border border-slate-200 p-3">
        <button className="font-semibold text-blue-600 underline" onClick={async () => {
          try {
            const scope = occurrenceId || 'meeting';
            if (emailScope === scope) { setEmailScope(null); return; }
            const result = await trpc.meetings.summaryRecipients.query({ meetingCode: detail.meeting.meetingCode, ...(occurrenceId ? { occurrenceId } : {}) });
            setRecipients(result); setSelectedRecipients([]); setEmailScope(scope); setNotice('');
          } catch { setNotice('Attendee email addresses could not be loaded. Only registered attendees with an account can be selected.'); }
        }}>Email transcript to participants</button>
        {emailScope === (occurrenceId || 'meeting') && <div className="space-y-3">
          {!recipients.length && <p className="text-sm text-slate-500">No registered participants with email addresses are available for this session.</p>}
          {recipients.map(person => <label key={person.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedRecipients.includes(person.id)} onChange={event => setSelectedRecipients(current => event.target.checked ? [...current, person.id] : current.filter(id => id !== person.id))} />{person.name} ({person.email})</label>)}
          <button disabled={emailBusy || !selectedRecipients.length} className="rounded-lg bg-blue-600 px-3 py-2 text-white disabled:opacity-50" onClick={async () => {
            setEmailBusy(true); setNotice('');
            try {
              const transcripts = items.filter(item => item.kind === 'transcript' && (item.label === 'reviewed-complete' || !items.some(candidate => candidate.kind === 'transcript' && candidate.label === 'reviewed-complete'))).sort((a, b) => (a.label || '').localeCompare(b.label || '')).map(item => item.content);
              const summary = items.filter(item => item.kind === 'summary').at(-1)?.content;
              const result = await trpc.meetings.shareTranscript.mutate({ meetingCode: detail.meeting.meetingCode, ...(occurrenceId ? { occurrenceId } : {}), summary, transcript: transcripts.join('\n\n'), recipientIds: selectedRecipients });
              setNotice(`${result.sentIds.length} participant email(s) accepted. ${result.failedIds.length ? `${result.failedIds.length} failed; you can retry from history.` : ''}`);
            } catch { setNotice('Could not send the email. Check the history entry and your connection, then retry.'); }
            finally { setEmailBusy(false); }
          }}>{emailBusy ? 'Sending…' : 'Send transcript'}</button>
        </div>}
      </div>}
      {recordings.map(recording => <div key={recording.id} className="break-words text-sm">
        <p>Supabase recording: {recording.fileName} · {recording.status}{recording.durationSeconds != null ? ` · ${recording.durationSeconds} seconds` : ''}</p>
        {recording.status === 'completed' && <button className="text-blue-600 underline" onClick={() => {
          void trpc.recordings.downloadUrl.mutate({ recordingId: recording.id }).then(result => setRecordingLinks(current => ({ ...current, [recording.id]: result.url })), () => setNotice('The recording link could not be generated. Please retry.'));
        }}>Get temporary recording link</button>}
        {recordingLinks[recording.id] && <a className="ml-3 text-blue-600 underline" href={recordingLinks[recording.id]} target="_blank" rel="noopener noreferrer">Open saved recording</a>}
      </div>)}
    </div>;
  };
  return <section className="mx-auto w-full max-w-5xl space-y-5 px-4 py-8 text-slate-900">
    <h1 className="text-2xl font-bold">Meeting History</h1>
    <p className="text-sm text-slate-500">Meetings you created, with saved session details. Times below use your device’s timezone unless specified.</p>
    {selected && <button className="font-semibold text-blue-600 underline" onClick={() => setSelected(null)}>Back to meeting history</button>}
    {loading && <p role="status">Loading meeting history…</p>}
    {error && <div role="alert">{error} <button className="underline" onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
    {!loading && !error && !selected && <>
      {!rows.length && <p>No meetings on this page.</p>}
      <ul className="space-y-3">{rows.map(row => <li key={row.id}><button onClick={() => setSelected(row.id)} className="w-full rounded-2xl border border-slate-200 bg-white p-5 text-left hover:border-blue-400 focus-visible:outline-blue-600">
        <span className="block break-words font-bold">{row.title}</span>
        <span className="mt-1 block text-sm text-slate-500">{row.meetingCode} · {row.status} · Created {date(row.createdAt)}</span>
        <span className="block text-sm">{formatMeetingTime(row)}</span>
        <span className="mt-2 block text-sm text-blue-600">View details</span>
      </button></li>)}</ul>
      <div className="flex gap-4"><button className="underline disabled:opacity-40" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 30))}>Previous</button><button className="underline disabled:opacity-40" disabled={rows.length < 30} onClick={() => setOffset(value => value + 30)}>Next</button></div>
    </>}
    {!loading && !error && detail && <article className="min-w-0 space-y-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
      <h2 className="break-words text-xl font-bold">{detail.meeting.title}</h2>
      <p>Status: {detail.meeting.status} · Created: {date(detail.meeting.createdAt)}</p>
      <p>Schedule: {formatMeetingTime(detail.meeting)}</p>
      <p className="break-all text-sm">Meeting link: {`${window.location.origin}/meet/${detail.meeting.meetingCode}`}</p>
      <button className="text-blue-600 underline" onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/meet/${detail.meeting.meetingCode}`).then(() => setNotice('Meeting link copied.'), () => setNotice('Could not copy the link. Select and copy the link above.'))}>Copy meeting link</button>
      {notice && <p role="status">{notice}</p>}
      {materials(null)}
      <h3 className="font-semibold">Meeting sessions</h3>
      {!detail.sessions.length && <p className="text-sm text-slate-500">No separate session times are stored for this meeting.</p>}
      {detail.sessions.map(session => <details key={session.id} className="rounded-xl border p-4">
        <summary className="cursor-pointer font-semibold">{session.status} · {session.status === 'live' || session.status === 'ended' ? `Started ${date(session.startedAt)}` : `Scheduled ${date(session.scheduledAt)}`}</summary>
        <div className="mt-4 space-y-3 text-sm"><p>Scheduled: {date(session.scheduledAt)}{session.timeZone ? ` (${session.timeZone} schedule)` : ''}</p>
          {(session.status === 'live' || session.status === 'ended') && <p>Started: {date(session.startedAt)} · Ended: {date(session.endedAt)}</p>}
          {session.cancelledAt && <p>Cancelled: {date(session.cancelledAt)}</p>}
          {materials(session.id)}
        </div>
      </details>)}
    </article>}
  </section>;
}
