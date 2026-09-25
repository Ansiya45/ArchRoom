import { useEffect, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { createSummaryCapture } from '@/lib/meetingSummaryCapture';

export function useMeetingSummaryCapture(active: boolean, meetingCode: string, occurrenceId: string | undefined,
  local: MediaStream | null, micOn: boolean, remote: Record<string, MediaStream>, muted: Record<string, boolean>) {
  const [error, setError] = useState('');
  const warning = useRef('');
  const runtime = useRef<ReturnType<typeof createSummaryCapture> | null>(null);
  const inputs = useRef({ local, micOn, remote, muted });
  inputs.current = { local, micOn, remote, muted };
  useEffect(() => {
    if (!active) return;
    warning.current = ''; setError('');
    const warn = (message: string) => { warning.current = message; setError(message); };
    try {
      const capture = createSummaryCapture(async (blob, mimeType) => {
        const audio = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onerror = reject;
          reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(blob);
        });
        const result = await trpc.meetings.transcribeSpeech.mutate({ meetingCode, occurrenceId, mimeType, audio }, { signal: AbortSignal.timeout(75000) });
        return result.text;
      }, warn);
      runtime.current = capture;
      capture.update(inputs.current);
      // Existing streams can acquire tracks without changing object identity.
      const timer = setInterval(() => capture.update(inputs.current), 1000);
      return () => { clearInterval(timer); capture.dispose(); if (runtime.current === capture) runtime.current = null; };
    } catch (cause) { warn(cause instanceof Error ? cause.message : 'Speech capture could not start.'); }
  }, [active, meetingCode, occurrenceId]);
  useEffect(() => { runtime.current?.update(inputs.current); }, [active, local, micOn, remote, muted]);
  return { error, getWarning: () => warning.current, finish: () => runtime.current?.finish() ?? Promise.resolve(''),
    resume: () => runtime.current?.resume().catch(() => setError('Audio processing could not resume.')) };
}
