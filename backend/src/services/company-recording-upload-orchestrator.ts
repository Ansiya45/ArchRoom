import type { Sql } from 'postgres';
import { requireLocalStaging, type StagingConfig, LocalRecordingIngestion } from './local-recording-ingestion.service.js';
import { CompanyRecordingJobsService } from './company-recording-jobs.service.js';
import { CompanyRecordingDriveIntentService, CompanyRecordingPreparationError, type CompanyRecordingPreparationCode } from './company-recording-drive-intent.service.js';
import { CompanyRecordingTransferWorker } from './company-recording-transfer-worker.js';
import { CompanyRecordingDriveVerificationService } from './company-recording-drive-verification.service.js';
import { CompanyRecordingHistoryPublicationService } from './company-recording-history-publication.service.js';
import { TRPCError } from '@trpc/server';

type ProgressStage='waiting_for_ingestion'|'ingesting'|'verifying_canonical_bytes'|'preparing_drive_upload'|'uploading_to_drive'|'awaiting_drive_verification'|'publishing_history'|'completed'|'retryable_failure'|'manual_reconciliation';
type PipelineResult={state:string;offset?:number};
const safeError='COMPANY_UPLOAD_RETRYABLE' as const;

// Durable work is inferred from the existing immutable staging attestation,
// intent, confirmed Drive offset, verification and job records. No second queue.
export class CompanyRecordingUploadOrchestrator {
  private active=new Set<string>();
  private timer:NodeJS.Timeout|undefined;
  constructor(private readonly sql:Sql,private readonly config:StagingConfig,private readonly jobs:CompanyRecordingJobsService,
    private readonly intent:CompanyRecordingDriveIntentService,private readonly transfer:CompanyRecordingTransferWorker,
    private readonly verification:CompanyRecordingDriveVerificationService,private readonly publication:CompanyRecordingHistoryPublicationService,
    private readonly ingestion:LocalRecordingIngestion) {}

  private enabled(){requireLocalStaging(this.config);}
  async status(jobId:string,ownerId:string){
    this.enabled();const job=await this.jobs.status(jobId,ownerId);
    const [state]=await this.sql`select j.state,j.error_code,j.byte_length,j.recording_id,i.transfer_state,i.drive_confirmed_offset,i.session_creation_attempted,i.encrypted_session,
      (i.lease_token is not null and i.lease_until>clock_timestamp()) as lease_active,
      r.id as stage_id,coalesce((select sum(c.byte_length) from local_recording_staging.chunks c where c.staging_id=r.id),0) as staged_bytes,
      v.verified_at as staged_verified,dv.outcome as drive_verification
      from company_recording_upload_jobs j left join company_recording_transfer_intents i on i.job_id=j.id
      left join local_recording_staging.recordings r on r.source_job_id=j.id and r.recording_id=j.recording_id
      left join local_recording_staging.verifications v on v.staging_id=r.id
      left join company_recording_drive_verifications dv on dv.job_id=j.id where j.id=${jobId} and j.owner_user_id=${ownerId}`;
    if(!state)return {jobId,recordingId:job.recordingId,stage:'waiting_for_ingestion' as ProgressStage,stagedBytes:0,expectedBytes:job.byteLength,driveConfirmedBytes:0,errorCode:null};
    const staged=Number(state.staged_bytes),expected=Number(state.byte_length),drive=Number(state.drive_confirmed_offset??0);
    let stage:ProgressStage;
    if(state.state==='completed')stage='completed';
    else if(state.state==='retryable')stage='retryable_failure';
    else if(state.state==='failed')stage='manual_reconciliation';
    else if(!state.staged_verified)stage=staged===0?'waiting_for_ingestion':staged<expected?'ingesting':'verifying_canonical_bytes';
    else if(state.drive_verification==='blocked')stage='manual_reconciliation';
    else if(state.drive_verification==='inconclusive')stage=state.transfer_state==='awaiting_drive_verification'?'awaiting_drive_verification':'manual_reconciliation';
    else if(state.drive_verification==='verified')stage='publishing_history';
    else if(state.transfer_state==='awaiting_drive_verification')stage='awaiting_drive_verification';
    else if(state.session_creation_attempted&&!state.encrypted_session)stage=state.lease_active?'preparing_drive_upload':'manual_reconciliation';
    else if(state.encrypted_session)stage='uploading_to_drive';
    else stage='preparing_drive_upload';
    return {jobId,recordingId:state.recording_id,stage,stagedBytes:staged,expectedBytes:expected,driveConfirmedBytes:drive,errorCode:state.error_code??null};
  }

