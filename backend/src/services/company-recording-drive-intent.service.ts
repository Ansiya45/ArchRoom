import { randomUUID } from 'node:crypto';
import type { Sql, TransactionSql } from 'postgres';
import { sealCompanyRecordingSession, unsealCompanyRecordingSession, type CompanyRecordingSessionBinding } from './company-recording-session-crypto.js';
import { requireLocalStaging, type StagingConfig } from './local-recording-ingestion.service.js';
import { CompanyRecordingResumableTransport, CompanyRecordingSessionStartError } from './company-recording-resumable-transport.js';

export type CompanyDriveAccess = { accountEmail: string; credentialGeneration: string; accessToken: string };
export type CompanyRecordingPreparationCode =
  'PREPARE_JOB_UNAVAILABLE' | 'PREPARE_DESTINATION_BLOCKED' |
  'PREPARE_DESTINATION_UNVERIFIABLE' | 'PREPARE_DESTINATION_CHANGED' |
  'PREPARE_CREDENTIAL_UNAVAILABLE' | 'PREPARE_DRIVE_ID_ALLOCATION_FAILED' |
  'PREPARE_CREDENTIAL_CHANGED' | 'PREPARE_INTENT_PERSIST_FAILED';
export class CompanyRecordingPreparationError extends Error {
  constructor(readonly code: CompanyRecordingPreparationCode) {
    super('Company recording upload preparation failed.');
    this.name = 'CompanyRecordingPreparationError';
  }
}
async function preparationStep<T>(code: CompanyRecordingPreparationCode, action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) {
    if (error instanceof CompanyRecordingPreparationError) throw error;
    throw new CompanyRecordingPreparationError(code);
  }
}
type Privacy = (jobId: string, ownerId: string) => Promise<{ status: string; destinationId?: string }>;
type Authorize = (jobId: string, ownerId: string) => Promise<unknown>;
const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fileId = /^[A-Za-z0-9_-]{10,128}$/;
const refuse = () => { throw new Error('Company recording transfer is unavailable.'); };

// No router or background worker constructs this service. Its methods are
// testable preparation steps; they do not transfer any media or complete a job.
export class CompanyRecordingDriveIntentService {
  constructor(private readonly sql: Sql, private readonly config: StagingConfig,
    private readonly authorize: Authorize, private readonly privacy: Privacy,
    private readonly access: () => Promise<CompanyDriveAccess>,
    private readonly transport: CompanyRecordingResumableTransport,
    private readonly encryptionKey: Buffer) {}

  private enabled() { requireLocalStaging(this.config); if (this.encryptionKey.length !== 32) refuse(); }
  private async authenticated(jobId: string, ownerId: string) {
    this.enabled();
    if (!id.test(jobId) || !id.test(ownerId)) refuse();
    await this.authorize(jobId, ownerId);
  }
  private async withJob<T>(jobId: string, ownerId: string, action: (tx: TransactionSql, job: any, stage: any) => Promise<T>): Promise<T> {
    await this.authenticated(jobId, ownerId);
    return this.sql.begin(async tx => {
      await tx`set local lock_timeout='5s'`;
      await tx`set local statement_timeout='15s'`;
      await tx`set local ylaam.local_staging_test='enabled'`;
      await tx`select local_recording_staging.require_disposable_test()`;
      const [job] = await tx`select * from company_recording_upload_jobs where id=${jobId} and owner_user_id=${ownerId} for update`;
      if (!job || job.state !== 'pending' || Number(job.byte_length) > 134217728) refuse();
      const [stage] = await tx`select r.* from local_recording_staging.recordings r
        join local_recording_staging.verifications v on v.staging_id=r.id
        where r.source_job_id=${jobId} and r.recording_id=${job.recording_id} and r.owner_user_id=${ownerId}
          and r.meeting_id=${job.meeting_id} and r.occurrence_id is not distinct from ${job.occurrence_id}::uuid
          and r.mime_type=${job.mime_type} and r.byte_length=${job.byte_length} and r.sha256=${job.sha256}
          and v.byte_length=r.byte_length and v.sha256=r.sha256 for share of r`;
      if (!stage) refuse();
      return action(tx, job, stage);
    }) as Promise<T>;
  }
  private binding(job: any, intent: any): CompanyRecordingSessionBinding {
    return { jobId: job.id, recordingId: job.recording_id, ownerUserId: job.owner_user_id,
      driveFileId: intent.drive_file_id, companyAccountEmail: intent.company_account_email,
      credentialGeneration: intent.credential_generation };
  }
  private async current(intent: any): Promise<CompanyDriveAccess> {
    const access = await this.access();
    if (access.accountEmail.toLowerCase() !== intent.company_account_email.toLowerCase() ||
        access.credentialGeneration !== intent.credential_generation || !access.accessToken) refuse();
    return access;
  }
  private async safeDestination(job: any, ownerId: string) {
    const result = await this.privacy(job.id, ownerId);
    if (result.status === 'BLOCKED') throw new CompanyRecordingPreparationError('PREPARE_DESTINATION_BLOCKED');
    if (result.status !== 'SAFE') throw new CompanyRecordingPreparationError('PREPARE_DESTINATION_UNVERIFIABLE');
    if (result.destinationId !== job.destination_folder_id) throw new CompanyRecordingPreparationError('PREPARE_DESTINATION_CHANGED');
  }

