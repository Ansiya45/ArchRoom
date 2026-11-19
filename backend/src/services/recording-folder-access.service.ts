import { TRPCError } from '@trpc/server';
import { db } from '../db/index.js';
import { recordingBatchFolderPermissions, recordingBatchFolders } from '../db/schema.js';
import { recordingDriveRootId, validateDriveFolderId } from '../config/recordingDrive.js';
import { env } from '../env.js';
import { canCreateRecordingFolder, userCanAccessRecordingDestination } from './drive-security.service.js';
import { recordingFolderService } from './google-drive-integration.runtime.js';
import type { RecordingDriveFolderService } from './recording-drive-folder.service.js';

type FolderOperations = Pick<RecordingDriveFolderService, 'listDirectChildren' | 'createDirectChild'>;

export async function validateRecordingDestination(userId: string, folderId: string | null): Promise<string | null> {
  if (folderId === null) return null;
  try { validateDriveFolderId(folderId); }
  catch { throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid recording folder ID.' }); }
  if (folderId === recordingDriveRootId()) return null;
  if (!env.GOOGLE_INTEGRATION_ADMIN_USER_ID || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET ||
      !env.GOOGLE_OAUTH_CALLBACK_URL || !env.GOOGLE_INTEGRATION_TOKEN_KEY)
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'A verified Google Drive connection is required for batch folders.' });
  const isAdmin = Boolean(env.GOOGLE_INTEGRATION_ADMIN_USER_ID && userId === env.GOOGLE_INTEGRATION_ADMIN_USER_ID);
  if (!isAdmin && !await userCanAccessRecordingDestination(userId, folderId, 'upload', env.GOOGLE_INTEGRATION_ADMIN_USER_ID))
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You cannot select this recording folder.' });
  try { await recordingFolderService().validateDestination(folderId); }
  catch { throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'The recording folder could not be verified.' }); }
  return folderId;
}

export async function listRecordingFolders(userId: string, drive?: FolderOperations) {
  let live;
  try { live = await (drive ?? recordingFolderService()).listDirectChildren(); }
  catch { return { connected: false, canCreate: false, folders: [] as { id: string; name: string }[] }; }
  const isAdmin = Boolean(env.GOOGLE_INTEGRATION_ADMIN_USER_ID && userId === env.GOOGLE_INTEGRATION_ADMIN_USER_ID);
  const allowed = [];
  for (const folder of live) {
    if (isAdmin || await userCanAccessRecordingDestination(userId, folder.id, 'upload', env.GOOGLE_INTEGRATION_ADMIN_USER_ID))
      allowed.push({ id: folder.id, name: folder.name });
  }
  return { connected: true, canCreate: await canCreateRecordingFolder(userId, env.GOOGLE_INTEGRATION_ADMIN_USER_ID), folders: allowed };
}

export async function createRecordingFolder(userId: string, name: string, drive?: FolderOperations) {
  if (!await canCreateRecordingFolder(userId, env.GOOGLE_INTEGRATION_ADMIN_USER_ID))
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Batch folder creation permission is required.' });
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 255 || /[\x00-\x1f\/]/.test(trimmed))
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid recording folder name.' });
  const service = drive ?? recordingFolderService();
  let existing;
  try { existing = await service.listDirectChildren(); }
  catch { throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Google Drive is not connected or the root could not be verified.' }); }
  if (existing.some(folder => folder.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase()))
    throw new TRPCError({ code: 'CONFLICT', message: 'A batch folder with this name already exists.' });
  let created;
  try { created = await service.createDirectChild(trimmed); }
  catch { throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'The batch folder could not be created.' }); }
  try {
    await db.transaction(async tx => {
      await tx.insert(recordingBatchFolders).values({ folderId: created.id, name: created.name, createdByUserId: userId });
      await tx.insert(recordingBatchFolderPermissions).values({ folderId: created.id, userId, role: 'manager' });
    });
  } catch {
    // Drive creation cannot be rolled back here. Retain the ID for manual reconciliation.
    console.error(JSON.stringify({ event: 'recording_folder_registration_failed', folderId: created.id }));
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR',
      message: `The folder was created in Google Drive but could not be registered. Do not retry. Contact the integration administrator with folder ID ${created.id}.` });
  }
  return { id: created.id, name: created.name };
}
