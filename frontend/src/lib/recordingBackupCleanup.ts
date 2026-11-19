import { getStoredUser } from '@/lib/auth';
import { trpc } from '@/lib/trpc';
import { deleteConfirmedBackup, reconstructRecordingBackup } from '@/lib/recordingBackup';

// Conservative reconciliation: any failure or incomplete evidence retains data.
export async function reconcileConfirmedBackup(ownerId: string, recordingId: string): Promise<boolean> {
  if (!ownerId || getStoredUser()?.id !== ownerId) return false;
  try {
    const { user } = await trpc.auth.me.query();
    if (user.id !== ownerId || getStoredUser()?.id !== ownerId) return false;
    const backup = await reconstructRecordingBackup(ownerId, recordingId);
    const row = backup.metadata;
    if (backup.partial || !row.meetingId || !row.uploadIntent) return false;
    const confirmation = await trpc.recordings.verifiedCompanyRecording.query({ recordingId });
    if (!confirmation || confirmation.verified !== true || confirmation.recordingId !== row.id || confirmation.ownerId !== ownerId ||
      confirmation.meetingId !== row.meetingId || confirmation.occurrenceId !== (row.occurrenceId ?? null) ||
      confirmation.byteLength !== backup.blob.size || confirmation.mimeType !== row.mimeType || !confirmation.jobId || !confirmation.historyId ||
      confirmation.historyUrl !== `https://drive.google.com/file/d/${confirmation.driveFileId}/view` ||
      (row.uploadIntent.destinationFolderId === null ? !confirmation.destinationIsRoot : confirmation.destinationFolderId !== row.uploadIntent.destinationFolderId)) return false;
    const digest = await crypto.subtle.digest('SHA-256', await backup.blob.arrayBuffer());
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== confirmation.sha256 || getStoredUser()?.id !== ownerId) return false;
    const latest = await trpc.auth.me.query();
    if (latest.user.id !== ownerId || getStoredUser()?.id !== ownerId) return false;
    return await deleteConfirmedBackup(row, () => getStoredUser()?.id === ownerId);
  } catch { return false; }
}
