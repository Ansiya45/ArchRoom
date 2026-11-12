import type { Sql } from 'postgres';
export class CompanyRecordingAnyoneConfirmationService {
  constructor(private readonly sql: Sql) {}
  async confirm(jobId: string, hostUserId: string, policyVersion: number) {
    if (!Number.isInteger(policyVersion) || policyVersion < 1) throw new Error('Invalid sharing policy version.');
    return this.sql.begin(async tx => {
      const [job] = await tx`select j.recording_id,m.host_user_id,j.owner_user_id,j.access_policy from company_recording_upload_jobs j join meetings m on m.id=j.meeting_id where j.id=${jobId} for update of j,m`;
      if (!job || job.owner_user_id !== hostUserId || job.host_user_id !== hostUserId) throw new Error('Anyone-with-link confirmation is not authorized.');
      const [active] = await tx`select id,policy_version,policy_mode,status,reconciliation_status from company_recording_private_policies where job_id=${jobId} and is_active for update`;
      if (active) {
        if (policyVersion !== Number(active.policy_version) + 1 || active.policy_mode === 'anyone_with_link' || active.status !== 'verified' || active.reconciliation_status !== 'resolved')
          throw new Error('Anyone-with-link policy version is stale or requires reconciliation.');
      } else if (policyVersion !== 1 || job.access_policy !== 'anyone_with_link') {
        throw new Error('Anyone-with-link policy version is stale.');
      }
      const [row] = await tx`insert into company_recording_anyone_confirmations(job_id,recording_id,host_user_id,policy_version) values(${jobId},${job.recording_id},${hostUserId},${policyVersion}) on conflict(job_id,policy_version) do update set host_user_id=company_recording_anyone_confirmations.host_user_id where company_recording_anyone_confirmations.host_user_id=excluded.host_user_id and company_recording_anyone_confirmations.recording_id=excluded.recording_id and company_recording_anyone_confirmations.consumed_at is null returning id,confirmed_at`;
      if (!row) throw new Error('Anyone-with-link confirmation is unavailable or already used.');
      return { confirmationId: row.id as string, confirmedAt: row.confirmed_at as Date };
    });
  }
}
