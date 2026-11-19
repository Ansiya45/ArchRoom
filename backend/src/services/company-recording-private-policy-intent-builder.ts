import type { Sql, TransactionSql } from 'postgres';
import { CompanyRecordingPrivateAclService, type PrivateAclIntentInput } from './company-recording-private-acl.service.js';
import { resolvePrivateRecordingRecipients } from './company-recording-private-recipient-resolver.js';

export type PrivatePolicyDependencies = {
  account: () => Promise<{ accountEmail: string; credentialGeneration: string }>;
  validateDestination: (jobId: string, ownerId: string) => Promise<unknown>;
};

export class CompanyRecordingPrivatePolicyIntentBuilder {
  constructor(private readonly sql: Sql, private readonly acl: CompanyRecordingPrivateAclService, private readonly deps: PrivatePolicyDependencies) {}

  async resolveReplacementRecipients(tx: TransactionSql, jobId: string, ownerId: string, targetMode: string): Promise<PrivateAclIntentInput['recipients']> {
    if (targetMode === 'anyone_with_link') return [];
    if (targetMode !== 'private' && targetMode !== 'restricted') throw new Error('Unsupported recording sharing mode.');
    const [job] = await tx`select j.destination_folder_id,m.recording_folder_id,m.host_user_id from company_recording_upload_jobs j join meetings m on m.id=j.meeting_id where j.id=${jobId} and j.owner_user_id=${ownerId} for update of j,m`;
    if (!job || job.host_user_id !== ownerId) throw new Error('Recording sharing change is not authorized.');
    const folder = job.recording_folder_id as string | null;
    if (targetMode === 'restricted' && (!folder || job.destination_folder_id !== folder)) throw new Error('Restricted recording requires the authorized batch destination.');
    if (folder) {
      const [registered] = await tx`select folder_id from recording_batch_folders where folder_id=${folder} for update`;
      if (!registered) throw new Error('Recording batch is unavailable.');
    }
    if (targetMode === 'restricted') {
      const [unbound] = await tx`select e.id from batch_student_enrollments e left join batch_enrollment_account_bindings b on b.enrollment_id=e.id where e.folder_id=${folder} and e.status='approved' and b.user_id is null limit 1`;
      if (unbound) throw new Error('An approved student has no verified account binding.');
    }
    const candidates = await tx`select ${ownerId}::uuid as user_id union select p.user_id from recording_batch_folder_permissions p where p.folder_id=${folder} and (p.role='manager' or (${targetMode}='restricted' and p.role='trainer')) union select b.user_id from batch_student_enrollments e join batch_enrollment_account_bindings b on b.enrollment_id=e.id where ${targetMode}='restricted' and e.folder_id=${folder} and e.status='approved'`;
    const ids = candidates.map(row => row.user_id as string).sort();
    await tx`select id from users where id = any(${ids}::uuid[]) order by id for share`;
    await tx`select user_id from student_google_identities where user_id = any(${ids}::uuid[]) order by user_id for share`;
    const rows = await tx`select u.id,u.email_verified_at,i.google_subject,i.google_email from users u left join student_google_identities i on i.user_id=u.id and i.verified_at is not null where u.id = any(${ids}::uuid[]) order by u.id`;
    if (rows.length !== ids.length) throw new Error('A recording recipient account is unavailable.');
    return rows.map(row => {
      if (!row.email_verified_at || !row.google_subject || !row.google_email) throw new Error('A recording recipient has no verified Google identity.');
      return { userId:row.id as string, googleSubject:row.google_subject as string, googleEmail:row.google_email as string, authorized:true, kind:row.id===ownerId ? 'creator' as const : targetMode==='restricted' ? 'student' as const : 'manager' as const };
    });
  }

