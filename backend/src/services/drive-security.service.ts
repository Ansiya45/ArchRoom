import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { driveIntegrationCredentials, recordingBatchFolderPermissions, recordingBatchFolders, recordingFolderCreators } from '../db/schema.js';
import { recordingDriveRootId, validateDriveFolderId } from '../config/recordingDrive.js';

export type FolderRole = 'manager' | 'trainer' | 'viewer';
export type FolderAction = 'view' | 'upload' | 'manage';

export function assertIntegrationAdministrator(userId: string | undefined, administratorId: string | undefined): void {
  if (!userId || !administratorId || userId !== administratorId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Integration administrator access is required.' });
  }
}

export async function canCreateRecordingFolder(userId: string, administratorId: string | undefined): Promise<boolean> {
  if (!administratorId) return false;
  if (userId === administratorId) return true;
  const grant = await db.query.recordingFolderCreators.findFirst({ where: eq(recordingFolderCreators.userId, userId) });
  return Boolean(grant);
}

export async function setRecordingFolderCreatorGrant(administratorId: string | undefined, actorUserId: string | undefined,
  targetUserId: string, enabled: boolean): Promise<void> {
  assertIntegrationAdministrator(actorUserId, administratorId);
  if (enabled) await db.insert(recordingFolderCreators).values({ userId: targetUserId, grantedByUserId: actorUserId! })
    .onConflictDoNothing({ target: recordingFolderCreators.userId });
  else await db.delete(recordingFolderCreators).where(eq(recordingFolderCreators.userId, targetUserId));
}

export function canAccessRecordingFolder(
  folderId: string | null,
  action: FolderAction,
  role: FolderRole | undefined,
  isAdministrator = false,
): boolean {
  if (isAdministrator) return true;
  // Any authenticated meeting creator may use the root for general recordings.
  if (folderId === null) return action === 'view' || action === 'upload';
  if (role === 'manager') return true;
  if (role === 'trainer') return action === 'view' || action === 'upload';
  return role === 'viewer' && action === 'view';
}

export function parseTokenKey(value: string | undefined): Buffer {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error('Google integration token key is not configured correctly.');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) throw new Error('Google integration token key is not configured correctly.');
  return key;
}

const tokenAad = Buffer.from('ylaam-google-drive-refresh-token:v1');

export function encryptRefreshToken(token: string, key: Buffer): string {
  if (!token || key.length !== 32) throw new Error('Invalid Google integration credential.');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(tokenAad);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return `v1.${nonce.toString('base64url')}.${ciphertext.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
}

export function decryptRefreshToken(value: string, key: Buffer): string {
  try {
    if (key.length !== 32) throw new Error();
    const [version, noncePart, ciphertextPart, tagPart, extra] = value.split('.');
    if (version !== 'v1' || extra !== undefined) throw new Error();
    const nonce = Buffer.from(noncePart, 'base64url');
    const tag = Buffer.from(tagPart, 'base64url');
    if (nonce.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(tokenAad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(ciphertextPart, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Stored Google integration credential cannot be decrypted.');
  }
}

export interface IntegrationCredentialRepository {
  save(value: { googleAccountEmail: string; encryptedRefreshToken: string; connectedByUserId: string }): Promise<void>;
  load(): Promise<{ googleAccountEmail: string; encryptedRefreshToken: string } | null>;
  remove(): Promise<void>;
}

export const databaseIntegrationCredentialRepository: IntegrationCredentialRepository = {
  async save(value) {
    await db.insert(driveIntegrationCredentials).values({ id: 1, ...value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: driveIntegrationCredentials.id, set: { ...value, updatedAt: new Date() } });
  },
  async load() {
    const row = await db.query.driveIntegrationCredentials.findFirst({ where: eq(driveIntegrationCredentials.id, 1) });
    return row ? { googleAccountEmail: row.googleAccountEmail, encryptedRefreshToken: row.encryptedRefreshToken } : null;
  },
  async remove() { await db.delete(driveIntegrationCredentials).where(eq(driveIntegrationCredentials.id, 1)); },
};

export class IntegrationCredentialService {
  constructor(private readonly repository: IntegrationCredentialRepository, private readonly administratorId: string | undefined, private readonly key: Buffer) {}

  async replace(userId: string | undefined, googleAccountEmail: string, refreshToken: string): Promise<void> {
    assertIntegrationAdministrator(userId, this.administratorId);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(googleAccountEmail)) throw new Error('Invalid Google account email.');
    const encryptedRefreshToken = encryptRefreshToken(refreshToken, this.key);
    await this.repository.save({ googleAccountEmail, encryptedRefreshToken, connectedByUserId: userId! });
  }

  // For a future backend Drive client only. Never return this through an API.
  async loadForBackend(): Promise<{ googleAccountEmail: string; refreshToken: string } | null> {
    const stored = await this.repository.load();
    return stored ? { googleAccountEmail: stored.googleAccountEmail, refreshToken: decryptRefreshToken(stored.encryptedRefreshToken, this.key) } : null;
  }

  async disconnect(userId: string | undefined): Promise<void> {
    assertIntegrationAdministrator(userId, this.administratorId);
    await this.repository.remove();
  }
}

export async function userCanAccessRecordingDestination(userId: string, folderId: string | null, action: FolderAction, administratorId?: string): Promise<boolean> {
  if (folderId === null || folderId === recordingDriveRootId()) return canAccessRecordingFolder(null, action, undefined, userId === administratorId);
  validateDriveFolderId(folderId);
  const folder = await db.query.recordingBatchFolders.findFirst({ where: eq(recordingBatchFolders.folderId, folderId) });
  if (!folder) return false;
  const permission = await db.query.recordingBatchFolderPermissions.findFirst({ where: and(
    eq(recordingBatchFolderPermissions.folderId, folderId), eq(recordingBatchFolderPermissions.userId, userId),
  ) });
  return canAccessRecordingFolder(folderId, action, permission?.role, userId === administratorId);
}