  // Persist a single pre-generated ID. Allocating an ID never creates a file.
  // An existing intent is never replaced after a retry or an account switch.
  async reserve(jobId: string, ownerId: string) {
    await preparationStep('PREPARE_JOB_UNAVAILABLE', () => this.withJob(jobId, ownerId, async tx => {
      const [old] = await tx`select job_id from company_recording_transfer_intents where job_id=${jobId}`;
      if (old) return;
    }));
    // This check is point-in-time; beginSession repeats it before file creation.
    const job = await preparationStep('PREPARE_JOB_UNAVAILABLE', async () => {
      const [found] = await this.sql`select id,destination_folder_id from company_recording_upload_jobs where id=${jobId} and owner_user_id=${ownerId}`;
      if (!found) refuse();
      return found;
    });
    await preparationStep('PREPARE_DESTINATION_UNVERIFIABLE', () => this.safeDestination(job, ownerId));
    const getAccess = () => preparationStep('PREPARE_CREDENTIAL_UNAVAILABLE', async () => {
      const value = await this.access();
      if (!value?.accountEmail || !value.credentialGeneration || !value.accessToken) refuse();
      return value;
    });
    const access = await getAccess();
    const allocated = await preparationStep('PREPARE_DRIVE_ID_ALLOCATION_FAILED', async () => {
      const value = await this.transport.allocateFileId(access.accessToken);
      if (!fileId.test(value)) refuse();
      return value;
    });
    // Credential changes between allocation and reservation fail closed.
    const latest = await getAccess();
    if (latest.credentialGeneration !== access.credentialGeneration || latest.accountEmail !== access.accountEmail)
      throw new CompanyRecordingPreparationError('PREPARE_CREDENTIAL_CHANGED');
    return preparationStep('PREPARE_INTENT_PERSIST_FAILED', () => this.withJob(jobId, ownerId, async (tx, job) => {
      const [existing] = await tx`select * from company_recording_transfer_intents where job_id=${jobId}`;
      if (existing) {
        if (existing.owner_user_id !== ownerId || existing.recording_id !== job.recording_id ||
          existing.company_account_email !== access.accountEmail || existing.credential_generation !== access.credentialGeneration ||
          existing.destination_folder_id !== job.destination_folder_id) refuse();
        return { driveFileId: existing.drive_file_id as string, sessionReady: !!existing.encrypted_session };
      }
      const [created] = await tx`insert into company_recording_transfer_intents
        (job_id,recording_id,owner_user_id,drive_file_id,company_account_email,credential_generation,destination_folder_id)
        values (${jobId},${job.recording_id},${ownerId},${allocated},${access.accountEmail},${access.credentialGeneration},${job.destination_folder_id}) returning drive_file_id`;
      return { driveFileId: created.drive_file_id as string, sessionReady: false };
    }));
  }

