import type { Sql } from 'postgres';

export type PrivateRecordingRecipient = {
  userId: string;
  kind: 'creator' | 'manager';
  authorized: true;
  googleSubject: string;
  googleEmail: string;
};

type Snapshot = {
  jobId: string;
  ownerUserId: string;
  hostUserId: string;
  accessPolicy: string;
  destinationFolderId: string | null;
  managers: Array<{ userId: string; googleSubject?: string | null; googleEmail?: string | null }>;
  creatorIdentity?: { googleSubject?: string | null; googleEmail?: string | null } | null;
};

export function validatePrivateRecordingRecipientSnapshot(input: Snapshot) {
  if (input.accessPolicy !== 'private') throw new Error('Private recording policy is required.');
  if (!input.ownerUserId || input.ownerUserId !== input.hostUserId) {
    throw new Error('A durable host authorization is required.');
  }
  const identity = input.creatorIdentity;
  if (!identity?.googleSubject || !identity.googleEmail) throw new Error('Verified Google identity is required.');
  const recipients: PrivateRecordingRecipient[] = [{
    userId: input.ownerUserId, kind: 'creator', authorized: true,
    googleSubject: identity.googleSubject, googleEmail: identity.googleEmail,
  }];
  const subjects = new Set([identity.googleSubject]);
  const emails = new Set([identity.googleEmail.toLowerCase()]);
  for (const manager of input.managers) {
    if (!manager.googleSubject || !manager.googleEmail) throw new Error('Every authorized manager must have a verified Google identity.');
    if (subjects.has(manager.googleSubject) || emails.has(manager.googleEmail.toLowerCase())) continue;
    subjects.add(manager.googleSubject); emails.add(manager.googleEmail.toLowerCase());
    recipients.push({ userId: manager.userId, kind: 'manager', authorized: true, googleSubject: manager.googleSubject, googleEmail: manager.googleEmail });
  }
  return recipients;
}

export async function resolvePrivateRecordingRecipients(sql: Sql, jobId: string, ownerUserId: string) {
  return sql.begin(async tx => {
    const [job] = await tx`select j.id, j.recording_id, j.owner_user_id, j.access_policy, j.destination_folder_id,
      m.host_user_id, m.recording_folder_id
      from company_recording_upload_jobs j join meetings m on m.id=j.meeting_id
      where j.id=${jobId} and j.owner_user_id=${ownerUserId} and j.access_policy='private'
      for update of j, m`;
    if (!job) throw new Error('Recording upload job is not authorized.');
    const [creator] = await tx`select google_subject, google_email from student_google_identities
      where user_id=${job.owner_user_id} and verified_at is not null for update`;
    const managers: Array<{ userId: string; googleSubject?: string | null; googleEmail?: string | null }> = job.recording_folder_id ? await tx`select p.user_id as "userId", i.google_subject as "googleSubject", i.google_email as "googleEmail"
      from recording_batch_folder_permissions p left join student_google_identities i
        on i.user_id=p.user_id and i.verified_at is not null
      where p.folder_id=${job.recording_folder_id} and p.role='manager' and p.user_id<>${job.owner_user_id}
      order by p.user_id for update of p` as any : [];
    const recipients = validatePrivateRecordingRecipientSnapshot({
      jobId: job.id, ownerUserId: job.owner_user_id, hostUserId: job.host_user_id,
      accessPolicy: job.access_policy, destinationFolderId: job.destination_folder_id,
      creatorIdentity: creator ?? null, managers,
    });
    return { jobId: job.id as string, recordingId: job.recording_id as string, destinationFolderId: job.destination_folder_id as string, recipients };
  });
}