  async request(jobId:string,ownerId:string){
    this.enabled();await this.jobs.status(jobId,ownerId);const progress=await this.status(jobId,ownerId);
    if(progress.stage==='completed')return progress;
    if(progress.stage==='manual_reconciliation')return progress;
    if(progress.stage==='waiting_for_ingestion'||progress.stage==='ingesting'||(progress.stage==='verifying_canonical_bytes'&&progress.stagedBytes<progress.expectedBytes))return progress;
    this.schedule(jobId,ownerId);return {...progress,accepted:true};
  }
  async retry(jobId:string,ownerId:string){
    this.enabled();await this.jobs.status(jobId,ownerId);
    const [job]=await this.sql`select state from company_recording_upload_jobs where id=${jobId} and owner_user_id=${ownerId}`;
    if(!job||job.state!=='retryable')throw new TRPCError({code:'CONFLICT',message:'This upload is not eligible for retry.'});
    const [unsafe]=await this.sql`select 1 from company_recording_transfer_intents where job_id=${jobId} and session_creation_attempted and encrypted_session is null`;
    if(unsafe)throw new TRPCError({code:'PRECONDITION_FAILED',message:'This upload requires manual reconciliation.'});
    const [updated]=await this.sql`update company_recording_upload_jobs set state='pending',error_code=null,retry_count=retry_count+1,updated_at=now() where id=${jobId} and owner_user_id=${ownerId} and state='retryable' returning id`;
    if(!updated)throw new TRPCError({code:'CONFLICT',message:'This upload is not eligible for retry.'});
    this.schedule(jobId,ownerId);return {...await this.status(jobId,ownerId),accepted:true};
  }

