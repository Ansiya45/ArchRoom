import type { CompanyUploadStatus } from '@/hooks/useCompanyRecordingUpload';

const labels: Record<string, string> = {
  preparing: 'Preparing recording', staging: 'Uploading recording bytes', verifying: 'Verifying recording',
  processing_requested: 'Preparing company Drive upload', waiting_for_ingestion: 'Waiting for recording bytes',
  ingesting: 'Uploading recording bytes', verifying_canonical_bytes: 'Verifying recording',
  preparing_drive_upload: 'Preparing company Drive upload', uploading_to_drive: 'Uploading to company Drive',
  awaiting_drive_verification: 'Verifying Drive file', publishing_history: 'Publishing to Meeting History',
  completed: 'Saved to company Drive and available in Meeting History',
  retryable_failure: 'Upload interrupted. Keep the recording and retry.',
  unavailable: 'Company Drive upload is unavailable. Download or save this recording locally.',
  metadata_unavailable: 'The recording start time is unavailable. Download the local recording.',
  manual_reconciliation: 'Upload needs manual reconciliation. Keep your recording.',
};

export function CompanyRecordingUploadFeedback({ statuses, onRetry }: { statuses: CompanyUploadStatus[]; onRetry: (recordingId: string) => void }) {
  if (!statuses.length) return null;
  return <section aria-label="Company recording uploads" className="mb-4 space-y-2">
    {statuses.map(status => <div key={status.recordingId} className="rounded-[8px] border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
      <p className="truncate font-semibold">{status.fileName}</p>
      <p role="status">{labels[status.stage] ?? 'Checking recording upload'}</p>
      {status.errorMessage && <p role="alert" className="mt-1 text-xs text-red-700">{status.errorMessage}</p>}
      {['staging', 'ingesting'].includes(status.stage) && <p className="text-xs text-slate-600">{status.stagedBytes} / {status.totalBytes} bytes staged</p>}
      {status.stage === 'uploading_to_drive' && <p className="text-xs text-slate-600">{status.driveBytes} / {status.totalBytes} bytes confirmed by Drive</p>}
      {['preparing', 'staging', 'verifying', 'retryable_failure'].includes(status.stage) && <p className="mt-1 text-xs text-slate-600">Keep this tab open until staging finishes. Closing it can lose a recording that has not been saved locally.</p>}
      {status.stage === 'retryable_failure' && <button type="button" onClick={() => onRetry(status.recordingId)} className="mt-2 rounded-[8px] bg-violet-600 px-3 py-2 text-xs font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-600">Retry upload</button>}
    </div>)}
  </section>;
}