  async build(jobId: string, ownerId: string) {
    const [job] = await this.sql`select id, recording_id, owner_user_id, drive_file_id, destination_folder_id, access_policy
      from company_recording_upload_jobs where id=${jobId} and owner_user_id=${ownerId}`;
    if (!job || job.access_policy !== 'private' || !job.drive_file_id) throw new Error('Private ACL intent is not eligible.');
    const destination = await this.deps.validateDestination(jobId, ownerId) as { status?: string; destinationId?: string } | null;
    if (!destination || destination.status !== 'SAFE' || destination.destinationId !== job.destination_folder_id)
      throw new Error('Recording destination is not verified.');
    const recipients = await resolvePrivateRecordingRecipients(this.sql, jobId, ownerId);
    const account = await this.deps.account();
    const result = await this.acl.createIntent({
      jobId: job.id, recordingId: job.recording_id, driveFileId: job.drive_file_id,
      destinationFolderId: job.destination_folder_id, companyAccountEmail: account.accountEmail,
      credentialGeneration: account.credentialGeneration, policyMode: 'private', policyVersion: 1,
      creatorId: ownerId, hostId: ownerId, durableHostIds: [ownerId], recipients: recipients.recipients,
    });
    return { ...result, recipients: recipients.recipients };
  }

  async buildRestricted(jobId: string, ownerId: string) {
    const [job] = await this.sql`select j.id,j.recording_id,j.drive_file_id,j.destination_folder_id,j.access_policy,m.recording_folder_id,m.host_user_id from company_recording_upload_jobs j join meetings m on m.id=j.meeting_id where j.id=${jobId} and j.owner_user_id=${ownerId}`;
    if (!job || job.access_policy !== 'restricted' || !job.recording_folder_id || job.destination_folder_id !== job.recording_folder_id || !job.drive_file_id || job.host_user_id !== ownerId) throw new Error('Restricted recording requires an authorized batch and durable host.');
    const destination = await this.deps.validateDestination(jobId, ownerId) as { status?: string; destinationId?: string } | null;
    if (!destination || destination.status !== 'SAFE' || destination.destinationId !== job.destination_folder_id) throw new Error('Recording destination is not verified.');
    const account = await this.deps.account();
    return this.sql.begin(async tx => {
    // Enrollment mutations already lock this folder before changing the roster.
    const [folder] = await tx`select folder_id from recording_batch_folders where folder_id=${job.recording_folder_id} for update`;
    if (!folder) throw new Error('Restricted recording batch is unavailable.');
    const [lockedJob] = await tx`select j.id,j.recording_id,j.drive_file_id,j.destination_folder_id,j.access_policy,m.recording_folder_id,m.host_user_id from company_recording_upload_jobs j join meetings m on m.id=j.meeting_id where j.id=${jobId} and j.owner_user_id=${ownerId} for update of j,m`;
    if (!lockedJob || lockedJob.access_policy !== 'restricted' || lockedJob.recording_folder_id !== job.recording_folder_id || lockedJob.destination_folder_id !== job.destination_folder_id || lockedJob.recording_id !== job.recording_id || lockedJob.drive_file_id !== job.drive_file_id || lockedJob.host_user_id !== ownerId) throw new Error('Restricted recording settings changed.');
    const candidates = await tx`select b.user_id from batch_student_enrollments e join batch_enrollment_account_bindings b on b.enrollment_id=e.id where e.folder_id=${job.recording_folder_id} and e.status='approved'
      union select p.user_id from recording_batch_folder_permissions p where p.folder_id=${job.recording_folder_id} and p.role in ('manager','trainer') union select ${ownerId}::uuid as user_id`;
    const ids = candidates.map(row => row.user_id as string).sort();
    // OIDC unlink/link locks these rows for update before invalidating policies.
    await tx`select id from users where id = any(${ids}::uuid[]) order by id for share`;
    await tx`select user_id from student_google_identities where user_id = any(${ids}::uuid[]) order by user_id for share`;
    // Bound approved students are selected from the roster, independent of attendance.
    // LEFT JOIN identities ensures a missing verified identity blocks the entire snapshot.
    const recipients = await tx`select b.user_id,i.google_subject,i.google_email,u.email_verified_at as user_verified,'student' as kind
      from batch_student_enrollments e join batch_enrollment_account_bindings b on b.enrollment_id=e.id
      left join users u on u.id=b.user_id
      left join student_google_identities i on i.user_id=b.user_id and i.verified_at is not null
      where e.folder_id=${job.recording_folder_id} and e.status='approved'
      union all select p.user_id,i.google_subject,i.google_email,u.email_verified_at as user_verified,'manager' as kind
      from recording_batch_folder_permissions p left join users u on u.id=p.user_id left join student_google_identities i on i.user_id=p.user_id and i.verified_at is not null
      where p.folder_id=${job.recording_folder_id} and p.role in ('manager','trainer')
      union all select u.id,i.google_subject,i.google_email,u.email_verified_at as user_verified,'creator' as kind from users u
      left join student_google_identities i on i.user_id=u.id and i.verified_at is not null
      where u.id=${ownerId} and u.email_verified_at is not null`;
    const distinct = new Map<string, { userId:string; googleSubject:string; googleEmail:string; authorized:true; kind:'creator'|'manager'|'student' }>();
    for (const r of recipients) {
      if (!r.user_id || !r.user_verified || !r.google_subject || !r.google_email) throw new Error('A required Restricted recipient has no verified Google identity.');
      const prior = distinct.get(r.user_id);
      if (prior && (prior.googleSubject !== r.google_subject || prior.googleEmail.toLowerCase() !== r.google_email.toLowerCase())) throw new Error('Restricted identity is ambiguous.');
      if (!prior || r.kind === 'creator' || (r.kind === 'manager' && prior.kind === 'student'))
        distinct.set(r.user_id, { userId:r.user_id,googleSubject:r.google_subject,googleEmail:r.google_email,authorized:true,kind:r.kind });
    }
    if (!distinct.has(ownerId)) throw new Error('Restricted host identity is unavailable.');
    return this.acl.createIntent({ jobId:job.id, recordingId:job.recording_id, driveFileId:job.drive_file_id, destinationFolderId:job.destination_folder_id, companyAccountEmail:account.accountEmail, credentialGeneration:account.credentialGeneration, policyMode:'restricted', policyVersion:1, creatorId:ownerId, hostId:ownerId, durableHostIds:[ownerId], recipients:[...distinct.values()] }, tx);
    });
  }

