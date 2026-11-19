import { createHash } from 'node:crypto';
import type { Sql, TransactionSql } from 'postgres';
import { validateRecordingChunkRange, verifyCanonicalRecordingBytes, DRIVE_CHUNK_ALIGNMENT } from './company-recording-transfer-protocol.js';

export class IngestionError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}
export type StagingConfig = { nodeEnv: string; jobsEnabled: boolean; localEnabled: boolean; databaseUrl: string };
export type RecordingBinding = { jobId: string; recordingId: string; userId: string };
export const MAX_LOCAL_RECORDING_BYTES = 128 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireLocalStaging(config: StagingConfig) {
  let local = false;
  try {
    const url = new URL(config.databaseUrl);
    local = ['postgres:', 'postgresql:'].includes(url.protocol) && ['127.0.0.1', '[::1]'].includes(url.hostname)
      && /^\/ylaam_staging_disposable_[a-z0-9_]+$/.test(url.pathname) && !url.search;
  } catch { /* Fail closed without returning connection details. */ }
  if (!['test', 'development'].includes(config.nodeEnv) || config.jobsEnabled !== true || config.localEnabled !== true || !local)
    throw new IngestionError(503, 'LOCAL_STAGING_DISABLED');
}

export class LocalRecordingIngestion {
  constructor(private readonly sql: Sql, private readonly config: StagingConfig,
    // Runtime reuses CompanyRecordingJobsService.status and its authorizeExport checks.
    private readonly authorizeJob: (jobId: string, userId: string) => Promise<unknown>) {}
  requireEnabled() { requireLocalStaging(this.config); }

  private async transaction<T>(binding: RecordingBinding, fn: (tx: TransactionSql, job: any) => Promise<T>): Promise<T> {
    this.requireEnabled();
    if (![binding.jobId, binding.recordingId, binding.userId].every(id => uuid.test(id))) throw new IngestionError(400, 'INVALID_RECORDING_ID');
    await this.authorizeJob(binding.jobId, binding.userId);
    try {
      return await this.sql.begin(async tx => {
        await tx`set local lock_timeout = '5s'`;
        await tx`set local statement_timeout = '15s'`;
        await tx`set local idle_in_transaction_session_timeout = '15s'`;
        await tx`set local ylaam.local_staging_test = 'enabled'`;
        await tx`select local_recording_staging.require_disposable_test()`;
        // Lock in the existing job service's order: meeting, occurrence, participant, job.
        const [initial] = await tx`select * from company_recording_upload_jobs where id=${binding.jobId} and owner_user_id=${binding.userId} and recording_id=${binding.recordingId}`;
        if (!initial) throw new IngestionError(404, 'RECORDING_JOB_UNAVAILABLE');
        const [meeting] = await tx`select * from meetings where id=${initial.meeting_id} for share`;
        if (!meeting) throw new IngestionError(404, 'RECORDING_JOB_UNAVAILABLE');
        if (['reusable', 'recurring'].includes(meeting.schedule_type)) {
          const [session] = await tx`select id from meeting_occurrences where id=${initial.occurrence_id} and meeting_id=${meeting.id} for share`;
          if (!session) throw new IngestionError(403, 'RECORDING_SESSION_UNAVAILABLE');
        } else if (initial.occurrence_id) throw new IngestionError(403, 'RECORDING_SESSION_UNAVAILABLE');
        if (meeting.host_user_id !== binding.userId) {
          const [host] = await tx`select id from meeting_participants where meeting_id=${meeting.id} and user_id=${binding.userId}
            and occurrence_id is not distinct from ${initial.occurrence_id}::uuid and role='host' and admission='admitted' for share`;
          if (!host) throw new IngestionError(403, 'RECORDING_HOST_REQUIRED');
        }
        const [job] = await tx`select * from company_recording_upload_jobs where id=${binding.jobId} and owner_user_id=${binding.userId} and recording_id=${binding.recordingId} for update`;
        if (!job || job.meeting_id !== initial.meeting_id || job.occurrence_id !== initial.occurrence_id) throw new IngestionError(409, 'RECORDING_JOB_CHANGED');
        if (Number(job.byte_length) > MAX_LOCAL_RECORDING_BYTES) throw new IngestionError(413, 'RECORDING_TOO_LARGE');
        return await fn(tx, job);
      }) as T;
    } catch (error) {
      if (error instanceof IngestionError) throw error;
      if (error instanceof Error && error.message === 'STAGING_CAPACITY_EXHAUSTED') throw new IngestionError(507, 'STAGING_CAPACITY_EXHAUSTED');
      throw new IngestionError(503, 'STAGING_TRANSACTION_FAILED');
    }
  }

