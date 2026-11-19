import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import { requireLocalStaging, type StagingConfig } from './local-recording-ingestion.service.js';
import { CompanyRecordingDriveFileInspector, type FileInspection } from './company-recording-drive-file-inspector.js';
import type { CompanyDriveAccess } from './company-recording-drive-intent.service.js';

type Authorize = (jobId: string, ownerId: string) => Promise<unknown>;
type Privacy = (jobId: string, ownerId: string) => Promise<{status:string; destinationId?:string}>;
const fail=()=>{throw new Error('Company recording verification is unavailable.');};
const id=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Manually invoked only. It never changes job completion, History, media or Drive.
export class CompanyRecordingDriveVerificationService {
  constructor(private readonly sql:Sql, private readonly config:StagingConfig, private readonly authorize:Authorize,
    private readonly privacy:Privacy, private readonly access:()=>Promise<CompanyDriveAccess>, private readonly inspector:CompanyRecordingDriveFileInspector) {}
  async verify(jobId:string,ownerId:string) {
    requireLocalStaging(this.config); if(!id.test(jobId)||!id.test(ownerId)) fail(); await this.authorize(jobId,ownerId);
    const token=randomUUID();
    const claim=await this.sql.begin(async tx=>{
      await tx`set local ylaam.local_staging_test='enabled'`;await tx`select local_recording_staging.require_disposable_test()`;
      const [row]=await tx`select j.*,i.drive_file_id,i.company_account_email,i.credential_generation,i.transfer_state,i.lease_epoch
        from company_recording_upload_jobs j join company_recording_transfer_intents i on i.job_id=j.id
        join local_recording_staging.recordings r on r.source_job_id=j.id and r.recording_id=j.recording_id
        join local_recording_staging.verifications v on v.staging_id=r.id
        where j.id=${jobId} and j.owner_user_id=${ownerId} and j.state='pending' and i.transfer_state='awaiting_drive_verification'
        and r.owner_user_id=${ownerId} and r.mime_type=j.mime_type and r.byte_length=j.byte_length and r.sha256=j.sha256 for update of j,i`;
      if(!row) fail();
      const [claimed]=await tx`update company_recording_transfer_intents set lease_token=${token},lease_epoch=lease_epoch+1,lease_until=now()+interval '90 seconds',updated_at=now()
        where job_id=${jobId} and (lease_token is null or lease_until<now()) and transfer_state='awaiting_drive_verification' returning *`;
      if(!claimed) return null; return {job:row,intent:claimed,epoch:Number(claimed.lease_epoch)};
    });
    if(!claim) return {state:'busy' as const};
    let result:FileInspection={status:'UNVERIFIABLE',reason:'Verification did not complete.'};
    let inspectionStage='destination';
    try {
      await this.authorize(jobId,ownerId); const privacy=await this.privacy(jobId,ownerId);
      if(privacy.status!=='SAFE'||privacy.destinationId!==claim.intent.destination_folder_id) result={status:'BLOCKED',reason:'Recording destination is not safe.'};
      else { inspectionStage='credential'; const access=await this.access();
        if(access.accountEmail.toLowerCase()!==claim.intent.company_account_email.toLowerCase()||access.credentialGeneration!==claim.intent.credential_generation) result={status:'UNVERIFIABLE',reason:'Company Drive connection changed.'};
        else { inspectionStage='drive_file'; result=await this.inspector.inspect(access.accessToken,{fileId:claim.intent.drive_file_id,destinationId:claim.intent.destination_folder_id,byteLength:Number(claim.job.byte_length),mimeType:claim.job.mime_type,sha256:claim.job.sha256,companyEmail:access.accountEmail,manualSharing:true}); }
      }
      if(result.status!=='SAFE') console.warn('Company recording independent verification',
        {jobId,stage:inspectionStage,outcome:result.status,reason:result.reason});
      const outcome=result.status==='SAFE'?'verified':result.status==='BLOCKED'?'blocked':'inconclusive';
      const code=outcome==='verified'?null:outcome==='blocked'?'DRIVE_FILE_BLOCKED':'DRIVE_FILE_INCONCLUSIVE';
      if(result.status==='SAFE'&&(result.fileId!==claim.intent.drive_file_id||result.destinationId!==claim.intent.destination_folder_id||
        result.size!==Number(claim.job.byte_length)||result.mimeType!==claim.job.mime_type||result.sha256!==claim.job.sha256)) fail();
      const saved=await this.sql.begin(async tx=>{
        await tx`set local lock_timeout='5s'`;await tx`set local statement_timeout='15s'`;
        await tx`set local ylaam.local_staging_test='enabled'`;await tx`select local_recording_staging.require_disposable_test()`;
        // Lock the live job and intent through the write. A new claimant cannot
        // change the fencing epoch while this transaction is persisting.
        const [live]=await tx`select i.job_id from company_recording_transfer_intents i
          join company_recording_upload_jobs j on j.id=i.job_id
          join local_recording_staging.recordings r on r.source_job_id=j.id and r.recording_id=j.recording_id
          join local_recording_staging.verifications v on v.staging_id=r.id
          where j.id=${jobId} and j.owner_user_id=${ownerId} and j.state='pending'
            and j.recording_id=${claim.job.recording_id} and r.owner_user_id=${ownerId} and r.meeting_id=j.meeting_id
            and r.occurrence_id is not distinct from j.occurrence_id and r.mime_type=j.mime_type
            and r.byte_length=j.byte_length and r.sha256=j.sha256 and v.byte_length=r.byte_length and v.sha256=r.sha256
            and i.owner_user_id=${ownerId} and i.recording_id=j.recording_id and i.destination_folder_id=j.destination_folder_id
            and i.drive_file_id=${claim.intent.drive_file_id} and i.destination_folder_id=${claim.intent.destination_folder_id}
            and i.company_account_email=${claim.intent.company_account_email} and i.credential_generation=${claim.intent.credential_generation}
            and i.lease_token=${token} and i.lease_epoch=${claim.epoch} and i.lease_until>clock_timestamp()
            and i.transfer_state='awaiting_drive_verification' for update of j,i`;
        if(!live) fail();
        // INSERT ... SELECT checks the live lease for the first insert too;
        // the conflict branch checks it again at the statement's write point.
        const rows=await tx`insert into company_recording_drive_verifications(job_id,recording_id,drive_file_id,destination_folder_id,expected_byte_length,observed_byte_length,expected_mime_type,observed_mime_type,expected_sha256,observed_sha256,company_account_email,credential_generation,outcome,failure_code)
          select j.id,j.recording_id,i.drive_file_id,i.destination_folder_id,j.byte_length,${result.status==='SAFE'?result.size:null},j.mime_type,${result.status==='SAFE'?result.mimeType:null},j.sha256,${result.status==='SAFE'?result.sha256:null},i.company_account_email,i.credential_generation,${outcome},${code}
          from company_recording_upload_jobs j join company_recording_transfer_intents i on i.job_id=j.id
          where j.id=${jobId} and j.state='pending' and i.lease_token=${token} and i.lease_epoch=${claim.epoch}
            and i.lease_until>clock_timestamp() and i.transfer_state='awaiting_drive_verification'
          on conflict(job_id) do update set outcome=excluded.outcome,failure_code=excluded.failure_code,observed_byte_length=excluded.observed_byte_length,observed_mime_type=excluded.observed_mime_type,observed_sha256=excluded.observed_sha256,verified_at=now(),updated_at=now()
          where company_recording_drive_verifications.recording_id=excluded.recording_id
            and company_recording_drive_verifications.drive_file_id=excluded.drive_file_id
            and company_recording_drive_verifications.destination_folder_id=excluded.destination_folder_id
            and company_recording_drive_verifications.expected_byte_length=excluded.expected_byte_length
            and company_recording_drive_verifications.expected_mime_type=excluded.expected_mime_type
            and company_recording_drive_verifications.expected_sha256=excluded.expected_sha256
            and company_recording_drive_verifications.company_account_email=excluded.company_account_email
            and company_recording_drive_verifications.credential_generation=excluded.credential_generation
            and exists(select 1 from company_recording_transfer_intents i where i.job_id=${jobId} and i.lease_token=${token}
              and i.lease_epoch=${claim.epoch} and i.lease_until>clock_timestamp() and i.transfer_state='awaiting_drive_verification') returning outcome`;
        if(!rows[0]) fail();
        // An INSERT can wait on an uncommitted conflicting row. Recheck the
        // wall clock after the write so a lease that expired during that wait
        // rolls the verification back instead of publishing a stale result.
        const [unexpired]=await tx`select 1 from company_recording_transfer_intents where job_id=${jobId}
          and lease_token=${token} and lease_epoch=${claim.epoch} and lease_until>clock_timestamp()
          and transfer_state='awaiting_drive_verification'`;
        if(!unexpired) fail();return rows[0];
      });
      if(!saved) fail(); return {state:outcome as 'verified'|'blocked'|'inconclusive'};
    } finally { await this.sql`update company_recording_transfer_intents set lease_token=null,lease_until=null,updated_at=now() where job_id=${jobId} and lease_token=${token} and lease_epoch=${claim.epoch}`; }
  }
}
