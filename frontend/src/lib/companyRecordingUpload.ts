// Transport foundation for finalized canonical recordings. The caller owns the
// stable recording ID and must retain it across retries and recovery.
export const COMPANY_RECORDING_MAX_BYTES = 128 * 1024 * 1024;
export const COMPANY_RECORDING_CHUNK_BYTES = 8 * 1024 * 1024;
const ALIGNMENT = 256 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// History provenance is computed by the backend from the completed job and
// independent Drive verification. Match the exact recording and occurrence.
export function verifiedCompanyRecordingLink(items: ReadonlyArray<{ kind: string; dedupeKey: string | null;
  occurrenceId: string | null; independentlyVerified: boolean; content: string }>,
  recordingId: string, occurrenceId?: string | null): string | null {
  if (!uuid.test(recordingId)) return null;
  const item = items.find(candidate => candidate.kind === 'drive' && candidate.independentlyVerified === true &&
    candidate.dedupeKey === `company-drive:${recordingId}` &&
    candidate.occurrenceId === (occurrenceId ?? null) &&
    /^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/view$/.test(candidate.content));
  return item?.content ?? null;
}

export function canLeaveRecordingReview(previewRecordingId: string | null | undefined, uploads: ReadonlyArray<{ recordingId: string; stage: string }>): boolean {
  if (previewRecordingId === null) return true;
  return Boolean(previewRecordingId && uploads.some(upload => upload.recordingId === previewRecordingId && upload.stage === 'completed'));
}

export type CanonicalRecording = { recordingId: string; meetingCode: string; occurrenceId?: string; recordingStartedAt?: string;
  destinationFolderId?: string | null; canonicalBlob: Blob };
export type StagingProgress = { jobId: string; recordingId: string; mimeType: string; byteLength: number; ingestionOffset: number; ingestionState: 'verified' | 'unverified' };
export type CompanyUploadApi = {
  createJob(input: { recordingId: string; meetingCode: string; occurrenceId?: string; destinationFolderId?: string | null;
    recordingStartedAt: string; mimeType: 'video/webm' | 'video/mp4'; byteLength: number; sha256: string }): Promise<{ id: string; recordingId: string }>;
  progress(jobId: string, recordingId: string): Promise<StagingProgress>;
  chunk(jobId: string, recordingId: string, range: string, bytes: Blob): Promise<StagingProgress>;
  verify(jobId: string, recordingId: string): Promise<StagingProgress>;
  requestProcessing(jobId: string): Promise<unknown>;
};
export type StagingUpdate = { stage: 'preparing' | 'staging' | 'verifying' | 'processing_requested'; stagedBytes: number; totalBytes: number };

function checkProgress(progress: StagingProgress, jobId: string, recording: CanonicalRecording, mimeType: string) {
  if (progress.jobId !== jobId || progress.recordingId !== recording.recordingId || progress.mimeType !== mimeType ||
      progress.byteLength !== recording.canonicalBlob.size || !Number.isSafeInteger(progress.ingestionOffset) ||
      progress.ingestionOffset < 0 || progress.ingestionOffset > recording.canonicalBlob.size ||
      (progress.ingestionOffset !== recording.canonicalBlob.size && progress.ingestionOffset % ALIGNMENT !== 0) ||
      !['verified', 'unverified'].includes(progress.ingestionState))
    throw new Error('The server returned inconsistent recording progress.');
}

// This function does not claim Drive success. A caller must query the backend's
// owner-scoped companyJobProgress and wait for its completed stage.
export async function stageCanonicalRecording(recording: CanonicalRecording, api: CompanyUploadApi,
  onUpdate: (update: StagingUpdate) => void = () => {}) {
  const blob = recording.canonicalBlob;
  const mimeType = blob.type;
  if (!uuid.test(recording.recordingId) || !recording.meetingCode.trim() || !recording.recordingStartedAt || !Number.isFinite(Date.parse(recording.recordingStartedAt)) ||
      (recording.occurrenceId !== undefined && !uuid.test(recording.occurrenceId)) ||
      !['video/webm', 'video/mp4'].includes(mimeType) || !blob.size || blob.size > COMPANY_RECORDING_MAX_BYTES)
    throw new Error('The finalized canonical recording is unavailable or exceeds the local test limit.');
  onUpdate({ stage: 'preparing', stagedBytes: 0, totalBytes: blob.size });
  // Web Crypto's digest API requires a complete ArrayBuffer. The input is
  // limited to 128 MiB and any allocation failure is reported to the caller.
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const created = await api.createJob({ recordingId: recording.recordingId, meetingCode: recording.meetingCode,
    occurrenceId: recording.occurrenceId, destinationFolderId: recording.destinationFolderId,
    recordingStartedAt:recording.recordingStartedAt, mimeType: mimeType as 'video/webm' | 'video/mp4', byteLength: blob.size, sha256 });
  if (!uuid.test(created.id) || created.recordingId !== recording.recordingId) throw new Error('The server returned an unexpected recording job.');
  let progress = await api.progress(created.id, recording.recordingId);
  checkProgress(progress, created.id, recording, mimeType);
  onUpdate({ stage: 'staging', stagedBytes: progress.ingestionOffset, totalBytes: blob.size });
  while (progress.ingestionOffset < blob.size) {
    if (progress.ingestionState === 'verified') throw new Error('The server returned inconsistent recording progress.');
    const start = progress.ingestionOffset;
    const end = Math.min(start + COMPANY_RECORDING_CHUNK_BYTES, blob.size);
    const next = await api.chunk(created.id, recording.recordingId, `bytes ${start}-${end - 1}/${blob.size}`, blob.slice(start, end));
    checkProgress(next, created.id, recording, mimeType);
    // If another client has advanced the job, the caller can re-read progress
    // on retry. Never assume bytes were committed from a sent request.
    if (next.ingestionOffset !== end) throw new Error('Recording progress changed. Retry to resume from the server offset.');
    progress = next;
    onUpdate({ stage: 'staging', stagedBytes: progress.ingestionOffset, totalBytes: blob.size });
  }
  onUpdate({ stage: 'verifying', stagedBytes: progress.ingestionOffset, totalBytes: blob.size });
  const verified = await api.verify(created.id, recording.recordingId);
  checkProgress(verified, created.id, recording, mimeType);
  if (verified.ingestionState !== 'verified' || verified.ingestionOffset !== blob.size)
    throw new Error('The server has not verified the recording bytes.');
  await api.requestProcessing(created.id);
  onUpdate({ stage: 'processing_requested', stagedBytes: verified.ingestionOffset, totalBytes: blob.size });
  return { jobId: created.id, recordingId: recording.recordingId };
}
