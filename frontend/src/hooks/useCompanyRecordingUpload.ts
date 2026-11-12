import { useCallback, useEffect, useRef, useState } from 'react';
import { getStoredUser, subscribeToSessionRemoval } from '@/lib/auth';
import { trpc } from '@/lib/trpc';
import { stageCanonicalRecording } from '@/lib/companyRecordingUpload';
import { companyRecordingUploadApi, CompanyUploadManualReconciliation } from '@/lib/companyRecordingUploadApi';
import type { RecordingPreview } from './useScreenRecorder';

export type CompanyUploadStatus = { recordingId: string; occurrenceId?: string; fileName: string; stage: string; stagedBytes: number; totalBytes: number;
  driveBytes: number; jobId?: string; errorMessage?: string };
type Attempt = { preview: RecordingPreview; meetingCode: string; ownerId: string; destinationFolderId?: string | null; controller: AbortController };

const delay = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(new Error('Cancelled')); return; }
  const timer = window.setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 2000);
  const abort = () => { window.clearTimeout(timer); reject(new Error('Cancelled')); };
  signal.addEventListener('abort', abort, { once: true });
});

export function useCompanyRecordingUpload() {
  const [statuses, setStatuses] = useState<CompanyUploadStatus[]>([]);
  const attempts = useRef(new Map<string, Attempt>());
  const recordings = useRef(new Map<string, Omit<Attempt, 'controller'>>());
  const live = useRef(true);
  const update = (recordingId: string, patch: Partial<CompanyUploadStatus>) => {
    if (live.current) setStatuses(current => current.map(item => item.recordingId === recordingId ? { ...item, ...patch } : item));
  };
  useEffect(() => {
    live.current = true;
    const lock = () => {
      for (const attempt of attempts.current.values()) attempt.controller.abort();
      attempts.current.clear(); recordings.current.clear(); if (live.current) setStatuses([]);
    };
    const check = () => {
      if ([...attempts.current.values(), ...recordings.current.values()].some(attempt => getStoredUser()?.id !== attempt.ownerId)) lock();
    };
    const unsubscribe = subscribeToSessionRemoval(lock);
    const timer = window.setInterval(check, 1000);
    window.addEventListener('storage', check);
    return () => { live.current = false; lock(); unsubscribe(); window.clearInterval(timer); window.removeEventListener('storage', check); };
  }, []);
  useEffect(() => {
    if (!statuses.some(item => ['preparing', 'staging', 'verifying'].includes(item.stage) ||
      (item.stage === 'retryable_failure' && item.stagedBytes < item.totalBytes))) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect); return () => window.removeEventListener('beforeunload', protect);
  }, [statuses]);

  const start = useCallback(async (preview: RecordingPreview, meetingCode: string, ownerId: string, retryRequested = false,
    destinationFolderId?: string | null) => {
    if (!preview.canonicalBlob || !preview.recordingId || !ownerId || getStoredUser()?.id !== ownerId) return false;
    const id = preview.recordingId;
    if (attempts.current.has(id)) return true;
    const controller = new AbortController();
    attempts.current.set(id, { preview, meetingCode, ownerId, destinationFolderId, controller });
    try {
      const account = await trpc.auth.me.query(undefined, { signal: controller.signal });
      if (account.user.id !== ownerId || getStoredUser()?.id !== ownerId) throw new Error('Account changed.');
      recordings.current.set(id, { preview, meetingCode, ownerId, destinationFolderId });
      setStatuses(current => [...current.filter(item => item.recordingId !== id), { recordingId: id, occurrenceId: preview.occurrenceId, fileName: preview.fileName,
        stage: 'preparing', stagedBytes: 0, totalBytes: preview.canonicalBlob!.size, driveBytes: 0 }]);
      if (!preview.recordingStartedAt || !Number.isFinite(Date.parse(preview.recordingStartedAt))) { update(id, { stage:'metadata_unavailable' }); return false; }
      const capability = await trpc.recordings.companyUploadCapability.query(undefined, { signal: controller.signal });
      if (!capability.available) { update(id, { stage: 'unavailable', errorMessage: 'Company Drive uploads are currently unavailable.' }); return false; }
      if (controller.signal.aborted || getStoredUser()?.id !== ownerId) return false;
      const api = companyRecordingUploadApi(ownerId, controller.signal, jobId => update(id, { jobId }), retryRequested);
      const job = await stageCanonicalRecording({ recordingId: id, meetingCode, occurrenceId: preview.occurrenceId, destinationFolderId,
        recordingStartedAt:preview.recordingStartedAt, canonicalBlob: preview.canonicalBlob }, api,
        progress => update(id, { stage: progress.stage, stagedBytes: progress.stagedBytes, totalBytes: progress.totalBytes }));
      while (!controller.signal.aborted) {
        if (getStoredUser()?.id !== ownerId) throw new Error('Account changed.');
        const progress = await trpc.recordings.companyJobProgress.query({ jobId: job.jobId }, { signal: controller.signal });
        if (controller.signal.aborted || getStoredUser()?.id !== ownerId) throw new Error('Account changed.');
        if (progress.recordingId !== id) throw new Error('Recording status changed.');
        update(id, { stage: progress.stage, stagedBytes: progress.stagedBytes, totalBytes: progress.expectedBytes, driveBytes: progress.driveConfirmedBytes, jobId: job.jobId });
        if (['completed', 'retryable_failure', 'manual_reconciliation'].includes(progress.stage)) return true;
        await delay(controller.signal);
      }
    } catch (error) {
      if (!controller.signal.aborted && getStoredUser()?.id === ownerId)
        update(id, { stage: error instanceof CompanyUploadManualReconciliation ? 'manual_reconciliation' : 'retryable_failure',
          errorMessage: error instanceof Error ? error.message : 'The recording upload could not be started. Choose a valid folder and retry.' });
    } finally { if (attempts.current.get(id)?.controller === controller) attempts.current.delete(id); }
    return true;
  }, []);

  const retry = useCallback((recordingId: string) => {
    const recording = recordings.current.get(recordingId);
    if (recording) void start(recording.preview, recording.meetingCode, recording.ownerId, true, recording.destinationFolderId);
  }, [start]);
  return { statuses, start, retry };
}
