import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import { requireLocalStaging, type StagingConfig } from './local-recording-ingestion.service.js';
import { CompanyRecordingDriveFileInspector } from './company-recording-drive-file-inspector.js';
import type { CompanyDriveAccess } from './company-recording-drive-intent.service.js';
import { companyRecordingSharingReadiness } from './company-recording-sharing-readiness.js';

type Authorize=(jobId:string,ownerId:string)=>Promise<unknown>;
type Privacy=(jobId:string,ownerId:string)=>Promise<{status:string;destinationId?:string}>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reject=()=>{throw new Error('Verified recording publication is unavailable.');};

// Manually invoked backend boundary. No router or worker calls this yet.
export class CompanyRecordingHistoryPublicationService {
  constructor(private readonly sql:Sql,private readonly config:StagingConfig,private readonly authorize:Authorize,
    private readonly privacy:Privacy,private readonly access:()=>Promise<CompanyDriveAccess>,private readonly inspector:CompanyRecordingDriveFileInspector,
    private readonly readiness:()=>{ready:boolean;reason:string} = companyRecordingSharingReadiness) {}
  async publish(jobId:string,ownerId:string) {
    requireLocalStaging(this.config);if(!uuid.test(jobId)||!uuid.test(ownerId))reject();await this.authorize(jobId,ownerId);
    // The deployment guard remains closed until the simplified upload is verified.
    if (!this.readiness().ready) reject();
    const token=randomUUID();
    const claimed=await this.sql.begin(async tx=>{
      await tx`set local ylaam.local_staging_test='enabled'`;await tx`select local_recording_staging.require_disposable_test()`;
      const [row]=await tx`select j.*,i.drive_file_id,i.company_account_email,i.credential_generation,i.transfer_state,
        v.outcome,v.destination_folder_id as verified_destination,v.expected_byte_length,v.expected_mime_type,v.expected_sha256,v.company_account_email as verified_account,v.credential_generation as verified_generation
        from company_recording_upload_jobs j join company_recording_transfer_intents i on i.job_id=j.id
        join company_recording_drive_verifications v on v.job_id=j.id
        join local_recording_staging.recordings r on r.source_job_id=j.id and r.recording_id=j.recording_id
        join local_recording_staging.verifications a on a.staging_id=r.id
        where j.id=${jobId} and j.owner_user_id=${ownerId} and j.state='pending' and i.transfer_state='awaiting_drive_verification'
          and v.outcome='verified' and r.owner_user_id=${ownerId} and r.byte_length=j.byte_length and r.sha256=j.sha256 and r.mime_type=j.mime_type for update of j,i,v`;
      if(!row) reject();
      if(row.destination_folder_id!==row.verified_destination||row.company_account_email!==row.verified_account||row.credential_generation!==row.verified_generation||Number(row.byte_length)!==Number(row.expected_byte_length)||row.mime_type!==row.expected_mime_type||row.sha256!==row.expected_sha256)reject();
      const [intent]=await tx`update company_recording_transfer_intents set lease_token=${token},lease_epoch=lease_epoch+1,lease_until=now()+interval '90 seconds',updated_at=now()
        where job_id=${jobId} and (lease_token is null or lease_until<now()) and transfer_state='awaiting_drive_verification' returning *`;
      return intent?{row,intent,epoch:Number(intent.lease_epoch)}:null;
    });
    if(!claimed)return {state:'busy' as const};
    try {
      const privateDestination=async()=>{const result=await this.privacy(jobId,ownerId);if(result.status!=='SAFE'||result.destinationId!==claimed.row.destination_folder_id)reject();};
      await privateDestination();let current=await this.access();
      if(current.accountEmail.toLowerCase()!==claimed.row.company_account_email.toLowerCase()||current.credentialGeneration!==claimed.row.credential_generation)reject();
      const checked=await this.inspector.inspect(current.accessToken,{fileId:claimed.row.drive_file_id,destinationId:claimed.row.destination_folder_id,byteLength:Number(claimed.row.byte_length),mimeType:claimed.row.mime_type,sha256:claimed.row.sha256,companyEmail:current.accountEmail,manualSharing:true});
      if(checked.status!=='SAFE')reject();
      await privateDestination();current=await this.access();
      if(current.accountEmail.toLowerCase()!==claimed.row.company_account_email.toLowerCase()||current.credentialGeneration!==claimed.row.credential_generation)reject();
      const published=await this.sql.begin(async tx=>{
        await tx`set local ylaam.local_staging_test='enabled'`;await tx`select local_recording_staging.require_disposable_test()`;
        const [done]=await tx`update company_recording_upload_jobs set state='completed',verified_drive_file_id=${claimed.row.drive_file_id},drive_file_id=${claimed.row.drive_file_id},confirmed_offset=byte_length,completed_at=now(),updated_at=now()
          where id=${jobId} and owner_user_id=${ownerId} and state='pending'
            and exists(select 1 from company_recording_transfer_intents i where i.job_id=${jobId} and i.lease_token=${token} and i.lease_epoch=${claimed.epoch} and i.lease_until>now() and i.transfer_state='awaiting_drive_verification')
            and exists(select 1 from company_recording_drive_verifications v where v.job_id=${jobId} and v.outcome='verified' and v.drive_file_id=${claimed.row.drive_file_id} and v.destination_folder_id=${claimed.row.destination_folder_id} and v.credential_generation=${claimed.row.credential_generation}) returning id`;
        if(!done)reject();
        const url=`https://drive.google.com/file/d/${claimed.row.drive_file_id}/view`;
        await tx`insert into meeting_history_items(meeting_id,occurrence_id,kind,dedupe_key,content,label) values(${claimed.row.meeting_id},${claimed.row.occurrence_id},'drive',${`company-drive:${claimed.row.recording_id}`},${url},${claimed.row.recording_filename ?? `Company recording ${claimed.row.recording_id}`}) on conflict(meeting_id,dedupe_key) do nothing`;
        return {state:'published' as const,fileId:claimed.row.drive_file_id};
      });
      return published;
    } finally {await this.sql`update company_recording_transfer_intents set lease_token=null,lease_until=null,updated_at=now() where job_id=${jobId} and lease_token=${token} and lease_epoch=${claimed.epoch}`;}
  }
}
