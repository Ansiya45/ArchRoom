import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import { requireLocalStaging, type StagingConfig } from './local-recording-ingestion.service.js';
import { CompanyRecordingDriveIntentService, type CompanyDriveAccess } from './company-recording-drive-intent.service.js';
import { CompanyRecordingResumableTransport } from './company-recording-resumable-transport.js';

type Authorize = (jobId: string, ownerId: string) => Promise<unknown>;
type Privacy = (jobId: string, ownerId: string) => Promise<{ status: string; destinationId?: string }>;
type StepResult = { state: 'busy' | 'progress' | 'retryable' | 'reconciliation_required' | 'awaiting_drive_verification'; offset: number };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reject = () => { throw new Error('Company recording transfer is unavailable.'); };

// Manually invoked one-chunk backend worker. No router, timer or startup path
// constructs it; both feature flags and the disposable DB guard remain required.
export class CompanyRecordingTransferWorker {
  constructor(private readonly sql: Sql, private readonly config: StagingConfig,
    private readonly authorize: Authorize, private readonly privacy: Privacy,
    private readonly access: () => Promise<CompanyDriveAccess>,
    private readonly intentService: CompanyRecordingDriveIntentService,
    private readonly transport: CompanyRecordingResumableTransport) {}

  private async claim(jobId: string, ownerId: string) {
    const token = randomUUID();
    return this.sql.begin(async tx => {
      await tx`set local lock_timeout='5s'`;
      await tx`set local statement_timeout='15s'`;
      await tx`set local ylaam.local_staging_test='enabled'`;
      await tx`select local_recording_staging.require_disposable_test()`;
      const [job] = await tx`select * from company_recording_upload_jobs where id=${jobId} and owner_user_id=${ownerId} for update`;
      if (!job || job.state !== 'pending' || Number(job.byte_length) > 134217728) reject();
      const [verified] = await tx`select r.id from local_recording_staging.recordings r
        join local_recording_staging.verifications v on v.staging_id=r.id
        where r.source_job_id=${jobId} and r.recording_id=${job.recording_id} and r.owner_user_id=${ownerId}
          and r.meeting_id=${job.meeting_id} and r.occurrence_id is not distinct from ${job.occurrence_id}::uuid
          and r.mime_type=${job.mime_type} and r.byte_length=${job.byte_length} and r.sha256=${job.sha256}
          and v.byte_length=r.byte_length and v.sha256=r.sha256 for share of r`;
      if (!verified) reject();
      const [intent] = await tx`select job_id from company_recording_transfer_intents where job_id=${jobId}`;
      if (!intent) reject();
      const [row] = await tx`update company_recording_transfer_intents
        set lease_token=${token},lease_epoch=lease_epoch+1,lease_until=now()+interval '90 seconds',updated_at=now()
        where job_id=${jobId} and owner_user_id=${ownerId} and recording_id=${job.recording_id}
          and destination_folder_id=${job.destination_folder_id}
          and (lease_token is null or lease_until < now())
          and transfer_state <> 'awaiting_drive_verification' returning *`;
      if (!row) return null;
      if (Number(row.drive_confirmed_offset) > Number(job.byte_length)) reject();
      return { token, epoch: Number(row.lease_epoch), intent: row, job };
    });
  }
  private async update(jobId: string, token: string, epoch: number, state: string, offset: number) {
    const [row] = await this.sql`update company_recording_transfer_intents
      set transfer_state=${state},drive_confirmed_offset=${offset},updated_at=now()
      where job_id=${jobId} and lease_token=${token} and lease_epoch=${epoch}
        and lease_until > now() and drive_confirmed_offset <= ${offset}
      returning job_id`;
    if (!row) reject();
  }
  private async release(jobId: string, token: string, epoch: number) {
    await this.sql`update company_recording_transfer_intents set lease_token=null,lease_until=null,updated_at=now()
      where job_id=${jobId} and lease_token=${token} and lease_epoch=${epoch}`;
  }
  private async accessFor(intent: any) {
    const current = await this.access();
    if (!current.accessToken || current.credentialGeneration !== intent.credential_generation ||
      current.accountEmail.toLowerCase() !== intent.company_account_email.toLowerCase()) reject();
    return current;
  }
  private async privacyFor(jobId: string, ownerId: string, destination: string) {
    const result = await this.privacy(jobId, ownerId);
    if (result.status !== 'SAFE' || result.destinationId !== destination) reject();
  }
  private validOffset(offset: number, total: number) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > total || (offset !== total && offset % 262144 !== 0)) reject();
  }
  private async identifyFile(jobId: string, claim: NonNullable<Awaited<ReturnType<CompanyRecordingTransferWorker['claim']>>>, token: string): Promise<StepResult> {
    const outcome = await this.transport.lookupFile(token, claim.intent.drive_file_id);
    if (outcome === 'present') {
      await this.update(jobId, claim.token, claim.epoch, 'awaiting_drive_verification', Number(claim.job.byte_length));
      return { state: 'awaiting_drive_verification', offset: Number(claim.job.byte_length) };
    }
    await this.update(jobId, claim.token, claim.epoch, 'reconcile_required', Number(claim.intent.drive_confirmed_offset));
    return { state: 'reconciliation_required', offset: Number(claim.intent.drive_confirmed_offset) };
  }

  async step(jobId: string, ownerId: string): Promise<StepResult> {
    requireLocalStaging(this.config);
    if (!uuid.test(jobId) || !uuid.test(ownerId)) reject();
    await this.authorize(jobId, ownerId);
    const claim = await this.claim(jobId, ownerId);
    if (!claim) return { state: 'busy', offset: 0 };
    try {
      await this.authorize(jobId, ownerId);
      await this.privacyFor(jobId, ownerId, claim.intent.destination_folder_id);
      let access = await this.accessFor(claim.intent);
      if (!claim.intent.encrypted_session) return await this.identifyFile(jobId, claim, access.accessToken);
      const recovered = await this.intentService.recoverSession(jobId, ownerId);
      if (recovered.driveFileId !== claim.intent.drive_file_id || recovered.total !== Number(claim.job.byte_length)) reject();
      const reported = await this.transport.queryOffset(access.accessToken, recovered.sessionUrl, recovered.total, recovered.driveFileId);
      if (reported.state === 'complete_unverified' || reported.state === 'session_expired')
        return await this.identifyFile(jobId, claim, access.accessToken);
      if (reported.state === 'failed') return await this.identifyFile(jobId, claim, access.accessToken);
      if (reported.state === 'retryable') {
        await this.update(jobId, claim.token, claim.epoch, 'reconcile_required', Number(claim.intent.drive_confirmed_offset));
        return { state: 'retryable', offset: Number(claim.intent.drive_confirmed_offset) };
      }
      const offset = reported.confirmedOffset;
      this.validOffset(offset, recovered.total);
      if (offset < Number(claim.intent.drive_confirmed_offset)) reject();
      await this.update(jobId, claim.token, claim.epoch, 'ready', offset);
      if (offset === recovered.total) return await this.identifyFile(jobId, claim, access.accessToken);
      const bytes = await this.intentService.readVerifiedChunk(jobId, ownerId, offset);
      if (bytes.length > 8 * 1024 * 1024 || (offset + bytes.length < recovered.total && bytes.length % 262144 !== 0)) reject();
      // The read may take time; recheck both company identity and destination
      // immediately before the only media request in this invocation.
      await this.privacyFor(jobId, ownerId, claim.intent.destination_folder_id);
      access = await this.accessFor(claim.intent);
      const sent = await this.transport.sendChunk(access.accessToken, recovered.sessionUrl, bytes, offset, recovered.total, recovered.driveFileId);
      if (sent.state === 'complete_unverified') return await this.identifyFile(jobId, claim, access.accessToken);
      if (sent.state === 'session_expired') return await this.identifyFile(jobId, claim, access.accessToken);
      if (sent.state !== 'incomplete') {
        await this.update(jobId, claim.token, claim.epoch, 'reconcile_required', offset);
        return { state: 'retryable', offset };
      }
      this.validOffset(sent.confirmedOffset, recovered.total);
      if (sent.confirmedOffset < offset || sent.confirmedOffset > offset + bytes.length) reject();
      await this.update(jobId, claim.token, claim.epoch, 'ready', sent.confirmedOffset);
      return { state: 'progress', offset: sent.confirmedOffset };
    } catch (error) {
      // Any uncertain provider or database outcome must be reconciled before a
      // new request. A failed fenced update cannot overwrite a successor.
      await this.sql`update company_recording_transfer_intents set transfer_state='reconcile_required',updated_at=now()
        where job_id=${jobId} and lease_token=${claim.token} and lease_epoch=${claim.epoch} and lease_until > now()`;
      throw error;
    } finally { await this.release(jobId, claim.token, claim.epoch); }
  }
}
