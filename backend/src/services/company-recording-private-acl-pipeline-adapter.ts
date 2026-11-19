import type { Sql } from 'postgres';
import { CompanyRecordingPrivateAclWorker } from './company-recording-private-acl-worker.js';
import type { CompanyRecordingPrivateAclService } from './company-recording-private-acl.service.js';
import type { CompanyRecordingDriveFileInspector, ExpectedFile } from './company-recording-drive-file-inspector.js';
import type { CompanyRecordingDriveAclClient } from './company-recording-drive-acl-client.js';

export class CompanyRecordingPrivateAclPipelineAdapter {
  constructor(private readonly sql: Sql, private readonly acl: CompanyRecordingPrivateAclService,
    private readonly access: () => Promise<{ accountEmail: string; credentialGeneration: string; accessToken: string }>,
    private readonly inspector: CompanyRecordingDriveFileInspector,
    private readonly drive: CompanyRecordingDriveAclClient) {}

  async reconcileForJob(jobId: string, ownerId: string): Promise<{ state: string }> {
    const [policy] = await this.sql`select p.id,p.job_id,p.recording_id,p.drive_file_id,p.destination_folder_id,p.company_account_email,p.credential_generation,p.policy_version,p.policy_mode,p.host_confirmed,
      j.owner_user_id,j.mime_type,j.byte_length,j.sha256
      from company_recording_private_policies p join company_recording_upload_jobs j on j.id=p.job_id
      where p.job_id=${jobId} and j.owner_user_id=${ownerId} and p.is_active and p.recording_id=j.recording_id and p.policy_mode=j.access_policy and p.drive_file_id=j.drive_file_id and p.destination_folder_id=j.destination_folder_id and p.status in ('pending','applying','reconciliation_required')`;
    if (!policy) return { state: 'reconciliation_required' };
    const account = await this.access();
    if (account.accountEmail.toLowerCase() !== String(policy.company_account_email).toLowerCase() || account.credentialGeneration !== policy.credential_generation)
      return { state: 'reconciliation_required' };
    const readers = await this.sql`select user_id,google_subject,google_email from company_recording_private_readers where policy_id=${policy.id} order by user_id`;
    const operations = await this.sql`select id as operation_id,user_id,state,operation_kind from company_recording_private_acl_operations where policy_id=${policy.id} order by id`;
    const expected: ExpectedFile = { fileId: policy.drive_file_id, destinationId: policy.destination_folder_id, byteLength: Number(policy.byte_length), mimeType: policy.mime_type, sha256: policy.sha256, companyEmail: policy.company_account_email,
      privateReaders: readers.map((r: any) => ({ userId: r.user_id, email: r.google_email })) };
    const inspect = async (allowMissingPrivateReaders = false) => {
      const current = await this.access();
      if (current.accountEmail.toLowerCase() !== String(policy.company_account_email).toLowerCase() || current.credentialGeneration !== policy.credential_generation)
        return { file: { status: 'UNVERIFIABLE' as const, reason: 'Company Drive connection changed.' }, permissions: [] };
      const file = await this.inspector.inspect(current.accessToken, { ...expected, allowMissingPrivateReaders });
      if (file.status !== 'SAFE') return { file, permissions: [] };
      const permissions = await this.drive.listPermissions(policy.drive_file_id, { companyAccountEmail: policy.company_account_email, credentialGeneration: policy.credential_generation });
      return { file, permissions: permissions.map((p: any) => ({ id: p.id, type: p.type, role: p.role, email: p.emailAddress })) };
    };
    const worker = new CompanyRecordingPrivateAclWorker(this.acl);
    if (policy.policy_mode === 'anyone_with_link') {
      if (!policy.host_confirmed || readers.length !== 0 || operations.length !== 1 || operations[0].operation_kind !== 'anyone_reader') return { state:'reconciliation_required' };
      const inspectAs = async (publicMode:boolean) => {
        const fresh = await this.access();
        if (fresh.accountEmail.toLowerCase() !== String(policy.company_account_email).toLowerCase() || fresh.credentialGeneration !== policy.credential_generation)
          return { status:'UNVERIFIABLE' as const, reason:'Company Drive connection changed.' };
        return this.inspector.inspect(fresh.accessToken, { ...expected, privateReaders:publicMode ? undefined : [], sharingMode:publicMode ? 'anyone_with_link' : 'private' });
      };
      const result = await worker.reconcileAnyone({ policyId:policy.id, policyVersion:Number(policy.policy_version), operationId:operations[0].operation_id, companyAccountEmail:policy.company_account_email, credentialGeneration:policy.credential_generation,
        drive:this.drive, inspectOwnerOnly:()=>inspectAs(false), inspectPublic:()=>inspectAs(true) });
      if (result.state === 'reconciliation_required') await this.sql`update company_recording_private_policies set status='reconciliation_required',reconciliation_status='required',updated_at=clock_timestamp() where id=${policy.id} and is_active and status<>'verified'`;
      return result;
    }
    return worker.reconcile({ policyId: policy.id, policyVersion: Number(policy.policy_version), companyEmail: policy.company_account_email, credentialGeneration:policy.credential_generation,
      readers: readers.map((r: any) => ({ userId: r.user_id, googleSubject: r.google_subject, email: r.google_email, role: 'reader' as const })),
      operations: operations.map((o: any) => ({ operationId: o.operation_id, userId: o.user_id, state: o.state, obsolete: o.state === 'obsolete' })), inspect, drive: this.drive });
  }
}
