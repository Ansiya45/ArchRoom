import type { Sql } from 'postgres';
import { recordingDriveRootId } from '../config/recordingDrive.js';

type Authorize = (jobId: string, ownerId: string) => Promise<{ recordingId: string; meetingId: string; occurrenceId: string | null }>;
export type RecordingConfirmation = { recordingId: string; meetingId: string; occurrenceId: string | null; ownerId: string;
  jobId: string; driveFileId: string; destinationFolderId: string; historyId: string; historyUrl: string;
  byteLength: number; sha256: string; mimeType: string; destinationIsRoot: boolean; verified: true };

// This is a read-only attestation of persisted evidence, not a fresh Drive API inspection.
export class CompanyRecordingConfirmationService {
  constructor(private readonly sql: Sql, private readonly authorize: Authorize) {}
  async confirm(recordingId: string, ownerId: string): Promise<RecordingConfirmation | null> {
    const read = async () => {
      const rows = await this.sql`select j.id as job_id,j.recording_id,j.meeting_id,j.occurrence_id,j.owner_user_id,
        j.verified_drive_file_id,j.destination_folder_id,j.byte_length,j.sha256,j.mime_type,h.id as history_id,h.content as history_url
        from company_recording_upload_jobs j
        join company_recording_transfer_intents i on i.job_id=j.id and i.recording_id=j.recording_id and i.owner_user_id=j.owner_user_id
        join company_recording_drive_verifications v on v.job_id=j.id
        join meeting_history_items h on h.meeting_id=j.meeting_id and h.occurrence_id is not distinct from j.occurrence_id
          and h.kind='drive' and h.dedupe_key=('company-drive:' || j.recording_id::text)
          and h.content=('https://drive.google.com/file/d/' || j.verified_drive_file_id || '/view')
        where j.recording_id=${recordingId} and j.owner_user_id=${ownerId} and j.state='completed' and j.completed_at is not null
          and j.confirmed_offset=j.byte_length and j.verified_drive_file_id=j.drive_file_id
          and i.drive_file_id=j.verified_drive_file_id and i.destination_folder_id=j.destination_folder_id
          and i.drive_confirmed_offset=j.byte_length and v.outcome='verified' and v.recording_id=j.recording_id
          and v.drive_file_id=j.verified_drive_file_id and v.destination_folder_id=j.destination_folder_id
          and v.expected_byte_length=j.byte_length and v.observed_byte_length=j.byte_length
          and v.expected_mime_type=j.mime_type and v.observed_mime_type=j.mime_type
          and v.expected_sha256=j.sha256 and v.observed_sha256=j.sha256
          and v.company_account_email=i.company_account_email and v.credential_generation=i.credential_generation`;
      return rows.length === 1 ? rows[0] : null;
    };
    const first = await read();
    if (!first) return null;
    const job = await this.authorize(String(first.job_id), ownerId);
    if (job.recordingId !== recordingId || job.meetingId !== String(first.meeting_id) || job.occurrenceId !== (first.occurrence_id == null ? null : String(first.occurrence_id))) return null;
    const row = await read();
    if (!row || row.recording_id !== recordingId || row.owner_user_id !== ownerId || row.meeting_id !== first.meeting_id ||
      row.occurrence_id !== first.occurrence_id || row.job_id !== first.job_id || row.history_id !== first.history_id || row.history_url !== first.history_url ||
      row.destination_folder_id !== first.destination_folder_id || row.verified_drive_file_id !== first.verified_drive_file_id) return null;
    const size = Number(row.byte_length), file = String(row.verified_drive_file_id), folder = String(row.destination_folder_id), digest = String(row.sha256);
    if (!Number.isSafeInteger(size) || size < 1 || !/^[A-Za-z0-9_-]{10,128}$/.test(file) || !/^[A-Za-z0-9_-]{10,128}$/.test(folder) ||
      !/^[a-f0-9]{64}$/.test(digest) || row.history_url !== `https://drive.google.com/file/d/${file}/view` ||
      !['video/webm', 'video/mp4'].includes(String(row.mime_type))) return null;
    return { recordingId, ownerId, meetingId: String(row.meeting_id), occurrenceId: row.occurrence_id == null ? null : String(row.occurrence_id),
      jobId: String(row.job_id), driveFileId: file, destinationFolderId: folder, historyId: String(row.history_id), historyUrl: String(row.history_url),
      byteLength: size, sha256: digest, mimeType: String(row.mime_type), destinationIsRoot: folder === recordingDriveRootId(), verified: true };
  }
}