  async buildForJob(jobId: string, ownerId: string) {
    const [row] = await this.sql`select access_policy from company_recording_upload_jobs where id=${jobId} and owner_user_id=${ownerId}`;
    if (!row) throw new Error('Recording job is unavailable.');
    if (row.access_policy === 'restricted') return this.buildRestricted(jobId, ownerId);
    if (row.access_policy === 'anyone_with_link') return this.buildAnyone(jobId, ownerId);
    return this.build(jobId, ownerId);
  }

  async buildAnyone(jobId: string, ownerId: string) {
    const destination = await this.deps.validateDestination(jobId, ownerId) as { status?: string; destinationId?: string } | null;
    if (!destination || destination.status !== 'SAFE' || !destination.destinationId) throw new Error('Recording destination is not verified.');
    return this.sql.begin(async tx => {
      const [job] = await tx`select j.id,j.recording_id,j.drive_file_id,j.destination_folder_id,j.access_policy,m.host_user_id from company_recording_upload_jobs j join meetings m on m.id=j.meeting_id where j.id=${jobId} and j.owner_user_id=${ownerId} for update of j,m`;
      if (!job || job.access_policy !== 'anyone_with_link' || job.host_user_id !== ownerId || !job.drive_file_id || job.destination_folder_id !== destination.destinationId) throw new Error('Anyone-with-link policy is not authorized.');
      const [confirmation] = await tx`select id,consumed_at from company_recording_anyone_confirmations where job_id=${jobId} and recording_id=${job.recording_id} and host_user_id=${ownerId} and policy_version=1 for update`;
      if (!confirmation) throw new Error('Explicit Anyone-with-link confirmation is required.');
      if (confirmation.consumed_at) {
        const [active] = await tx`select id from company_recording_private_policies where job_id=${jobId} and recording_id=${job.recording_id} and is_active and policy_mode='anyone_with_link' and policy_version=1 and host_confirmed for update`;
        if (!active) throw new Error('Anyone-with-link confirmation is already used.');
      }
      const account = await this.deps.account();
      const intent = await this.acl.createIntent({ jobId:job.id, recordingId:job.recording_id, driveFileId:job.drive_file_id, destinationFolderId:job.destination_folder_id, companyAccountEmail:account.accountEmail, credentialGeneration:account.credentialGeneration, policyMode:'anyone_with_link', policyVersion:1, creatorId:ownerId, hostId:ownerId, durableHostIds:[ownerId], recipients:[], hostConfirmed:true }, tx);
      if (!confirmation.consumed_at) await tx`update company_recording_anyone_confirmations set consumed_at=clock_timestamp() where id=${confirmation.id} and consumed_at is null`;
      return intent;
    });
  }
}