  // The durable attempted bit is committed BEFORE the external request. A lost
  // response or failed DB write leaves an uncertain state that blocks new sessions.
  async beginSession(jobId: string, ownerId: string) {
    const [job] = await this.sql`select id,destination_folder_id from company_recording_upload_jobs where id=${jobId} and owner_user_id=${ownerId}`;
    if (!job) refuse();
    await this.withJob(jobId, ownerId, async (tx, currentJob) => {
      const [intent] = await tx`select * from company_recording_transfer_intents where job_id=${jobId}`;
      if (!intent || intent.encrypted_session || intent.session_creation_attempted || intent.destination_folder_id !== currentJob.destination_folder_id) refuse();
    });
    const [intent] = await this.sql`select * from company_recording_transfer_intents where job_id=${jobId}`;
    if (!intent) refuse();
    await this.current(intent);
    // The final authorization and privacy gate run immediately before claiming
    // the unique attempt, which is the last step before provider creation.
    await this.authenticated(jobId, ownerId);
    await this.safeDestination(job, ownerId);
    const access = await this.current(intent);
    const leaseToken = randomUUID();
    const claim = await this.withJob(jobId, ownerId, async (tx, currentJob) => {
      const [row] = await tx`update company_recording_transfer_intents
        set session_creation_attempted=true, lease_token=${leaseToken}, lease_epoch=lease_epoch+1,
          lease_until=clock_timestamp()+interval '90 seconds', updated_at=now()
        where job_id=${jobId} and recording_id=${currentJob.recording_id} and owner_user_id=${ownerId}
          and destination_folder_id=${currentJob.destination_folder_id} and credential_generation=${access.credentialGeneration}
          and company_account_email=${access.accountEmail} and not session_creation_attempted and encrypted_session is null
          and (lease_token is null or lease_until<clock_timestamp())
        returning *`;
      if (!row) refuse();
      return { job: currentJob, intent: row };
    });
    let stage = 'destination_recheck';
    let providerRequestStarted = false;
    try {
      // Repeat both checks after the durable claim, directly before the provider
      // request. A changed account or unsafe destination prevents the request.
      await this.safeDestination(claim.job, ownerId);
      stage = 'credential_recheck';
      const finalAccess = await this.current(claim.intent);
      stage = 'drive_session_request';
      providerRequestStarted = true;
      const session = await this.transport.beginSession(finalAccess.accessToken, {
        fileId: claim.intent.drive_file_id, folderId: claim.intent.destination_folder_id,
        mimeType: claim.job.mime_type, byteLength: Number(claim.job.byte_length),
        name: claim.job.recording_filename ?? `recording-${claim.job.recording_id}.${claim.job.mime_type === 'video/mp4' ? 'mp4' : 'webm'}`,
      });
      stage = 'session_encryption';
      const envelope = sealCompanyRecordingSession(session, this.binding(claim.job, claim.intent), this.encryptionKey);
      stage = 'session_persist';
      await this.withJob(jobId, ownerId, async tx => {
        const [saved] = await tx`update company_recording_transfer_intents set encrypted_session=${envelope}, updated_at=now()
          where job_id=${jobId} and recording_id=${claim.job.recording_id} and owner_user_id=${ownerId}
            and credential_generation=${access.credentialGeneration} and company_account_email=${access.accountEmail}
            and lease_token=${leaseToken} and lease_epoch=${claim.intent.lease_epoch} and lease_until>clock_timestamp()
            and session_creation_attempted and encrypted_session is null returning job_id`;
        if (!saved) refuse();
      });
      return { driveFileId: claim.intent.drive_file_id as string, sessionReady: true };
    } catch (error) {
      let failure = error;
      if (!providerRequestStarted) {
        // No provider call was made. Rearm only this fenced attempt so a
        // transient destination or credential preflight can be retried safely.
        // Once the call starts, its outcome may be ambiguous and stays blocked.
        try {
          const [rearmed] = await this.sql`update company_recording_transfer_intents
            set session_creation_attempted=false, updated_at=now()
            where job_id=${jobId} and recording_id=${claim.job.recording_id} and owner_user_id=${ownerId}
              and lease_token=${leaseToken} and lease_epoch=${claim.intent.lease_epoch}
              and lease_until>clock_timestamp() and session_creation_attempted
              and encrypted_session is null returning job_id`;
          if (!rearmed) refuse();
        } catch {
          stage = 'pre_request_rearm';
          failure = new CompanyRecordingPreparationError('PREPARE_INTENT_PERSIST_FAILED');
        }
      }
      console.warn('Company recording session preparation failed', {
        stage,
        kind: stage === 'pre_request_rearm' ? 'persistence_failure'
          : failure instanceof CompanyRecordingSessionStartError ? failure.kind
          : failure instanceof CompanyRecordingPreparationError ? 'preparation_rejected'
          : stage === 'session_persist' ? 'persistence_failure' : 'unexpected_failure',
        ...(failure instanceof CompanyRecordingSessionStartError && failure.httpStatus !== undefined
          ? { httpStatus: failure.httpStatus } : {}),
        ...(failure instanceof CompanyRecordingSessionStartError && failure.sessionDiagnostic
          ? failure.sessionDiagnostic : {}),
      });
      throw failure;
    } finally {
      try {
        await this.sql`update company_recording_transfer_intents set lease_token=null,lease_until=null,updated_at=now()
          where job_id=${jobId} and lease_token=${leaseToken} and lease_epoch=${claim.intent.lease_epoch}`;
      } catch (error) {
        console.warn('Company recording session preparation failed', { stage: 'lease_release', kind: 'persistence_failure' });
        throw error;
      }
    }
  }

  // Backend-only access for a future fenced uploader. This does not send media.
  async recoverSession(jobId: string, ownerId: string) {
    return this.withJob(jobId, ownerId, async (tx, job) => {
      const [intent] = await tx`select * from company_recording_transfer_intents where job_id=${jobId}`;
      if (!intent || !intent.encrypted_session || intent.recording_id !== job.recording_id || intent.owner_user_id !== ownerId) refuse();
      const access = await this.current(intent);
      return { sessionUrl: unsealCompanyRecordingSession(intent.encrypted_session, this.binding(job, intent), this.encryptionKey),
        driveFileId: intent.drive_file_id as string, accessToken: access.accessToken, total: Number(job.byte_length) };
    });
  }
  async readVerifiedChunk(jobId: string, ownerId: string, offset: number) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset % 262144 !== 0) refuse();
    return this.withJob(jobId, ownerId, async (tx, job, stage) => {
      const [chunk] = await tx`select byte_offset,byte_length,contents,sha256 from local_recording_staging.chunks
        where staging_id=${stage.id} and byte_offset=${offset}`;
      if (!chunk || chunk.contents.length !== chunk.byte_length || offset + chunk.byte_length > Number(job.byte_length)) refuse();
      const { createHash } = await import('node:crypto');
      if (createHash('sha256').update(chunk.contents).digest('hex') !== chunk.sha256) refuse();
      return chunk.contents as Buffer;
    });
  }
}
