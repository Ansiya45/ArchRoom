import { useEffect, useState } from 'react';
import { trpc } from '../lib/trpc';
import { formatMeetingTime } from '../lib/meetingSchedule';
import { Video, ChevronDown, Copy, CalendarDays } from 'lucide-react';
import LocalRecordingsPanel from './LocalRecordingsPanel';
import RecordingBackupsPanel from './RecordingBackupsPanel';

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
  const copyText = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); setNotice(label + ' copied.'); }
    catch { setNotice('Could not copy. Select the text and copy it manually.'); }
  };
  const materials = (occurrenceId: string | null) => {
    if (!detail) return null;
    const items = detail.items.filter(item => item.occurrenceId === occurrenceId);
    const recordings = detail.recordings.filter(item => item.occurrenceId === occurrenceId);
    return <div className="space-y-3">
      <h3 className="font-semibold">Transcript / Summary</h3>
      {!items.some(item => (item.kind === 'transcript' || item.kind === 'summary') && item.content.trim()) && <p className="text-sm text-slate-500">No saved transcript or summary is available.</p>}
      {(['transcript', 'summary'] as const).map(kind => {
        const texts = items.filter(item => item.kind === kind && item.content.trim());
        const displayTexts = (kind === 'transcript' && texts.some(item => item.label === 'reviewed-complete') ? texts.filter(item => item.label === 'reviewed-complete') : texts)
          .sort((a, b) => (a.label || '').localeCompare(b.label || '') || (a.createdAt || '').localeCompare(b.createdAt || ''));
        return displayTexts.length > 0 && <details key={kind} className="rounded-[8px] border border-slate-200 p-3"><summary className="cursor-pointer font-semibold text-blue-300">{kind === 'transcript' ? 'View transcript' : 'View summary'}</summary>
          <p className="my-2 text-xs text-slate-500">Automatically generated; may be incomplete or inaccurate. Review before use.</p>
          <div tabIndex={0} aria-label={kind === 'transcript' ? 'Saved transcript' : 'Saved summary'} className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-sm select-text">{displayTexts.map(item => item.content).join('\n\n')}</div>
          <button className="mt-3 rounded-[8px] border border-slate-200 px-3 py-2 text-sm text-blue-300" onClick={() => void copyText(displayTexts.map(item => item.content).join('\n\n'), kind === 'transcript' ? 'Transcript' : 'Summary')}>Copy {kind}</button>
          {kind === 'transcript' && <button className="ml-2 mt-3 rounded-[8px] border border-slate-200 px-3 py-2 text-sm text-blue-300" onClick={() => {
            const url = URL.createObjectURL(new Blob([displayTexts.map(item => item.content).join('\n\n')], { type: 'text/plain;charset=utf-8' }));
            const link = document.createElement('a'); link.href = url; link.download = 'meeting-transcript.txt'; link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}>Download transcript</button>}
        </details>;
      })}
      {(items.some(item => item.kind === 'drive') || recordings.length > 0) && <section aria-label="Recording" className="space-y-3 rounded-[8px] border border-slate-200 p-3">
        <h3 className="font-semibold">Recording</h3>
        {items.filter(item => item.kind === 'drive').map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="break-all">{item.label || 'Saved recording'}</span>
          <span className="text-xs text-slate-500">{item.independentlyVerified === true ? 'File independently verified at upload' : 'File verification unavailable (legacy or unverified link)'}</span>
          {/^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/view(?:\?[^#]*)?$/.test(item.content)
            ? <a className="inline-flex rounded-[8px] border border-slate-200 px-3 py-2 font-semibold text-blue-300" href={item.content} target="_blank" rel="noopener noreferrer">Open in Drive</a>
            : <p className="text-slate-500">No usable Google Drive link is available.</p>}
          <button className="rounded-[8px] border border-slate-200 px-3 py-2 text-blue-300" onClick={() => void copyText(item.content, 'Recording link')}>Copy Link</button>
        </div>)}
        {items.some(item => item.kind === 'drive') && <p className="text-xs text-slate-500">Drive permissions still apply. A saved link does not guarantee that the file is available.</p>}
        {recordings.map(recording => <div key={recording.id} className="break-words text-sm">
          <p>Supabase recording: {recording.fileName} / {recording.status}{recording.durationSeconds != null ? ` / ${recording.durationSeconds} seconds` : ''}</p>
          {recording.status === 'completed' && <button className="rounded-[8px] text-blue-300 underline" onClick={() => {
            void trpc.recordings.downloadUrl.mutate({ recordingId: recording.id }).then(result => setRecordingLinks(current => ({ ...current, [recording.id]: result.url })), () => setNotice('The recording link could not be generated. Please retry.'));
          }}>Get temporary recording link</button>}
          {recordingLinks[recording.id] && <a className="ml-3 rounded-[8px] text-blue-300 underline" href={recordingLinks[recording.id]} target="_blank" rel="noopener noreferrer">Open saved recording</a>}
        </div>)}
      </section>}
      {items.some(item => item.kind === 'transcript') && <div className="space-y-3 rounded-[8px] border border-slate-200 p-3">
        <button className="rounded-[8px] font-semibold text-blue-300 underline" onClick={async () => {
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
          <button disabled={emailBusy || !selectedRecipients.length} className="rounded-[8px] bg-blue-600 px-3 py-2 text-white disabled:opacity-50" onClick={async () => {
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
    </div>;
  };
  return <section className="mx-auto w-full max-w-6xl space-y-5 px-4 py-8 text-slate-900 [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-blue-400 [&_summary:focus-visible]:outline-2 [&_summary:focus-visible]:outline-blue-400 [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-blue-400">
    <h1 className="text-2xl font-bold">Meeting History</h1>
    <p className="text-sm text-slate-500">Meetings you created, with saved session details. Times below use your device's timezone unless specified.</p>
    <LocalRecordingsPanel />
    <RecordingBackupsPanel />
    {!selected && loading && <p role="status">Loading meeting history...</p>}
    {!selected && error && <div role="alert">{error} <button className="rounded-[8px] underline" onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
    {!selected && !loading && !error && !rows.length && <p>No meetings on this page.</p>}
    <ul className="space-y-3">{rows.map(row => {
      const expanded = selected === row.id;
      const meeting = expanded && detail ? detail.meeting : row;
      const link = window.location.origin + '/meet/' + meeting.meetingCode;
      return <li key={row.id} className="min-w-0 rounded-[8px] border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="shrink-0 rounded-[8px] bg-blue-500/15 p-3 text-blue-300"><Video className="h-5 w-5" aria-hidden="true" /></div>
            <div className="min-w-0"><h2 className="break-words font-bold">{meeting.title}</h2>
              <p className="mt-1 break-words text-sm text-slate-500">ID: {meeting.meetingCode}{meeting.scheduleType === 'reusable' ? ' / ' + formatMeetingTime(meeting) : ''}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm lg:justify-end">
            <span className="rounded-[8px] bg-blue-500/15 px-3 py-1 font-semibold text-blue-300">{meeting.status}</span>
            <div className="flex items-center gap-2 text-slate-500 lg:border-l lg:border-slate-200 lg:pl-4"><CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" /><span>{meeting.scheduledAt ? 'Scheduled: ' : 'Created: '}{date(meeting.scheduledAt || meeting.createdAt)}</span></div>
            <button aria-expanded={expanded} aria-controls={'history-' + row.id} onClick={() => setSelected(expanded ? null : row.id)} className="inline-flex items-center gap-2 rounded-[8px] px-3 py-2 font-semibold text-blue-300 hover:bg-blue-500/10">
              {expanded ? 'Hide Details' : 'View Details'}<ChevronDown aria-hidden="true" className={'h-4 w-4 ' + (expanded ? 'rotate-180' : '')} />
            </button>
          </div>
        </div>
        {expanded && <div id={'history-' + row.id} className="mt-4 min-w-0 space-y-4 rounded-[8px] border border-slate-200 bg-slate-50 p-3 sm:p-4">
          {loading && <p role="status">Loading meeting details...</p>}
          {error && <div role="alert">{error} <button className="rounded-[8px] underline" onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
          {!loading && !error && detail && <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label htmlFor={'link-' + row.id} className="shrink-0 font-semibold sm:mr-3">Meeting link</label>
              <div className="flex min-w-0 flex-1 gap-2"><input id={'link-' + row.id} readOnly value={link} onFocus={event => event.currentTarget.select()} className="min-w-0 flex-1 rounded-[8px] border border-slate-200 bg-white px-3 py-2 text-sm select-text focus-visible:outline-blue-400" />
                <button onClick={() => void copyText(link, 'Meeting link')} className="inline-flex shrink-0 items-center gap-2 rounded-[8px] border border-slate-200 px-3 py-2 text-sm font-semibold text-blue-300"><Copy className="h-4 w-4" aria-hidden="true" />{notice === 'Meeting link copied.' ? 'Copied' : 'Copy'}</button>
              </div>
            </div>
            {notice && <p role="status" className="text-sm text-slate-500">{notice}</p>}
            {detail.meeting.scheduleType === 'recurring' && <p className="text-sm text-slate-500">Schedule: {formatMeetingTime(detail.meeting)}</p>}
            {materials(null)}
            <h3 className="font-semibold">Meeting sessions</h3>
            {!detail.sessions.length && <p className="text-sm text-slate-500">No separate session times are stored for this meeting.</p>}
            {detail.sessions.map(session => <details key={session.id} className="rounded-[8px] border border-slate-200 p-3">
              <summary className="cursor-pointer font-semibold">{session.status} / {session.status === 'live' || session.status === 'ended' ? 'Started ' + date(session.startedAt) : 'Scheduled ' + date(session.scheduledAt)}</summary>
              <div className="mt-4 space-y-3 text-sm"><p>Scheduled: {date(session.scheduledAt)}{session.timeZone ? ' (' + session.timeZone + ' schedule)' : ''}</p>
                {(session.status === 'live' || session.status === 'ended') && <p>Started: {date(session.startedAt)} / Ended: {date(session.endedAt)}</p>}
                {session.cancelledAt && <p>Cancelled: {date(session.cancelledAt)}</p>}
                {materials(session.id)}
              </div>
            </details>)}
          </>}
        </div>}
      </li>;
    })}</ul>
    <div className="flex gap-4"><button className="rounded-[8px] underline disabled:opacity-40" disabled={offset === 0} onClick={() => { setSelected(null); setOffset(value => Math.max(0, value - 30)); }}>Previous</button><button className="rounded-[8px] underline disabled:opacity-40" disabled={rows.length < 30} onClick={() => { setSelected(null); setOffset(value => value + 30); }}>Next</button></div>
  </section>;
}
