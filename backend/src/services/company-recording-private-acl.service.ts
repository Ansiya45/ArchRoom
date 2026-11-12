import { randomUUID } from 'node:crypto';
import type { Sql, TransactionSql } from 'postgres';

type Recipient = { userId: string; googleSubject?: string; googleEmail?: string; authorized: boolean; kind: 'creator' | 'host' | 'manager' | 'student' };
export type PrivateAclIntentInput = {
  jobId: string; recordingId: string; driveFileId: string; destinationFolderId: string;
  companyAccountEmail: string; credentialGeneration: string; policyMode: string; policyVersion: number;
  creatorId: string; hostId: string; durableHostIds: readonly string[]; recipients: readonly Recipient[]; hostConfirmed?: boolean;
};
export type PrivateAclDriveClient = {
  grantReader(input: { fileId: string; email: string; companyAccountEmail: string; credentialGeneration: string }): Promise<{ permissionId: string; created: boolean }>;
  revokeDirectReader(input: { fileId: string; permissionId: string; companyAccountEmail: string; credentialGeneration: string }): Promise<{ revoked: boolean }>;
  grantAnyoneReader?(input: { fileId: string; companyAccountEmail: string; credentialGeneration: string }): Promise<{ permissionId: string; created: boolean }>;
  revokePermission?(input: { fileId: string; permissionId: string; companyAccountEmail: string; credentialGeneration: string }): Promise<{ revoked: boolean }>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const id = /^[A-Za-z0-9_-]{10,128}$/;
const permissionId = /^[A-Za-z0-9_-]{1,128}$/;
const reject = (message: string): never => { throw new Error(message); };

export function validatePrivateAclIntent(input: PrivateAclIntentInput) {
  if (![input.jobId, input.recordingId, input.credentialGeneration].every(value => uuid.test(value)) ||
      !id.test(input.driveFileId) || !id.test(input.destinationFolderId) || !Number.isInteger(input.policyVersion) || input.policyVersion < 1)
    reject('Private recording ACL input is invalid.');
  if (!['private','restricted','anyone_with_link'].includes(input.policyMode)) reject('This recording sharing mode is not supported.');
  if (!email.test(input.companyAccountEmail) || !input.companyAccountEmail.includes('@')) reject('Company recording identity is unavailable.');
  if (input.hostId !== input.creatorId && !input.durableHostIds.includes(input.hostId)) reject('Recording host authorization is not durable.');
  if (input.policyMode === 'anyone_with_link') {
    if (!input.hostConfirmed || input.recipients.length) reject('Anyone-with-link requires explicit host confirmation and no direct recipients.');
    return [];
  }
  if (input.policyMode !== 'restricted' && input.recipients.some(r => r.kind === 'student')) reject('Student recipients require a Restricted recording.');
  const required = new Set([input.creatorId, input.hostId, ...input.recipients.filter(r => r.kind === 'manager' || (input.policyMode === 'restricted' && r.kind === 'student')).map(r => r.userId)]);
  const seenUsers = new Set<string>(), seenSubjects = new Set<string>(), seenEmails = new Set<string>();
  for (const recipient of input.recipients) {
    if (!required.has(recipient.userId) || !recipient.authorized || seenUsers.has(recipient.userId) ||
      !recipient.googleSubject || !recipient.googleEmail || !email.test(recipient.googleEmail)) reject('Private recording recipient is not verified.');
    const subject = recipient.googleSubject as string;
    const normalized = (recipient.googleEmail as string).toLowerCase();
    if (seenSubjects.has(subject) || seenEmails.has(normalized)) reject('Private recording identities are ambiguous.');
    seenUsers.add(recipient.userId); seenSubjects.add(subject); seenEmails.add(normalized);
  }
  if (seenUsers.size !== required.size) reject('A required recording recipient has no verified Google identity.');
  return [...input.recipients].sort((a, b) => a.userId.localeCompare(b.userId));
}

export class CompanyRecordingPrivateAclService {
  constructor(private readonly sql: Sql) {}

  async createIntent(input: PrivateAclIntentInput, caller?: TransactionSql) {
    const recipients = validatePrivateAclIntent(input);
    const work = async (tx: TransactionSql) => {
      await tx`set local lock_timeout='5s'`;
      const [job] = await tx`select id,recording_id,drive_file_id,destination_folder_id,access_policy from company_recording_upload_jobs where id=${input.jobId} for update`;
      if (!job || job.recording_id !== input.recordingId || job.drive_file_id !== input.driveFileId || job.destination_folder_id !== input.destinationFolderId || job.access_policy !== input.policyMode) reject('Recording job does not match the sharing ACL intent.');
      const [existing] = await tx`select * from company_recording_private_policies where job_id=${input.jobId} and is_active for update`;
      if (existing) {
        if (existing.recording_id !== input.recordingId || existing.drive_file_id !== input.driveFileId || existing.destination_folder_id !== input.destinationFolderId || existing.company_account_email !== input.companyAccountEmail.toLowerCase() || existing.credential_generation !== input.credentialGeneration || existing.policy_mode !== input.policyMode || Number(existing.policy_version) !== input.policyVersion) reject('Conflicting Private ACL intent exists.');
        const saved = await tx`select user_id,google_subject,google_email from company_recording_private_readers where policy_id=${existing.id} order by user_id`;
        if (saved.length !== recipients.length || recipients.some((r, i) => saved[i]?.user_id !== r.userId || saved[i]?.google_subject !== r.googleSubject || saved[i]?.google_email !== r.googleEmail?.toLowerCase())) reject('Conflicting Private ACL recipient snapshot exists.');
        return { policyId: existing.id as string, idempotent: true as const };
      }
      const [policy] = await tx.unsafe('insert into company_recording_private_policies(job_id,recording_id,drive_file_id,destination_folder_id,company_account_email,credential_generation,policy_mode,policy_version) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id', [input.jobId,input.recordingId,input.driveFileId,input.destinationFolderId,input.companyAccountEmail.toLowerCase(),input.credentialGeneration,input.policyMode,input.policyVersion]);
      if (input.hostConfirmed !== undefined) await tx`update company_recording_private_policies set host_confirmed=${Boolean(input.hostConfirmed)} where id=${policy.id}`;
      for (const recipient of recipients) {
        await tx`insert into company_recording_private_readers(policy_id,user_id,google_subject,google_email,role) values(${policy.id},${recipient.userId},${recipient.googleSubject!},${recipient.googleEmail!.toLowerCase()},'reader')`;
        const [operation] = await tx`insert into company_recording_private_acl_operations(policy_id,user_id,google_subject,google_email,desired_role) values(${policy.id},${recipient.userId},${recipient.googleSubject!},${recipient.googleEmail!.toLowerCase()},'reader') returning id`;
        await tx`insert into company_recording_private_acl_audit(operation_id,policy_id,action,fencing_epoch,detail) values(${operation.id},${policy.id},'intent_created',0,'Private ACL intent created')`;
      }
      if (input.policyMode === 'anyone_with_link') {
        const [operation] = await tx`insert into company_recording_private_acl_operations(policy_id,user_id,google_subject,google_email,desired_role,operation_kind) values(${policy.id},null,null,null,'reader','anyone_reader') returning id`;
        await tx`insert into company_recording_private_acl_audit(operation_id,policy_id,action,fencing_epoch,detail) values(${operation.id},${policy.id},'intent_created',0,'Public reader intent created')`;
      }
      return { policyId: policy.id as string, idempotent: false as const };
    };
    return caller ? work(caller) : this.sql.begin(work);
  }

  async replaceIntent(input: PrivateAclIntentInput, resolveRecipients?: (tx: TransactionSql, targetMode: string) => Promise<PrivateAclIntentInput['recipients']>) {
    return this.sql.begin(async tx => {
      // Lock the authoritative recording and durable host before the policy;
      // promoted meeting participants cannot change a saved recording's ACL.
      const [job] = await tx`select j.recording_id,j.owner_user_id,j.access_policy,j.drive_file_id,j.destination_folder_id,m.host_user_id from company_recording_upload_jobs j join meetings m on m.id=j.meeting_id where j.id=${input.jobId} for update of j,m`;
      if (!job || job.recording_id !== input.recordingId || job.owner_user_id !== input.creatorId || job.host_user_id !== input.creatorId || input.hostId !== input.creatorId)
        reject('Recording sharing change is not authorized.');
      const [old] = await tx`select id,policy_version,policy_mode,recording_id,drive_file_id,destination_folder_id,company_account_email,credential_generation from company_recording_private_policies where job_id=${input.jobId} and is_active for update`;
      if (!old || !Number.isSafeInteger(Number(old.policy_version))) reject('Sharing policy version is stale.');
      if (input.policyVersion !== Number(old.policy_version) && input.policyVersion !== Number(old.policy_version) + 1) reject('Sharing policy version is stale.');
      if (input.policyVersion === Number(old.policy_version) && (old.policy_mode !== input.policyMode || job.access_policy !== input.policyMode)) reject('Sharing policy version is stale.');
      if (resolveRecipients) input = { ...input, recipients: await resolveRecipients(tx, input.policyMode) };
      else if (input.policyMode !== 'anyone_with_link') reject('Authoritative recording recipients are required.');
      validatePrivateAclIntent(input);
      // An identical retry recovers the durable old-operation list; it does not
      // consume another confirmation or create another policy.
      if (Number(old.policy_version) === input.policyVersion && old.policy_mode === input.policyMode && job.access_policy === input.policyMode) {
        const existing = await this.createIntent(input, tx);
        const obsoleteOperations = await tx`select o.policy_id as "policyId",o.id as "operationId",o.permission_id as "permissionId",o.operation_kind as "operationKind" from company_recording_private_policies prior join company_recording_private_acl_operations o on o.policy_id=prior.id where prior.superseded_by=${old.id} and o.permission_id is not null and o.state<>'revoked' for update of o`;
        return { ...existing, obsoleteOperations: obsoleteOperations.map(op => ({ policyId:String(op.policyId), operationId:String(op.operationId), permissionId:String(op.permissionId), operationKind:String(op.operationKind) })) };
      }
      if (input.policyVersion !== Number(old.policy_version) + 1 || old.policy_mode !== job.access_policy || old.policy_mode === input.policyMode) reject('Sharing policy version is stale.');
      if (old.recording_id !== input.recordingId || old.drive_file_id !== input.driveFileId || old.destination_folder_id !== input.destinationFolderId || job.drive_file_id !== input.driveFileId || job.destination_folder_id !== input.destinationFolderId || old.company_account_email !== input.companyAccountEmail.toLowerCase() || old.credential_generation !== input.credentialGeneration) reject('Recording sharing binding changed.');
      let confirmationId: string | undefined;
      if (input.policyMode === 'anyone_with_link') {
        const [confirmation] = await tx`select id from company_recording_anyone_confirmations where job_id=${input.jobId} and recording_id=${input.recordingId} and host_user_id=${input.creatorId} and policy_version=${input.policyVersion} and consumed_at is null for update`;
        if (!confirmation) reject('Explicit Anyone-with-link confirmation is required.');
        confirmationId = confirmation.id;
      }
      let obsoleteOperations: Array<{ policyId: string; operationId: string; permissionId: string; operationKind: string }> = [];
      if (old) {
        const operations = await tx`select policy_id as "policyId",id as "operationId",permission_id as "permissionId",operation_kind as "operationKind",state,lease_token from company_recording_private_acl_operations where policy_id=${old.id} for update`;
        // An interrupted or ambiguous provider request might still grant access.
        // Its outcome must be reconciled before a new policy can supersede it.
        if (operations.some(op => op.lease_token || ['in_progress','retryable','reconciliation_required'].includes(op.state) || (op.state === 'applied' && !op.permissionId))) reject('Existing ACL operation requires reconciliation.');
        obsoleteOperations = operations.filter(op => op.state === 'applied').map(op => ({ policyId:op.policyId, operationId:op.operationId, permissionId:op.permissionId, operationKind:op.operationKind })) as typeof obsoleteOperations;
        await tx`update company_recording_private_policies set is_active=false,status='reconciliation_required',reconciliation_status='required',superseded_at=clock_timestamp(),updated_at=clock_timestamp() where id=${old.id} and is_active`;
        // Existing direct/public operations remain durable audit evidence. A
        // worker must confirm their revocation before the replacement verifies.
        await tx`update company_recording_private_acl_operations set state='reconciliation_required',failure_code='POLICY_SUPERSEDED',lease_token=null,lease_until=null,fencing_epoch=fencing_epoch+1,updated_at=clock_timestamp() where policy_id=${old.id} and state='applied'`;
      }
      await tx`update company_recording_upload_jobs set access_policy=${input.policyMode},updated_at=clock_timestamp() where id=${input.jobId}`;
      const replacement = await this.createIntent(input, tx);
      if (confirmationId) await tx`update company_recording_anyone_confirmations set consumed_at=clock_timestamp() where id=${confirmationId} and consumed_at is null`;
      if (old) await tx`update company_recording_private_policies set superseded_by=${replacement.policyId} where id=${old.id} and superseded_by is null`;
      return { ...replacement, obsoleteOperations };
    });
  }

  async acquireLease(policyId: string, operationId: string, leaseSeconds = 60, allowApplied = false) {
    if (!uuid.test(policyId) || !uuid.test(operationId) || !Number.isInteger(leaseSeconds) || leaseSeconds < 5 || leaseSeconds > 300) reject('ACL lease input is invalid.');
    const token = randomUUID();
    return this.sql.begin(async tx => {
      const [row] = await tx`update company_recording_private_acl_operations set state='in_progress',lease_token=${token},lease_until=clock_timestamp()+(${leaseSeconds} * interval '1 second'),fencing_epoch=fencing_epoch+1,updated_at=clock_timestamp()
        where id=${operationId} and policy_id=${policyId} and (lease_token is null or lease_until<=clock_timestamp()) and state = any(${allowApplied ? ['pending','retryable','reconciliation_required','applied','revoked'] : ['pending','retryable','reconciliation_required']}) returning id,fencing_epoch,lease_token`;
      if (!row) return { acquired: false as const };
      await tx`update company_recording_private_policies set status='applying',lease_token=${token},lease_until=clock_timestamp()+(${leaseSeconds} * interval '1 second'),lease_epoch=lease_epoch+1,updated_at=clock_timestamp() where id=${policyId}`;
      await tx`insert into company_recording_private_acl_audit(operation_id,policy_id,action,fencing_epoch,detail) values(${operationId},${policyId},'lease_acquired',${row.fencing_epoch},'ACL lease acquired')`;
      return { acquired: true as const, token: row.lease_token as string, fencingEpoch: Number(row.fencing_epoch) };
    });
  }

  async recordResult(input: { policyId: string; operationId: string; token: string; fencingEpoch: number; state: 'applied'|'retryable'|'reconciliation_required'|'revoked'; permissionId?: string; providerResult?: string; failureCode?: string }) {
    if (!uuid.test(input.policyId) || !uuid.test(input.operationId) || !uuid.test(input.token) || !Number.isInteger(input.fencingEpoch) || input.fencingEpoch < 1) reject('ACL operation input is invalid.');
    return this.sql.begin(async tx => {
      const [row] = await tx`update company_recording_private_acl_operations set state=${input.state},permission_id=coalesce(${input.permissionId ?? null},permission_id),provider_result=${input.providerResult ?? null},failure_code=${input.failureCode ?? null},lease_token=null,lease_until=null,updated_at=clock_timestamp()
        where id=${input.operationId} and policy_id=${input.policyId} and lease_token=${input.token} and fencing_epoch=${input.fencingEpoch} and lease_until>clock_timestamp() and state='in_progress'
          and (${input.state} <> 'applied' or exists(select 1 from company_recording_private_policies p where p.id=${input.policyId} and p.is_active)) returning id`;
      if (!row) reject('Stale or conflicting ACL operation.');
      const action = input.state === 'applied' ? 'applied' : input.state === 'revoked' ? 'revoked' : input.state;
      await tx`insert into company_recording_private_acl_audit(operation_id,policy_id,action,permission_id,fencing_epoch,detail) values(${input.operationId},${input.policyId},${action},${input.permissionId ?? null},${input.fencingEpoch},${input.providerResult ?? input.failureCode ?? null})`;
      if (input.state !== 'applied') await tx`update company_recording_private_policies set status='reconciliation_required',reconciliation_status='required',updated_at=clock_timestamp() where id=${input.policyId}`;
      return { recorded: true as const };
    });
  }

  async markReconciled(policyId: string) {
    if (!uuid.test(policyId)) reject('ACL policy input is invalid.');
    const [row] = await this.sql`update company_recording_private_policies set status='pending',reconciliation_status='resolved',updated_at=clock_timestamp() where id=${policyId} and status='reconciliation_required' returning id`;
    if (!row) reject('ACL policy is not awaiting reconciliation.');
    return { reconciled: true as const };
  }

  async markVerified(policyId: string, policyVersion: number, binding?: { companyAccountEmail:string; credentialGeneration:string }) {
    if (!uuid.test(policyId) || !Number.isInteger(policyVersion) || policyVersion < 1) reject('ACL policy input is invalid.');
    return this.sql.begin(async tx => {
      if (binding) {
        const [credential] = await tx`select g.generation,c.google_account_email from drive_integration_generation g join drive_integration_credentials c on c.id=g.id where g.id=1 for share of g,c`;
        if (!credential || credential.generation !== binding.credentialGeneration || credential.google_account_email.toLowerCase() !== binding.companyAccountEmail.toLowerCase()) reject('Company Drive connection changed.');
        const [policy] = await tx`select id from company_recording_private_policies where id=${policyId} and company_account_email=${binding.companyAccountEmail.toLowerCase()} and credential_generation=${binding.credentialGeneration} for update`;
        if (!policy) reject('Company Drive connection changed.');
      }
      const [row] = await tx`update company_recording_private_policies p set status='verified',reconciliation_status='resolved',updated_at=clock_timestamp()
        where p.id=${policyId} and p.is_active and p.policy_version=${policyVersion} and p.status in ('pending','applying') and p.reconciliation_status <> 'required'
          and not exists(select 1 from company_recording_private_policies prior join company_recording_private_acl_operations o on o.policy_id=prior.id where prior.job_id=p.job_id and prior.id<>p.id and o.permission_id is not null and o.state<>'revoked')
          and not exists(select 1 from company_recording_private_acl_operations o where o.policy_id=p.id and (o.state<>'applied' or o.lease_token is not null))
          and exists(select 1 from company_recording_private_acl_operations o where o.policy_id=p.id)
        returning p.id`;
      if (!row) reject('Private ACL policy is incomplete or fenced by another worker.');
      return { verified: true as const };
    });
  }

  async grantReader(policyId: string, operationId: string, drive: PrivateAclDriveClient) {
    const lease = await this.acquireLease(policyId, operationId, 60, true);
    if (!lease.acquired) return { state: 'busy' as const };
    const [binding] = await this.sql`select p.drive_file_id,p.company_account_email,p.credential_generation,o.google_email
      from company_recording_private_policies p join company_recording_private_acl_operations o on o.policy_id=p.id
      where p.id=${policyId} and p.is_active and p.reconciliation_status<>'required' and o.id=${operationId} and o.fencing_epoch=${lease.fencingEpoch}`;
    if (!binding) reject('ACL operation is unavailable.');
    try {
      const result = await drive.grantReader({ fileId: binding.drive_file_id, email: binding.google_email,
        companyAccountEmail: binding.company_account_email, credentialGeneration: binding.credential_generation });
      if (!result || !permissionId.test(result.permissionId)) reject('Drive permission result is ambiguous.');
      await this.recordResult({ policyId, operationId, token: lease.token, fencingEpoch: lease.fencingEpoch, state: 'applied', permissionId: result.permissionId, providerResult: result.created ? 'created' : 'already_exists' });
      return { state: 'applied' as const, permissionId: result.permissionId, created: result.created };
    } catch (error) {
      try { await this.recordResult({ policyId, operationId, token: lease.token, fencingEpoch: lease.fencingEpoch, state: 'reconciliation_required', failureCode: 'PROVIDER_OUTCOME_AMBIGUOUS', providerResult: error instanceof Error ? error.message.slice(0, 120) : 'provider_failure' }); } catch { /* preserve original failure */ }
      return { state: 'reconciliation_required' as const };
    }
  }

  async revokeReader(policyId: string, operationId: string, drive: PrivateAclDriveClient) {
    const lease = await this.acquireLease(policyId, operationId, 60, true);
    if (!lease.acquired) return { state: 'busy' as const };
    const [binding] = await this.sql`select p.drive_file_id,p.company_account_email,p.credential_generation,o.permission_id
      from company_recording_private_policies p join company_recording_private_acl_operations o on o.policy_id=p.id
      where p.id=${policyId} and o.id=${operationId} and o.fencing_epoch=${lease.fencingEpoch}`;
    if (!binding || !binding.permission_id || !permissionId.test(binding.permission_id)) {
      try { await this.recordResult({ policyId, operationId, token: lease.token, fencingEpoch: lease.fencingEpoch, state: 'reconciliation_required', failureCode: 'PERMISSION_ID_UNAVAILABLE' }); } catch { /* preserve state */ }
      return { state: 'reconciliation_required' as const };
    }
    try {
      const result = await drive.revokeDirectReader({ fileId: binding.drive_file_id, permissionId: binding.permission_id,
        companyAccountEmail: binding.company_account_email, credentialGeneration: binding.credential_generation });
      if (!result || result.revoked !== true) reject('Drive revocation result is ambiguous.');
      await this.recordResult({ policyId, operationId, token: lease.token, fencingEpoch: lease.fencingEpoch, state: 'revoked', permissionId: binding.permission_id, providerResult: 'revoked' });
      return { state: 'revoked' as const, permissionId: binding.permission_id };
    } catch (error) {
      try { await this.recordResult({ policyId, operationId, token: lease.token, fencingEpoch: lease.fencingEpoch, state: 'reconciliation_required', failureCode: 'REVOCATION_OUTCOME_AMBIGUOUS', providerResult: error instanceof Error ? error.message.slice(0, 120) : 'provider_failure' }); } catch { /* preserve original failure */ }
      return { state: 'reconciliation_required' as const };
    }
  }

  async grantAnyone(policyId: string, operationId: string, drive: PrivateAclDriveClient) {
    const grantAnyoneReader = drive.grantAnyoneReader;
    if (!grantAnyoneReader) reject('Anyone-with-link provider operation is unavailable.');
    const grant = grantAnyoneReader as NonNullable<PrivateAclDriveClient['grantAnyoneReader']>;
    const lease = await this.acquireLease(policyId, operationId, 60, true);
    if (!lease.acquired) return { state: 'busy' as const };
    const [binding] = await this.sql`select p.drive_file_id,p.company_account_email,p.credential_generation from company_recording_private_policies p join company_recording_private_acl_operations o on o.policy_id=p.id where p.id=${policyId} and p.is_active and p.policy_mode='anyone_with_link' and p.host_confirmed and o.operation_kind='anyone_reader' and o.id=${operationId} and o.fencing_epoch=${lease.fencingEpoch}`;
    if (!binding) return { state: 'reconciliation_required' as const };
    try {
      const result = await grant.call(drive, { fileId: binding.drive_file_id, companyAccountEmail: binding.company_account_email, credentialGeneration: binding.credential_generation });
      if (!result?.permissionId) reject('Drive public permission result is ambiguous.');
      await this.recordResult({ policyId, operationId, token: lease.token, fencingEpoch: lease.fencingEpoch, state: 'applied', permissionId: result.permissionId, providerResult: result.created ? 'created' : 'already_exists' });
      return { state: 'applied' as const, permissionId: result.permissionId };
    } catch { try { await this.recordResult({ policyId, operationId, token: lease.token, fencingEpoch: lease.fencingEpoch, state: 'reconciliation_required', failureCode: 'PROVIDER_OUTCOME_AMBIGUOUS' }); } catch {} return { state: 'reconciliation_required' as const }; }
  }

  async revokeAnyone(policyId: string, operationId: string, drive: PrivateAclDriveClient) {
    if (!drive.revokePermission) reject('Anyone-with-link provider operation is unavailable.');
    return this.revokeReader(policyId, operationId, { ...drive, revokeDirectReader: input => drive.revokePermission!(input) });
  }
}
