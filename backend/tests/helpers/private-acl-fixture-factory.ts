import type { Sql } from 'postgres';
import { createHash, randomUUID } from 'node:crypto';

/**
 * Test-only fixture orchestration. Security-sensitive states are produced by
 * injected real service transitions; this helper never inserts verified,
 * granted, fenced, or published rows directly.
 */
export type PrivateAclFixtureTransitions = {
  createUser(input: { email: string; password: string; emailVerified: boolean }): Promise<{ id: string; sessionId: string }>;
  linkGoogleIdentity(userId: string, subject: string, email: string): Promise<void>;
  createMeeting(input: { creatorId: string; hostId: string; folderId: string | null; accessPolicy: 'private' }): Promise<{ id: string }>;
  createRecordingJob(input: { ownerId: string; meetingId: string; recordingId: string; mimeType: string; byteLength: number; sha256: string; destinationFolderId: string }): Promise<{ id: string }>;
  ingestAndVerifyRecording(input: { jobId: string; ownerId: string; recordingId: string; bytes: Uint8Array }): Promise<void>;
  verifyDriveFile(input: { jobId: string; ownerId: string }): Promise<void>;
  publishHistory(input: { jobId: string; ownerId: string }): Promise<void>;
};

export type PrivateAclFixture = {
  sql: Sql;
  owner: { id: string; sessionId: string };
  manager?: { id: string; sessionId: string };
  meeting: { id: string };
  job: { id: string; recordingId: string };
};

export async function createPrivateAclFixture(sql: Sql, transitions: PrivateAclFixtureTransitions, options?: { includeManager?: boolean }) {
  const owner = await transitions.createUser({ email: `fixture-owner-${Date.now()}@example.test`, password: 'fixture-only-password', emailVerified: true });
  const manager = options?.includeManager ? await transitions.createUser({ email: `fixture-manager-${Date.now()}@example.test`, password: 'fixture-only-password', emailVerified: true }) : undefined;
  await transitions.linkGoogleIdentity(owner.id, 'fixture-owner-sub', `fixture-owner-${owner.id}@example.test`);
  if (manager) await transitions.linkGoogleIdentity(manager.id, 'fixture-manager-sub', `fixture-manager-${manager.id}@example.test`);
  const meeting = await transitions.createMeeting({ creatorId: owner.id, hostId: owner.id, folderId: 'fixture-folder', accessPolicy: 'private' });
  const recordingId = randomUUID();
  const bytes = new TextEncoder().encode('fixture-recording-bytes');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const job = await transitions.createRecordingJob({ ownerId: owner.id, meetingId: meeting.id, recordingId, mimeType: 'video/webm', byteLength: bytes.byteLength, sha256, destinationFolderId: 'fixture-folder' });
  await transitions.ingestAndVerifyRecording({ jobId: job.id, ownerId: owner.id, recordingId, bytes });
  return { sql, owner, manager, meeting, job, bytes, verifyDriveFile: () => transitions.verifyDriveFile({ jobId: job.id, ownerId: owner.id }), publishHistory: () => transitions.publishHistory({ jobId: job.id, ownerId: owner.id }) };
}