  private async stage(tx: TransactionSql, job: any, create: boolean) {
    if (create) await tx`insert into local_recording_staging.recordings(source_job_id) values(${job.id}) on conflict(source_job_id) do nothing`;
    const [stage] = await tx`select * from local_recording_staging.recordings where source_job_id=${job.id} for update`;
    if (stage && ['recording_id', 'owner_user_id', 'meeting_id', 'occurrence_id', 'mime_type', 'sha256'].some(key => stage[key] !== job[key]))
      throw new IngestionError(409, 'RECORDING_METADATA_CHANGED');
    if (stage && Number(stage.byte_length) !== Number(job.byte_length)) throw new IngestionError(409, 'RECORDING_METADATA_CHANGED');
    return stage;
  }
  private async progress(tx: TransactionSql, job: any, stage: any) {
    const [count] = stage ? await tx`select coalesce(sum(byte_length),0) as accepted from local_recording_staging.chunks where staging_id=${stage.id}` : [{ accepted: 0 }];
    const [verified] = stage ? await tx`select verified_at from local_recording_staging.verifications where staging_id=${stage.id}` : [];
    return { jobId: job.id as string, recordingId: job.recording_id as string, mimeType: job.mime_type as string,
      byteLength: Number(job.byte_length), ingestionOffset: Number(count.accepted),
      ingestionState: verified ? 'verified' as const : 'unverified' as const, verifiedAt: verified?.verified_at ?? null };
  }
  async status(binding: RecordingBinding) {
    return this.transaction(binding, async (tx, job) => this.progress(tx, job, await this.stage(tx, job, false)));
  }
  async ingest(binding: RecordingBinding, contentRange: string, bytes: Buffer) {
    return this.transaction(binding, async (tx, job) => {
      const stage = await this.stage(tx, job, true);
      const progress = await this.progress(tx, job, stage);
      const start = Number(/^bytes (\d+)-/.exec(contentRange)?.[1]);
      let range;
      try {
        // Earlier offsets are allowed ONLY after an exact persisted chunk comparison below.
        range = validateRecordingChunkRange(contentRange, Number(job.byte_length), start);
        if (start % DRIVE_CHUNK_ALIGNMENT !== 0 || bytes.length !== range.length) throw new Error();
      } catch { throw new IngestionError(400, 'INVALID_CHUNK_RANGE'); }
      if (start < progress.ingestionOffset) {
        const [existing] = await tx`select contents from local_recording_staging.chunks where staging_id=${stage.id} and byte_offset=${start}`;
        if (!existing || !bytes.equals(existing.contents)) throw new IngestionError(409, 'CONFLICTING_CHUNK');
        return progress;
      }
      if (progress.ingestionState === 'verified' || start !== progress.ingestionOffset) throw new IngestionError(409, 'INVALID_INGESTION_OFFSET');
      await tx`insert into local_recording_staging.chunks(staging_id,byte_offset,contents) values(${stage.id},${start},${bytes})`;
      return this.progress(tx, job, stage);
    });
  }
  async verify(binding: RecordingBinding) {
    return this.transaction(binding, async (tx, job) => {
      const stage = await this.stage(tx, job, false);
      const progress = await this.progress(tx, job, stage);
      if (!stage || progress.ingestionOffset !== Number(job.byte_length)) throw new IngestionError(409, 'RECORDING_INCOMPLETE');
      if (progress.ingestionState === 'verified') return progress;
      // Bounded keyset reads: at most one 8 MiB chunk, never the complete recording.
      async function* chunks() {
        let offset = 0;
        const deadline = Date.now() + 60000;
        while (offset < Number(job.byte_length)) {
          if (Date.now() > deadline) throw new IngestionError(503, 'VERIFICATION_TIMEOUT');
          const [chunk] = await tx`select byte_offset,byte_length,contents,sha256 from local_recording_staging.chunks
            where staging_id=${stage.id} and byte_offset >= ${offset} order by byte_offset limit 1`;
          if (!chunk || Number(chunk.byte_offset) !== offset || chunk.contents.length !== chunk.byte_length ||
            createHash('sha256').update(chunk.contents).digest('hex') !== chunk.sha256) throw new IngestionError(422, 'RECORDING_INTEGRITY_FAILED');
          offset += chunk.byte_length;
          yield chunk.contents as Buffer;
        }
      }
      try { await verifyCanonicalRecordingBytes(chunks(), Number(job.byte_length), job.sha256); }
      catch (error) { if (error instanceof IngestionError) throw error; throw new IngestionError(422, 'RECORDING_INTEGRITY_FAILED'); }
      await tx`insert into local_recording_staging.verifications(staging_id,byte_length,sha256) values(${stage.id},${job.byte_length},${job.sha256})`;
      return this.progress(tx, job, stage);
    });
  }
}