  schedule(jobId:string,ownerId:string){
    const key=`${jobId}:${ownerId}`;if(this.active.has(key))return;
    this.active.add(key);void this.process(jobId,ownerId).catch(async error=>{
      const reason=error instanceof CompanyRecordingPreparationError?error.code:safeError;
      if(error instanceof CompanyRecordingPreparationError)
        console.warn('Company recording upload preparation failed', {jobId,reasonCode:reason});
      await this.markRetryable(jobId,reason).catch(()=>undefined);
    }).finally(()=>this.active.delete(key));
  }
  private async markRetryable(jobId:string,reasonCode:CompanyRecordingPreparationCode|typeof safeError=safeError){
    await this.sql`update company_recording_upload_jobs j set state='retryable',error_code=${reasonCode},updated_at=now()
      where j.id=${jobId} and j.state='pending' and not exists(select 1 from company_recording_transfer_intents i where i.job_id=j.id and i.session_creation_attempted and i.encrypted_session is null)`;
    await this.sql`update company_recording_upload_jobs j set state='failed',error_code='DRIVE_RECONCILIATION_REQUIRED',updated_at=now()
      where j.id=${jobId} and j.state='pending' and exists(select 1 from company_recording_transfer_intents i where i.job_id=j.id and i.session_creation_attempted and i.encrypted_session is null
        and (i.lease_token is null or i.lease_until<=clock_timestamp()))`;
  }
  private async markManual(jobId:string,code:string){
    const allowed=new Set(['DRIVE_RECONCILIATION_REQUIRED','DRIVE_VERIFICATION_BLOCKED','DRIVE_VERIFICATION_INCONCLUSIVE','PUBLICATION_REQUIRES_REVIEW']);
    await this.sql`update company_recording_upload_jobs set state='failed',error_code=${allowed.has(code)?code:'PUBLICATION_REQUIRES_REVIEW'},updated_at=now() where id=${jobId} and state='pending'`;
  }
  async process(jobId:string,ownerId:string):Promise<PipelineResult>{
    this.enabled();await this.jobs.status(jobId,ownerId);
    const [stage]=await this.sql`select r.id,j.recording_id,j.byte_length,coalesce((select sum(c.byte_length) from local_recording_staging.chunks c where c.staging_id=r.id),0) as accepted,v.staging_id as verified
      from local_recording_staging.recordings r join company_recording_upload_jobs j on j.id=r.source_job_id left join local_recording_staging.verifications v on v.staging_id=r.id
      where j.id=${jobId} and j.owner_user_id=${ownerId} and r.recording_id=j.recording_id and r.owner_user_id=${ownerId} and r.meeting_id=j.meeting_id and r.occurrence_id is not distinct from j.occurrence_id and r.mime_type=j.mime_type and r.byte_length=j.byte_length and r.sha256=j.sha256`;
    if(!stage)return {state:'waiting_for_ingestion'};
    if(!stage.verified){if(Number(stage.accepted)!==Number(stage.byte_length))return {state:'ingesting',offset:Number(stage.accepted)};
      await this.ingestion.verify({jobId,recordingId:stage.recording_id,userId:ownerId});}
    let progress=await this.status(jobId,ownerId);
    if(progress.stage==='completed')return {state:'completed'};
    const [intent]=await this.sql`select session_creation_attempted,encrypted_session,transfer_state from company_recording_transfer_intents where job_id=${jobId}`;
    if(!intent){await this.intent.reserve(jobId,ownerId);}
    const [current]=await this.sql`select session_creation_attempted,encrypted_session,transfer_state,
      (lease_token is not null and lease_until>clock_timestamp()) as lease_active from company_recording_transfer_intents where job_id=${jobId}`;
    // A transfer that reached the verification boundary needs no session or
    // media request. This also resumes a persisted successful verification.
    if(current?.transfer_state!=='awaiting_drive_verification'){
      if(current?.session_creation_attempted&&!current.encrypted_session){
        if(current.lease_active)return {state:'busy'};
        await this.markManual(jobId,'DRIVE_RECONCILIATION_REQUIRED');return {state:'reconciliation_required'};
      }
      if(!current?.encrypted_session)await this.intent.beginSession(jobId,ownerId);
      for(let count=0;count<20;count++){
        const result=await this.transfer.step(jobId,ownerId);
        if(result.state==='busy')return result;
        if(result.state==='reconciliation_required'){await this.markManual(jobId,'DRIVE_RECONCILIATION_REQUIRED');return result;}
        if(result.state==='retryable'){await this.markRetryable(jobId);return result;}
        if(result.state==='awaiting_drive_verification')break;
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
    progress=await this.status(jobId,ownerId);
    if(progress.stage!=='awaiting_drive_verification'&&progress.stage!=='publishing_history')return {state:progress.stage,offset:progress.driveConfirmedBytes};
    // Reuse the durable independent verification after a restart.
    let verified=progress.stage==='publishing_history' ? {state:'verified' as const} : await this.verification.verify(jobId,ownerId);
    // Inspection may initially be inconclusive after a completed transfer.
    // Repeat only fenced verification with Drive reads; never create a session
    // or file. Persist manual reconciliation if the outcome remains uncertain.
    for(let attempt=1;verified.state==='inconclusive'&&attempt<3;attempt++){
      await new Promise(resolve=>setTimeout(resolve,2000));
      verified=await this.verification.verify(jobId,ownerId);
    }
    if(verified.state==='busy')return verified;
    if(verified.state!=='verified'){
      await this.markManual(jobId,verified.state==='blocked'?'DRIVE_VERIFICATION_BLOCKED':'DRIVE_VERIFICATION_INCONCLUSIVE');
      return verified;
    }
    try { return await this.publication.publish(jobId,ownerId); }
    catch { await this.markManual(jobId,'PUBLICATION_REQUIRES_REVIEW');return {state:'reconciliation_required'}; }
  }

  startPolling(intervalMs=5000){
    this.enabled();if(this.timer)return;
    const scan=async()=>{
      const jobs=await this.sql`select distinct j.id,j.owner_user_id,j.state from company_recording_upload_jobs j
        join local_recording_staging.recordings r on r.source_job_id=j.id and r.recording_id=j.recording_id
        where j.state='pending' and not exists(select 1 from company_recording_drive_verifications d where d.job_id=j.id and d.outcome='blocked')
          and (exists(select 1 from local_recording_staging.verifications v where v.staging_id=r.id)
          or (select coalesce(sum(c.byte_length),0) from local_recording_staging.chunks c where c.staging_id=r.id)=j.byte_length)
        order by j.id limit 100`;
      for(const row of jobs)this.schedule(row.id,row.owner_user_id);
    };
    this.timer=setInterval(()=>{void scan().catch(()=>undefined);},intervalMs);this.timer.unref();void scan().catch(()=>undefined);
  }
  stopPolling(){if(this.timer)clearInterval(this.timer);this.timer=undefined;}
}
