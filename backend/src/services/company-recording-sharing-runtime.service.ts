import type { CompanyRecordingPrivateAclService, PrivateAclDriveClient, PrivateAclIntentInput } from './company-recording-private-acl.service.js';
import type { CompanyRecordingPrivateAclWorker } from './company-recording-private-acl-worker.js';
import type { Sql, TransactionSql } from 'postgres';

type SharingDependencies = {
  sql: Sql;
  assertReady: () => void;
  validateDestination: (jobId:string,ownerId:string) => Promise<{status:string;destinationId?:string}>;
  access: () => Promise<{accountEmail:string;credentialGeneration:string}>;
  resolveRecipients: (tx:TransactionSql,jobId:string,ownerId:string,targetMode:string) => Promise<PrivateAclIntentInput['recipients']>;
  drive: PrivateAclDriveClient;
};

/** Injectable orchestration boundary for tests and guarded runtime callers. */
export class CompanyRecordingSharingRuntimeService {
  constructor(private readonly acl: CompanyRecordingPrivateAclService, private readonly worker: CompanyRecordingPrivateAclWorker,
    private readonly pipeline?: { reconcileForJob(jobId:string, ownerId:string):Promise<{state:string}> }, private readonly deps?: SharingDependencies) {}

  async replace(input: PrivateAclIntentInput, drive: PrivateAclDriveClient, resolveRecipients?: (tx:TransactionSql,targetMode:string)=>Promise<PrivateAclIntentInput['recipients']>) {
    const replacement = await this.acl.replaceIntent(input, resolveRecipients);
    const revoked = await this.worker.revokeSuperseded({ operations: replacement.obsoleteOperations.map(operation => ({
      policyId: operation.policyId, operationId: operation.operationId,
      operationKind: operation.operationKind === 'anyone_reader' ? 'anyone_reader' as const : 'direct_reader' as const,
    })), drive });
    if (revoked.state !== 'revoked') return { state: revoked.state, replacement };
    if (!this.pipeline) return { state: 'reconciliation_required' as const, replacement };
    const result = await this.pipeline.reconcileForJob(input.jobId, input.creatorId);
    return { state: result.state, replacement };
  }

  async requestChange(jobId:string, ownerId:string, targetMode:'private'|'restricted'|'anyone_with_link', expectedVersion:number) {
    if (!this.deps || !this.pipeline) throw new Error('Recording sharing changes are unavailable.');
    this.deps.assertReady();
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || expectedVersion >= 2147483647 || !['private','restricted','anyone_with_link'].includes(targetMode)) throw new Error('Recording sharing request is invalid.');
    const [row] = await this.deps.sql`select j.id,j.recording_id,j.owner_user_id,j.drive_file_id,j.destination_folder_id,m.host_user_id,p.id as policy_id,p.policy_version,p.policy_mode,p.status as policy_status,p.reconciliation_status,p.company_account_email,p.credential_generation,
      prior.policy_version as prior_version from company_recording_upload_jobs j join meetings m on m.id=j.meeting_id
      join company_recording_private_policies p on p.job_id=j.id and p.is_active
      left join company_recording_private_policies prior on prior.superseded_by=p.id
      where j.id=${jobId} and j.owner_user_id=${ownerId}`;
    if (!row || row.host_user_id !== ownerId || !row.drive_file_id) throw new Error('Recording sharing change is not authorized.');
    const nextVersion = expectedVersion + 1;
    const initial = Number(row.policy_version) === expectedVersion && row.policy_mode !== targetMode;
    const retry = Number(row.policy_version) === nextVersion && row.policy_mode === targetMode && Number(row.prior_version) === expectedVersion;
    if (!initial && !retry) throw new Error('Sharing policy version is stale.');
    if (initial && (row.policy_status !== 'verified' || row.reconciliation_status !== 'resolved')) throw new Error('Current recording sharing requires reconciliation.');
    const destination = await this.deps.validateDestination(jobId,ownerId);
    if (destination.status !== 'SAFE' || destination.destinationId !== row.destination_folder_id) throw new Error('Recording destination is not verified.');
    const account = await this.deps.access();
    if (account.accountEmail.toLowerCase() !== String(row.company_account_email).toLowerCase() || account.credentialGeneration !== row.credential_generation) throw new Error('Company Drive connection changed.');
    if (retry && row.policy_status === 'verified' && row.reconciliation_status === 'resolved') return { state:'verified' as const, replacement:{policyId:row.policy_id as string,idempotent:true as const,obsoleteOperations:[]} };
    return this.replace({ jobId,recordingId:row.recording_id,driveFileId:row.drive_file_id,destinationFolderId:row.destination_folder_id,
      companyAccountEmail:account.accountEmail,credentialGeneration:account.credentialGeneration,policyMode:targetMode,policyVersion:nextVersion,
      creatorId:ownerId,hostId:ownerId,durableHostIds:[ownerId],recipients:[],hostConfirmed:targetMode==='anyone_with_link' }, this.deps.drive,
      (tx, mode) => this.deps!.resolveRecipients(tx,jobId,ownerId,mode));
  }
}
