import { useEffect, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { createSummaryCapture } from '@/lib/meetingSummaryCapture';

export function useMeetingSummaryCapture(active: boolean, meetingCode: string, occurrenceId: string | undefined,
  requestId: string | undefined, allowedParticipantIds: string[], local: MediaStream | null, micOn: boolean,
  remote: Record<string, MediaStream>, muted: Record<string, boolean>, onSegment?: (text: string) => void) {
  const [error, setError] = useState('');
  const [capturing, setCapturing] = useState(false);
  const warning = useRef('');
  const segmentHandler = useRef(onSegment);
  segmentHandler.current = onSegment;
  const captureActive = useRef(active);
  captureActive.current = active;
  const runtime = useRef<ReturnType<typeof createSummaryCapture> | null>(null);
  const completed = useRef<string[]>([]);
  const pendingFinishes = useRef(new Set<Promise<void>>());
  const allowed = new Set(allowedParticipantIds);
  const safeRemote = Object.fromEntries(Object.entries(remote).filter(([id]) => allowed.has(id)));
  const inputs = useRef({ local, micOn, remote: safeRemote, muted });
  inputs.current = { local, micOn, remote: safeRemote, muted };

  useEffect(() => {
    if (!active || !requestId) return;
    setError('');
    const warn = (message: string) => { warning.current = message; setError(message); };
    try {
      const capture = createSummaryCapture(async (blob, mimeType, sequence) => {
        const audio = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onerror = reject;
          reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(blob);
        });
        const result = await trpc.meetings.transcribeSpeech.mutate({ meetingCode, occurrenceId, requestId, sequence, mimeType, audio }, { signal: AbortSignal.timeout(75000) });
        if (result.historyWarning) warn(result.historyWarning);
        return result.text;
      }, warn, setCapturing, text => { if (captureActive.current) segmentHandler.current?.(text); });
      runtime.current = capture;
      capture.update(inputs.current);
      const timer = setInterval(() => capture.update(inputs.current), 1000);
      return () => {
        clearInterval(timer);
        if (runtime.current !== capture) return;
        runtime.current = null;
        const finishing = capture.finish().then(text => { if (text) completed.current.push(text); })
          .finally(() => { capture.dispose(); pendingFinishes.current.delete(finishing); });
        pendingFinishes.current.add(finishing);
      };
    } catch (cause) { warn(cause instanceof Error ? cause.message : 'Speech capture could not start.'); }
  }, [active, meetingCode, occurrenceId, requestId]);

  useEffect(() => { runtime.current?.update(inputs.current); }, [active, local, micOn, remote, muted, allowedParticipantIds.join(',')]);

  return {
    error,
    capturing,
    getWarning: () => warning.current,
    finish: async () => {
      const capture = runtime.current;
      if (capture) {
        runtime.current = null;
        const text = await capture.finish();
        if (text) completed.current.push(text);
        capture.dispose();
      }
      await Promise.all([...pendingFinishes.current]);
      return completed.current.filter(Boolean).join('\n');
    },
    resume: () => runtime.current?.resume().catch(() => setError('Audio processing could not resume.')),
  };
}
