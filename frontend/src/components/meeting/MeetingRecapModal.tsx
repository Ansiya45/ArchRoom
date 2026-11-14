import { useEffect, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';

// Shown to participants when the meeting ends. Offers the raw transcript and
// an AI-generated structured summary for download when the host allows it.
export function MeetingRecapModal({ meetingCode, occurrenceId, participantId, onClose }: {
  meetingCode: string;
  occurrenceId?: string;
  participantId?: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [restricted, setRestricted] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const result = await trpc.meetings.transcriptRecap.query({ meetingCode, occurrenceId, participantId });
        setTranscript(result.transcript);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : '';
        if (message.includes('limited') || message.includes('participants')) setRestricted(true);
        else setError(message || 'Unable to load the meeting recap.');
      } finally { setLoading(false); }
    })();
  }, [meetingCode, occurrenceId, participantId]);

  const downloadText = (name: string, text: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadSummary = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await trpc.meetings.aiSummaryRecap.mutate({ meetingCode, occurrenceId, participantId }, { signal: AbortSignal.timeout(90000) });
      downloadText(`meeting-${meetingCode}-ai-summary.txt`, result.summary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to generate the AI summary.');
    } finally { setBusy(false); }
  };

  return <div className="fixed inset-0 z-[110] bg-black/80 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="recap-title">
    <div className="bg-zinc-900 text-white border border-white/10 rounded-2xl p-6 w-full max-w-md space-y-4">
      <h2 id="recap-title" className="text-xl font-semibold">Meeting ended</h2>
      {loading && <p role="status" className="text-sm text-zinc-400">Checking for a transcript…</p>}
      {!loading && restricted && (
        <p className="text-sm text-zinc-400">Transcript and AI summary downloads for this meeting are available to the host only.</p>
      )}
      {!loading && !restricted && (
        <p className="text-sm text-zinc-400">
          {transcript.trim() ? 'A transcript of this meeting is available.' : 'No transcript was captured for this meeting.'}
        </p>
      )}
      {error && <p role="alert" className="text-red-300 text-sm">{error}</p>}
      <div className="flex gap-3 flex-wrap">
        {!restricted && transcript.trim() ? <>
          <button className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm font-semibold"
            onClick={() => downloadText(`meeting-${meetingCode}-transcript.txt`, transcript)}>Download transcript</button>
          <button className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-sm font-semibold disabled:opacity-50"
            disabled={busy} onClick={() => void downloadSummary()}>{busy ? 'Generating…' : 'Download AI summary'}</button>
        </> : null}
        <button className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-semibold" onClick={onClose}>Done</button>
      </div>
    </div>
  </div>;
}
