import { trpc } from './trpc';
import { getRefreshToken, getStoredUser } from './auth';
import { getValidAccessToken } from './sessionRenewal';
import type { CompanyUploadApi, StagingProgress } from './companyRecordingUpload';

export class CompanyUploadManualReconciliation extends Error {
  constructor() { super('This recording requires manual reconciliation.'); }
}

export function companyRecordingUploadApi(ownerId: string, signal: AbortSignal, onJob: (jobId: string) => void, retryRequested = false): CompanyUploadApi {
  const assertOwner = () => {
    if (signal.aborted || getStoredUser()?.id !== ownerId) throw new Error('The recording owner session changed.');
  };
  const call = async <T>(operation: () => Promise<T>): Promise<T> => {
    assertOwner(); const result = await operation(); assertOwner(); return result;
  };
  const binary = async (jobId: string, recordingId: string, action: 'progress' | 'chunks' | 'verify', bytes?: Blob, range?: string) => {
    const base = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
    const path = `${base}/recording-staging/jobs/${encodeURIComponent(jobId)}/recordings/${encodeURIComponent(recordingId)}/${action}`;
    const send = async (force: boolean) => {
      assertOwner(); const token = await getValidAccessToken(force); assertOwner();
      if (!token) throw new Error('Sign in again to continue this recording upload.');
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (bytes && range) { headers['Content-Type'] = 'application/octet-stream'; headers['Content-Range'] = range; }
      return fetch(path, { method: action === 'progress' ? 'GET' : 'POST', headers, body: bytes, signal });
    };
    let response = await send(false);
    if (response.status === 401 && getRefreshToken()) response = await send(true);
    assertOwner();
    if (!response.ok) throw new Error('Recording staging is unavailable. Keep the recording and retry.');
    const result = await response.json() as StagingProgress; assertOwner(); return result;
  };
  return {
    async createJob(input) { const job = await call(() => trpc.recordings.createCompanyJob.mutate(input, { signal })); onJob(job.id); return job; },
    progress: (jobId, recordingId) => binary(jobId, recordingId, 'progress'),
    chunk: (jobId, recordingId, range, bytes) => binary(jobId, recordingId, 'chunks', bytes, range),
    verify: (jobId, recordingId) => binary(jobId, recordingId, 'verify'),
    async requestProcessing(jobId) {
      const current = await call(() => trpc.recordings.companyJobProgress.query({ jobId }, { signal }));
      if (current.stage === 'manual_reconciliation') throw new CompanyUploadManualReconciliation();
      if (current.stage === 'retryable_failure') {
        if (!retryRequested) throw new Error('The upload requires an explicit retry.');
        return call(() => trpc.recordings.retryCompanyJob.mutate({ jobId }, { signal }));
      }
      if (current.stage === 'completed') return current;
      return call(() => trpc.recordings.requestCompanyJobProcessing.mutate({ jobId }, { signal }));
    },
  };
}
